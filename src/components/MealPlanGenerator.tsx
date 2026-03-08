import { useState, useMemo, useEffect, useRef } from "react";
import { useMeals, type Meal } from "@/hooks/useMeals";
import { useShoppingList } from "@/hooks/useShoppingList";
import { useFoodItems } from "@/components/FoodItems";
import { Dice5, Flame, Weight, HelpCircle, ArrowUpDown, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/hooks/usePreferences";
import { Separator } from "@/components/ui/separator";
import { normalizeKey, parseIngredientLineRaw, smartFoodContains } from "@/lib/ingredientUtils";

const MENU_PREF_KEY = "menu_generator_selected_ids_v1";
const MENU_NEEDS_KEY = "menu_generator_needs_v1";
const MENU_SORT_KEY = "menu_generator_sort_v1";

type MenuSortMode = "manual" | "calories" | "alphabetical";

function keyMatch(a: string, b: string): boolean {
  return normalizeKey(a) === normalizeKey(b);
}



function parseStoredIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function parseNbValue(nb: string | null, type: string | null): { grams: number; count: number } | null {
  if (!nb) return null;
  const val = parseFloat(nb.replace(/[^0-9.,]/g, '').replace(',', '.'));
  if (isNaN(val) || val <= 0) return null;
  if (type === 'g' || (!type && /g/i.test(nb))) return { grams: val, count: 0 };
  return { grams: 0, count: val };
}

/** Get recipe ingredient usage. No-ingredient meals → name is the ingredient */
function getRecipeUsage(recipe: Meal): Map<string, { grams: number; count: number; rawName: string }> {
  const usage = new Map<string, { grams: number; count: number; rawName: string }>();
  if (!recipe.ingredients) {
    const key = normalizeKey(recipe.name);
    usage.set(key, { grams: 0, count: 1, rawName: recipe.name });
    return usage;
  }
  const groups = recipe.ingredients.split(/(?:\n|,(?!\d))/).map((s) => s.trim()).filter(Boolean);
  for (const group of groups) {
    const alts = group.split(/\|/);
    const first = alts[0]?.trim();
    if (!first) continue;
    const parsed = parseIngredientLineRaw(first);
    if (!parsed.name) continue;
    const key = normalizeKey(parsed.name);
    const prev = usage.get(key) || { grams: 0, count: 0, rawName: parsed.rawName };
    usage.set(key, { grams: prev.grams + parsed.qty, count: prev.count + parsed.count, rawName: prev.rawName });
  }
  return usage;
}

export function MealPlanGenerator() {
  const { getMealsByCategory } = useMeals();
  const { items: shoppingItems, groups: shoppingGroups, toggleSecondaryCheck, updateItemQuantity } = useShoppingList();
  const { items: foodItems } = useFoodItems();
  const { getPreference, setPreference } = usePreferences();

  const allPlats = getMealsByCategory("plat");
  const persistedRaw = getPreference<unknown>(MENU_PREF_KEY, null);
  const persistedIds = useMemo(() => parseStoredIds(persistedRaw), [JSON.stringify(persistedRaw)]);
  const persistedNeeds = getPreference<Record<string, { grams: number; count: number }>>(MENU_NEEDS_KEY, {});

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

  // Identify frozen group IDs (surgelés/congelés)
  const frozenGroupIds = useMemo(() => {
    return new Set(
      shoppingGroups
        .filter(g => {
          const n = normalizeKey(g.name);
          return n.includes('surgele') || n.includes('congele');
        })
        .map(g => g.id)
    );
  }, [shoppingGroups]);

  // Identify "Toujours présents" group IDs
  const toujoursPresentGroupIds = useMemo(() => {
    return new Set(
      shoppingGroups
        .filter(g => {
          const n = normalizeKey(g.name);
          return n.includes('toujours present') || n.includes('toujours la');
        })
        .map(g => g.id)
    );
  }, [shoppingGroups]);

  // Build set of normalized keys for "Toujours présent" food items
  const toujoursFoodKeys = useMemo(() => {
    return new Set(
      foodItems.filter(fi => fi.storage_type === 'toujours').map(fi => normalizeKey(fi.name))
    );
  }, [foodItems]);

  // Build shopping inventory from items with Nb, excluding frozen
  const shoppingInventory = useMemo(() => {
    const inv = new Map<string, { grams: number; count: number; pkgGrams: number; pkgCount: number }>();
    for (const item of shoppingItems) {
      if (item.group_id && frozenGroupIds.has(item.group_id)) continue;
      const nb = parseNbValue(item.content_quantity, item.content_quantity_type);
      if (!nb) continue;
      const key = normalizeKey(item.name);
      const qty = parseInt(item.quantity || '1') || 1;
      const prev = inv.get(key) || { grams: 0, count: 0, pkgGrams: 0, pkgCount: 0 };
      inv.set(key, {
        grams: prev.grams + nb.grams * qty,
        count: prev.count + nb.count * qty,
        pkgGrams: nb.grams || prev.pkgGrams,
        pkgCount: nb.count || prev.pkgCount,
      });
    }
    return inv;
  }, [shoppingItems, frozenGroupIds]);

  const updateShoppingChecks = (needsMap: Map<string, { grams: number; count: number }>) => {
    const toujoursKeys = [...toujoursFoodKeys];
    const matchedItemIds = new Set<string>();
    const desiredQuantities = new Map<string, number>();

    const isToujoursItem = (item: { name: string; group_id: string | null }, itemKey: string) => {
      if (item.group_id && toujoursPresentGroupIds.has(item.group_id)) return true;
      if (toujoursFoodKeys.has(itemKey)) return true;
      return toujoursKeys.some((tjKey) => smartFoodContains(item.name, tjKey));
    };

    const computeQtyNeeded = (item: { content_quantity: string | null; content_quantity_type: string | null }, need: { grams: number; count: number }) => {
      const nb = parseNbValue(item.content_quantity, item.content_quantity_type);
      if (nb && nb.grams > 0 && need.grams > 0) return Math.ceil(need.grams / nb.grams);
      if (nb && nb.count > 0 && need.count > 0) return Math.ceil(need.count / nb.count);
      if (need.count > 0) return Math.ceil(need.count);
      return 1;
    };

    for (const [needKey, need] of needsMap) {
      const exactMatches: typeof shoppingItems = [];
      const partialMatches: typeof shoppingItems = [];

      for (const item of shoppingItems) {
        const itemKey = normalizeKey(item.name);
        if (isToujoursItem(item, itemKey)) continue;

        if (itemKey === needKey || keyMatch(itemKey, needKey)) {
          exactMatches.push(item);
        } else if (smartFoodContains(item.name, needKey)) {
          partialMatches.push(item);
        }
      }

      // Only auto-check if exact match OR single partial match
      // Multiple partial matches → leave unchecked for colored ❓ system
      const targetMatches = exactMatches.length > 0 ? exactMatches : (partialMatches.length === 1 ? partialMatches : []);
      for (const item of targetMatches) {
        matchedItemIds.add(item.id);
        const qtyNeeded = computeQtyNeeded(item, need);
        const prevQty = desiredQuantities.get(item.id) || 0;
        desiredQuantities.set(item.id, Math.max(prevQty, qtyNeeded));
      }
    }

    for (const item of shoppingItems) {
      const shouldCheck = matchedItemIds.has(item.id);
      const desiredQty = shouldCheck ? String(desiredQuantities.get(item.id) || 1) : null;

      if (item.secondary_checked !== shouldCheck) {
        toggleSecondaryCheck.mutate({ id: item.id, secondary_checked: shouldCheck });
      }

      if (shouldCheck) {
        if ((item.quantity || null) !== desiredQty) {
          updateItemQuantity.mutate({ id: item.id, quantity: desiredQty });
        }
      } else if (item.secondary_checked && item.quantity !== null) {
        updateItemQuantity.mutate({ id: item.id, quantity: null });
      }
    }
  };

  const initialMenuSyncDone = useRef(false);
  useEffect(() => {
    if (initialMenuSyncDone.current) return;
    if (shoppingItems.length === 0) return;

    const entries = Object.entries(persistedNeeds);
    if (entries.length > 0) {
      updateShoppingChecks(new Map(entries));
    }
    initialMenuSyncDone.current = true;
  }, [shoppingItems.length, persistedNeeds]);

  const generatePlan = () => {
    const avantGrimpe = allPlats.find((m) => m.name.toLowerCase().includes("avant grimpe"));
    const painFuet = allPlats.find((m) => {
      const n = m.name.toLowerCase().replace(/\s+/g, ' ');
      return n.includes("pain + fuet") || n.includes("pain+fuet");
    });
    const excludeIds = new Set([avantGrimpe?.id, painFuet?.id].filter(Boolean) as string[]);
    const candidatePlats = allPlats.filter((m) => !excludeIds.has(m.id));

    if (candidatePlats.length === 0) return;

    // Build remaining inventory (mutable copy)
    const remaining = new Map<string, { grams: number; count: number }>();
    for (const [k, v] of shoppingInventory) {
      remaining.set(k, { grams: v.grams, count: v.count });
    }
    const hasInventory = remaining.size > 0;

    const selectedIds: string[] = [];
    const counts = new Map<string, number>();

    // Shuffle candidates for better diversity
    const shuffled = [...candidatePlats].sort(() => Math.random() - 0.5);

    // Greedy selection with HIGH diversity: 16 recipes
    for (let i = 0; i < 16; i++) {
      const scored: { id: string; score: number }[] = [];

      for (const recipe of shuffled) {
        if ((counts.get(recipe.id) || 0) >= 2) continue;
        // Diversity penalty: reduce score heavily if already selected
        const alreadySelected = counts.get(recipe.id) || 0;
        let score = alreadySelected > 0 ? -3 : 0;

        if (hasInventory) {
          const usage = getRecipeUsage(recipe);
          let usesConstrainedItem = false;

          for (const [ingKey, used] of usage) {
            let matchKey: string | null = null;
            for (const rk of remaining.keys()) {
              if (rk === ingKey || keyMatch(rk, ingKey)) { matchKey = rk; break; }
            }
            if (!matchKey) continue;
            const avail = remaining.get(matchKey)!;
            if (avail.grams <= 0 && avail.count <= 0) continue;
            usesConstrainedItem = true;

            if (used.grams > 0 && avail.grams > 0) {
              const pkgGrams = shoppingInventory.get(matchKey)?.pkgGrams || 0;
              const afterUse = avail.grams - used.grams;

              if (afterUse < 0) {
                score -= 1;
              } else if (Math.abs(afterUse) < 1) {
                score += 5;
              } else if (pkgGrams > 0 && afterUse % pkgGrams < 1) {
                score += 3;
              } else {
                score += Math.min(1, used.grams / avail.grams);
              }
            }
            if (used.count > 0 && avail.count > 0) {
              if (avail.count < used.count) {
                score -= 1;
              } else if (Math.abs(avail.count - used.count) < 0.5) {
                score += 5;
              } else {
                score += Math.min(1, used.count / avail.count);
              }
            }
          }
          if (usesConstrainedItem) score += 0.5;
        }

        // Larger random factor for diversity
        score += Math.random() * 4;
        scored.push({ id: recipe.id, score });
      }

      if (scored.length === 0) break;

      // Pick from top 6 candidates for more diversity
      scored.sort((a, b) => b.score - a.score);
      const topN = scored.slice(0, Math.min(6, scored.length));
      const pick = topN[Math.floor(Math.random() * topN.length)];

      selectedIds.push(pick.id);
      counts.set(pick.id, (counts.get(pick.id) || 0) + 1);

      // Deduct from remaining inventory
      const recipe = candidatePlats.find(r => r.id === pick.id);
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
      for (let j = 0; j < 4; j++) selectedIds.push(avantGrimpe.id);
    }

    // Build total needs map for shopping check persistence
    const needsMap = new Map<string, { grams: number; count: number }>();
    for (const id of selectedIds) {
      const recipe = allPlats.find(r => r.id === id);
      if (!recipe) continue;
      const usage = getRecipeUsage(recipe);
      for (const [key, used] of usage) {
        const prev = needsMap.get(key) || { grams: 0, count: 0 };
        needsMap.set(key, { grams: prev.grams + used.grams, count: prev.count + used.count });
      }
    }

    // Persist needs for re-check on green toggle
    const needsObj: Record<string, { grams: number; count: number }> = {};
    for (const [k, v] of needsMap) needsObj[k] = v;

    setSelectedMealIds(selectedIds);
    setPreference.mutate({ key: MENU_PREF_KEY, value: selectedIds });
    setPreference.mutate({ key: MENU_NEEDS_KEY, value: needsObj });

    // Update shopping list checkboxes & quantities
    updateShoppingChecks(needsMap);
  };

  const shoppingItems2 = useMemo(() => {
    const map = new Map<string, { grams: number; count: number; displayName: string; matched: boolean; ambiguous: boolean }>();

    for (const meal of selectedMeals) {
      const usage = getRecipeUsage(meal);
      for (const [key, used] of usage) {
        const existing = map.get(key) || { grams: 0, count: 0, displayName: used.rawName, matched: false, ambiguous: false };
        map.set(key, {
          grams: existing.grams + used.grams,
          count: existing.count + used.count,
          displayName: existing.displayName,
          matched: existing.matched,
          ambiguous: existing.ambiguous,
        });
      }
    }

    // Check which ingredients match shopping list items or "Toujours présent" food items
    const toujoursKeys = [...toujoursFoodKeys];
    for (const [key, item] of map) {
      if (toujoursFoodKeys.has(key) || toujoursKeys.some((tjKey) => smartFoodContains(item.displayName, tjKey))) {
        item.matched = true;
        continue;
      }

      const exactMatches = shoppingItems.filter((si) => {
        if (si.group_id && toujoursPresentGroupIds.has(si.group_id)) return false;
        const siKey = normalizeKey(si.name);
        if (toujoursFoodKeys.has(siKey) || toujoursKeys.some((tjKey) => smartFoodContains(si.name, tjKey))) return false;
        return siKey === key || keyMatch(siKey, key);
      });

      if (exactMatches.length > 0) {
        item.matched = true;
        continue;
      }

      const partialMatches = shoppingItems.filter((si) => {
        if (si.group_id && toujoursPresentGroupIds.has(si.group_id)) return false;
        const siKey = normalizeKey(si.name);
        if (toujoursFoodKeys.has(siKey) || toujoursKeys.some((tjKey) => smartFoodContains(si.name, tjKey))) return false;
        return smartFoodContains(si.name, item.displayName);
      });

      if (partialMatches.length > 0) {
        item.matched = true;
        // Multiple partial matches = ambiguous (user needs to choose)
        if (partialMatches.length > 1) {
          item.ambiguous = true;
        }
      }
    }

    return Array.from(map.entries())
      .map(([, v]) => v)
      .sort((a, b) => {
        if (a.matched !== b.matched) return a.matched ? 1 : -1;
        return a.displayName.localeCompare(b.displayName, "fr");
      });
  }, [selectedMeals, shoppingItems, toujoursPresentGroupIds, toujoursFoodKeys]);

  const totalCal = selectedMeals.reduce((sum, m) => {
    const c = parseFloat((m.calories || "0").replace(/[^0-9.]/g, "")) || 0;
    return sum + c;
  }, 0);

  // Sorting
  const persistedSort = getPreference<string>(MENU_SORT_KEY, "manual");
  const [menuSort, setMenuSort] = useState<MenuSortMode>("manual");
  useEffect(() => {
    if (persistedSort === "calories" || persistedSort === "alphabetical") setMenuSort(persistedSort);
  }, [persistedSort]);

  const toggleMenuSort = () => {
    const next: MenuSortMode = menuSort === "manual" ? "calories" : menuSort === "calories" ? "alphabetical" : "manual";
    setMenuSort(next);
    setPreference.mutate({ key: MENU_SORT_KEY, value: next });
  };

  // Separate avant grimpe from main meals
  const avantGrimpeMeal = allPlats.find((m) => m.name.toLowerCase().includes("avant grimpe"));
  const avantGrimpeId = avantGrimpeMeal?.id;
  const mainMenuMeals = selectedMeals.filter((_, i) => {
    const id = selectedMealIds[i];
    return id !== avantGrimpeId;
  });
  const avantGrimpeMeals = selectedMeals.filter((_, i) => {
    const id = selectedMealIds[i];
    return id === avantGrimpeId;
  });

  // Sort main meals
  let sortedMainMeals = [...mainMenuMeals];
  if (menuSort === "calories") {
    const parseCal = (cal: string | null) => parseFloat((cal || "0").replace(/[^0-9.]/g, "")) || 0;
    sortedMainMeals.sort((a, b) => parseCal(a.calories) - parseCal(b.calories));
  } else if (menuSort === "alphabetical") {
    sortedMainMeals.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }

  const SortIcon = menuSort === "calories" ? Flame : menuSort === "alphabetical" ? ArrowUpDown : ArrowUpDown;
  const sortLabel = menuSort === "calories" ? "Calories" : menuSort === "alphabetical" ? "A-Z" : "Manuel";

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
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                🍽️ Plats sélectionnés ({selectedMeals.length})
              </p>
              <Button size="sm" variant="ghost" onClick={toggleMenuSort} className="text-[10px] gap-0.5 h-6 px-1.5">
                <SortIcon className="h-3 w-3" />
                <span className="hidden sm:inline">{sortLabel}</span>
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(() => {
                // Column-first order: all items in col1, then col2
                const half = Math.ceil(sortedMainMeals.length / 2);
                const col1 = sortedMainMeals.slice(0, half);
                const col2 = sortedMainMeals.slice(half);
                const renderMealCard = (meal: Meal, prefix: string, i: number) => (
                  <div
                    key={`${meal.id}-${prefix}-${i}`}
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
                );
                return (
                  <>
                    <div className="flex flex-col gap-2">
                      {col1.map((meal, i) => renderMealCard(meal, "c1", i))}
                    </div>
                    <div className="flex flex-col gap-2">
                      {col2.map((meal, i) => renderMealCard(meal, "c2", i))}
                    </div>
                  </>
                );
              })()}
            </div>

            {avantGrimpeMeals.length > 0 && (
              <>
                <Separator className="my-3 opacity-30" />
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  🧗 Avant grimpe ({avantGrimpeMeals.length})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {avantGrimpeMeals.map((meal, i) => (
                    <div
                      key={`${meal.id}-ag-${i}`}
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
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4 max-w-[50%] mx-auto">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
              🛒 Liste d'ingrédients ({shoppingItems2.length})
            </p>
            <div className="space-y-1">
              {shoppingItems2.map((item, i) => (
                <div key={i} className="flex items-center gap-2 py-1 px-2 rounded-xl bg-muted/40 text-sm">
                  <span className="font-medium text-foreground flex-1">{item.displayName}</span>
                  {!item.matched && (
                    <span className="text-amber-500 text-xs" title="Pas trouvé dans Courses-Liste">❓</span>
                  )}
                  {item.matched && item.ambiguous && (
                    <span className="text-blue-500 text-xs" title="Plusieurs articles correspondent, choix à faire dans Courses-Liste">❓</span>
                  )}
                  {item.grams > 0 && (
                    <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 font-mono">
                      {Math.round(item.grams)}g
                    </span>
                  )}
                  {item.count > 0 && item.grams <= 0 && (
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
