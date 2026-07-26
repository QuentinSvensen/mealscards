import { Fragment, useMemo, useSyncExternalStore } from "react";
import { format } from "date-fns";
import { Flame, Hash, Wheat, Weight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getCalorieRangeTotalColorClass } from "@/domain/planning/calorieGoalRange";
import { useCalorieBalance } from "@/hooks/useCalorieBalance";
import type { FoodItem } from "@/hooks/useFoodItems";
import { usePreferences } from "@/hooks/usePreferences";
import {
  getAvailableThresholdDayIso,
  subscribeAvailableThresholdDay,
} from "@/lib/availableThresholdDaySession";
import {
  buildIngredientsOverrideFromSelection,
  computeIngredientMacros,
  getIngredientStockBubbles,
  listIngredientStockFoodItems,
  resolveIngredientStockFoodItem,
  type FoodItemMacroIndex,
  type IngredientQtyEdit,
  type OptionalIngredientGroup,
} from "@/lib/ingredientUtils";
import {
  buildTwoWeekDates,
  resolveDefaultThresholdDayIso,
  resolvePlanningGoalForIso,
} from "@/lib/planningWeekUtils";
import { formatExpirationLabel } from "@/lib/stockUtils";
import { NutritionScoreBadge } from "@/components/NutritionScoreBadge";
import { SatietyIndexBadge } from "@/components/SatietyIndexBadge";
import { getMealNutritionScore } from "@/lib/nutritionScore";
import { getMealRecipeSatietyDetails } from "@/lib/satietyIndex";
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";

export type { OptionalIngredientChoice, OptionalIngredientGroup } from "@/lib/ingredientUtils";

interface OptionalIngredientsMoveDialogProps {
  open: boolean;
  mealName: string;
  /** Catégorie du repas (plat / petit_dejeuner) pour la note nutritionnelle. */
  mealCategory?: string | null;
  /** Recette source (pour recalculer les macros des cases cochées). */
  ingredients: string | null;
  groups: OptionalIngredientGroup[];
  includeKeys: Set<string>;
  qtyEdits: Record<string, IngredientQtyEdit>;
  foodItems: FoodItem[];
  foodItemIndex?: FoodItemMacroIndex;
  /** Sources Macro pour l’indice de satiété recette (même base que les cartes Repas). */
  ingredientMacroSources?: IngredientMacroAutofillSources;
  /** Pref « Masquer calories » : remplace le chiffre kcal par le mot coloré du jour Au choix. */
  hideDayCalorieTotals?: boolean;
  onToggleKey: (key: string) => void;
  onQtyEdit: (key: string, field: keyof IngredientQtyEdit, value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Calcule kcal / prot / fibres des ingrédients actuellement cochés dans la pop-up
 * (avec quantités éventuellement modifiées) en une seule passe.
 */
function computeCheckedIngredientTotals(
  ingredients: string | null,
  includeKeys: Set<string>,
  qtyEdits: Record<string, IngredientQtyEdit>,
  foodItems: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): { cal: number; pro: number; fiber: number } {
  const selected = buildIngredientsOverrideFromSelection(ingredients, includeKeys, qtyEdits);
  if (!selected?.trim() || includeKeys.size === 0) return { cal: 0, pro: 0, fiber: 0 };
  const macros = computeIngredientMacros(selected, undefined, 1, foodItems, foodItemIndex);
  return {
    cal: Math.round(macros.cal ?? 0),
    pro: Math.round(macros.pro ?? 0),
    fiber: Math.round(macros.fiber ?? 0),
  };
}

/**
 * Résout le jour ISO choisi dans Au choix (session) pour colorer le mot « Calories ».
 */
function resolveAuChoixThresholdDayIso(stored: string | null): string {
  const todayIso = format(new Date(), "yyyy-MM-dd");
  const window = buildTwoWeekDates(new Date());
  return window.some((d) => d.iso === stored)
    ? (stored as string)
    : resolveDefaultThresholdDayIso(window, todayIso);
}

/**
 * Convertit la classe Tailwind Planning en couleur CSS inline (évite les conflits de style dialog).
 */
function calorieRangeColorCss(
  total: number,
  low: number | null | undefined,
  high: number | null | undefined,
): string {
  const cls = getCalorieRangeTotalColorClass(total, low, high);
  if (cls === "text-black") return "#000000";
  if (cls === "text-red-400") return "#f87171";
  if (cls === "text-emerald-500") return "#10b981";
  return "#ffffff";
}

/** Force un objectif calorique en nombre (prefs JSON parfois string). */
function asGoalNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Calcule la largeur CSS (en `ch`) d’un input grammes/quantité selon le texte saisi.
 * Garde une largeur mini pour 3–4 chiffres sans écraser le nom sur mobile.
 */
function qtyFieldWidthCh(value: string, minChars = 3, maxChars = 5): number {
  const len = Math.max(value.trim().length, minChars);
  // +1.75ch : marge pour tabular-nums, bordure et px (évite la troncature des 3–4 chiffres)
  return Math.min(len, maxChars) + 1.75;
}

/**
 * Pop-up affichée avant d'envoyer une carte Tous / Au choix vers Possible :
 * liste tous les ingrédients, quantités éditables, non optionnels cochés par défaut.
 */
export function OptionalIngredientsMoveDialog({
  open,
  mealName,
  mealCategory = null,
  ingredients,
  groups,
  includeKeys,
  qtyEdits,
  foodItems,
  foodItemIndex,
  ingredientMacroSources,
  hideDayCalorieTotals = false,
  onToggleKey,
  onQtyEdit,
  onConfirm,
  onCancel,
}: OptionalIngredientsMoveDialogProps) {
  const totals = useMemo(
    () => computeCheckedIngredientTotals(ingredients, includeKeys, qtyEdits, foodItems, foodItemIndex),
    [ingredients, includeKeys, qtyEdits, foodItems, foodItemIndex],
  );

  /** Ingrédients actuellement cochés (quantités éditées) pour note + satiété alignées sur la sélection. */
  const selectedIngredients = useMemo(
    () => buildIngredientsOverrideFromSelection(ingredients, includeKeys, qtyEdits),
    [ingredients, includeKeys, qtyEdits],
  );

  /** Note nutritionnelle de la sélection (même formule que les cartes Repas). */
  const nutritionScore = useMemo(
    () =>
      getMealNutritionScore({
        category: mealCategory,
        ingredients: selectedIngredients ?? ingredients,
        calories: null,
        protein: null,
        fiber: null,
      }),
    [mealCategory, selectedIngredients, ingredients],
  );

  /** Densite satiété 0–100 + volume (g) de la sélection. */
  const satietyDetails = useMemo(
    () => getMealRecipeSatietyDetails(selectedIngredients ?? ingredients, ingredientMacroSources),
    [selectedIngredients, ingredients, ingredientMacroSources],
  );

  const { getDayCalories, DAILY_GOAL, DAILY_GOAL_LOW } = useCalorieBalance();
  const { getPreference } = usePreferences();
  const nextDailyGoal = asGoalNumber(getPreference("next_week_daily_goal", DAILY_GOAL), DAILY_GOAL);
  const nextDailyGoalLow = asGoalNumber(
    getPreference("next_week_daily_goal_low", DAILY_GOAL_LOW),
    DAILY_GOAL_LOW,
  );
  const dailyGoal = asGoalNumber(DAILY_GOAL, 0);
  const dailyGoalLow = asGoalNumber(DAILY_GOAL_LOW, 0);

  // Suit le jour Au choix (session JS) pour recalculer la couleur dès qu'il change.
  const storedThresholdIso = useSyncExternalStore(
    subscribeAvailableThresholdDay,
    getAvailableThresholdDayIso,
    () => null,
  );

  /** Totaux / objectifs du jour Au choix pour colorer « Calories » (mode Masquer calories). */
  const thresholdDayCalorieInfo = useMemo(() => {
    const selectedIso = resolveAuChoixThresholdDayIso(storedThresholdIso);
    const window = buildTwoWeekDates(new Date());
    const day = window.find((d) => d.iso === selectedIso) ?? window[0];
    if (!day) {
      return { calories: 0, goalLow: dailyGoalLow, goalHigh: dailyGoal };
    }
    return {
      calories: getDayCalories(day.key, day.iso),
      goalLow: asGoalNumber(resolvePlanningGoalForIso(day.iso, dailyGoalLow, nextDailyGoalLow), 0),
      goalHigh: asGoalNumber(resolvePlanningGoalForIso(day.iso, dailyGoal, nextDailyGoal), 0),
    };
  }, [
    open,
    storedThresholdIso,
    getDayCalories,
    dailyGoal,
    dailyGoalLow,
    nextDailyGoal,
    nextDailyGoalLow,
  ]);

  const calorieWordColor = calorieRangeColorCss(
    // Jour Planning + kcal de la sélection (quantités modifiées incluses).
    thresholdDayCalorieInfo.calories + totals.cal,
    thresholdDayCalorieInfo.goalLow,
    thresholdDayCalorieInfo.goalHigh,
  );

  const todayIso = format(new Date(), "yyyy-MM-dd");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-left flex items-center gap-1.5 min-w-0">
              <span className="truncate">{mealName || "Sélection"}</span>
              <NutritionScoreBadge score={nutritionScore} />
              <SatietyIndexBadge
                index={satietyDetails?.index ?? null}
                totalGrams={satietyDetails?.totalGrams}
                hideWhenMissing
                onMealCard
                recipeTotal
              />
            </DialogTitle>
            <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-bold leading-none">
              {hideDayCalorieTotals ? (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/15 px-1.5 py-0.5 border border-orange-500/25"
                  title={`${Math.round(thresholdDayCalorieInfo.calories + totals.cal)} kcal (jour + sélection) · obj ${thresholdDayCalorieInfo.goalLow || "—"}–${thresholdDayCalorieInfo.goalHigh || "—"}`}
                >
                  <Flame className="h-3 w-3 text-orange-500" />
                  <span style={{ color: calorieWordColor }}>Calories</span>
                </span>
              ) : (
                totals.cal > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/15 text-orange-500 px-1.5 py-0.5 border border-orange-500/25">
                    <Flame className="h-3 w-3" />
                    {totals.cal}
                  </span>
                )
              )}
              {totals.pro > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/15 text-blue-400 px-1.5 py-0.5 border border-blue-500/25">
                  <span className="text-[10px]">🍗</span>
                  {totals.pro}
                </span>
              )}
              {totals.fiber > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 text-emerald-500 px-1.5 py-0.5 border border-emerald-500/25">
                  <Wheat className="h-3 w-3" />
                  {totals.fiber}
                </span>
              )}
            </div>
          </div>
        </DialogHeader>
        <ul className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto py-0.5">
          {groups.map((group, groupIndex) => (
            <li key={`group-${groupIndex}`} className="flex flex-col gap-0">
              {group.alternatives.map((alt, altIndex) => (
                <Fragment key={`alt-${groupIndex}-${altIndex}`}>
                  {altIndex > 0 && (
                    <div className="flex items-center justify-center py-px" aria-hidden>
                      <span className="text-[9px] font-bold uppercase tracking-wide text-sky-400/90 bg-sky-500/10 border border-sky-500/25 rounded-full px-1.5 leading-none">
                        ou
                      </span>
                    </div>
                  )}
                  {alt.items.map((opt, itemIndex) => {
                    const checked = includeKeys.has(opt.key);
                    const edit = qtyEdits[opt.key] ?? { qty: opt.qty, count: opt.count };
                    // Affiche grammes OU quantité selon la définition d’origine (les deux si les deux existent).
                    const showQty = !!opt.qty.trim();
                    const showCount = !!opt.count.trim();
                    const stockLots = listIngredientStockFoodItems(opt.name, foodItems);
                    const stockFi = resolveIngredientStockFoodItem(opt.name, foodItems);
                    const expDate = stockFi?.expiration_date ?? null;
                    const expLabel = formatExpirationLabel(expDate);
                    const expIsToday = !!expDate && expDate.slice(0, 10) === todayIso;
                    const stockBubbles = getIngredientStockBubbles(stockLots);
                    return (
                      <div key={opt.key}>
                        {alt.isBundle && itemIndex > 0 && (
                          <div className="flex items-center justify-center py-px" aria-hidden>
                            <span className="text-[9px] font-bold uppercase tracking-wide text-amber-500/90 bg-amber-500/10 border border-amber-500/25 rounded-full px-1.5 leading-none">
                              et
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 rounded-lg border bg-muted/30 px-2 py-1 hover:bg-muted/50 transition-colors">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => onToggleKey(opt.key)}
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          {showQty && (
                            <Input
                              aria-label={`Grammes ${opt.name}`}
                              inputMode="decimal"
                              placeholder="g"
                              value={edit.qty}
                              size={Math.max(edit.qty.trim().length, 3)}
                              onChange={(e) => onQtyEdit(opt.key, "qty", e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: `${qtyFieldWidthCh(edit.qty)}ch` }}
                              className="h-6 w-auto min-w-0 max-w-[6.75ch] shrink-0 rounded-md border-border/60 bg-background/50 text-[11px] tabular-nums text-center px-1 py-0 [field-sizing:content]"
                            />
                          )}
                          {showCount && (
                            <Input
                              aria-label={`Nombre ${opt.name}`}
                              inputMode="numeric"
                              placeholder="#"
                              value={edit.count}
                              size={Math.max(edit.count.trim().length, 2)}
                              onChange={(e) => onQtyEdit(opt.key, "count", e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: `${qtyFieldWidthCh(edit.count, 2, 3)}ch` }}
                              className="h-6 w-auto min-w-0 max-w-[4.75ch] shrink-0 rounded-md border-border/60 bg-background/50 text-[11px] tabular-nums text-center px-0.5 py-0 [field-sizing:content]"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => onToggleKey(opt.key)}
                            className="text-[12px] font-medium text-foreground leading-tight flex-1 min-w-0 text-left whitespace-normal break-normal [overflow-wrap:normal] [word-break:normal]"
                          >
                            {opt.name}
                          </button>
                          {expLabel && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 font-semibold ${
                                expIsToday
                                  ? "text-red-200 bg-red-500/30 ring-1 ring-red-500"
                                  : expDate && new Date(expDate) < new Date(new Date().toDateString())
                                    ? "text-red-200 bg-red-500/30"
                                    : "text-white/70 bg-white/10"
                              }`}
                            >
                              📅 {expLabel}
                            </span>
                          )}
                          <div className="flex items-center gap-0.5 shrink-0">
                            {stockBubbles.map((bubble) => (
                              <span
                                key={`${opt.key}-${bubble.kind}`}
                                className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 font-semibold tabular-nums ${
                                  bubble.kind === "remainder"
                                    ? "text-amber-100 bg-amber-500/40"
                                    : "text-white/90 bg-white/15"
                                }`}
                                title={
                                  bubble.kind === "quantity"
                                    ? "Quantité"
                                    : bubble.kind === "grams"
                                      ? "Grammage"
                                      : bubble.kind === "remainder"
                                        ? "Reste"
                                        : "Stock"
                                }
                              >
                                {bubble.kind === "quantity" && <Hash className="h-2.5 w-2.5" />}
                                {bubble.kind === "grams" && <Weight className="h-2.5 w-2.5" />}
                                {bubble.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" className="rounded-xl" onClick={onCancel}>
            Annuler
          </Button>
          <Button type="button" className="rounded-xl" onClick={onConfirm}>
            Continuer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
