import { useState, useCallback, useEffect } from "react";
import { z } from "zod";
import { Plus, Copy, Trash2, Timer, Flame, Weight, Calendar, ArrowUpDown, CalendarDays, Infinity as InfinityIcon, UtensilsCrossed, Refrigerator, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FoodItem {
  id: string;
  name: string;
  grams: string | null;
  calories: string | null;
  expiration_date: string | null;
  counter_start_date: string | null;
  sort_order: number;
  created_at: string;
  is_meal: boolean;
  is_infinite: boolean;
  is_dry: boolean;
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const FOOD_COLORS = [
  "hsl(345, 45%, 48%)", "hsl(22, 55%, 48%)", "hsl(155, 35%, 40%)",
  "hsl(215, 45%, 46%)", "hsl(275, 35%, 48%)", "hsl(40, 50%, 44%)",
  "hsl(185, 40%, 40%)", "hsl(5, 40%, 46%)", "hsl(130, 30%, 40%)",
  "hsl(240, 35%, 50%)", "hsl(315, 30%, 46%)", "hsl(60, 35%, 40%)",
];

/** Deterministic color from any string (id or name) — unique per input */
export function colorFromName(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return FOOD_COLORS[Math.abs(hash) % FOOD_COLORS.length];
}

function getCounterDays(startDate: string | null): number | null {
  if (!startDate) return null;
  return Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000);
}

function isExpiredDate(d: string | null) {
  if (!d) return false;
  return new Date(d) < new Date(new Date().toDateString());
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFoodItems() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["food_items"] });

  // Re-fetch when auth session becomes available (mirrors useMeals behavior)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        qc.invalidateQueries({ queryKey: ["food_items"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["food_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_items")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as any[]).map(d => ({
        ...d,
        is_meal: d.is_meal ?? false,
        is_infinite: d.is_infinite ?? false,
        is_dry: d.is_dry ?? false,
      })) as FoodItem[];
    },
    retry: 3,
    retryDelay: 500,
  });

  const addItem = useMutation({
    mutationFn: async (name: string) => {
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
      const { error } = await supabase
        .from("food_items")
        .insert({ name, sort_order: maxOrder + 1 } as any);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<FoodItem> & { id: string }) => {
      const { error } = await supabase
        .from("food_items")
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("food_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const duplicateItem = useMutation({
    mutationFn: async (id: string) => {
      const source = items.find(i => i.id === id);
      if (!source) return;
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
      const { error } = await supabase.from("food_items").insert({
        name: source.name,
        grams: source.grams,
        calories: source.calories,
        expiration_date: source.expiration_date,
        counter_start_date: source.counter_start_date,
        is_meal: source.is_meal,
        is_infinite: source.is_infinite,
        sort_order: maxOrder + 1,
      } as any);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reorderItems = useMutation({
    mutationFn: async (ordered: { id: string; sort_order: number }[]) => {
      await Promise.all(ordered.map(({ id, sort_order }) =>
        supabase.from("food_items").update({ sort_order } as any).eq("id", id)
      ));
    },
    onSuccess: invalidate,
  });

  return { items, isLoading, addItem, updateItem, deleteItem, duplicateItem, reorderItems };
}

// ─── FoodItemCard ────────────────────────────────────────────────────────────

interface FoodItemCardProps {
  item: FoodItem;
  color: string;
  onUpdate: (updates: Partial<FoodItem>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function FoodItemCard({ item, color, onUpdate, onDelete, onDuplicate, onDragStart, onDragOver, onDrop }: FoodItemCardProps) {
  const [editing, setEditing] = useState<"name" | "grams" | "calories" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [calOpen, setCalOpen] = useState(false);

  const expired = isExpiredDate(item.expiration_date);
  const counterDays = getCounterDays(item.counter_start_date);
  const counterUrgent = counterDays !== null && counterDays >= 3;

  const saveEdit = () => {
    const val = editValue.trim() || null;
    if (editing === "name" && val) onUpdate({ name: val });
    if (editing === "grams") onUpdate({ grams: val });
    if (editing === "calories") onUpdate({ calories: val });
    setEditing(null);
  };

  const startEdit = (field: "name" | "grams" | "calories") => {
    setEditValue(field === "name" ? item.name : field === "grams" ? (item.grams ?? "") : (item.calories ?? ""));
    setEditing(field);
  };

  const selectedDate = item.expiration_date ? parseISO(item.expiration_date) : undefined;

  // Cycle through grams states: normal → infinite → remove
  const handleGramsCycle = () => {
    if (item.is_infinite) {
      // Turn off infinite, clear grams
      onUpdate({ is_infinite: false, grams: null });
    } else if (item.grams) {
      // Has grams → make infinite
      onUpdate({ is_infinite: true, grams: null });
    } else {
      // No grams → start editing
      startEdit("grams");
    }
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex flex-col rounded-2xl px-3 py-2.5 shadow-md transition-all hover:scale-[1.01] hover:shadow-lg select-none cursor-grab active:cursor-grabbing ${expired ? 'ring-2 ring-red-500' : ''}`}
      style={{ backgroundColor: color }}
    >
      {/* Row 1: name + badges + actions */}
      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
        {editing === "name" ? (
          <Input
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={e => e.key === "Enter" && saveEdit()}
            className="h-7 flex-1 border-white/30 bg-white/20 text-white placeholder:text-white/60 text-sm min-w-0"
          />
        ) : (
          <button
            onClick={() => startEdit("name")}
            className="font-semibold text-white text-sm truncate flex-1 text-left hover:underline decoration-white/40"
          >
            {item.name}
          </button>
        )}

        {/* Counter badge */}
        {counterDays !== null && (
          <button
            onClick={() => onUpdate({ counter_start_date: null })}
            className={`text-[11px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5 border shrink-0 transition-all ${counterUrgent ? 'bg-red-600 text-white border-red-300 shadow-md animate-pulse' : 'bg-black/40 text-white border-white/30'}`}
            title="Cliquer pour arrêter le compteur"
          >
            <Timer className="h-2.5 w-2.5" />{counterDays}j
          </button>
        )}

        {/* Grams / Infinite */}
        {item.is_infinite ? (
          <button
            onClick={handleGramsCycle}
            className="text-[10px] text-white/90 bg-white/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/40 shrink-0 font-bold"
            title="Cliquer pour désactiver ∞"
          >
            <InfinityIcon className="h-2.5 w-2.5" />∞
          </button>
        ) : editing === "grams" ? (
          <Input
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={e => e.key === "Enter" && saveEdit()}
            placeholder="Ex: 500"
            className="h-6 w-20 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5"
          />
        ) : item.grams ? (
          <button
            onClick={handleGramsCycle}
            className="text-[10px] text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30 shrink-0"
            title="Cliquer pour rendre infini"
          >
            <Weight className="h-2.5 w-2.5" />{item.grams}
          </button>
        ) : null}

        {/* Calories */}
        {editing === "calories" ? (
          <Input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key === "Enter" && saveEdit()} placeholder="Ex: 200 kcal" className="h-6 w-24 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5" />
        ) : item.calories ? (
          <button onClick={() => startEdit("calories")} className="text-[10px] text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30 shrink-0">
            <Flame className="h-2.5 w-2.5" />{item.calories}
          </button>
        ) : null}

        {/* is_meal toggle */}
        <button
          onClick={() => onUpdate({ is_meal: !item.is_meal })}
          className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${item.is_meal ? 'bg-white/30 text-white border-white/50 font-bold' : 'bg-white/10 text-white/50 border-white/20'}`}
          title={item.is_meal ? "Se mange seul (désactiver)" : "Marquer comme repas à part entière"}
        >
          <UtensilsCrossed className="h-2.5 w-2.5" />
        </button>

        {/* is_dry toggle */}
        <button
          onClick={() => onUpdate({ is_dry: !item.is_dry })}
          className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${item.is_dry ? 'bg-amber-500/40 text-white border-amber-300/50 font-bold' : 'bg-white/10 text-white/50 border-white/20'}`}
          title={item.is_dry ? "Produit sec / placard (désactiver)" : "Marquer comme produit sec (placard)"}
        >
          <Package className="h-2.5 w-2.5" />
        </button>

        <Button size="icon" variant="ghost" onClick={onDuplicate} className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/20" title="Dupliquer">
          <Copy className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onDelete} className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/20" title="Supprimer">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Row 2: quick-add + expiration + counter */}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {!item.grams && !item.is_infinite && editing !== "grams" && (
          <button onClick={handleGramsCycle} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Weight className="h-2.5 w-2.5" />+ grammes
          </button>
        )}
        {!item.is_infinite && !item.grams && editing !== "grams" && (
          <button
            onClick={() => onUpdate({ is_infinite: true })}
            className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
            title="Disponible en quantité infinie"
          >
            <InfinityIcon className="h-2.5 w-2.5" />∞
          </button>
        )}
        {!item.calories && editing !== "calories" && (
          <button onClick={() => startEdit("calories")} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Flame className="h-2.5 w-2.5" />+ calories
          </button>
        )}

        {/* Expiration date picker */}
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button className={`h-5 min-w-[88px] border border-white/20 bg-white/10 text-white text-[10px] px-1.5 rounded-md flex items-center gap-0.5 hover:bg-white/20 transition-colors ${expired ? 'text-red-200' : ''}`}>
              <Calendar className="h-2.5 w-2.5 shrink-0" />
              {item.expiration_date
                ? format(parseISO(item.expiration_date), 'd MMM yy', { locale: fr })
                : <span className="text-white/40">Péremption</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarPicker
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                onUpdate({ expiration_date: date ? format(date, 'yyyy-MM-dd') : null });
                setCalOpen(false);
              }}
              initialFocus
            />
            {item.expiration_date && (
              <div className="p-2 border-t">
                <button onClick={() => { onUpdate({ expiration_date: null }); setCalOpen(false); }} className="text-xs text-muted-foreground hover:text-destructive w-full text-center">
                  Effacer la date
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Counter toggle */}
        <button
          onClick={() => onUpdate({ counter_start_date: item.counter_start_date ? null : new Date().toISOString() })}
          className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
          title={item.counter_start_date ? 'Arrêter compteur' : 'Démarrer compteur'}
        >
          <Timer className="h-2.5 w-2.5" />
          {item.counter_start_date ? 'Stop' : 'Compteur'}
        </button>
      </div>
    </div>
  );
}

// ─── Validation schema ───────────────────────────────────────────────────────
const foodItemSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(100, "Nom trop long (100 car. max)"),
});

// ─── Main component ──────────────────────────────────────────────────────────

type SortMode = "manual" | "expiration";

export function FoodItems() {
  const { items, isLoading, addItem, updateItem, deleteItem, duplicateItem, reorderItems } = useFoodItems();
  const [newName, setNewName] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Use item.id (not name) for color to ensure uniqueness per card
  const colorMap = useCallback((item: FoodItem) => colorFromName(item.id), []);

  const getSortedItems = (): FoodItem[] => {
    if (sortMode === "expiration") {
      return [...items].sort((a, b) => {
        if (!a.expiration_date && !b.expiration_date) return 0;
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        return a.expiration_date.localeCompare(b.expiration_date);
      });
    }
    return items;
  };

  const sortedItems = getSortedItems();

  const handleAdd = () => {
    const result = foodItemSchema.safeParse({ name: newName });
    if (!result.success) {
      toast({ title: "Données invalides", description: result.error.errors[0].message, variant: "destructive" });
      return;
    }
    addItem.mutate(result.data.name, {
      onSuccess: () => { setNewName(""); toast({ title: "Aliment ajouté 🥕" }); },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast({ title: "Erreur lors de l'ajout", description: msg, variant: "destructive" });
      },
    });
  };

  const handleReorder = (fromIndex: number, toIndex: number) => {
    const reordered = [...sortedItems];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    reorderItems.mutate(reordered.map((item, i) => ({ id: item.id, sort_order: i })));
    setSortMode("manual");
  };

  const SortIcon = sortMode === "expiration" ? CalendarDays : ArrowUpDown;
  const sortLabel = sortMode === "expiration" ? "Péremption" : "Manuel";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground animate-pulse">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Add form */}
      <div className="flex gap-2 mb-4">
        <Input
          placeholder="Nom de l'aliment (ex : Crème fraîche)"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          className="flex-1 rounded-xl"
        />
        <Button onClick={handleAdd} disabled={!newName.trim()} className="rounded-full gap-1 shrink-0">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Ajouter</span>
        </Button>
      </div>

      {/* Frigo section */}
      <FoodSection
        emoji={<Refrigerator className="h-4 w-4 text-blue-400" />}
        title="Frigo"
        isDry={false}
        items={sortedItems.filter(i => !i.is_dry)}
        colorMap={colorMap}
        onUpdate={(id, updates) => updateItem.mutate({ id, ...updates })}
        onDelete={(id) => deleteItem.mutate(id)}
        onDuplicate={(id) => duplicateItem.mutate(id)}
        sortMode={sortMode}
        onToggleSort={() => setSortMode(m => m === "manual" ? "expiration" : "manual")}
        sortedItems={sortedItems}
        onReorder={handleReorder}
        dragIndex={dragIndex}
        setDragIndex={setDragIndex}
      />

      {/* Sec / Placard section */}
      <div className="mt-4">
        <FoodSection
          emoji={<Package className="h-4 w-4 text-amber-500" />}
          title="Placard sec"
          isDry={true}
          items={sortedItems.filter(i => i.is_dry)}
          colorMap={colorMap}
          onUpdate={(id, updates) => updateItem.mutate({ id, ...updates })}
          onDelete={(id) => deleteItem.mutate(id)}
          onDuplicate={(id) => duplicateItem.mutate(id)}
          sortMode={sortMode}
          onToggleSort={() => setSortMode(m => m === "manual" ? "expiration" : "manual")}
          sortedItems={sortedItems}
          onReorder={handleReorder}
          dragIndex={dragIndex}
          setDragIndex={setDragIndex}
        />
      </div>
    </div>
  );
}

// ─── FoodSection ─────────────────────────────────────────────────────────────

interface FoodSectionProps {
  emoji: React.ReactNode;
  title: string;
  isDry: boolean;
  items: FoodItem[];
  colorMap: (item: FoodItem) => string;
  onUpdate: (id: string, updates: Partial<FoodItem>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  sortMode: SortMode;
  onToggleSort: () => void;
  sortedItems: FoodItem[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
}

function FoodSection({ emoji, title, isDry, items, colorMap, onUpdate, onDelete, onDuplicate, sortMode, onToggleSort, sortedItems, onReorder, dragIndex, setDragIndex }: FoodSectionProps) {
  const SortIcon = sortMode === "expiration" ? CalendarDays : ArrowUpDown;
  const sortLabel = sortMode === "expiration" ? "Péremption" : "Manuel";
  const [sectionDragOver, setSectionDragOver] = useState(false);

  return (
    <div
      className={`rounded-3xl bg-card/80 backdrop-blur-sm p-4 transition-all ${sectionDragOver ? "ring-2 ring-primary/40" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setSectionDragOver(true); }}
      onDragLeave={() => setSectionDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSectionDragOver(false);
        const itemId = e.dataTransfer.getData("foodItemId");
        const fromDry = e.dataTransfer.getData("foodItemIsDry") === "true";
        if (itemId && fromDry !== isDry) {
          onUpdate(itemId, { is_dry: isDry });
          setDragIndex(null);
        }
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2 flex-1">
          {emoji} {title}
        </h2>
        <span className="text-sm font-normal text-muted-foreground">{items.length}</span>
        <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-7 px-2">
          <SortIcon className="h-3 w-3" />
          <span className="hidden sm:inline">{sortLabel}</span>
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-6 italic">
            Aucun aliment — glisse une carte depuis l'autre section
          </p>
        ) : (
          items.map((item) => {
            const index = sortedItems.findIndex(i => i.id === item.id);
            return (
              <FoodItemCard
                key={item.id}
                item={item}
                color={colorMap(item)}
                onUpdate={(updates) => onUpdate(item.id, updates)}
                onDelete={() => onDelete(item.id)}
                onDuplicate={() => onDuplicate(item.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData("foodItemIndex", String(index));
                  e.dataTransfer.setData("foodItemId", item.id);
                  e.dataTransfer.setData("foodItemIsDry", String(item.is_dry));
                  setDragIndex(index);
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const fromId = e.dataTransfer.getData("foodItemId");
                  const fromDry = e.dataTransfer.getData("foodItemIsDry") === "true";
                  // Same-section reorder
                  if (fromDry === isDry && dragIndex !== null && dragIndex !== index) {
                    onReorder(dragIndex, index);
                  }
                  // Cross-section move handled by parent onDrop
                  if (fromId && fromDry !== isDry) {
                    onUpdate(fromId, { is_dry: isDry });
                  }
                  setDragIndex(null);
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
