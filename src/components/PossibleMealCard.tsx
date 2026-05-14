/**
 * PossibleMealCard — Carte de repas dans la liste "Possibles".
 *
 * Affiche un repas planifié avec toutes ses options :
 * - Dates : péremption, jour de la semaine, créneau (matin/midi/soir)
 * - Compteur d'ouverture (jours depuis l'ouverture de l'ingrédient)
 * - Macros : calories et protéines (calculées ou manuelles)
 * - Multiplicateur de ratio (détecté automatiquement depuis les ingrédients)
 * - Édition inline des calories, grammes, quantité, ratio
 * - Édition des ingrédients via IngredientEditor
 *
 * detectScaleRatio() : détecte si les ingrédients ont été mis à l'échelle
 * StructuredIngredientInline : affichage compact des ingrédients avec highlighting
 */
import React, { useMemo, useState } from "react";
import { ArrowLeft, Copy, MoreVertical, Trash2, Calendar, Timer, Flame, Weight, Hash, List, Undo2, Percent, Thermometer, SplitSquareHorizontal, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IngredientEditor } from "@/components/IngredientEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PossibleMeal } from "@/hooks/useMeals";
import { DAYS, TIMES } from "@/hooks/useMeals";
import { format, parseISO } from "date-fns";
import {
  type IngLine, parseIngredientLineDisplay, formatQtyDisplay,
  parseIngredientsToLines, serializeIngredients, computeIngredientCalories,
  computeIngredientProtein, cleanIngredientText, normalizeKey,
  hasNegativeMetric, getMealColor, getAdaptedCounterDays, getDateForDayKey,
  extractMetrics, parseIngredientLineRaw, getCounterDaysBadgeTooltip,
} from "@/lib/ingredientUtils";
import { usePreferences } from "@/hooks/usePreferences";
import { StructuredIngredientInline } from "@/components/StructuredIngredientInline";
import { scaleIngredientStringExact, findStockKey, getDisplayedPMCalories, getDisplayedPMProtein, buildFoodItemIndex } from "@/lib/stockUtils";
import type { StockInfo } from "@/lib/stockUtils";
import type { FoodItem } from "@/hooks/useFoodItems";
import { fr } from "date-fns/locale";

interface PossibleMealCardProps {
  pm: PossibleMeal;
  onRemove: () => void;
  onReturnWithoutDeduction?: () => void;
  onReturnWithoutDeductionLabel?: string;
  onReturnToMaster?: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdateExpiration: (date: string | null) => void;
  onUpdatePlanning: (day: string | null, time: string | null) => void;
  onUpdateCounter: (date: string | null) => void;
  onUpdateCalories: (cal: string | null) => void;
  onUpdateProtein?: (pro: string | null) => void;
  onUpdateGrams: (g: string | null) => void;
  onUpdateQuantity?: (qty: number) => void;
  onSplitQuantity?: (ratio: number, baseIngredients: string | null) => void;
  onUpdateIngredients: (ing: string | null) => void;
  onUpdatePossibleIngredients?: (newIngredients: string | null) => void;
  onUpdateOvenTemp?: (temp: string | null) => void;
  onUpdateOvenMinutes?: (minutes: string | null) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isHighlighted?: boolean;
  stockMap?: Map<string, StockInfo>;
  expiredIngredientNames?: Set<string>;
  expiringSoonIngredientNames?: Set<string>;
  onDoubleClick?: () => void;
  realtimeCounterStartDate?: string | null;
  /** Fiches aliments (garde-manger) : complète les protéines quand les lignes n’ont que des kcal ou pas de [pro]. */
  foodItems?: FoodItem[];
}

const DAY_LABELS: Record<string, string> = {
  lundi: 'Lun', mardi: 'Mar', mercredi: 'Mer', jeudi: 'Jeu',
  vendredi: 'Ven', samedi: 'Sam', dimanche: 'Dim',
};

/**
 * Interprète une macro figée à l’arrivée dans « possible » (préférences planning_*) et la multiplie par la quantité de cartes.
 * Même logique que getCardDisplayCalories / getCardDisplayProtein dans useCalorieBalance.
 */
function parsePlanningMacroOverride(override: string | undefined, qty: number): number | null {
  if (override == null || String(override).trim() === "") return null;
  const n = parseFloat(String(override).replace(",", ".").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * qty);
}

/**
 * Indique si les kcal affichées sur une carte « possible » relèvent du calcul par lignes (style orange),
 * comme sur MealCard « au choix ». Si l’override post-déduction a perdu les `{cal}`, on regarde la recette maître.
 */
function caloriesLookComputedOnPossibleCard(
  ingredientsOverrideDefined: boolean,
  displayIngredients: string | null | undefined,
  masterIngredients: string | null | undefined,
  scaleR: number,
  isAvailable?: (name: string) => boolean,
): boolean {
  const fromDisplay = computeIngredientCalories(displayIngredients ?? null, isAvailable, scaleR);
  if (fromDisplay !== null) return true;
  if (!ingredientsOverrideDefined || !masterIngredients?.trim()) return false;
  return computeIngredientCalories(masterIngredients, isAvailable, 1) !== null;
}

/**
 * Idem pour les protéines (bleu), y compris complément depuis les fiches aliments sur les lignes.
 */
function proteinLooksComputedOnPossibleCard(
  ingredientsOverrideDefined: boolean,
  displayIngredients: string | null | undefined,
  masterIngredients: string | null | undefined,
  scaleR: number,
  isAvailable: ((name: string) => boolean) | undefined,
  foodItems: FoodItem[] | undefined,
  foodMacroIndex: ReturnType<typeof buildFoodItemIndex> | undefined,
): boolean {
  const fromDisplay = computeIngredientProtein(
    displayIngredients ?? null,
    isAvailable,
    scaleR,
    foodItems,
    foodMacroIndex,
  );
  if (fromDisplay !== null) return true;
  if (!ingredientsOverrideDefined || !masterIngredients?.trim()) return false;
  return computeIngredientProtein(masterIngredients, isAvailable, 1, foodItems, foodMacroIndex) !== null;
}

// Utilitaires d'analyse d'ingrédients importés de @/lib/ingredientUtils

/** Carte d’un repas « possible » : dates, macros, édition, drag & drop (voir en-tête de module). */
export function PossibleMealCard({
  pm, stockMap, onRemove, onReturnWithoutDeduction, onReturnWithoutDeductionLabel,
  onReturnToMaster, onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning,
  onUpdateCounter, onUpdateCalories, onUpdateProtein, onUpdateGrams, onUpdateQuantity,
  onUpdateIngredients, onUpdatePossibleIngredients, 
  onUpdateOvenTemp, onUpdateOvenMinutes,
  onDragStart, onDragOver,
  onDrop, isHighlighted, expiredIngredientNames, expiringSoonIngredientNames, onSplitQuantity, onDoubleClick,
  realtimeCounterStartDate, foodItems
}: PossibleMealCardProps) {
  const parseIngredientLine = parseIngredientLineDisplay;
  const formatQty = formatQtyDisplay;
  const { getPreference } = usePreferences();
  const calOverrides = getPreference<Record<string, string>>("planning_cal_overrides", {});
  const proOverrides = getPreference<Record<string, string>>("planning_pro_overrides", {});
  const [editing, setEditing] = useState<"calories" | "protein" | "grams" | "quantity" | "ratio" | "oven_temp" | "oven_minutes" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [calOpen, setCalOpen] = useState(false);
  const [calMobileOpen, setCalMobileOpen] = useState(false);
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [ingLines, setIngLines] = useState<IngLine[]>([]);

  const foodMacroIndex = useMemo(
    () => (foodItems?.length ? buildFoodItemIndex(foodItems) : undefined),
    [foodItems],
  );

  const meal = pm.meals;
  if (!meal) return null;

  const qty = pm.quantity ?? 1;
  const frozenDisplayCal = parsePlanningMacroOverride(calOverrides[pm.id], qty);
  const frozenDisplayPro = parsePlanningMacroOverride(proOverrides[pm.id], qty);

  // `ingredients_override === ""` : override volontairement vide (ne pas retomber sur la recette maître via ??).
  const displayIngredients =
    pm.ingredients_override != null ? pm.ingredients_override : meal.ingredients;
  const cardColorIngredients = displayIngredients;

  // Construire le rappel isAvailable à partir de stockMap pour le calcul des macros
  const isAvailableCb = stockMap ? (name: string) => {
    const key = findStockKey(stockMap, name);
    if (!key) return false;
    const stock = stockMap.get(key);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  } : undefined;

  // Détecter le ratio de mise à l'échelle à partir de l'override vs les ingrédients originaux
  // Retourne le ratio uniquement si TOUS les ingrédients non optionnels ont le même ratio
  const detectScaleRatio = (): number | null => {
    if (!pm.ingredients_override) return null;
    // Pour les cartes infinies/simples sans ingrédients, synthétiser la même base utilisée lors de la mise à l'échelle
    const baseIngStr = meal.ingredients
      ? meal.ingredients
      : (() => {
        const baseGrams = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
        return baseGrams > 0 ? `${baseGrams}g ${meal.name}` : `1 ${meal.name}`;
      })();
    const parseToMap = (str: string) => {
      const map = new Map<string, { qty: number; count: number }>();
      str.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean).forEach(group => {
        const alt = group.split(/\|/)[0].trim();
        const isOptional = alt.startsWith("?");
        const cleanAlt = isOptional ? alt.slice(1).trim() : alt;

        // Utiliser la clé normalisée pour la correspondance
        const { text: withoutMetrics } = extractMetrics(cleanAlt);
        const parsed = parseIngredientLineRaw(withoutMetrics);
        if (!parsed.name) return;
        const key = normalizeKey(parsed.name);

        // Ne garder que la première occurrence (on pourrait sommer, mais généralement une ligne par ingrédient)
        if (!map.has(key)) {
          map.set(key, { qty: parsed.qty, count: parsed.count });
        }
      });
      return map;
    };

    const baseMap = parseToMap(baseIngStr);
    const overMap = parseToMap(pm.ingredients_override);

    if (baseMap.size === 0 || overMap.size === 0) return null;

    let detectedRatios: number[] = [];
    let commonCount = 0;

    for (const [key, baseVal] of baseMap.entries()) {
      const overVal = overMap.get(key);
      if (!overVal) continue;

      commonCount++;
      if (baseVal.qty > 0 && overVal.qty > 0) {
        detectedRatios.push(overVal.qty / baseVal.qty);
      } else if (baseVal.count > 0 && overVal.count > 0) {
        detectedRatios.push(overVal.count / baseVal.count);
      } else {
        detectedRatios.push(1);
      }
    }

    if (detectedRatios.length === 0) return null;
    const firstRatio = detectedRatios[0];
    if (Math.abs(firstRatio - 1) <= 0.01) return null;

    const allSame = detectedRatios.every(r => Math.abs(r - firstRatio) / (firstRatio || 1) < 0.05);
    if (!allSame) return null;
    if (commonCount < Math.min(baseMap.size, overMap.size) * 0.5) return null;

    return firstRatio;
  };
  const detectedRatio = detectScaleRatio();

  const isExpired = pm.expiration_date && new Date(pm.expiration_date) < new Date();
  const todayISO = format(new Date(), 'yyyy-MM-dd');

  // PRIORITÉ : On utilise le compteur stock s'il est présent (plus à jour), 
  // sinon celui sauvegardé sur la carte (indispensable si l'aliment est consommé/supprimé du stock)
  const effectiveCounterStart = realtimeCounterStartDate ?? pm.counter_start_date;

  const counterDays = getAdaptedCounterDays(effectiveCounterStart, pm.day_of_week, pm.created_at, pm.meal_time);

  // Arrêter le clignotement si le jour du repas est passé !
  let isPast = false;
  if (pm.day_of_week) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = getDateForDayKey(pm.day_of_week, new Date());
    isPast = target.getTime() < today.getTime();
  }

  const counterUrgent = counterDays !== null && counterDays >= 3;
  const animateUrgent = counterUrgent && !isPast;

  const handleSaveEdit = () => {
    const val = editValue.trim() || null;
    if (editing === "calories") onUpdateCalories(val);
    if (editing === "protein" && onUpdateProtein) onUpdateProtein(val);
    if (editing === "grams") onUpdateGrams(val);
    if (editing === "oven_temp" && onUpdateOvenTemp) onUpdateOvenTemp(val);
    if (editing === "oven_minutes" && onUpdateOvenMinutes) onUpdateOvenMinutes(val);
    if (editing === "quantity" && onUpdateQuantity) {
      const qty = parseInt(editValue.trim());
      if (!isNaN(qty) && qty >= 1) onUpdateQuantity(qty);
    }
    if (editing === "ratio") {
      const trimmed = editValue.trim().toLowerCase();
      let ratio: number | null = null;
      if (trimmed.startsWith("x")) {
        const mult = parseFloat(trimmed.slice(1));
        if (!isNaN(mult) && mult >= 0.1) ratio = mult;
      } else {
        const pct = parseFloat(trimmed.replace("%", ""));
        if (!isNaN(pct) && pct >= 10) ratio = pct / 100;
      }
      if (ratio !== null && onUpdatePossibleIngredients) {
        // Toujours appliquer le ratio depuis la base ORIGINALE du repas maître (meal.ingredients),
        // pas depuis ingredients_override qui est déjà mis à l'échelle (ex: après une division).
        // Ainsi "x2" signifie toujours "2x la recette originale", quelle que soit l'état courant.
        const baseIng = meal.ingredients
          ? meal.ingredients
          : (() => {
            const baseGrams = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
            return baseGrams > 0 ? `${baseGrams}g ${meal.name}` : `1 ${meal.name}`;
          })();

        const scaledIngredients = scaleIngredientStringExact(baseIng, ratio, undefined, true);
        onUpdatePossibleIngredients(scaledIngredients);
      }
      // NOTE : Ne PAS appeler onUpdateGrams ou onUpdateCalories ici — ceux-ci modifient le repas MAÎTRE.
      // Les valeurs mises à l'échelle sont dérivées de ingredients_override (pour les calories basées sur les ingrédients)
      // et visibles via le badge detectedRatio pour l'affichage des grammes.
    }
    setEditing(null);
  };

  const openIngredients = () => {
    setIngLines(parseIngredientsToLines(displayIngredients));
    setEditingIngredients(true);
  };

  const commitIngredients = () => {
    const serialized = serializeIngredients(ingLines);
    if (onUpdatePossibleIngredients) {
      // `null` serait stocké comme absence d'override → retombée sur la recette maître.
      // Chaîne vide = « tout retiré » explicite, sans réafficher les quantités d'origine.
      onUpdatePossibleIngredients(serialized === null ? "" : serialized);
    } else {
      onUpdateIngredients(serialized);
    }
    setEditingIngredients(false);
  };

  const selectedDate = pm.expiration_date ? parseISO(pm.expiration_date) : undefined;
  const expIsToday = pm.expiration_date === todayISO;

  const renderDatesSection = (isMobile: boolean) => {
    const isOpen = isMobile ? calMobileOpen : calOpen;
    const setIsOpen = isMobile ? setCalMobileOpen : setCalOpen;

    return (
      <div className={`flex items-center flex-wrap shrink-0 ${isMobile ? "gap-0.5" : "gap-1"}`}>
        <Calendar className="h-2.5 w-2.5 text-white/50 shrink-0" />
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={`h-5 ${isMobile ? "min-w-[86px] px-1.5" : "min-w-[88px] px-1.5"} border bg-white/10 text-white text-[10px] rounded-md flex items-center hover:bg-white/20 transition-colors ${expIsToday ? 'border-red-500 ring-1 ring-red-500 text-red-200' : isExpired ? 'border-white/20 text-red-200' : 'border-white/20'
                }`}
            >
              {pm.expiration_date
                ? format(parseISO(pm.expiration_date), 'd MMM yy', { locale: fr })
                : <span className="text-white/40">Date péremption</span>
              }
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarPicker
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                onUpdateExpiration(date ? format(date, 'yyyy-MM-dd') : null);
                setIsOpen(false);
              }}
              initialFocus
            />
            {pm.expiration_date && (
              <div className="p-2 border-t">
                <button
                  onClick={() => { onUpdateExpiration(null); setIsOpen(false); }}
                  className="text-xs text-muted-foreground hover:text-destructive w-full text-center"
                >
                  Effacer la date
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {(() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const monday = new Date(today);
          const dayOf = monday.getDay();
          const diff = monday.getDate() - dayOf + (dayOf === 0 ? -6 : 1);
          monday.setDate(diff);

          const planningDays = Array.from({ length: 14 }).map((_, i) => {
            const d = new Date(monday);
            d.setDate(d.getDate() + i);
            return {
              iso: format(d, 'yyyy-MM-dd'),
              label: format(d, 'EEEE d', { locale: fr }).replace(/^\w/, c => c.toUpperCase())
            };
          });

          return (
            <Select
              value={pm.day_of_week && /^\d{4}-\d{2}-\d{2}$/.test(pm.day_of_week) ? pm.day_of_week : "none"}
              onValueChange={(val) => onUpdatePlanning(val === "none" ? null : val, pm.meal_time)}
            >
              <SelectTrigger
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className={`h-5 ${isMobile ? "min-w-[62px] px-1.5 gap-0.5" : "min-w-[58px] px-1.5 gap-1"} w-auto justify-start p-0 border border-white/20 bg-white/10 text-white text-[10px] flex items-center hover:bg-white/20 transition-colors [&>svg:last-child]:hidden focus:ring-0 focus:ring-offset-0`}
              >
                <Calendar className="h-2.5 w-2.5 opacity-50 shrink-0" />
                {pm.day_of_week ? (
                  /^\d{4}-\d{2}-\d{2}$/.test(pm.day_of_week)
                    ? format(parseISO(pm.day_of_week), 'eee d', { locale: fr })
                    : DAY_LABELS[pm.day_of_week] || pm.day_of_week
                ) : (
                  <span className="opacity-40">Jour</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Nul —</SelectItem>
                {planningDays.map(d => (
                  <SelectItem
                    key={d.iso}
                    value={d.iso}
                    className={d.iso === todayISO ? 'bg-primary/15 focus:bg-primary/25 font-bold' : ''}
                  >
                    <div className="flex items-center gap-2">
                      <span>{d.iso === todayISO ? `📅 ${d.label}` : d.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })()}

        <Select value={pm.meal_time || "none"} onValueChange={(val) => onUpdatePlanning(pm.day_of_week, val === "none" ? null : val)}>
          <SelectTrigger
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={`h-5 ${isMobile ? "w-[52px] px-1" : "w-[50px] px-1"} border-white/20 bg-white/10 text-white text-[10px]`}
          >
            <SelectValue placeholder="Quand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {meal.category === "petit_dejeuner" && <SelectItem value="matin">Matin</SelectItem>}
            {TIMES.map((t) => (
              <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        onDoubleClick?.();
      }}
      className={`group relative flex flex-col rounded-2xl px-3 py-2.5 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg ${isHighlighted ? 'ring-4 ring-yellow-400 scale-105' : expIsToday ? 'ring-2 ring-red-500' : isExpired ? 'ring-2 ring-red-500' : ''}`}
      style={{ backgroundColor: getMealColor(cardColorIngredients, meal.name) }}
    >
      {/* Badge multiplicateur — épinglé en haut à droite absolu */}
      {detectedRatio !== null && !editing && !editingIngredients && (
        <div className="absolute top-0 right-0 z-10">
          <button onClick={() => { setEditValue(detectedRatio >= 1 ? `x${Math.round(detectedRatio * 10) / 10}` : `${Math.round(detectedRatio * 100)}%`); setEditing("ratio"); }} className="bg-orange-500/80 text-white text-[10px] font-black px-1.5 py-0.5 rounded-tr-2xl rounded-bl-2xl hover:bg-orange-500/90 transition-colors shadow-sm">
            {detectedRatio >= 1 && Number.isInteger(detectedRatio) ? `x${detectedRatio}` : `${Math.round(detectedRatio * 100)}%`}
          </button>
        </div>
      )}

      {/* Ligne 1 : nom + actions + planification à droite (ou dessous si manque de place) */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] max-[820px]:grid-cols-1 items-start gap-1.5 min-w-0">
        <div className="flex items-start gap-1.5 min-w-0">
          <Button size="icon" variant="ghost" onClick={onRemove} className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20 mt-0.5" data-testid="pm-return-btn">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <span className="block flex-1 font-semibold text-white text-sm min-w-0 break-normal whitespace-normal pt-[2px]">
              {meal.name}
            </span>
            {counterDays !== null ? (
              <button
                onClick={() => onUpdateCounter(null)}
                className={`min-[431px]:hidden max-[430px]:flex text-xs font-bold px-1.5 py-0.5 rounded-full items-center gap-0.5 transition-all shrink-0 ${counterUrgent
                  ? animateUrgent
                    ? 'bg-red-500/80 text-white animate-pulse shadow-lg shadow-red-500/30'
                    : 'bg-red-500/80 text-white shadow-lg shadow-red-500/30'
                  : 'bg-white/25 text-white'
                  }`}
                title={getCounterDaysBadgeTooltip(effectiveCounterStart ?? null, pm.day_of_week, pm.meal_time, counterDays)}
              >
                <Timer className="h-3 w-3" /> {counterDays}j
              </button>
            ) : null}
          </div>
        </div>

        {/* Dates bureau uniquement (en haut à droite) */}
        <div className="hidden lg:flex items-center shrink-0 mt-0.5">
          {renderDatesSection(false)}
        </div>

        {/* Planification mobile/tablette : à droite du titre, ou ligne dessous à droite si manque de place */}
        <div className="lg:hidden flex items-center shrink-0 justify-self-end max-[820px]:w-full max-[820px]:justify-end">
          {renderDatesSection(true)}
        </div>
      </div>

      {/* Superposition d'édition */}
      {editing ? (
        <Input autoFocus placeholder={
          editing === "ratio" ? "75% ou x2" :
            editing === "calories" ? "Ex: 350 kcal" :
              editing === "protein" ? "Ex: 28 g" :
                editing === "oven_temp" ? "Ex: 180" :
                  editing === "oven_minutes" ? "Ex: 25" :
                    "Ex: 150g"
        } value={editValue}
          onChange={(e) => setEditValue(e.target.value)} onBlur={handleSaveEdit}
          onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
          inputMode={editing === "oven_temp" || editing === "oven_minutes" ? "numeric" : undefined}
          className="mt-1.5 h-6 border-white/30 bg-white/20 text-white placeholder:text-white/60 text-xs" />
      ) : editingIngredients ? (
        <div className="mt-1.5">
          <IngredientEditor lines={ingLines} onUpdate={setIngLines} onCommit={commitIngredients} />
        </div>
      ) : null}

      {/* Ligne 2 : Options (alignées à droite) */}
      <div className="flex flex-wrap items-center justify-end gap-y-1.5 gap-x-1 md:gap-x-2 w-full mt-1.5 mt-auto">

        {/* Options */}
        <div className="ml-auto w-full flex flex-wrap items-center justify-end gap-1 md:gap-1.5">
          {counterDays !== null ? (
            <button
              onClick={() => onUpdateCounter(null)}
              className={`hidden min-[431px]:inline-flex text-xs font-bold px-1.5 py-0.5 rounded-full items-center gap-0.5 transition-all shrink-0 ${counterUrgent
                ? animateUrgent
                  ? 'bg-red-500/80 text-white animate-pulse shadow-lg shadow-red-500/30'
                  : 'bg-red-500/80 text-white shadow-lg shadow-red-500/30' // Figé passé l'urgence
                : 'bg-white/25 text-white'
                }`}
              title={getCounterDaysBadgeTooltip(effectiveCounterStart ?? null, pm.day_of_week, pm.meal_time, counterDays)}
            >
              <Timer className="h-3 w-3" /> {counterDays}j
            </button>
          ) : null}

          {(pm.quantity > 1 || onUpdateQuantity) && (
            <button
              onClick={() => { if (onUpdateQuantity) { setEditValue(String(pm.quantity)); setEditing("quantity"); } }}
              className={`text-[10px] text-white/90 bg-black/30 px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 ${onUpdateQuantity ? 'hover:bg-black/40 cursor-pointer' : ''}`}
            >
              <Hash className="h-2.5 w-2.5" />{pm.quantity}
            </button>
          )}
          {(() => {
            const explicitEmptyOverride =
              pm.ingredients_override != null && String(pm.ingredients_override).trim() === "";
            const baseG = parseFloat((meal.grams || "").replace(/[^0-9.]/g, "")) || 0;
            if (explicitEmptyOverride || baseG <= 0) return null;
            const displayG =
              detectedRatio !== null && baseG > 0 ? String(Math.round(baseG * detectedRatio)) : meal.grams;
            return (
              <button onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }} className="text-[10px] text-white/90 bg-black/30 px-1 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-black/40 shrink-0">
                <Weight className="h-2.5 w-2.5" />{displayG}
              </button>
            );
          })()}
          {(meal.oven_temp || meal.oven_minutes) && (
            <span className="text-[10px] text-white/90 bg-black/30 px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0">
              <Thermometer className="h-2.5 w-2.5" /> {meal.oven_temp && `${meal.oven_temp}°C`}{meal.oven_temp && meal.oven_minutes && ' · '}{meal.oven_minutes && `${meal.oven_minutes}min`}
            </span>
          )}
          {/* le badge de ratio a été déplacé en haut à droite absolu */}
          {(() => {
            const scaleR = detectedRatio ?? 1;
            const rawDisplayCal = frozenDisplayCal !== null
              ? frozenDisplayCal
              : getDisplayedPMCalories(pm, detectedRatio ?? undefined, isAvailableCb);
            const displayCal = rawDisplayCal ? Math.round(rawDisplayCal) : null;
            const isComputed = caloriesLookComputedOnPossibleCard(
              pm.ingredients_override != null,
              displayIngredients,
              meal.ingredients,
              scaleR,
              isAvailableCb,
            );

            return displayCal ? (
              <button
                onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }}
                className={`text-[10px] px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 ${isComputed
                  ? 'bg-orange-500/50 text-white font-bold hover:bg-orange-500/60'
                  : 'bg-black/30 text-white/90 hover:bg-black/40'
                  }`}
              >
                <Flame className="h-2.5 w-2.5" />{displayCal}
              </button>
            ) : null;
          })()}
          {(() => {
            const scaleR = detectedRatio ?? 1;
            const rawDisplayPro = frozenDisplayPro !== null
              ? frozenDisplayPro
              : getDisplayedPMProtein(pm, detectedRatio ?? undefined, isAvailableCb, foodItems, foodMacroIndex);
            const displayPro = rawDisplayPro != null ? Math.round(rawDisplayPro) : null;
            const isComputedPro = proteinLooksComputedOnPossibleCard(
              pm.ingredients_override != null,
              displayIngredients,
              meal.ingredients,
              scaleR,
              isAvailableCb,
              foodItems,
              foodMacroIndex,
            );
            return displayPro != null && displayPro > 0 ? (
              <button
                onClick={() => { setEditValue(meal.protein || ""); setEditing("protein"); }}
                className={`text-[10px] px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 font-semibold ${isComputedPro
                  ? 'bg-blue-600/60 text-white hover:bg-blue-600/80'
                  : 'bg-black/30 text-white/90 hover:bg-black/40'
                  }`}
              >
                🍗 {displayPro}
              </button>
            ) : null;
          })()}

          <Button size="icon" variant="ghost" onClick={onDuplicate} className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20" title="Dupliquer">
            <Copy className="h-3 w-3" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onReturnToMaster && (
                <DropdownMenuItem onClick={onReturnToMaster}>
                  <Undo2 className="mr-2 h-4 w-4" /> Revenir dans Tous
                </DropdownMenuItem>
              )}
              {onReturnWithoutDeduction && (
                <DropdownMenuItem onClick={onReturnWithoutDeduction}>
                  <Undo2 className="mr-2 h-4 w-4" /> {onReturnWithoutDeductionLabel || 'Remettre au choix (sans déduire)'}
                </DropdownMenuItem>
              )}
              {onSplitQuantity && detectedRatio !== null && detectedRatio >= 2 && Number.isInteger(detectedRatio) && (
                <DropdownMenuItem onClick={() => {
                  const baseIng = pm.ingredients_override ? pm.ingredients_override : meal.ingredients ? meal.ingredients : (() => {
                    const baseGrams = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
                    return baseGrams > 0 ? `${baseGrams}g ${meal.name}` : `1 ${meal.name}`;
                  })();
                  const baseIngredients = scaleIngredientStringExact(baseIng, 1 / detectedRatio, undefined, true);
                  onSplitQuantity(detectedRatio, baseIngredients);
                }}>
                  <SplitSquareHorizontal className="mr-2 h-4 w-4" /> Diviser les quantités
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => { setEditValue(""); setEditing("ratio"); }}>
                <Percent className="mr-2 h-4 w-4" /> Pourcentage / Multiple
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }}>
                <Flame className="mr-2 h-4 w-4" /> Calories
              </DropdownMenuItem>
              {onUpdateProtein && (
                <DropdownMenuItem onClick={() => { setEditValue(meal.protein || ""); setEditing("protein"); }}>
                  <span className="mr-2 text-sm">🍗</span> Protéines
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }}>
                <Weight className="mr-2 h-4 w-4" /> Grammes
              </DropdownMenuItem>
              {onUpdateOvenTemp && (
                <DropdownMenuItem onClick={() => { setEditValue(meal.oven_temp || ""); setEditing("oven_temp"); }}>
                  <Thermometer className="mr-2 h-4 w-4" /> Température (°C)
                </DropdownMenuItem>
              )}
              {onUpdateOvenMinutes && (
                <DropdownMenuItem onClick={() => { setEditValue(meal.oven_minutes || ""); setEditing("oven_minutes"); }}>
                  <Timer className="mr-2 h-4 w-4" /> Durée (min)
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={openIngredients}>
                <List className="mr-2 h-4 w-4" /> Ingrédients
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdateCounter(pm.counter_start_date ? null : new Date().toISOString())}>
                <Timer className="mr-2 h-4 w-4" /> {pm.counter_start_date ? (new Date(pm.counter_start_date) > new Date() ? 'Prog.' : 'Arrêter compteur') : 'Démarrer compteur'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" /> Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Ligne 3 : ingrédients (cliquer pour éditer) — afficher si la base ou l'override a des ingrédients */}
      {!editing && !editingIngredients && displayIngredients && (
        <button onClick={openIngredients} className="mt-1 text-[10px] text-white/60 flex flex-wrap gap-x-1 text-left hover:text-white/80 transition-colors">
          <StructuredIngredientInline
            ingredients={displayIngredients}
            expiredIngredientNames={expiredIngredientNames}
            expiringSoonIngredientNames={expiringSoonIngredientNames}
            stockMap={stockMap}
            softUnavailableStyle
            forcePlainWhite
            removeQuantityPrefixX
          />
        </button>
      )}
    </div>
  );
}
