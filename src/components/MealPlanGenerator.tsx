import { useState, useMemo, useEffect } from "react";
import { useMeals, type Meal } from "@/hooks/useMeals";
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

function parseStoredIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function MealPlanGenerator() {
  const { getMealsByCategory } = useMeals();
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

  const generatePlan = () => {
    const avantGrimpe = allPlats.find((m) => m.name.toLowerCase().includes("avant grimpe"));
    const otherPlats = allPlats.filter((m) => m.id !== avantGrimpe?.id);

    if (otherPlats.length === 0) return;

    const counts = new Map<string, number>();
    const selectedIds: string[] = [];

    const pool = [...otherPlats].sort(() => Math.random() - 0.5);
    let attempts = 0;
    while (selectedIds.length < 16 && attempts < 500) {
      const pick = pool[attempts % pool.length];
      const count = counts.get(pick.id) || 0;
      if (count < 2) {
        selectedIds.push(pick.id);
        counts.set(pick.id, count + 1);
      }
      attempts++;
    }

    if (avantGrimpe) {
      for (let i = 0; i < 4; i++) selectedIds.push(avantGrimpe.id);
    }

    setSelectedMealIds(selectedIds);
    setPreference.mutate({ key: MENU_PREF_KEY, value: selectedIds });
  };

  const shoppingItems = useMemo(() => {
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
              🛒 Liste d'ingrédients ({shoppingItems.length})
            </p>
            <div className="space-y-1">
              {shoppingItems.map((item, i) => (
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
              {shoppingItems.length === 0 && (
                <p className="text-xs text-muted-foreground italic text-center py-2">Aucun ingrédient à afficher</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
