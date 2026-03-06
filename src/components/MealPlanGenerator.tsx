import { useState, useMemo, useEffect } from "react";
import { useMeals, type Meal } from "@/hooks/useMeals";
import { useShoppingList } from "@/hooks/useShoppingList";
import { Dice5, Flame, Weight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/hooks/usePreferences";

const MENU_PREF_KEY = "menu_generator_selected_ids_v1";

function parseIngredientLine(raw: string) {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { qty: 0, count: 0, name: "", display: "" };

  const unitRegex = "(?:g|gr|gramme?s?|kg|ml|cl|l)";
  const matchFull = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i"));
  if (matchFull) {
    return { qty: parseFloat(matchFull[1].replace(",", ".")), count: parseFloat(matchFull[2].replace(",", ".")), name: matchFull[3].trim(), display: trimmed };
  }

  const matchUnit = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(.+)$`, "i"));
  if (matchUnit) {
    return { qty: parseFloat(matchUnit[1].replace(",", ".")), count: 0, name: matchUnit[2].trim(), display: trimmed };
  }

  const matchNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (matchNum) {
    return { qty: 0, count: parseFloat(matchNum[1].replace(",", ".")), name: matchNum[2].trim(), display: trimmed };
  }

  return { qty: 0, count: 0, name: trimmed, display: trimmed };
}

function normalizeKey(name: string) {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").replace(/s$/, "").trim();
}

function keyMatch(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  return na === nb;
}

function parseStoredIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** Parse Nb value from shopping item */
function parseNbValue(nb: string | null, type: string | null): { grams: number; count: number } | null {
  if (!nb) return null;
  const val = parseFloat(nb.replace(/[^0-9.,]/g, '').replace(',', '.'));
  if (isNaN(val) || val <= 0) return null;
  if (type === 'g' || (!type && /g/i.test(nb))) return { grams: val, count: 0 };
  return { grams: 0, count: val };
}

/** Get recipe ingredient usage as a map: normalizedName → {grams, count} */
function getRecipeUsage(recipe: Meal): Map<string, { grams: number; count: number }> {
  const usage = new Map<string, { grams: number; count: number }>();
  if (!recipe.ingredients) return usage;
  const groups = recipe.ingredients.split(/(?:\n|,(?!\d))/).map((s) => s.trim()).filter(Boolean);
  for (const group of groups) {
    const alts = group.split(/\|/);
    const first = alts[0]?.trim();
    if (!first) continue;
    const parsed = parseIngredientLine(first);
    if (!parsed.name) continue;
    const key = normalizeKey(parsed.name);
    const prev = usage.get(key) || { grams: 0, count: 0 };
    usage.set(key, { grams: prev.grams + parsed.qty, count: prev.count + parsed.count });
  }
  return usage;
}

export function MealPlanGenerator() {
  const { getMealsByCategory } = useMeals();
  const { items: shoppingItems } = useShoppingList();
  const { getPreference, setPreference } = usePreferences();

  const allPlats = getMealsByCategory("plat");
  const persistedRaw = getPreference<unknown>(MENU_PREF_KEY, null);
  const persistedIds = useMemo(() => parseStoredIds(persistedRaw), [JSON.stringify(persistedRaw)]);

  const [selectedMealIds, setSelectedMealIds] = useState<string[]>([]);

  useEffect(() => {
    if (persistedIds.length === 0) return;
    setSelectedMealIds((prev) => (prev.length === 0 ? persistedIds : prev));
  }, [persistedIds.join("|")]);

  const selectedMeals = useMemo(() => {
    if (selectedMealIds.length === 0 || allPlats.length === 0) return [];
    return selectedMealIds
      .map((mealId) => allPlats.find((meal) => meal.id === mealId))
      .filter((meal): meal is Meal => !!meal);
  }, [selectedMealIds, allPlats]);

  // Build shopping inventory from items with Nb (content_quantity)
  const shoppingInventory = useMemo(() => {
    const inv = new Map<string, { grams: number; count: number }>();
    for (const item of shoppingItems) {
      const nb = parseNbValue(item.content_quantity, (item as any).content_quantity_type);
      if (!nb) continue; // no Nb = infinite, don't constrain
      const key = normalizeKey(item.name);
      const qty = parseInt(item.quantity || '1') || 1;
      const prev = inv.get(key) || { grams: 0, count: 0 };
      inv.set(key, {
        grams: prev.grams + nb.grams * qty,
        count: prev.count + nb.count * qty,
      });
    }
    return inv;
  }, [shoppingItems]);

  const generatePlan = () => {
    const avantGrimpe = allPlats.find((m) => m.name.toLowerCase().includes("avant grimpe"));
    const painFuet = allPlats.find((m) => m.name.toLowerCase().replace(/\s+/g, ' ').includes("pain + fuet") || m.name.toLowerCase().replace(/\s+/g, ' ').includes("pain+fuet"));
    const excludeIds = new Set([avantGrimpe?.id, painFuet?.id].filter(Boolean) as string[]);
    const candidatePlats = allPlats.filter((m) => !excludeIds.has(m.id));

    if (candidatePlats.length === 0) return;

    // Build remaining inventory (mutable copy)
    const remaining = new Map<string, { grams: number; count: number }>();
    for (const [k, v] of shoppingInventory) {
      remaining.set(k, { ...v });
    }
    const hasInventory = remaining.size > 0;

    const selectedIds: string[] = [];
    const counts = new Map<string, number>();

    // Greedy selection: 16 recipes
    for (let i = 0; i < 16; i++) {
      let bestScore = -1;
      let bestId = '';

      if (hasInventory) {
        for (const recipe of candidatePlats) {
          if ((counts.get(recipe.id) || 0) >= 2) continue;
          const usage = getRecipeUsage(recipe);
          let score = 0;
          let usesConstrainedItem = false;

          for (const [ingKey, used] of usage) {
            // Find matching inventory key
            let matchKey: string | null = null;
            for (const rk of remaining.keys()) {
              if (rk === ingKey || keyMatch(rk, ingKey)) { matchKey = rk; break; }
            }
            if (!matchKey) continue;
            const avail = remaining.get(matchKey)!;
            usesConstrainedItem = true;

            if (used.grams > 0 && avail.grams > 0) {
              const pct = Math.min(1, used.grams / avail.grams);
              score += pct;
              // Bonus for exactly finishing the package
              if (Math.abs(avail.grams - used.grams) < 1) score += 2;
            }
            if (used.count > 0 && avail.count > 0) {
              const pct = Math.min(1, used.count / avail.count);
              score += pct;
              if (Math.abs(avail.count - used.count) < 0.5) score += 2;
            }
          }

          if (usesConstrainedItem) score += 0.5;
          if (score > bestScore) {
            bestScore = score;
            bestId = recipe.id;
          }
        }
      }

      if (bestScore <= 0 || !bestId) {
        // Random pick from remaining pool
        const pool = candidatePlats.filter(r => (counts.get(r.id) || 0) < 2);
        if (pool.length === 0) break;
        bestId = pool[Math.floor(Math.random() * pool.length)].id;
      }

      selectedIds.push(bestId);
      counts.set(bestId, (counts.get(bestId) || 0) + 1);

      // Deduct from remaining inventory
      const recipe = candidatePlats.find(r => r.id === bestId);
      if (recipe && hasInventory) {
        const usage = getRecipeUsage(recipe);
        for (const [ingKey, used] of usage) {
          let matchKey: string | null = null;
          for (const rk of remaining.keys()) {
            if (rk === ingKey || keyMatch(rk, ingKey)) { matchKey = rk; break; }
          }
          if (!matchKey) continue;
          const avail = remaining.get(matchKey)!;
          remaining.set(matchKey, {
            grams: Math.max(0, avail.grams - used.grams),
            count: Math.max(0, avail.count - used.count),
          });
        }
      }
    }

    if (avantGrimpe) {
      for (let i = 0; i < 4; i++) selectedIds.push(avantGrimpe.id);
    }

    setSelectedMealIds(selectedIds);
    setPreference.mutate({ key: MENU_PREF_KEY, value: selectedIds });
  };

  const shoppingItems2 = useMemo(() => {
    const map = new Map<string, { grams: number; count: number; displayName: string }>();

    for (const meal of selectedMeals) {
      if (!meal.ingredients) continue;
      const groups = meal.ingredients.split(/(?:\n|,(?!\d))/).map((s) => s.trim()).filter(Boolean);
      for (const group of groups) {
        const alts = group.split(/\|/);
        const first = alts[0]?.trim();
        if (!first) continue;
        const parsed = parseIngredientLine(first);
        if (!parsed.name) continue;
        const key = normalizeKey(parsed.name);
        const existing = map.get(key) || { grams: 0, count: 0, displayName: parsed.name };
        map.set(key, {
          grams: existing.grams + parsed.qty,
          count: existing.count + parsed.count,
          displayName: existing.displayName,
        });
      }
    }

    return Array.from(map.entries())
      .map(([, v]) => v)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
  }, [selectedMeals]);

  const totalCal = selectedMeals.reduce((sum, m) => {
    const c = parseFloat((m.calories || "0").replace(/[^0-9.]/g, "")) || 0;
    return sum + c;
  }, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">🎲 Menu semaine</h2>
        <div className="flex items-center gap-2">
          {totalCal > 0 && (
            <span className="flex items-center gap-1 text-sm font-black text-orange-500">
              <Flame className="h-4 w-4" />
              {Math.round(totalCal)} kcal
            </span>
          )}
          <Button onClick={generatePlan} className="rounded-full gap-1.5 text-xs">
            <Dice5 className="h-3.5 w-3.5" />
            Générer
          </Button>
        </div>
      </div>

      {selectedMeals.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8 italic">
          Clique sur "Générer" pour créer un menu aléatoire de 20 plats
        </p>
      ) : (
        <>
          <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
              🍽️ Plats sélectionnés ({selectedMeals.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedMeals.map((meal, i) => (
                <div
                  key={`${meal.id}-${i}`}
                  className="rounded-2xl px-3 py-2 shadow-md text-white"
                  style={{ backgroundColor: meal.color }}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-sm flex-1 min-w-0 break-words">{meal.name}</span>
                    {meal.calories && (
                      <span className="text-[10px] text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0">
                        <Flame className="h-2.5 w-2.5" />{meal.calories}
                      </span>
                    )}
                    {meal.grams && (
                      <span className="text-[10px] text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0">
                        <Weight className="h-2.5 w-2.5" />{meal.grams}
                      </span>
                    )}
                  </div>
                  {meal.ingredients && (
                    <p className="text-[10px] text-white/50 mt-0.5 break-words">
                      {meal.ingredients.split(/[,\n]+/).filter(Boolean).map((s) => s.trim()).join(" • ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
              🛒 Liste d'ingrédients ({shoppingItems2.length})
            </p>
            <div className="space-y-1">
              {shoppingItems2.map((item, i) => (
                <div key={i} className="flex items-center gap-2 py-1 px-2 rounded-xl bg-muted/40 text-sm">
                  <span className="font-medium text-foreground flex-1">{item.displayName}</span>
                  {item.grams > 0 && (
                    <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 font-mono">
                      {Math.round(item.grams)}g
                    </span>
                  )}
                  {item.count > 0 && (
                    <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 font-mono">
                      ×{Math.round(item.count)}
                    </span>
                  )}
                </div>
              ))}
              {shoppingItems2.length === 0 && (
                <p className="text-xs text-muted-foreground italic text-center py-2">Aucun ingrédient à afficher</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
