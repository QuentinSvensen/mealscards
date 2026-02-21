import { useState, useCallback, useEffect } from "react";
import { z } from "zod";
import { Plus, Copy, Trash2, Timer, Flame, Weight, Calendar, ArrowUpDown, CalendarDays, Infinity as InfinityIcon, UtensilsCrossed, Refrigerator, Package, Snowflake, Hash, ChevronDown, ChevronRight, Minus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// ─── Types ──────────────────────────────────────────────────────────────────

export type StorageType = 'frigo' | 'sec' | 'surgele';

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
  storage_type: StorageType;
  quantity: number | null;
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const FOOD_COLORS = [
  "hsl(345, 45%, 48%)", "hsl(22, 55%, 48%)", "hsl(155, 35%, 40%)",
  "hsl(215, 45%, 46%)", "hsl(275, 35%, 48%)", "hsl(40, 50%, 44%)",
  "hsl(185, 40%, 40%)", "hsl(5, 40%, 46%)", "hsl(130, 30%, 40%)",
  "hsl(240, 35%, 50%)", "hsl(315, 30%, 46%)", "hsl(60, 35%, 40%)",
  "hsl(0, 60%, 42%)", "hsl(30, 65%, 40%)", "hsl(90, 35%, 38%)",
  "hsl(170, 45%, 35%)", "hsl(200, 50%, 42%)", "hsl(250, 40%, 45%)",
  "hsl(290, 35%, 42%)", "hsl(330, 45%, 44%)", "hsl(15, 50%, 45%)",
  "hsl(50, 45%, 38%)", "hsl(110, 30%, 36%)", "hsl(145, 40%, 38%)",
  "hsl(180, 35%, 38%)", "hsl(220, 40%, 40%)", "hsl(260, 30%, 48%)",
  "hsl(300, 30%, 40%)", "hsl(340, 40%, 42%)", "hsl(10, 45%, 43%)",
  "hsl(70, 40%, 36%)", "hsl(120, 35%, 42%)", "hsl(160, 30%, 40%)",
  "hsl(190, 45%, 36%)", "hsl(230, 35%, 44%)", "hsl(270, 40%, 42%)",
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
        storage_type: d.storage_type ?? (d.is_dry ? 'sec' : 'frigo'),
        quantity: d.quantity ?? null,
      })) as FoodItem[];
    },
    retry: 3,
    retryDelay: 500,
  });

  const addItem = useMutation({
    mutationFn: async ({ name, storage_type }: { name: string; storage_type: StorageType }) => {
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
      const { error } = await supabase
        .from("food_items")
        .insert({ name, sort_order: maxOrder + 1, is_dry: storage_type === 'sec', storage_type } as any);
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
      const { data: inserted, error } = await supabase.from("food_items").insert({
        name: source.name,
        grams: source.grams,
        calories: source.calories,
        expiration_date: source.expiration_date,
        counter_start_date: source.counter_start_date,
        is_meal: source.is_meal,
        is_infinite: source.is_infinite,
        is_dry: source.is_dry,
        storage_type: source.storage_type,
        quantity: source.quantity,
        sort_order: maxOrder + 1,
      } as any).select().single();
      if (error) throw error;
      return { newId: inserted.id, sourceId: source.id };
    },
    onSuccess: (result) => {
      if (result) {
        const overrides = JSON.parse(sessionStorage.getItem('color_overrides') || '{}');
        overrides[result.newId] = result.sourceId;
        sessionStorage.setItem('color_overrides', JSON.stringify(overrides));
      }
      invalidate();
    },
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
  const [editing, setEditing] = useState<"name" | "grams" | "calories" | "quantity" | null>(null);
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
    if (editing === "quantity") onUpdate({ quantity: val ? parseInt(val) || null : null });
    setEditing(null);
  };

  const startEdit = (field: "name" | "grams" | "calories" | "quantity") => {
    if (field === "quantity") {
      setEditValue(item.quantity ? String(item.quantity) : "");
    } else {
      setEditValue(field === "name" ? item.name : field === "grams" ? (item.grams ?? "") : (item.calories ?? ""));
    }
    setEditing(field);
  };

  const selectedDate = item.expiration_date ? parseISO(item.expiration_date) : undefined;

  const handleGramsCycle = () => {
    if (item.is_infinite) {
      onUpdate({ is_infinite: false, grams: null });
    } else if (item.grams) {
      onUpdate({ is_infinite: true, grams: null });
    } else {
      startEdit("grams");
    }
  };

  const handleDecrementQuantity = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentQty = item.quantity ?? 1;
    if (currentQty <= 1) {
      onDelete();
    } else {
      onUpdate({ quantity: currentQty - 1 });
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
            className="font-semibold text-white text-sm flex-1 text-left hover:underline decoration-white/40 min-w-0 break-words whitespace-normal"
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

        {/* Quantity (item count) with decrement button */}
        {editing === "quantity" ? (
          <Input
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={e => e.key === "Enter" && saveEdit()}
            placeholder="Ex: 3"
            inputMode="numeric"
            className="h-6 w-14 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5"
          />
        ) : item.quantity ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={handleDecrementQuantity}
              className="h-5 w-5 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/40 text-white/80 hover:text-white transition-all"
              title="Retirer 1"
            >
              <Minus className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={() => startEdit("quantity")}
              className="text-[10px] text-white/90 bg-white/25 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/35 font-bold"
              title="Quantité"
            >
              <Hash className="h-2.5 w-2.5" />{item.quantity}
            </button>
          </div>
        ) : null}

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

        <Button size="icon" variant="ghost" onClick={onDuplicate} className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/20" title="Dupliquer">
          <Copy className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onDelete} className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/20" title="Supprimer">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Row 2: quick-add + expiration + counter */}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {!item.quantity && editing !== "quantity" && (
          <button onClick={() => startEdit("quantity")} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Hash className="h-2.5 w-2.5" />+ quantité
          </button>
        )}
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

const STORAGE_SECTIONS: { type: StorageType; label: string; emoji: React.ReactNode }[] = [
  { type: 'frigo', label: 'Frigo', emoji: <Refrigerator className="h-4 w-4 text-blue-400" /> },
  { type: 'sec', label: 'Placard sec', emoji: <Package className="h-4 w-4 text-amber-500" /> },
  { type: 'surgele', label: 'Surgelés', emoji: <Snowflake className="h-4 w-4 text-cyan-400" /> },
];

export function FoodItems() {
  const { items, isLoading, addItem, updateItem, deleteItem, duplicateItem, reorderItems } = useFoodItems();
  const [newName, setNewName] = useState("");
  const [showStoragePrompt, setShowStoragePrompt] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Independent sort per section
  const [sortModes, setSortModes] = useState<Record<StorageType, SortMode>>(() => {
    const saved = localStorage.getItem('food_sort_modes');
    return saved ? JSON.parse(saved) : { frigo: 'manual', sec: 'manual', surgele: 'manual' };
  });

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Persist sort modes
  useEffect(() => {
    localStorage.setItem('food_sort_modes', JSON.stringify(sortModes));
  }, [sortModes]);

  // Use item.id for color; if a duplicate, use source's id for same color
  const colorMap = useCallback((item: FoodItem) => {
    const overrides = JSON.parse(sessionStorage.getItem('color_overrides') || '{}') as Record<string, string>;
    let seedId = item.id;
    let visited = new Set<string>();
    while (overrides[seedId] && !visited.has(seedId)) {
      visited.add(seedId);
      seedId = overrides[seedId];
    }
    return colorFromName(seedId);
  }, []);

  const normalizeSearch = (text: string) =>
    text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/s$/g, "");

  const filterBySearch = (itemsList: FoodItem[]): FoodItem[] => {
    if (!searchQuery.trim()) return itemsList;
    const q = normalizeSearch(searchQuery);
    return itemsList.filter(item => normalizeSearch(item.name).includes(q));
  };

  const getSortedItems = (storageType: StorageType): FoodItem[] => {
    const sectionItems = items.filter(i => i.storage_type === storageType);
    let sorted: FoodItem[];
    if (sortModes[storageType] === "expiration") {
      sorted = [...sectionItems].sort((a, b) => {
        const aExpired = isExpiredDate(a.expiration_date);
        const bExpired = isExpiredDate(b.expiration_date);
        const aCounter = getCounterDays(a.counter_start_date);
        const bCounter = getCounterDays(b.counter_start_date);

        // Group 1: expired WITH counter (highest counter first, then earliest date)
        const aG1 = aExpired && aCounter !== null;
        const bG1 = bExpired && bCounter !== null;
        if (aG1 && !bG1) return -1;
        if (!aG1 && bG1) return 1;
        if (aG1 && bG1) {
          if (aCounter !== bCounter) return (bCounter ?? 0) - (aCounter ?? 0);
          return (a.expiration_date ?? '').localeCompare(b.expiration_date ?? '');
        }

        // Group 2: not expired WITH counter
        const aG2 = !aExpired && aCounter !== null;
        const bG2 = !bExpired && bCounter !== null;
        if (aG2 && !bG2) return -1;
        if (!aG2 && bG2) return 1;
        if (aG2 && bG2) {
          return (bCounter ?? 0) - (aCounter ?? 0);
        }

        // Group 3: expired WITHOUT counter
        const aG3 = aExpired && aCounter === null;
        const bG3 = bExpired && bCounter === null;
        if (aG3 && !bG3) return -1;
        if (!aG3 && bG3) return 1;
        if (aG3 && bG3) {
          return (a.expiration_date ?? '').localeCompare(b.expiration_date ?? '');
        }

        // Group 4: not expired, no counter — nearest first
        if (!a.expiration_date && !b.expiration_date) return 0;
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        return a.expiration_date.localeCompare(b.expiration_date);
      });
    } else {
      sorted = sectionItems;
    }
    return filterBySearch(sorted);
  };

  const handleAdd = () => {
    const result = foodItemSchema.safeParse({ name: newName });
    if (!result.success) {
      toast({ title: "Données invalides", description: result.error.errors[0].message, variant: "destructive" });
      return;
    }
    setPendingName(result.data.name);
    setShowStoragePrompt(true);
  };

  const confirmAdd = (storageType: StorageType) => {
    addItem.mutate({ name: pendingName, storage_type: storageType }, {
      onSuccess: () => { setNewName(""); setPendingName(""); setShowStoragePrompt(false); toast({ title: "Aliment ajouté 🥕" }); },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast({ title: "Erreur lors de l'ajout", description: msg, variant: "destructive" });
      },
    });
  };

  const handleReorder = (storageType: StorageType, fromIndex: number, toIndex: number) => {
    const sectionItems = getSortedItems(storageType);
    const reordered = [...sectionItems];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    reorderItems.mutate(reordered.map((item, i) => ({ id: item.id, sort_order: i })));
    setSortModes(prev => ({ ...prev, [storageType]: "manual" }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground animate-pulse">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Add form + search */}
      <div className="flex gap-2 mb-4">
        <Input
          placeholder="Nom de l'aliment (ex : Crème fraîche)"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          className="flex-1 rounded-xl"
        />
        <div className="relative shrink-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Rechercher…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-28 sm:w-36 rounded-xl pl-7 h-10"
          />
        </div>
        <Button onClick={handleAdd} disabled={!newName.trim()} className="rounded-full gap-1 shrink-0">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Ajouter</span>
        </Button>
      </div>

      {/* Storage type prompt */}
      {showStoragePrompt && (
        <div className="mb-4 rounded-2xl bg-card border p-4 shadow-lg">
          <p className="text-sm font-semibold text-foreground mb-3">Où ranger « {pendingName} » ?</p>
          <div className="flex gap-2">
            <Button onClick={() => confirmAdd('frigo')} variant="outline" className="flex-1 gap-1.5">
              <Refrigerator className="h-4 w-4 text-blue-400" /> Frigo
            </Button>
            <Button onClick={() => confirmAdd('sec')} variant="outline" className="flex-1 gap-1.5">
              <Package className="h-4 w-4 text-amber-500" /> Sec
            </Button>
            <Button onClick={() => confirmAdd('surgele')} variant="outline" className="flex-1 gap-1.5">
              <Snowflake className="h-4 w-4 text-cyan-400" /> Surgelé
            </Button>
          </div>
          <button onClick={() => setShowStoragePrompt(false)} className="text-xs text-muted-foreground mt-2 w-full text-center hover:text-foreground">
            Annuler
          </button>
        </div>
      )}

      {/* Sections */}
      {STORAGE_SECTIONS.map((section, idx) => (
        <div key={section.type} className={idx > 0 ? "mt-4" : ""}>
          <FoodSection
            emoji={section.emoji}
            title={section.label}
            storageType={section.type}
            items={getSortedItems(section.type)}
            colorMap={colorMap}
            onUpdate={(id, updates) => updateItem.mutate({ id, ...updates })}
            onDelete={(id) => deleteItem.mutate(id)}
            onDuplicate={(id) => duplicateItem.mutate(id)}
            sortMode={sortModes[section.type]}
            onToggleSort={() => setSortModes(prev => ({ ...prev, [section.type]: prev[section.type] === "manual" ? "expiration" : "manual" }))}
            onReorder={(from, to) => handleReorder(section.type, from, to)}
            dragIndex={dragIndex}
            setDragIndex={setDragIndex}
            allItems={items}
            onChangeStorage={(id, st) => updateItem.mutate({ id, storage_type: st, is_dry: st === 'sec' })}
          />
        </div>
      ))}
    </div>
  );
}

// ─── FoodSection ─────────────────────────────────────────────────────────────

interface FoodSectionProps {
  emoji: React.ReactNode;
  title: string;
  storageType: StorageType;
  items: FoodItem[];
  colorMap: (item: FoodItem) => string;
  onUpdate: (id: string, updates: Partial<FoodItem>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  sortMode: SortMode;
  onToggleSort: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
  allItems: FoodItem[];
  onChangeStorage: (id: string, storageType: StorageType) => void;
}

function FoodSection({ emoji, title, storageType, items, colorMap, onUpdate, onDelete, onDuplicate, sortMode, onToggleSort, onReorder, dragIndex, setDragIndex, allItems, onChangeStorage }: FoodSectionProps) {
  const SortIcon = sortMode === "expiration" ? CalendarDays : ArrowUpDown;
  const sortLabel = sortMode === "expiration" ? "Péremption" : "Manuel";
  const [sectionDragOver, setSectionDragOver] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={`rounded-3xl bg-card/80 backdrop-blur-sm p-4 transition-all ${sectionDragOver ? "ring-2 ring-primary/40" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setSectionDragOver(true); }}
      onDragLeave={() => setSectionDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSectionDragOver(false);
        const itemId = e.dataTransfer.getData("foodItemId");
        const fromStorage = e.dataTransfer.getData("foodItemStorage");
        if (itemId && fromStorage !== storageType) {
          onChangeStorage(itemId, storageType);
          setDragIndex(null);
        }
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setCollapsed(c => !c)} className="flex items-center gap-2 flex-1 text-left">
          {collapsed
            ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          }
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            {emoji} {title}
          </h2>
        </button>
        <span className="text-sm font-normal text-muted-foreground">{items.length}</span>
        <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-7 px-2">
          <SortIcon className="h-3 w-3" />
          <span className="hidden sm:inline">{sortLabel}</span>
        </Button>
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-2">
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6 italic">
              Aucun aliment — glisse une carte depuis une autre section
            </p>
          ) : (
            items.map((item, sectionIdx) => (
              <FoodItemCard
                key={item.id}
                item={item}
                color={colorMap(item)}
                onUpdate={(updates) => onUpdate(item.id, updates)}
                onDelete={() => onDelete(item.id)}
                onDuplicate={() => onDuplicate(item.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData("foodItemIndex", String(sectionIdx));
                  e.dataTransfer.setData("foodItemId", item.id);
                  e.dataTransfer.setData("foodItemStorage", item.storage_type);
                  setDragIndex(sectionIdx);
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const fromId = e.dataTransfer.getData("foodItemId");
                  const fromStorage = e.dataTransfer.getData("foodItemStorage");
                  if (fromStorage === storageType && dragIndex !== null && dragIndex !== sectionIdx) {
                    onReorder(dragIndex, sectionIdx);
                  }
                  if (fromId && fromStorage !== storageType) {
                    onChangeStorage(fromId, storageType);
                  }
                  setDragIndex(null);
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
