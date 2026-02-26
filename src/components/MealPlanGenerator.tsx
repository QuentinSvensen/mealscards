import { useState, useMemo } from "react";
import { useMeals, type Meal } from "@/hooks/useMeals";
import { colorFromName } from "@/components/FoodItems";
import { Dice5, Flame, Weight, Thermometer, List } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export function MealPlanGenerator() {
  const { getMealsByCategory } = useMeals();
  const allPlats = getMealsByCategory("plat");
  const [selectedMeals, setSelectedMeals] = useState<Meal[]>([]);

  const generatePlan = () => {
    const avantGrimpe = allPlats.find(m => m.name.toLowerCase().includes("avant grimpe"));
    const otherPlats = allPlats.filter(m => m.id !== avantGrimpe?.id);

    if (otherPlats.length === 0) return;

    const counts = new Map<string, number>();
    const selected: Meal[] = [];

    // Shuffle
    const pool = [...otherPlats].sort(() => Math.random() - 0.5);
    let attempts = 0;
    while (selected.length < 16 && attempts < 500) {
      const pick = pool[attempts % pool.length];
      const count = counts.get(pick.id) || 0;
      if (count < 2) {
        selected.push(pick);
        counts.set(pick.id, count + 1);
      }
      attempts++;
    }

    // Add 4 "Avant grimpe"
    if (avantGrimpe) {
      for (let i = 0; i < 4; i++) selected.push(avantGrimpe);
    }

    setSelectedMeals(selected);
  };

  // Aggregate ingredients
  const shoppingItems = useMemo(() => {
    const map = new Map<string, { grams: number; count: number; displayName: string }>();

    for (const meal of selectedMeals) {
      if (!meal.ingredients) continue;
      const groups = meal.ingredients.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
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
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
  }, [selectedMeals]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">🎲 Menu semaine</h2>
        <Button onClick={generatePlan} className="rounded-full gap-1.5 text-xs">
          <Dice5 className="h-3.5 w-3.5" />
          Générer
        </Button>
      </div>

      {selectedMeals.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8 italic">
          Clique sur "Générer" pour créer un menu aléatoire de 20 plats
        </p>
      ) : (
        <>
          {/* Meal cards */}
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
                      {meal.ingredients.split(/[,\n]+/).filter(Boolean).map(s => s.trim()).join(" • ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Shopping list */}
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

          {/* Total calories */}
          {(() => {
            const totalCal = selectedMeals.reduce((sum, m) => {
              const c = parseFloat((m.calories || "0").replace(/[^0-9.]/g, "")) || 0;
              return sum + c;
            }, 0);
            return totalCal > 0 ? (
              <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">Total calories</span>
                <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
                  <Flame className="h-4 w-4" />
                  {Math.round(totalCal)} kcal
                </span>
              </div>
            ) : null;
          })()}
        </>
      )}
    </div>
  );
}
