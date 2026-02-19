import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles, Infinity as InfinityIcon } from "lucide-react";
import type { FoodItem } from "@/components/FoodItems";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Meal } from "@/hooks/useMeals";

// ── Helpers (same logic as Index.tsx AvailableList) ──────────────────────────

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function parseQty(qty: string | null | undefined): number {
  if (!qty) return 0;
  const n = parseFloat(qty.replace(",", ".").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseIngredientLine(ing: string): { qty: number; name: string } {
  const m = ing.match(/^(\d+(?:[.,]\d+)?)\s*(?:[a-zA-Zµ°%]+\.?)?\s+(.*)/i);
  if (m) return { qty: parseFloat(m[1].replace(",", ".")), name: normalizeForMatch(m[2]) };
  return { qty: 0, name: normalizeForMatch(ing) };
}

function buildStockMap(foodItems: FoodItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const fi of foodItems) {
    const key = normalizeForMatch(fi.name);
    const prev = map.get(key) ?? 0;
    if (fi.is_infinite || prev === Infinity) {
      map.set(key, Infinity);
    } else {
      map.set(key, prev + parseQty(fi.grams));
    }
  }
  return map;
}

function findStockKey(stockMap: Map<string, number>, name: string): string | null {
  for (const key of stockMap.keys()) {
    if (key.includes(name) || name.includes(key)) return key;
  }
  return null;
}

function getMealMultiple(meal: Meal, stockMap: Map<string, number>): number | null {
  if (!meal.ingredients?.trim()) return null;
  const ingredients = meal.ingredients.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  if (ingredients.length === 0) return null;

  let multiple = Infinity;
  for (const ing of ingredients) {
    const { qty: needed, name } = parseIngredientLine(ing);
    const key = findStockKey(stockMap, name);
    if (key === null) return null;
    const available = stockMap.get(key)!;
    if (available === Infinity) continue;
    if (needed <= 0) continue;
    if (available < needed) return null;
    multiple = Math.min(multiple, Math.floor(available / needed));
  }
  return multiple === Infinity ? Infinity : multiple;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  foodItems: FoodItem[];
}

export function FoodItemsSuggestions({ foodItems }: Props) {
  const [open, setOpen] = useState(true);

  const { data: meals = [] } = useQuery({
    queryKey: ["meals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("meals").select("*").order("sort_order");
      if (error) throw error;
      return data as Meal[];
    },
  });

  const stockMap = buildStockMap(foodItems);

  const suggestions = meals
    .filter((m) => m.is_available && m.ingredients?.trim())
    .map((m) => ({ meal: m, multiple: getMealMultiple(m, stockMap) }))
    .filter(({ multiple }) => multiple !== null)
    .sort((a, b) => {
      const am = a.multiple === Infinity ? 999 : (a.multiple ?? 0);
      const bm = b.multiple === Infinity ? 999 : (b.multiple ?? 0);
      return bm - am;
    });

  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4 mt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-yellow-500" />
          Recettes réalisables
        </h2>
        <span className="text-sm font-normal text-muted-foreground">{suggestions.length}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 mt-3">
          {suggestions.map(({ meal, multiple }) => (
            <div
              key={meal.id}
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ backgroundColor: meal.color }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm truncate">{meal.name}</p>
                {meal.ingredients && (
                  <p className="text-white/60 text-[10px] truncate mt-0.5">
                    {meal.ingredients.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-0.5 bg-black/40 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0">
                x{multiple === Infinity ? <InfinityIcon className="inline h-3 w-3 ml-0.5" /> : multiple}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
