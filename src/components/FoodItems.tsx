import { useState, useCallback, useRef } from "react";
import { Plus, Copy, Trash2, Timer, Flame, Weight, Calendar, ArrowUpDown, CalendarDays } from "lucide-react";
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
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const FOOD_COLORS = [
  "hsl(345, 45%, 48%)", "hsl(22, 55%, 48%)", "hsl(155, 35%, 40%)",
  "hsl(215, 45%, 46%)", "hsl(275, 35%, 48%)", "hsl(40, 50%, 44%)",
  "hsl(185, 40%, 40%)", "hsl(5, 40%, 46%)", "hsl(130, 30%, 40%)",
  "hsl(240, 35%, 50%)", "hsl(315, 30%, 46%)", "hsl(60, 35%, 40%)",
];

function colorFromName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
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

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["food_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_items")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as FoodItem[];
    },
  });

  const addItem = useMutation({
    mutationFn: async (name: string) => {
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
      const { error } = await supabase
        .from("food_items")
        .insert({ name, sort_order: maxOrder + 1 });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<FoodItem> & { id: string }) => {
      const { error } = await supabase
        .from("food_items")
        .update(updates)
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
        sort_order: maxOrder + 1,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reorderItems = useMutation({
    mutationFn: async (ordered: { id: string; sort_order: number }[]) => {
      await Promise.all(ordered.map(({ id, sort_order }) =>
        supabase.from("food_items").update({ sort_order }).eq("id", id)
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

        {/* Grams */}
        {editing === "grams" ? (
          <Input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key === "Enter" && saveEdit()} placeholder="Ex: 500g" className="h-6 w-20 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5" />
        ) : item.grams ? (
          <button onClick={() => startEdit("grams")} className="text-[10px] text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30 shrink-0">
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

        <Button size="icon" variant="ghost" onClick={onDuplicate} className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/20" title="Dupliquer">
          <Copy className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onDelete} className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/20" title="Supprimer">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Row 2: quick-add + expiration + counter */}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {!item.grams && editing !== "grams" && (
          <button onClick={() => startEdit("grams")} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Weight className="h-2.5 w-2.5" />+ grammes
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

// ─── Main component ──────────────────────────────────────────────────────────

type SortMode = "manual" | "expiration";

export function FoodItems() {
  const { items, isLoading, addItem, updateItem, deleteItem, duplicateItem, reorderItems } = useFoodItems();
  const [newName, setNewName] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const colorMap = useCallback((name: string) => colorFromName(name), []);

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
    const name = newName.trim();
    if (!name) return;
    addItem.mutate(name, {
      onSuccess: () => { setNewName(""); toast({ title: "Aliment ajouté 🥕" }); },
      onError: (err: unknown) => {
        console.error("food_items insert error:", err);
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
          className="flex-1"
        />
        <Button onClick={handleAdd} disabled={!newName.trim()} className="rounded-full gap-1 shrink-0">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Ajouter</span>
        </Button>
      </div>

      {/* List */}
      <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-lg font-bold text-foreground flex-1">🥕 Ma cuisine</h2>
          <span className="text-sm font-normal text-muted-foreground">{items.length}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSortMode(m => m === "manual" ? "expiration" : "manual")}
            className="text-[10px] gap-0.5 h-7 px-2"
          >
            <SortIcon className="h-3 w-3" />
            <span className="hidden sm:inline">{sortLabel}</span>
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {sortedItems.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8 italic">
              Aucun aliment — ajoutez ce que vous avez dans votre cuisine
            </p>
          ) : (
            sortedItems.map((item, index) => (
              <FoodItemCard
                key={item.id}
                item={item}
                color={colorMap(item.name)}
                onUpdate={(updates) => updateItem.mutate({ id: item.id, ...updates })}
                onDelete={() => deleteItem.mutate(item.id)}
                onDuplicate={() => duplicateItem.mutate(item.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData("foodItemIndex", String(index));
                  setDragIndex(index);
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragIndex !== null && dragIndex !== index) {
                    handleReorder(dragIndex, index);
                  }
                  setDragIndex(null);
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
