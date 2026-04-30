/**
 * WeeklyPlanning — Planning hebdomadaire interactif.
 *
 * Affiche un tableau Jour × Créneau (Midi/Soir) avec les repas planifiés.
 * Chaque cellule contient des mini-cartes draggables avec :
 * - Nom, catégorie (emoji), calories, protéines, compteur, grammage
 * - Dates de péremption, ingrédients avec highlighting périmés/bientôt
 *
 * Fonctionnalités :
 * - Drag & drop entre cellules (desktop + touch mobile avec long press)
 * - Totaux caloriques et protéiques par jour avec objectifs configurables
 * - Section "Boissons" par jour (optionnelle, avec calories fixes)
 * - Reset hebdomadaire des valeurs (inputs, boissons, overrides)
 * - Semaine suivante : aperçu des repas "sauvegardés" (persistants après reset)
 * - Popup de détails au double-clic sur une carte
 * - Boutons de verrouillage/sauvegarde par carte dans le planning
 *
 * PlanningInput : champ numérique avec mode "+" pour ajouter à la valeur courante
 * PlanningMiniCard : carte compacte de repas dans le planning
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useMeals, DAYS, TIMES, type PossibleMeal, type Meal } from "@/hooks/useMeals";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { usePreferences } from "@/hooks/usePreferences";
import { useCalorieBalance, getOverrideScaleRatio, getCardDisplayProtein, getCardDisplayCalories } from "@/hooks/useCalorieBalance";
import { Timer, Flame, Weight, Calendar, Lock, Plus, Thermometer, Sparkles, Zap, Hash, Check } from "lucide-react";
import { computeIngredientCalories, computeIngredientProtein, normalizeKey, getMealColor, getAdaptedCounterDays, getCounterDaysBadgeTooltip } from "@/lib/ingredientUtils";
import { StructuredIngredientInline } from "@/components/StructuredIngredientInline";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { fr } from "date-fns/locale";
import { Checkbox } from "@/components/ui/checkbox";
import { useFoodItems, type FoodItem } from "@/hooks/useFoodItems";
import { useSortModes } from "@/hooks/useSortModes";
import { getSortedFoodItems } from "@/lib/foodSortUtils";
import { analyzeMealIngredients, buildStockMap, findStockKey, type StockInfo, getDisplayedCalories as getMealCal, getDisplayedProtein as getMealPro, resolveCounterStartForPossibleBadge } from "@/lib/stockUtils";
import { useMealTransfers } from "@/hooks/useMealTransfers";
import { toast } from "@/hooks/use-toast";
import { fetchSnapshotsAndPrefsParallel } from "@/data/planning/planningResetRepository";
import { buildFullBackupPayload } from "@/domain/planning/buildBackupPayload";
import { getPossibleMealIdsToDeleteOnManualReset } from "@/domain/planning/mealsToClear";
import { mergeSnapshotsIntoLivePrefMap } from "@/domain/planning/mergePlanningSnapshots";
import { resolvePostResetGoals } from "@/domain/planning/postResetGoals";
import { upsertPossibleMealsFullBackup, deletePossibleMealsByIds } from "@/services/planning/weeklyResetPersistence";
import { pushWeeklyResetClientPreferences } from "@/services/planning/pushWeeklyResetClientPreferences";
import { getDateForDayKey, DAY_KEY_TO_INDEX } from "@/lib/planningWeekUtils";
import { usePlanningWeek } from "@/hooks/usePlanningWeek";
import { useSyncPlanningQueriesOnResume } from "@/hooks/useSyncPlanningQueriesOnResume";
import { PlanningHeader } from "@/components/planning/PlanningHeader";

/**
 * Champ numérique du planning avec mode « + » pour ajouter une valeur à la saisie courante
 * (manuel midi/soir, extras, etc.).
 */
function PlanningInput({ storageKey, currentValue, onSave, placeholder, className }: {
  storageKey: string;
  currentValue: number;
  onSave: (val: number) => void;
  placeholder?: string;
  className?: string;
}) {
  const [addMode, setAddMode] = useState(false);
  const [tempVal, setTempVal] = useState("");
  const [editVal, setEditVal] = useState(String(currentValue || ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!addMode) setEditVal(String(currentValue || ""));
  }, [currentValue, addMode]);

  const commitAdd = () => {
    const raw = parseInt(tempVal) || 0;
    if (raw !== 0) onSave(currentValue + raw);
    setAddMode(false);
    setTempVal("");
  };

  const commitEdit = () => {
    const raw = parseInt(editVal) || 0;
    onSave(raw);
  };

  if (addMode) {
    return (
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="number"
          value={tempVal}
          onChange={(e) => setTempVal(e.target.value)}
          onBlur={commitAdd}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitAdd(); } }}
          placeholder={`+${placeholder || ""}`}
          className={className}
          autoFocus
        />
      </div>
    );
  }

  return (
    <div className="relative flex items-center">
      <input
        type="number"
        value={editVal}
        onChange={(e) => setEditVal(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } }}
        placeholder={placeholder}
        className={className}
      />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setAddMode(true); }}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-[9px] font-bold text-primary/60 hover:text-primary rounded"
        title="Ajouter"
      >+</button>
    </div>
  );
}

const DAY_LABELS: Record<string, string> = {
  lundi: "Lundi",
  mardi: "Mardi",
  mercredi: "Mercredi",
  jeudi: "Jeudi",
  vendredi: "Vendredi",
  samedi: "Samedi",
  dimanche: "Dimanche",
};

const TIME_LABELS: Record<string, string> = { midi: "Midi", soir: "Soir", gouter: "Goûter" };

const JS_DAY_TO_KEY: Record<number, string> = {
  1: "lundi",
  2: "mardi",
  3: "mercredi",
  4: "jeudi",
  5: "vendredi",
  6: "samedi",
  0: "dimanche",
};

const DEFAULT_DAILY_GOAL = 2750;
const DEFAULT_WEEKLY_MULTIPLIER = 7;

/** Clé de préférence utilisée pour mémoriser une surcharge calorique par carte (hors usage direct actuel). */
function calOverrideKey(pmId: string) { return `planning_cal_override_${pmId}`; }

/** Emoji de catégorie de repas pour l’affichage compact des cartes. */
function getCategoryEmoji(cat?: string) {
  switch (cat) {
    case "entree":
      return "🥗";
    case "plat":
      return "🍽️";
    case "dessert":
      return "🍰";
    case "bonus":
      return "⭐";
    default:
      return "🍴";
  }
}

/** Indique si une date de péremption (jour calendaire) est strictement avant aujourd’hui. */
function isExpiredDate(d: string | null) {
  if (!d) return false;
  return new Date(d) < new Date(new Date().toDateString());
}

/** Indique si la péremption est dépassée par rapport au jour du planning (ou au calendrier si pas de jour). */
function isExpiredOnDay(d: string | null, dayKey: string | null) {
  if (!d) return false;
  if (!dayKey) return isExpiredDate(d);
  const targetDate = getDateForDayKey(dayKey);
  return new Date(d) < targetDate;
}

/** Lit les kcal affichées sur une fiche repas (chaîne potentiellement avec unités). */
function parseCalories(cal: string | null | undefined): number {
  if (!cal) return 0;
  const n = parseFloat(cal.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Lit les protéines affichées sur une fiche repas. */
function parseProtein(prot: string | null | undefined): number {
  if (!prot) return 0;
  const n = parseFloat(prot.replace(",", ".").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Décode un extra « personnalisé » encodé dans un id de sélection (`custom::…`). */
function parseCustomExtraId(id: string): { name: string; cal: number; prot: number } | null {
  if (!id.startsWith('custom::')) return null;
  const parts = id.slice(8).split('::');
  return {
    name: parts[0] || 'Personnalisé',
    cal: parseFloat((parts[1] || '0').replace(',', '.')) || 0,
    prot: parseFloat((parts[2] || '0').replace(',', '.')) || 0,
  };
}

/** Somme kcal / prot des extras (aliments stock ou entrées `custom::…`). */
function sumExtrasFromSelectionIds(ids: string[] | undefined, foodItems: FoodItem[]): { cal: number; pro: number } {
  let cal = 0;
  let pro = 0;
  for (const id of ids ?? []) {
    const custom = parseCustomExtraId(id);
    if (custom) {
      cal += custom.cal;
      pro += custom.prot;
      continue;
    }
    const fi = foodItems.find((f) => f.id === id);
    if (fi) {
      cal += parseCalories(fi.calories);
      pro += parseProtein(fi.protein);
    }
  }
  return { cal, pro };
}

/** Formate l'étiquette d'un extra placé en incluant ses grammes s'ils existent. */
function formatPlacedExtraLabel(extraName: string, grams?: string | null): string {
  const name = (extraName || "").trim();
  const rawGrams = (grams || "").trim();
  const hasUnit = /[a-zA-Z]/.test(rawGrams);
  const g = rawGrams ? (hasUnit ? rawGrams : `${rawGrams}g`) : "";
  if (!name) return g;
  if (!g) return name;
  return `${g} ${name}`;
}

const DAILY_PROTEIN_GOAL = 110;

interface TouchDragState {
  pmId: string;
  ghost: HTMLElement;
  startX: number;
  startY: number;
  origTop: number;
  origLeft: number;
}

// ─── PlanningMiniCard ────────────────────────────────────────────────────────
/**
 * Carte compacte d’un repas dans une cellule du planning (drag, touch, override kcal, ingrédients).
 */
function PlanningMiniCard({ pm, meal, expired, counterDays, counterBadgeTitle, counterUrgent, isPast, displayCal, isComputedCal, displayPro, isComputedPro, compact, hideIngredients, isTouchDevice, touchDragActive, slotDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onRemove, onCalorieChange, onProteinChange, expiredIngredientNames, expiringSoonIngredientNames, onDoubleClick, stockMap }: {
  pm: PossibleMeal; meal: any; expired: boolean; counterDays: number | null; counterBadgeTitle?: string; counterUrgent: boolean; isPast: boolean; displayCal: string | null; isComputedCal: boolean; displayPro: string | null; isComputedPro: boolean; compact: boolean;
  hideIngredients?: boolean;
  isTouchDevice: boolean; touchDragActive: boolean; slotDragOver: string | null;
  onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void; onTouchMove: (e: React.TouchEvent) => void; onTouchEnd: (e: React.TouchEvent) => void; onTouchCancel: () => void;
  onRemove: () => void; onCalorieChange: (val: string | null) => void; onProteinChange: (val: string | null) => void;
  expiredIngredientNames?: Set<string>;
  expiringSoonIngredientNames?: Set<string>;
  onDoubleClick?: () => void;
  stockMap?: Map<string, StockInfo>;
}) {
  const [editingCal, setEditingCal] = useState(false);
  const [calValue, setCalValue] = useState("");
  const [editingPro, setEditingPro] = useState(false);
  const [proValue, setProValue] = useState("");

  return (
    <div
      draggable={!isTouchDevice}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onDoubleClick={onDoubleClick}
      className={`rounded-xl text-white select-none
        ${touchDragActive ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing"}
        transition-transform hover:scale-[1.01]
        ${expired ? "ring-[3px] ring-red-500 shadow-lg shadow-red-500/30" : ""}
        ${slotDragOver === pm.id ? "ring-2 ring-white/60" : ""}
        ${compact ? "px-1.5 py-0.5" : "px-1.5 py-0.5 sm:px-2 sm:py-1.5"}
      `}
      style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}
    >
      {/* Mobile : mise en page verticale */}
      <div className="flex flex-col sm:hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] max-[430px]:grid-cols-1 items-start gap-x-1 gap-y-0.5 min-w-0">
          <div className="min-w-0 overflow-hidden">
            <div className="flex items-start gap-1 min-w-0 w-full">
              <span className="text-[9px] opacity-70 shrink-0">{getCategoryEmoji(meal.category)}</span>
              <span className="block flex-1 min-w-0 font-semibold text-[10px] break-normal whitespace-normal leading-tight">{meal.name}</span>
            </div>
          </div>
          {!compact && (
            <div className="flex flex-col items-center shrink-0 max-[430px]:justify-self-end">
              {editingCal ? (
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  value={calValue}
                  onChange={(e) => setCalValue(e.target.value)}
                  onBlur={() => {
                    const trimmed = calValue.trim();
                    onCalorieChange(trimmed || null);
                    setEditingCal(false);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="w-16 h-5 text-[11px] bg-white/20 border border-white/40 rounded px-1 text-white placeholder:text-white/40 focus:outline-none"
                  placeholder="kcal"
                />
              ) : displayCal ? (
                <button
                  onClick={() => { setCalValue(displayCal); setEditingCal(true); }}
                  className={`text-xs font-black text-white px-2 py-0.5 rounded-full flex items-center gap-0.5 ${isComputedCal ? "bg-orange-500/60 hover:bg-orange-500/70" : "bg-black/30 hover:bg-black/40"
                    }`}
                  title="Modifier les calories (temporaire)"
                >
                  <Flame className="h-3 w-3" />
                  {displayCal}
                </button>
              ) : (
                <button
                  onClick={() => { setCalValue(""); setEditingCal(true); }}
                  className="text-[10px] text-white/40 hover:text-white/60"
                  title="Ajouter des calories"
                >
                  <Flame className="h-3 w-3" />
                </button>
              )}
              {editingPro ? (
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  value={proValue}
                  onChange={(e) => setProValue(e.target.value)}
                  onBlur={() => {
                    const trimmed = proValue.trim();
                    onProteinChange(trimmed || null);
                    setEditingPro(false);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="w-16 h-5 text-[11px] bg-white/20 border border-white/40 rounded px-1 text-white placeholder:text-white/40 focus:outline-none mt-0.5"
                  placeholder="prot"
                />
              ) : displayPro ? (
                <button
                  onClick={() => { setProValue(displayPro); setEditingPro(true); }}
                  className={`text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full mt-0.5 flex items-center justify-center ${isComputedPro ? 'bg-blue-600/70 hover:bg-blue-600/80' : 'bg-black/30 hover:bg-black/40'}`}
                  title="Modifier les protéines (temporaire)"
                >
                  🍗 {displayPro}
                </button>
              ) : (
                <button
                  onClick={() => { setProValue(""); setEditingPro(true); }}
                  className="text-[10px] text-white/40 hover:text-white/60 mt-0.5"
                  title="Ajouter des protéines"
                >
                  🍗
                </button>
              )}
              {counterDays !== null ? (
                <span
                  className={`text-[8px] font-black px-1 py-0.5 rounded-full mt-0.5 flex items-center gap-0.5 border shrink-0
                  ${counterUrgent ? `bg-red-600 text-white border-red-300 shadow-md ${!isPast ? 'animate-pulse' : ''}` : "bg-black/50 text-white border-white/30"}`}
                  title={counterBadgeTitle}
                >
                  <Timer className="h-2 w-2" />
                  {counterDays}j
                </span>
              ) : null}
            </div>
          )}
        </div>
        {!compact && (pm.expiration_date || meal.grams || pm.ingredients_override || meal.ingredients) && (
          <div className="mt-auto pt-0.5">
            {meal.grams && (
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                  <Weight className="h-2 w-2" />
                  {meal.grams}
                </span>
              </div>
            )}
            {(pm.ingredients_override || meal.ingredients || pm.expiration_date) && (
              <div className={`${meal.grams ? "mt-0.5" : ""} text-[9px] text-white/50 break-words whitespace-normal`}>
                {pm.expiration_date && (
                  <span className={`inline-flex items-center gap-0.5 mr-1 rounded px-1 py-0.5 border align-middle ${expired ? "text-red-200 font-bold border-red-300/40 bg-red-400/10" : "text-white/60 border-white/15 bg-white/5"}`}>
                    <Calendar className="h-2 w-2 inline" />
                    {format(parseISO(pm.expiration_date), "d MMM", { locale: fr })}
                  </span>
                )}
                {!hideIngredients && (pm.ingredients_override || meal.ingredients) && (
                  <StructuredIngredientInline
                    compact
                    ingredients={pm.ingredients_override ?? meal.ingredients}
                    expiredIngredientNames={expiredIngredientNames}
                    expiringSoonIngredientNames={expiringSoonIngredientNames}
                    stockMap={stockMap}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bureau : mise en page en deux colonnes — gauche (titre + date en bas), droite (badges) */}
      <div className="hidden sm:flex items-stretch gap-1 min-w-0">
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div className="flex items-start gap-1 min-w-0">
            <span className="text-[11px] opacity-70 shrink-0">{getCategoryEmoji(meal.category)}</span>
            <span className="block flex-1 min-w-0 font-semibold text-xs break-normal whitespace-normal leading-tight">{meal.name}</span>
            {counterDays !== null ? (
              <span
                className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5 border shrink-0
                ${counterUrgent ? "bg-red-600 text-white border-red-300 shadow-md" : "bg-black/50 text-white border-white/30"}`}
                title={counterBadgeTitle}
              >
                <Timer className="h-2.5 w-2.5" />
                {counterDays}j
              </span>
            ) : null}
          </div>
          {!compact && (pm.expiration_date || meal.grams || pm.ingredients_override || meal.ingredients) && (
            <div className="pt-0.5">
              {meal.grams && (
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                    <Weight className="h-2 w-2" />
                    {meal.grams}
                  </span>
                </div>
              )}
              {pm.expiration_date && (
                <div className={`${meal.grams ? "mt-0.5" : ""} text-[9px]`}>
                  <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 border ${expired ? "text-red-300 font-bold border-red-400/50 bg-red-500/20" : "text-white/60 border-white/15 bg-white/5"}`}>
                    <Calendar className="h-2 w-2 inline" />
                    {format(parseISO(pm.expiration_date), "d MMM", { locale: fr })}
                  </span>
                </div>
              )}
              {!hideIngredients && (pm.ingredients_override || meal.ingredients) && (
                <div className={`${pm.expiration_date || meal.grams ? "mt-0.5" : ""} text-[9px] text-white/50 flex flex-wrap gap-x-1`}>
                  <StructuredIngredientInline
                    compact
                    ingredients={pm.ingredients_override ?? meal.ingredients}
                    expiredIngredientNames={expiredIngredientNames}
                    expiringSoonIngredientNames={expiringSoonIngredientNames}
                    stockMap={stockMap}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        {!compact && (
          <div className="flex flex-col items-center shrink-0">
            {editingCal ? (
              <input
                autoFocus
                type="text"
                inputMode="numeric"
                value={calValue}
                onChange={(e) => setCalValue(e.target.value)}
                onBlur={() => {
                  const trimmed = calValue.trim();
                  onCalorieChange(trimmed || null);
                  setEditingCal(false);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="w-16 h-5 text-[11px] bg-white/20 border border-white/40 rounded px-1 text-white placeholder:text-white/40 focus:outline-none"
                placeholder="kcal"
              />
            ) : displayCal ? (
              <button
                onClick={() => { setCalValue(displayCal); setEditingCal(true); }}
                className={`text-xs font-black text-white px-2 py-0.5 rounded-full flex items-center gap-0.5 ${isComputedCal ? "bg-orange-500/60 hover:bg-orange-500/70" : "bg-black/30 hover:bg-black/40"
                  }`}
                title="Modifier les calories (temporaire)"
              >
                <Flame className="h-3 w-3" />
                {displayCal}
              </button>
            ) : (
              <button
                onClick={() => { setCalValue(""); setEditingCal(true); }}
                className="text-[10px] text-white/40 hover:text-white/60"
                title="Ajouter des calories"
              >
                <Flame className="h-3 w-3" />
              </button>
            )}
            {editingPro ? (
              <input
                autoFocus
                type="text"
                inputMode="numeric"
                value={proValue}
                onChange={(e) => setProValue(e.target.value)}
                onBlur={() => {
                  const trimmed = proValue.trim();
                  onProteinChange(trimmed || null);
                  setEditingPro(false);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="w-16 h-5 text-[11px] bg-white/20 border border-white/40 rounded px-1 text-white placeholder:text-white/40 focus:outline-none mt-0.5"
                placeholder="prot"
              />
            ) : displayPro ? (
              <button
                onClick={() => { setProValue(displayPro); setEditingPro(true); }}
                className={`text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full mt-0.5 flex items-center justify-center ${isComputedPro ? 'bg-blue-600/70 hover:bg-blue-600/80' : 'bg-black/30 hover:bg-black/40'}`}
                title="Modifier les protéines (temporaire)"
              >
                🍗 {displayPro}
              </button>
            ) : (
              <button
                onClick={() => { setProValue(""); setEditingPro(true); }}
                className="text-[10px] text-white/40 hover:text-white/60 mt-0.5"
                title="Ajouter des protéines"
              >
                🍗
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Vue principale du planning hebdomadaire : semaine courante / sauvegarde / suivante,
 * drag-and-drop, extras, reset et restauration.
 */
export function WeeklyPlanning({
  masterSourcePmIds = new Set(),
  unParUnSourcePmIds = new Set()
}: {
  masterSourcePmIds?: Set<string>,
  unParUnSourcePmIds?: Set<string>
} = {}) {
  const { possibleMeals, meals, updatePlanning, reorderPossibleMeals, getMealsByCategory } = useMeals();
  const qc = useQueryClient();
  const { getPreference, setPreference, isLoading: prefsLoading } = usePreferences();
  const { items: foodItems } = useFoodItems();
  const { foodSortModes, sortDirections } = useSortModes({ enabled: true });
  const stockMap = useMemo(() => buildStockMap(foodItems), [foodItems]);
  const { weekOffset, setWeekOffset, weekDates, todayISO } = usePlanningWeek();
  const manualResetLockRef = useRef(false);
  const [manualResetBusy, setManualResetBusy] = useState(false);
  const restoreLockRef = useRef(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

  useSyncPlanningQueriesOnResume(qc);

  const isAvailableCb = useCallback((name: string) => {
    const key = findStockKey(stockMap, name);
    if (!key) return false;
    const stock = stockMap.get(key);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  }, [stockMap]);
  const { updateFoodItemCountersForPlanning, deductIngredientsFromStock, deductNameMatchStock } = useMealTransfers(foodItems);

  const updatePlanningWithCounters = (pmId: string, day: string | null, time: string | null) => {
    const pm = possibleMeals.find(p => p.id === pmId);
    let earliestCounter: string | null = null;
    if (pm?.meals) {
      const ing = pm.ingredients_override ?? pm.meals.ingredients;
      const analysis = analyzeMealIngredients({ ...pm.meals, ingredients: ing }, foodItems);
      earliestCounter = analysis.earliestCounterDate;
    }

    updatePlanning.mutate({
      id: pmId,
      day_of_week: day,
      meal_time: time,
      counter_start_date: day && time ? undefined : earliestCounter,
    });
    if (pm) {
      const ing = pm.ingredients_override ?? pm.meals?.ingredients;
      const fallbackDate = earliestCounter || pm.counter_start_date || null;
      updateFoodItemCountersForPlanning(pmId, ing, day, time, fallbackDate, pm.created_at, possibleMeals);
    }
  };

  // Forcer le rafraîchissement des repas possibles au montage pour s'assurer que le planning affiche les dernières données
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["possible_meals"] });
  }, []);

  // Sélections de petit déjeuner par jour
  const breakfastSelections = getPreference<Record<string, string>>('planning_breakfast', {});
  const { getDayCalories, getDayProtein, DAILY_GOAL, getBreakfastForDay } = useCalorieBalance(isAvailableCb);
  const petitDejMeals = getMealsByCategory('petit_dejeuner');
  const possiblePetitDej = possibleMeals.filter(pm => pm.meals?.category === 'petit_dejeuner');

  const setBreakfastForDay = (day: string, selId: string | null) => {
    const updated = { ...breakfastSelections };
    const oldSelId = breakfastSelections[day];

    // Effacer l'ancienne planification s'il s'agissait d'un PossibleMeal
    if (oldSelId?.startsWith('pm:')) {
      const oldPmId = oldSelId.slice(3);
      if (selId !== oldSelId) {
        updatePlanningWithCounters(oldPmId, null, null);
      }
    }

    if (selId) {
      updated[day] = selId;
      if (selId.startsWith('pm:')) {
        const pmId = selId.slice(3);
        updatePlanningWithCounters(pmId, day, 'matin');
      }
    } else {
      delete updated[day];
    }
    setPreference.mutate({ key: 'planning_breakfast', value: updated });

    // Activer auto-consommation pour "Dèj choco", désactiver sur les autres changements
    const selectedMeal = getBreakfastMealFromSelId(selId);
    const isDejeChoco = selectedMeal?.name?.toLowerCase().includes('dèj choco') || selectedMeal?.name?.toLowerCase().includes('dej choco');
    if (isDejeChoco) {
      const updatedAC = { ...autoConsumeBreakfast, [day]: true };
      setPreference.mutate({ key: 'planning_auto_consume_breakfast', value: updatedAC });
    } else if (autoConsumeBreakfast[day]) {
      const updatedAC = { ...autoConsumeBreakfast };
      delete updatedAC[day];
      setPreference.mutate({ key: 'planning_auto_consume_breakfast', value: updatedAC });
    }
  };

  /** Résoudre un ID de sélection en un objet Meal (pour usage interne) */
  const getBreakfastMealFromSelId = (selId: string | null | undefined) => {
    if (!selId) return null;
    if (selId.startsWith('pm:')) {
      const pmId = selId.slice(3);
      return possiblePetitDej.find(pm => pm.id === pmId)?.meals || null;
    }
    if (selId.startsWith('meal:')) {
      const mealId = selId.slice(5);
      return petitDejMeals.find(m => m.id === mealId) || null;
    }
    // Ancien format (Legacy)
    return petitDejMeals.find(m => m.id === selId) || possiblePetitDej.find(pm => pm.meal_id === selId)?.meals || null;
  };
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const [dragOverUnplanned, setDragOverUnplanned] = useState(false);

  const slotDragRef = useRef<{ pmId: string; slotKey: string } | null>(null);
  const [slotDragOver, setSlotDragOver] = useState<string | null>(null);

  const touchDrag = useRef<TouchDragState | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [touchDragActive, setTouchDragActive] = useState(false);
  const [touchHighlight, setTouchHighlight] = useState<string | null>(null);

  const todayRef = useRef<HTMLDivElement | null>(null);
  const todayKey = JS_DAY_TO_KEY[new Date().getDay()];
  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  const [popupPm, setPopupPm] = useState<PossibleMeal | null>(null);
  const [popupBreakfast, setPopupBreakfast] = useState<{ meal: any; day: string } | null>(null);
  const [additiveModes, setAdditiveModes] = useState<Record<string, { active: boolean; value: string }>>({});
  const [openExtrasDay, setOpenExtrasDay] = useState<string | null>(null);
  const [draggedSelectedExtraId, setDraggedSelectedExtraId] = useState<string | null>(null);
  const [draggedSelectedExtraOrigin, setDraggedSelectedExtraOrigin] = useState<{ iso: string; key: string } | null>(null);
  const [selectedExtrasTopByDay, setSelectedExtrasTopByDay] = useState<Record<string, string[]>>({});
  const [selectedExtrasMiddleByDay, setSelectedExtrasMiddleByDay] = useState<Record<string, string[]>>({});
  const [selectedExtrasDropZone, setSelectedExtrasDropZone] = useState<string | null>(null);
  const [customExtraName, setCustomExtraName] = useState('');
  const [customExtraCal, setCustomExtraCal] = useState('');
  const [customExtraProt, setCustomExtraProt] = useState('');

  useEffect(() => {
    if (todayRef.current) {
      setTimeout(() => {
        const el = todayRef.current;
        if (!el) return;
        const headerHeight = 112;
        const top = el.getBoundingClientRect().top + window.scrollY - headerHeight;
        window.scrollTo({ top, behavior: "smooth" });
      }, 200);
    }
  }, []);

  // Auto-consommation du petit déjeuner pour les jours passés
  const autoConsumedDays = getPreference<Record<string, boolean>>('planning_auto_consumed_days', {});
  const autoConsumeChecked = useRef(false);
  useEffect(() => {
    if (autoConsumeChecked.current) return;
    if (prefsLoading) return; // Attendre le chargement des préférences
    if (foodItems.length === 0) return; // Attendre le chargement des aliments
    if (possibleMeals === undefined) return; // Attendre les repas possibles
    autoConsumeChecked.current = true;

    const runAutoConsume = async () => {
      // Vérifier depuis la DB pour éviter une double consommation
      const { data: freshConsumedData } = await supabase.from('user_preferences')
        .select('value').eq('key', 'planning_auto_consumed_days').maybeSingle();
      const freshConsumed = (freshConsumedData?.value as Record<string, boolean>) ?? {};

      const todayIdx = DAY_KEY_TO_INDEX[todayKey];
      const pastDays = DAYS.filter((_, i) => i < todayIdx);

      const toConsume: string[] = [];
      for (const day of pastDays) {
        if (autoConsumeBreakfast[day] && breakfastSelections[day] && !freshConsumed[day]) {
          toConsume.push(day);
        }
      }

      if (toConsume.length > 0) {
        const updatedConsumed = { ...freshConsumed };
        for (const day of toConsume) {
          updatedConsumed[day] = true;
          const selId = breakfastSelections[day];
          // Résoudre l'ID de sélection préfixé
          let breakfast: any = null;
          if (selId.startsWith('pm:')) {
            const pmId = selId.slice(3);
            const pm = possibleMeals.find(p => p.id === pmId);
            if (pm?.meals) breakfast = { ...pm.meals, ingredients: pm.ingredients_override ?? pm.meals.ingredients };
          } else if (selId.startsWith('meal:')) {
            const mId = selId.slice(5);
            breakfast = petitDejMeals.find(m => m.id === mId);
          } else {
            // Ancien ID simple (Legacy)
            breakfast = petitDejMeals.find(m => m.id === selId) || possibleMeals.find(pm => pm.meal_id === selId)?.meals;
          }
          if (breakfast) {
            // Construire un objet de type Meal pour les fonctions de transfert
            const mealObj = {
              id: breakfast.id,
              name: breakfast.name,
              category: breakfast.category || 'petit_dejeuner',
              calories: breakfast.calories,
              protein: breakfast.protein,
              grams: breakfast.grams,
              ingredients: breakfast.ingredients,
              sort_order: breakfast.sort_order,
              created_at: breakfast.created_at,
              is_available: (breakfast as any).is_available ?? false,
              is_favorite: (breakfast as any).is_favorite ?? false,
              oven_temp: breakfast.oven_temp ?? null,
              oven_minutes: breakfast.oven_minutes ?? null,
            } as Meal;

            if (mealObj.ingredients?.trim()) {
              // Utiliser une déduction basée sur les ingrédients
              await deductIngredientsFromStock(mealObj);
            } else {
              // Utiliser une déduction par correspondance de nom
              await deductNameMatchStock(mealObj);
            }
            qc.invalidateQueries({ queryKey: ["food_items"] });
          }
        }
        setPreference.mutate({ key: 'planning_auto_consumed_days', value: updatedConsumed });
      }
    };
    runAutoConsume();
  }, [foodItems.length, prefsLoading, possibleMeals]);

  const planningMeals = possibleMeals.filter((pm) => {
    if (pm.meals?.category === "plat") return true;
    // Catégories hors plats : n'afficher que si elles ont une date de planification assignée
    return !!pm.day_of_week && !!pm.meal_time;
  });

  // Détermine le slot visuel effectif d'une carte (slot planifié ou override temporaire d'affichage).
  const getVisualSlotForPm = (pm: PossibleMeal) => {
    const override = planningSlotOverrides[pm.id];
    if (override?.day && override?.time) return { day: override.day, time: override.time };
    return { day: pm.day_of_week ?? null, time: pm.meal_time ?? null };
  };

  const getMealsForSlot = (day: string, time: string, iso?: string): PossibleMeal[] =>
    planningMeals
      .filter((pm) => {
        const visual = getVisualSlotForPm(pm);
        return (visual.day === day || (iso && visual.day === iso)) && visual.time === time;
      })
      .sort((a, b) => a.sort_order - b.sort_order);

  const getDisplayDay = (day: string | null | undefined) => {
    if (!day) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      try {
        return format(parseISO(day), 'EEEE d/MM', { locale: fr }).toUpperCase();
      } catch (e) {
        return day;
      }
    }
    return DAY_LABELS[day] || (DAY_KEY_TO_INDEX[day?.toLowerCase()] !== undefined ? DAY_LABELS[day.toLowerCase()] : day);
  };

  const unplanned = planningMeals.filter((pm) => !pm.day_of_week || !pm.meal_time);

  const calOverrides = getPreference<Record<string, string>>('planning_cal_overrides', {});
  const proOverrides = getPreference<Record<string, string>>('planning_pro_overrides', {});
  const drinkChecks = getPreference<Record<string, boolean>>('planning_drink_checks', {});
  const planningSlotOverrides = getPreference<Record<string, { day: string; time: string }>>('planning_slot_overrides', {});
  const manualCalories = getPreference<Record<string, number>>('planning_manual_calories', {});
  const extraCalories = getPreference<Record<string, number>>('planning_extra_calories', {});
  const manualProteins = getPreference<Record<string, number>>('planning_manual_proteins', {});
  const breakfastManualProteins = getPreference<Record<string, number>>('planning_breakfast_manual_proteins', {});
  const extraProteins = getPreference<Record<string, number>>('planning_extra_proteins', {});
  const extraSelections = getPreference<Record<string, string[]>>('planning_extra_selections', {});
  // Assignation visuelle d’un extra à un créneau (matin/midi/soir) d’un jour donné.
  // Clé = `${iso}-${slot}`, valeur = liste d’ids d’aliments (pas de customExtra ici).
  const extraSlotAssignments = getPreference<Record<string, string[]>>('planning_extra_slot_assignments', {});

  const savedSnapshots = getPreference<Record<string, { cal?: number; prot?: number; itemIds?: string[] }>>('planning_saved_snapshots', {});
  /**
   * Résout un snapshot d'extra pour un jour donné avec fallback évolutif :
   * - priorité à la clé ISO du jour
   * - puis clé jour (lundi/mardi/...)
   * - puis dernier snapshot ISO connu pour ce même jour de semaine
   */
  const resolveExtraSnapshotForDay = (iso: string, key: string) => {
    const direct = (savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any;
    if (direct) return direct;

    let best: any = null;
    let bestIso = "";
    for (const [snapKey, snapVal] of Object.entries(savedSnapshots)) {
      if (!snapKey.startsWith("extra-")) continue;
      const suffix = snapKey.slice("extra-".length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(suffix)) continue;
      const dow = JS_DAY_TO_KEY[new Date(`${suffix}T12:00:00`).getDay()];
      if (dow !== key) continue;
      if (!best || suffix > bestIso) {
        best = snapVal;
        bestIso = suffix;
      }
    }
    return best;
  };
  const [flashedKeys, setFlashedKeys] = useState<Record<string, boolean>>({});
  const WEEKLY_GOAL = DAILY_GOAL * DEFAULT_WEEKLY_MULTIPLIER;
  const DAILY_PROTEIN_GOAL_PREF = getPreference<number>('planning_protein_goal', DAILY_PROTEIN_GOAL);
  const NEXT_DAILY_GOAL = getPreference<number>('next_week_daily_goal', DAILY_GOAL);
  const NEXT_PROTEIN_GOAL = getPreference<number>('next_week_protein_goal', DAILY_PROTEIN_GOAL_PREF);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [editingProteinGoal, setEditingProteinGoal] = useState(false);
  const [proteinGoalInput, setProteinGoalInput] = useState("");
  const breakfastManualCalories = getPreference<Record<string, number>>('planning_breakfast_manual_calories', {});
  const autoConsumeBreakfast = getPreference<Record<string, boolean>>('planning_auto_consume_breakfast', {});

  // Préférences pour la semaine prochaine (persistent au reset)
  const nextBreakfastSelections = getPreference<Record<string, string>>('next_week_breakfast', {});
  const nextManualCalories = getPreference<Record<string, number>>('next_week_manual_calories', {});
  const nextManualProteins = getPreference<Record<string, number>>('next_week_manual_proteins', {});
  const nextExtraCalories = getPreference<Record<string, number>>('next_week_extra_calories', {});
  const nextExtraProteins = getPreference<Record<string, number>>('next_week_extra_proteins', {});
  const nextExtraSelections = getPreference<Record<string, string[]>>('next_week_extra_selections', {});
  const nextBreakfastManualCalories = getPreference<Record<string, number>>('next_week_breakfast_manual_calories', {});
  const nextBreakfastManualProteins = getPreference<Record<string, number>>('next_week_breakfast_manual_proteins', {});
  const nextDrinkChecks = getPreference<Record<string, boolean>>('next_week_drink_checks', {});

  // Recherche de repas pour la vue de sauvegarde
  const allMealsById = useMemo(() => {
    const map = new Map<string, Meal>();
    for (const m of meals) map.set(m.id, m);
    return map;
  }, [meals]);

  const backupTotals = useMemo(() => {
    if (weekOffset !== -1) return null;
    const backupRaw = getPreference<any>('possible_meals_backup', null);
    if (!backupRaw) return null;

    const isNF = backupRaw && !Array.isArray(backupRaw) && backupRaw.cards;
    const cards: any[] = isNF ? backupRaw.cards : (Array.isArray(backupRaw) ? backupRaw : []);
    const bMC = isNF ? (backupRaw.manualCalories || {}) : {};
    const bMP = isNF ? (backupRaw.manualProteins || {}) : {};
    const bEC = isNF ? (backupRaw.extraCalories || {}) : {};
    const bEP = isNF ? (backupRaw.extraProteins || {}) : {};
    const bES = isNF ? (backupRaw.extraSelections || {}) : {};
    const bBC = isNF ? (backupRaw.breakfastManualCalories || {}) : {};
    const bBP = isNF ? (backupRaw.breakfastManualProteins || {}) : {};
    const bBS = isNF ? (backupRaw.breakfastSelections || {}) : {};
    const bDC = isNF ? (backupRaw.drinkChecks || {}) : {};
    const bCO = isNF ? (backupRaw.calOverrides || {}) : {};
    const bPO = isNF ? (backupRaw.proOverrides || {}) : {};

    // Objectifs tels qu’au moment de la sauvegarde (ne pas utiliser les objectifs courants / semaine suivante)
    const archivedDailyGoal =
      isNF && backupRaw.daily_goal != null && backupRaw.daily_goal > 0 ? backupRaw.daily_goal : DEFAULT_DAILY_GOAL;
    const archivedProteinGoal =
      isNF && backupRaw.protein_goal != null && backupRaw.protein_goal > 0 ? backupRaw.protein_goal : DAILY_PROTEIN_GOAL;

    let totalCal = 0;
    let totalPro = 0;

    const bDates = weekDates;
    bDates.forEach(({ key, iso }) => {
      const isTodayBack = iso === todayISO;
      let dayCal = 0;
      let dayPro = 0;

      // Repas
      cards.filter(c => c.day_of_week === key || c.day_of_week === iso).forEach(c => {
        const m = allMealsById.get(c.meal_id);
        if (m) {
          const overrideCal = c.id ? bCO[c.id] : undefined;
          const overridePro = c.id ? bPO[c.id] : undefined;
          const fullPm = { ...c, meals: m };
          dayCal += getCardDisplayCalories(fullPm, overrideCal, isAvailableCb);
          dayPro += getCardDisplayProtein(fullPm, overridePro, isAvailableCb);
        }
      });

      // Manuel
      dayCal += (bMC[iso] || bMC[key] || 0);
      dayPro += (bMP[iso] || bMP[key] || 0);

      // Extra (manuel + liste : inclut les ids `custom::…` de la sauvegarde)
      const selExtra = sumExtrasFromSelectionIds(bES[iso] || bES[key], foodItems);
      const eCal = (bEC[iso] || bEC[key] || 0) + selExtra.cal;
      const ePro = (bEP[iso] || bEP[key] || 0) + selExtra.pro;
      dayCal += eCal;
      dayPro += ePro;

      // Petit déjeuner
      const bfSel = bBS[iso] || bBS[key];
      if (bfSel) {
        if (bfSel.startsWith('pm:')) {
          const pm = cards.find(p => p.id === bfSel.slice(3));
          if (pm) {
            dayCal += getCardDisplayCalories(pm, bCO[pm.id], isAvailableCb);
            dayPro += getCardDisplayProtein(pm, bPO[pm.id], isAvailableCb);
          }
        } else {
          const m = allMealsById.get(bfSel);
          if (m) {
            dayCal += parseCalories(m.calories);
            dayPro += parseProtein(m.protein);
          }
        }
      }
      dayCal += (bBC[iso] || bBC[key] || 0);
      dayPro += (bBP[iso] || bBP[key] || 0);

      for (const time of TIMES) {
        if (bDC[`${iso}-${time}`] || bDC[`${key}-${time}`]) dayCal += 150;
      }

      totalCal += dayCal;
      totalPro += dayPro;
    });

    return { totalCal, totalPro, archivedDailyGoal, archivedProteinGoal };
  }, [getPreference, weekOffset, allMealsById, foodItems, weekDates]);

  const handleAddExtraItem = (day: string, item: FoodItem, remove = false) => {
    const updated = { ...extraSelections };
    const current = updated[day] || [];
    if (remove) {
      // Retirer une instance
      const idx = current.lastIndexOf(item.id);
      if (idx >= 0) {
        updated[day] = [...current.slice(0, idx), ...current.slice(idx + 1)];
      }
    } else {
      // Toujours ajouter (autoriser les doublons)
      updated[day] = [...current, item.id];
    }
    setPreference.mutate({ key: 'planning_extra_selections', value: updated });
  };

  // Garantit qu’un extra est présent dans `planning_extra_selections` pour un jour donné.
  // Fonctionne pour les extras standards ET personnalisés (`custom::...`).
  const ensureExtraSelectedForDay = (extraId: string, iso: string, key: string) => {
    if (!extraId) return;
    const cur = extraSelections[iso] || extraSelections[key] || [];
    if (cur.includes(extraId)) return;
    const updated = { ...extraSelections };
    if (iso) updated[iso] = [...cur, extraId]; else updated[key] = [...cur, extraId];
    setPreference.mutate({ key: 'planning_extra_selections', value: updated });
  };

  // Assigne un extra à un créneau précis du jour et le retire des autres créneaux du même jour.
  const assignExtraToDaySlot = (extraId: string, iso: string, key: string, slot: 'matin' | 'midi' | 'soir' | 'gouter') => {
    if (!extraId) return;
    ensureExtraSelectedForDay(extraId, iso, key);
    const assignments = { ...extraSlotAssignments };
    const slots: Array<'matin' | 'midi' | 'soir' | 'gouter'> = ['matin', 'midi', 'soir', 'gouter'];
    for (const s of slots) {
      const kIso = `${iso}-${s}`;
      const kKey = `${key}-${s}`;
      if (s !== slot) {
        if (assignments[kIso]?.includes(extraId)) assignments[kIso] = assignments[kIso].filter(x => x !== extraId);
        if (assignments[kKey]?.includes(extraId)) assignments[kKey] = assignments[kKey].filter(x => x !== extraId);
      }
    }
    const targetKey = iso ? `${iso}-${slot}` : `${key}-${slot}`;
    const targetCur = assignments[targetKey] || [];
    if (!targetCur.includes(extraId)) assignments[targetKey] = [...targetCur, extraId];
    setPreference.mutate({ key: 'planning_extra_slot_assignments', value: assignments });
  };

  // Retire un extra du créneau ciblé d’un jour (ne le désélectionne pas au niveau jour).
  const removeExtraFromDaySlot = (extraId: string, iso: string, key: string, slot: 'matin' | 'midi' | 'soir' | 'gouter') => {
    if (!extraId) return;
    const kIso = `${iso}-${slot}`;
    const kKey = `${key}-${slot}`;
    const updated = { ...extraSlotAssignments };
    if (updated[kIso]?.includes(extraId)) updated[kIso] = updated[kIso].filter(x => x !== extraId);
    if (updated[kKey]?.includes(extraId)) updated[kKey] = updated[kKey].filter(x => x !== extraId);
    setPreference.mutate({ key: 'planning_extra_slot_assignments', value: updated });
  };

  // Liste les ids d'extras déjà posés dans les slots d'une journée (matin/midi/soir/goûter).
  const getAssignedExtraIdsForDay = (iso: string, key: string): string[] => {
    const slots: Array<'matin' | 'midi' | 'soir' | 'gouter'> = ['matin', 'midi', 'soir', 'gouter'];
    const out = new Set<string>();
    for (const s of slots) {
      for (const id of (extraSlotAssignments[`${iso}-${s}`] ?? [])) out.add(id);
      for (const id of (extraSlotAssignments[`${key}-${s}`] ?? [])) out.add(id);
    }
    return [...out];
  };

  // Retire un extra de tous les slots de la journée (retour dans la catégorie "Extras").
  const unassignExtraFromAllDaySlots = (extraId: string, iso: string, key: string) => {
    if (!extraId) return;
    const slots: Array<'matin' | 'midi' | 'soir' | 'gouter'> = ['matin', 'midi', 'soir', 'gouter'];
    const updated = { ...extraSlotAssignments };
    for (const s of slots) {
      const kIso = `${iso}-${s}`;
      const kKey = `${key}-${s}`;
      if (updated[kIso]?.includes(extraId)) updated[kIso] = updated[kIso].filter(x => x !== extraId);
      if (updated[kKey]?.includes(extraId)) updated[kKey] = updated[kKey].filter(x => x !== extraId);
    }
    setPreference.mutate({ key: 'planning_extra_slot_assignments', value: updated });
  };

  // Désélectionne complètement un extra du jour (toutes occurrences) + le retire de tous les slots.
  const deselectExtraForDay = (extraId: string, iso: string, key: string) => {
    if (!extraId) return;
    const updatedSel = { ...extraSelections };
    const cur = updatedSel[iso] || updatedSel[key] || [];
    const next = cur.filter((id) => id !== extraId);
    if (iso) updatedSel[iso] = next;
    else updatedSel[key] = next;
    setPreference.mutate({ key: 'planning_extra_selections', value: updatedSel });
    unassignExtraFromAllDaySlots(extraId, iso, key);
  };

  // Retire une seule occurrence d'un extra dans une sélection de journée.
  const removeOneExtraOccurrenceForDay = (selection: Record<string, string[]>, dayIso: string, dayKey: string, extraId: string) => {
    const next = { ...selection };
    const isoList = [...(next[dayIso] || [])];
    const keyList = [...(next[dayKey] || [])];
    const isoIdx = isoList.lastIndexOf(extraId);
    if (isoIdx >= 0) {
      isoList.splice(isoIdx, 1);
      next[dayIso] = isoList;
      return next;
    }
    const keyIdx = keyList.lastIndexOf(extraId);
    if (keyIdx >= 0) {
      keyList.splice(keyIdx, 1);
      next[dayKey] = keyList;
    }
    return next;
  };

  // Déplace un extra entre deux jours en évitant les courses d'écritures (suppression + ajout atomiques).
  const moveExtraBetweenDaysToSlot = (
    extraId: string,
    sourceIso: string,
    sourceKey: string,
    targetIso: string,
    targetKey: string,
    targetSlot: 'matin' | 'midi' | 'soir' | 'gouter'
  ) => {
    if (!extraId) return;

    const nextSelections = removeOneExtraOccurrenceForDay(extraSelections, sourceIso, sourceKey, extraId);
    const targetCurrent = nextSelections[targetIso] || nextSelections[targetKey] || [];
    if (!targetCurrent.includes(extraId)) {
      nextSelections[targetIso] = [...targetCurrent, extraId];
    }

    const nextAssignments = { ...extraSlotAssignments };
    const slots: Array<'matin' | 'midi' | 'soir' | 'gouter'> = ['matin', 'midi', 'soir', 'gouter'];
    for (const s of slots) {
      const sIso = `${sourceIso}-${s}`;
      const sKey = `${sourceKey}-${s}`;
      if (nextAssignments[sIso]?.includes(extraId)) nextAssignments[sIso] = nextAssignments[sIso].filter((x) => x !== extraId);
      if (nextAssignments[sKey]?.includes(extraId)) nextAssignments[sKey] = nextAssignments[sKey].filter((x) => x !== extraId);
    }

    for (const s of slots) {
      if (s === targetSlot) continue;
      const tIso = `${targetIso}-${s}`;
      const tKey = `${targetKey}-${s}`;
      if (nextAssignments[tIso]?.includes(extraId)) nextAssignments[tIso] = nextAssignments[tIso].filter((x) => x !== extraId);
      if (nextAssignments[tKey]?.includes(extraId)) nextAssignments[tKey] = nextAssignments[tKey].filter((x) => x !== extraId);
    }
    const targetAssignKey = `${targetIso}-${targetSlot}`;
    const targetAssigned = nextAssignments[targetAssignKey] || [];
    if (!targetAssigned.includes(extraId)) {
      nextAssignments[targetAssignKey] = [...targetAssigned, extraId];
    }

    setPreference.mutate({ key: 'planning_extra_selections', value: nextSelections });
    setPreference.mutate({ key: 'planning_extra_slot_assignments', value: nextAssignments });
  };

  const handleDrop = async (e: React.DragEvent, day: string, time: string) => {
    e.preventDefault();
    setDragOverSlot(null);
    const pmId = e.dataTransfer.getData("pmId");
    const source = e.dataTransfer.getData("source");
    if (pmId) {
      const draggedPm = possibleMeals.find((p) => p.id === pmId);
      const isPlanningDrag = source === "planning-slot";
      const isAlreadyPlanned = Boolean(draggedPm?.day_of_week && draggedPm?.meal_time);
      const isSameDay = draggedPm?.day_of_week === day;
      const targetIsGouter = time === 'gouter';
      if (isPlanningDrag && isAlreadyPlanned && isSameDay && targetIsGouter) {
        const updated = { ...planningSlotOverrides };
        const sameAsPlanned = draggedPm?.day_of_week === day && draggedPm?.meal_time === time;
        if (sameAsPlanned) delete updated[pmId];
        else updated[pmId] = { day, time };
        setPreference.mutate({ key: 'planning_slot_overrides', value: updated });
      } else {
        const updated = { ...planningSlotOverrides };
        if (updated[pmId]) {
          delete updated[pmId];
          setPreference.mutate({ key: 'planning_slot_overrides', value: updated });
        }
        updatePlanningWithCounters(pmId, day, time);
      }
      return;
    }
    // Drop d’un extra sélectionné dans ce créneau (midi/soir uniquement côté TIMES).
    const extraId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
    if (extraId) {
      const iso = day;
      const dayKeyFromIso = weekDates.find(w => w.iso === iso)?.key || '';
      const origin = draggedSelectedExtraOrigin;
      if (origin && origin.iso && origin.iso !== iso) {
        moveExtraBetweenDaysToSlot(extraId, origin.iso, origin.key, iso, dayKeyFromIso, time as 'midi' | 'soir' | 'gouter');
      } else {
        assignExtraToDaySlot(extraId, iso, dayKeyFromIso, time as 'midi' | 'soir' | 'gouter');
      }
      setDraggedSelectedExtraId(null);
      setDraggedSelectedExtraOrigin(null);
    }
  };

  const handleDropOnCard = (e: React.DragEvent, targetPm: PossibleMeal) => {
    e.preventDefault();
    e.stopPropagation();
    setSlotDragOver(null);
    const extraId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
    if (extraId) {
      const targetDay = targetPm.day_of_week;
      const targetTime = targetPm.meal_time;
      if (targetDay && (targetTime === 'matin' || targetTime === 'midi' || targetTime === 'soir')) {
        const dayKeyFromIso = weekDates.find(w => w.iso === targetDay)?.key || '';
        const origin = draggedSelectedExtraOrigin;
        if (origin && origin.iso && origin.iso !== targetDay) {
          moveExtraBetweenDaysToSlot(extraId, origin.iso, origin.key, targetDay, dayKeyFromIso, targetTime);
        } else {
          assignExtraToDaySlot(extraId, targetDay, dayKeyFromIso, targetTime);
        }
        setDraggedSelectedExtraId(null);
        setDraggedSelectedExtraOrigin(null);
      }
      return;
    }
    const draggedPmId = e.dataTransfer.getData("pmId");
    const source = e.dataTransfer.getData("source");
    if (!draggedPmId || draggedPmId === targetPm.id) return;

    const targetVisual = getVisualSlotForPm(targetPm);
    const targetDay = targetVisual.day || targetPm.day_of_week!;
    const targetTime = targetVisual.time || targetPm.meal_time!;
    const draggedPm = possibleMeals.find(p => p.id === draggedPmId);
    const isPlanningDrag = source === "planning-slot";
    const isAlreadyPlanned = Boolean(draggedPm?.day_of_week && draggedPm?.meal_time);
    const isSameDay = draggedPm?.day_of_week === targetDay;
    const targetIsGouter = targetTime === 'gouter';
    const shouldOnlyOverride = isPlanningDrag && isAlreadyPlanned && isSameDay && targetIsGouter;

    // Si la carte vient d'un autre créneau ou est non planifiée, mettre d'abord à jour sa planification
    if (!shouldOnlyOverride && (!draggedPm || draggedPm.day_of_week !== targetDay || draggedPm.meal_time !== targetTime)) {
      const updated = { ...planningSlotOverrides };
      if (updated[draggedPmId]) {
        delete updated[draggedPmId];
        setPreference.mutate({ key: 'planning_slot_overrides', value: updated });
      }
      updatePlanningWithCounters(draggedPmId, targetDay, targetTime);
    } else if (shouldOnlyOverride && draggedPm) {
      const updated = { ...planningSlotOverrides };
      const sameAsPlanned = draggedPm.day_of_week === targetDay && draggedPm.meal_time === targetTime;
      if (sameAsPlanned) delete updated[draggedPmId];
      else updated[draggedPmId] = { day: targetDay, time: targetTime };
      setPreference.mutate({ key: 'planning_slot_overrides', value: updated });
    }

    const slot = getMealsForSlot(targetDay, targetTime);
    const filtered = slot.filter((p) => p.id !== draggedPmId);
    const targetIdx = filtered.findIndex((p) => p.id === targetPm.id);
    const insertAt = targetIdx === -1 ? filtered.length : targetIdx;
    filtered.splice(insertAt, 0, { id: draggedPmId } as PossibleMeal);
    reorderPossibleMeals.mutate(filtered.map((p, i) => ({ id: p.id, sort_order: i })));
  };

  const handleDropUnplanned = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverUnplanned(false);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) {
      const updated = { ...planningSlotOverrides };
      delete updated[pmId];
      setPreference.mutate({ key: 'planning_slot_overrides', value: updated });
      updatePlanningWithCounters(pmId, null, null);
    }
  };

  const handleTouchStart = (e: React.TouchEvent, pm: PossibleMeal) => {
    const touch = e.touches[0];
    const origEl = e.currentTarget as HTMLElement;
    const rect = origEl.getBoundingClientRect();

    if (longPressTimer.current) clearTimeout(longPressTimer.current);

    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";

      const ghost = origEl.cloneNode(true) as HTMLElement;
      ghost.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        z-index: 9999;
        pointer-events: none;
        opacity: 0.85;
        transform: scale(1.05);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.35);
        transition: none;
      `;
      document.body.appendChild(ghost);

      touchDrag.current = {
        pmId: pm.id,
        ghost,
        startX: touch.clientX,
        startY: touch.clientY,
        origTop: rect.top,
        origLeft: rect.left,
      };
      setTouchDragActive(true);
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchDrag.current) {
      e.preventDefault();
    } else if (!longPressTimer.current) {
      return;
    } else {
      return;
    }

    e.preventDefault();
    const touch = e.touches[0];
    const state = touchDrag.current;
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;

    state.ghost.style.top = `${state.origTop + dy}px`;
    state.ghost.style.left = `${state.origLeft + dx}px`;

    state.ghost.style.visibility = "hidden";
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    state.ghost.style.visibility = "visible";

    const slotEl = el?.closest("[data-slot]");
    if (slotEl) {
      const day = slotEl.getAttribute("data-day")!;
      const time = slotEl.getAttribute("data-time")!;
      setTouchHighlight(`${day}-${time}`);
    } else if (el?.closest("[data-unplanned]")) {
      setTouchHighlight("unplanned");
    } else {
      setTouchHighlight(null);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    const state = touchDrag.current;
    if (!state) return;

    touchDrag.current = null;
    setTouchDragActive(false);
    setTouchHighlight(null);
    document.body.style.overflow = "";
    document.body.style.touchAction = "";

    const touch = e.changedTouches[0];
    state.ghost.style.visibility = "hidden";
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    state.ghost.remove();

    const slotEl = el?.closest("[data-slot]");
    if (slotEl) {
      const day = slotEl.getAttribute("data-day")!;
      const time = slotEl.getAttribute("data-time")!;
      const draggedPm = possibleMeals.find((p) => p.id === state.pmId);
      const isAlreadyPlanned = Boolean(draggedPm?.day_of_week && draggedPm?.meal_time);
      const isSameDay = draggedPm?.day_of_week === day;
      const targetIsGouter = time === 'gouter';
      if (isAlreadyPlanned && isSameDay && targetIsGouter) {
        const updated = { ...planningSlotOverrides };
        const sameAsPlanned = draggedPm?.day_of_week === day && draggedPm?.meal_time === time;
        if (sameAsPlanned) delete updated[state.pmId];
        else updated[state.pmId] = { day, time };
        setPreference.mutate({ key: 'planning_slot_overrides', value: updated });
      } else {
        const updated = { ...planningSlotOverrides };
        if (updated[state.pmId]) {
          delete updated[state.pmId];
          setPreference.mutate({ key: 'planning_slot_overrides', value: updated });
        }
        updatePlanningWithCounters(state.pmId, day, time);
      }
    } else if (el?.closest("[data-unplanned]")) {
      const updated = { ...planningSlotOverrides };
      delete updated[state.pmId];
      setPreference.mutate({ key: 'planning_slot_overrides', value: updated });
      updatePlanningWithCounters(state.pmId, null, null);
    }
  };

  const handleTouchCancel = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (touchDrag.current) {
      touchDrag.current.ghost.remove();
      touchDrag.current = null;
    }
    setTouchDragActive(false);
    setTouchHighlight(null);
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
  };

  const handleRemoveFromSlot = (pm: PossibleMeal) => {
    const updated = { ...planningSlotOverrides };
    delete updated[pm.id];
    setPreference.mutate({ key: 'planning_slot_overrides', value: updated });
    updatePlanningWithCounters(pm.id, null, null);
  };

  const renderMiniCard = (pm: PossibleMeal, compact = false, hideIngredients = false) => {
    const meal = pm.meals;
    if (!meal) return null;
    const displayIngredients = pm.ingredients_override ?? meal.ingredients;
    const mealForAnalysis = { ...meal, ingredients: displayIngredients };
    const analysis = analyzeMealIngredients(mealForAnalysis, foodItems);

    const isOccupied = masterSourcePmIds.has(pm.id) || unParUnSourcePmIds.has(pm.id);
    const effectiveStart = isOccupied
      ? pm.counter_start_date
      : (resolveCounterStartForPossibleBadge(
          pm,
          possibleMeals,
          analysis.earliestCounterDate,
          pm.counter_start_date ?? undefined,
          foodItems,
          undefined,
        ) ?? analysis.earliestCounterDate ?? pm.counter_start_date);
    const counterDays = getAdaptedCounterDays(effectiveStart, pm.day_of_week, pm.created_at, pm.meal_time);
    const counterBadgeTitle =
      counterDays !== null && effectiveStart
        ? getCounterDaysBadgeTooltip(effectiveStart, pm.day_of_week, pm.meal_time, counterDays)
        : undefined;
    const counterUrgent = counterDays !== null && counterDays >= 3;

    const expiredIngs = analysis.expiredIngredientNames;
    const soonIngs = analysis.expiringSoonIngredientNames;

    const overrideCal = calOverrides[pm.id];
    const expired = isExpiredOnDay(pm.expiration_date, pm.day_of_week);

    // Utiliser la détection de ratio partagée
    let displayMeal = meal;
    const detectedRatio = getOverrideScaleRatio(meal, pm.ingredients_override);
    if (detectedRatio !== null && meal.grams) {
      const baseG = parseFloat(meal.grams.replace(/[^0-9.]/g, '')) || 0;
      if (baseG > 0) {
        displayMeal = { ...meal, grams: String(Math.round(baseG * detectedRatio)) };
      }
    }

    // Utiliser la logique de macros centralisée — toujours arrondir aux entiers (pas de décimales)
    const rawCalNum = overrideCal ? (parseFloat(overrideCal) || 0) : getCardDisplayCalories(pm, undefined, isAvailableCb);
    const displayCal = rawCalNum ? String(Math.round(rawCalNum)) : null;
    const overridePro = proOverrides[pm.id];
    const rawProNum = overridePro ? (parseFloat(overridePro) || 0) : getCardDisplayProtein(pm, undefined, isAvailableCb);
    const displayPro = rawProNum ? String(Math.round(rawProNum)) : null;

    const isComputedCal = !overrideCal && computeIngredientCalories(displayIngredients, isAvailableCb) !== null;
    const isComputedPro = !overridePro && computeIngredientProtein(displayIngredients, isAvailableCb) !== null;

    return (
      <PlanningMiniCard
        key={pm.id}
        pm={pm}
        meal={displayMeal}
        expired={expired}
        expiredIngredientNames={expiredIngs}
        expiringSoonIngredientNames={soonIngs}
        counterDays={counterDays}
        counterBadgeTitle={counterBadgeTitle}
        counterUrgent={counterUrgent}
        isPast={(() => {
          if (!pm.day_of_week) return false;
          const target = getDateForDayKey(pm.day_of_week, new Date());
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return target.getTime() < today.getTime();
        })()}
        displayCal={displayCal}
        isComputedCal={isComputedCal}
        displayPro={displayPro}
        isComputedPro={isComputedPro}
        compact={compact}
        hideIngredients={hideIngredients}
        isTouchDevice={isTouchDevice}
        touchDragActive={touchDragActive}
        slotDragOver={slotDragOver}
        onDragStart={(e) => {
          e.dataTransfer.setData("pmId", pm.id);
          e.dataTransfer.setData("mealId", pm.meal_id);
          e.dataTransfer.setData("source", "planning-slot");
          slotDragRef.current = { pmId: pm.id, slotKey: `${pm.day_of_week}-${pm.meal_time}` };
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSlotDragOver(pm.id);
        }}
        onDragLeave={() => setSlotDragOver(null)}
        onDrop={(e) => handleDropOnCard(e, pm)}
        onTouchStart={(e) => handleTouchStart(e, pm)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onRemove={() => handleRemoveFromSlot(pm)}
        onCalorieChange={(val) => {
          const updated = { ...calOverrides };
          if (val) updated[pm.id] = val;
          else delete updated[pm.id];
          setPreference.mutate({ key: 'planning_cal_overrides', value: updated });
        }}
        onProteinChange={(val) => {
          const updated = { ...proOverrides };
          if (val) updated[pm.id] = val;
          else delete updated[pm.id];
          setPreference.mutate({ key: 'planning_pro_overrides', value: updated });
        }}
        onDoubleClick={() => setPopupPm(pm)}
        stockMap={stockMap}
      />
    );
  };

  const weekTotal = weekDates.reduce((sum, d) => sum + getDayCalories(d.key, d.iso), 0);

  const handleRestoreBackup = async () => {
    if (restoreLockRef.current) return;
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      toast({ title: "Non connecté", description: "Utilisateur non connecté.", variant: "destructive" });
      return;
    }

    let raw: any;
    try {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("value")
        .eq("key", "possible_meals_backup")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      raw = data?.value;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Lecture sauvegarde impossible", description: msg, variant: "destructive" });
      return;
    }

    const isNewFormat = raw && !Array.isArray(raw) && raw.cards;
    const backup: any[] = isNewFormat ? raw.cards : (Array.isArray(raw) ? raw : []);
    if (backup.length === 0) {
      toast({ title: "Aucune sauvegarde", description: "Aucune donnée à restaurer.", variant: "destructive" });
      return;
    }
    if (!confirm(`Restaurer ${backup.length} carte(s) possible(s) ?`)) return;

    restoreLockRef.current = true;
    setRestoreBusy(true);
    try {
      const inserts = backup.map((pm: any) =>
        (supabase as any).from("possible_meals").insert({
          meal_id: pm.meal_id,
          quantity: pm.quantity,
          expiration_date: pm.expiration_date,
          day_of_week: pm.day_of_week,
          meal_time: pm.meal_time,
          counter_start_date: pm.counter_start_date,
          sort_order: pm.sort_order,
          ingredients_override: pm.ingredients_override,
        })
      );
      const results = await Promise.all(inserts);
      for (const r of results) {
        if (r.error) throw new Error(r.error.message);
      }

      if (isNewFormat) {
        if (raw.manualCalories) setPreference.mutate({ key: "planning_manual_calories", value: raw.manualCalories });
        if (raw.manualProteins) setPreference.mutate({ key: "planning_manual_proteins", value: raw.manualProteins });
        if (raw.extraCalories) setPreference.mutate({ key: "planning_extra_calories", value: raw.extraCalories });
        if (raw.extraProteins) setPreference.mutate({ key: "planning_extra_proteins", value: raw.extraProteins });
        if (raw.extraSelections) setPreference.mutate({ key: "planning_extra_selections", value: raw.extraSelections });
        if (raw.breakfastManualCalories) setPreference.mutate({ key: "planning_breakfast_manual_calories", value: raw.breakfastManualCalories });
        if (raw.breakfastManualProteins) setPreference.mutate({ key: "planning_breakfast_manual_proteins", value: raw.breakfastManualProteins });
        if (raw.breakfastSelections) setPreference.mutate({ key: "planning_breakfast", value: raw.breakfastSelections });
        if (raw.drinkChecks) setPreference.mutate({ key: "planning_drink_checks", value: raw.drinkChecks });
        if (raw.calOverrides) setPreference.mutate({ key: "planning_cal_overrides", value: raw.calOverrides });
        if (raw.proOverrides) setPreference.mutate({ key: "planning_pro_overrides", value: raw.proOverrides });
        if (raw.daily_goal) {
          setPreference.mutate({ key: "planning_daily_goal", value: raw.daily_goal });
          setPreference.mutate({ key: "next_week_daily_goal", value: raw.daily_goal });
        }
        if (raw.protein_goal) {
          setPreference.mutate({ key: "planning_protein_goal", value: raw.protein_goal });
          setPreference.mutate({ key: "next_week_protein_goal", value: raw.protein_goal });
        }
      }

      await qc.invalidateQueries({ queryKey: ["possible_meals"] });
      await qc.invalidateQueries({ queryKey: ["user_preferences"] });
      toast({ title: "Sauvegarde restaurée", description: `${backup.length} carte(s) réimportée(s).` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Restauration échouée", description: msg, variant: "destructive" });
    } finally {
      restoreLockRef.current = false;
      setRestoreBusy(false);
    }
  };

  const handleGlobalCalBlur = (val: number) => {
    if (weekOffset === 1) setPreference.mutate({ key: "next_week_daily_goal", value: val });
    else {
      setPreference.mutate({ key: "planning_daily_goal", value: val });
      setPreference.mutate({ key: "next_week_daily_goal", value: val });
    }
  };

  const handleGlobalProtBlur = (val: number) => {
    if (weekOffset === 1) setPreference.mutate({ key: "next_week_protein_goal", value: val });
    else {
      setPreference.mutate({ key: "planning_protein_goal", value: val });
      setPreference.mutate({ key: "next_week_protein_goal", value: val });
    }
  };

  const handleManualReset = async () => {
    if (!confirm('Réinitialiser le planning ? Les cartes seront supprimées et les valeurs sauvegardées (💾) seront restaurées.')) return;
    if (manualResetLockRef.current) return;
    manualResetLockRef.current = true;
    setManualResetBusy(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) {
        toast({ title: "Non connecté", description: "Session invalide.", variant: "destructive" });
        return;
      }

      const { snapshots, prefMap } = await fetchSnapshotsAndPrefsParallel(userId);

      await qc.refetchQueries({ queryKey: ["possible_meals"] });
      const freshPM =
        (qc.getQueryData<PossibleMeal[]>(["possible_meals"]) as PossibleMeal[] | undefined) ?? possibleMeals;

      const fullBackup = buildFullBackupPayload(freshPM, prefMap);
      await upsertPossibleMealsFullBackup(userId, fullBackup);

      const ids = getPossibleMealIdsToDeleteOnManualReset(freshPM);
      await deletePossibleMealsByIds(ids);

      const merged = mergeSnapshotsIntoLivePrefMap(prefMap, snapshots);
      const goals = resolvePostResetGoals(prefMap);
      pushWeeklyResetClientPreferences(
        setPreference,
        merged,
        goals,
        new Date().toISOString(),
        "manual_button"
      );

      await qc.invalidateQueries({ queryKey: ["possible_meals"] });
      await qc.invalidateQueries({ queryKey: ["user_preferences"] });
      toast({ title: "Planning réinitialisé", description: "Les cartes ont été supprimées ; l’état 💾 a été réappliqué." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Échec du reset", description: msg, variant: "destructive" });
    } finally {
      manualResetLockRef.current = false;
      setManualResetBusy(false);
    }
  };

  return (
    <div className={`max-w-4xl mx-auto space-y-3 overflow-x-hidden planning-responsive ${touchDragActive ? "touch-none" : ""}`}>
      <PlanningHeader
        weekOffset={weekOffset}
        onWeekOffsetChange={setWeekOffset}
        manualResetBusy={manualResetBusy}
        onManualReset={handleManualReset}
        restoreBusy={restoreBusy}
        onRestoreBackup={handleRestoreBackup}
        dailyGoal={DAILY_GOAL}
        nextDailyGoal={NEXT_DAILY_GOAL}
        dailyProteinGoal={DAILY_PROTEIN_GOAL_PREF}
        nextProteinGoal={NEXT_PROTEIN_GOAL}
        onGlobalCalBlur={handleGlobalCalBlur}
        onGlobalProtBlur={handleGlobalProtBlur}
        backupTotals={backupTotals}
      />

      {weekOffset === 0 ? (<>
        {weekDates.map(({ key, iso, display }) => {
          const isToday_ = iso === todayISO;
          const dayCalories = getDayCalories(key, iso);
          const matinMeals = getMealsForSlot(key, 'matin', iso);
          const matinCals = matinMeals.reduce((s, pm) => s + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb), 0);
          const matinPro = matinMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, proOverrides[pm.id], isAvailableCb), 0);

          const breakfast = getBreakfastForDay(key, iso);
          let baseBreakfastCals = 0;
          let baseBreakfastPro = 0;
          if (breakfast) {
            const selId = (iso && breakfastSelections[iso]) || breakfastSelections[key];
            if (selId?.startsWith('pm:')) {
              const pmId = selId.slice(3);
              const possiblePdj = possibleMeals.find(pm => pm.id === pmId);
              const isAlsoMatin = possiblePdj && (possiblePdj.day_of_week === key || possiblePdj.day_of_week === iso) && possiblePdj.meal_time === 'matin';
              if (isAlsoMatin) {
                baseBreakfastCals = 0;
                baseBreakfastPro = 0;
              } else {
                baseBreakfastCals = possiblePdj ? getCardDisplayCalories(possiblePdj, calOverrides[possiblePdj.id], isAvailableCb) : parseCalories(breakfast.calories);
                baseBreakfastPro = possiblePdj ? getCardDisplayProtein(possiblePdj, proOverrides[possiblePdj.id], isAvailableCb) : parseProtein(breakfast.protein);
              }
            } else {
              baseBreakfastCals = getMealCal(breakfast);
              baseBreakfastPro = getMealPro(breakfast);
            }
          } else {
            baseBreakfastCals = (iso && breakfastManualCalories[iso]) || breakfastManualCalories[key] || 0;
            baseBreakfastPro = (iso && breakfastManualProteins[iso]) || breakfastManualProteins[key] || 0;
          }

          const breakfastAssignedIds =
            extraSlotAssignments[`${iso}-matin`] ?? extraSlotAssignments[`${key}-matin`] ?? [];
          const breakfastAssigned = sumExtrasFromSelectionIds(breakfastAssignedIds, foodItems);
          const breakfastTotalCals = baseBreakfastCals + matinCals + breakfastAssigned.cal;
          const breakfastTotalPro = baseBreakfastPro + matinPro + breakfastAssigned.pro;
          const gouterAssignedIds =
            extraSlotAssignments[`${iso}-gouter`] ?? extraSlotAssignments[`${key}-gouter`] ?? [];
          const gouterAssigned = sumExtrasFromSelectionIds(gouterAssignedIds, foodItems);
          const gouterManualCal = manualCalories[`${iso}-gouter`] || manualCalories[`${key}-gouter`] || 0;
          const gouterManualPro = manualProteins[`${iso}-gouter`] || manualProteins[`${key}-gouter`] || 0;
          const gouterDrink = Boolean(drinkChecks[`${iso}-gouter`] || drinkChecks[`${key}-gouter`]);
          const gouterTotalCals = gouterManualCal + gouterAssigned.cal + (gouterDrink ? 150 : 0);
          const gouterTotalPro = gouterManualPro + gouterAssigned.pro;

          const breakfastDropKey = `${iso}-matin`;
          const isBreakfastDragOver = dragOverSlot === breakfastDropKey || dragOverSlot === `${key}-matin`;
          const breakfastAssignedSlotIds =
            extraSlotAssignments[breakfastDropKey] ?? extraSlotAssignments[`${key}-matin`] ?? [];
          return (
            <div
              key={iso}
              ref={isToday_ ? todayRef : undefined}
              className={`rounded-2xl p-2 sm:p-4 transition-all ${isToday_ ? "bg-primary/10 ring-2 ring-primary/40" : "bg-card/80 backdrop-blur-sm"}`}
            >
              <div className="flex items-start gap-2 mb-2 flex-wrap">
                <h3
                  className={`text-sm sm:text-base font-bold flex items-center gap-2 ${isToday_ ? "text-primary" : "text-foreground"}`}
                >
                  {display}
                  {isToday_ && (
                    <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-semibold">
                      Aujourd'hui
                    </span>
                  )}
                </h3>
                <div
                  className={`rounded-xl border border-dashed px-2 py-2 transition-colors ${isBreakfastDragOver ? 'border-primary/60 bg-primary/7 ring-1 ring-primary/20' : 'border-border/55 bg-background/10 hover:border-primary/40'}`}
                  onDragOver={(e) => {
                    const canAccept = !!(draggedSelectedExtraId || e.dataTransfer.types.includes('text/plain'));
                    if (!canAccept) return;
                    e.preventDefault();
                    setDragOverSlot(breakfastDropKey);
                  }}
                  onDragLeave={() => setDragOverSlot((cur) => (cur === breakfastDropKey ? null : cur))}
                  onDrop={(e) => {
                    const extraId = draggedSelectedExtraId || e.dataTransfer.getData('text/plain');
                    if (!extraId) return;
                    e.preventDefault();
                    const origin = draggedSelectedExtraOrigin;
                    if (origin && origin.iso && origin.iso !== iso) {
                      moveExtraBetweenDaysToSlot(extraId, origin.iso, origin.key, iso, key, 'matin');
                    } else {
                      assignExtraToDaySlot(extraId, iso, key, 'matin');
                    }
                    setDraggedSelectedExtraId(null);
                    setDraggedSelectedExtraOrigin(null);
                    setDragOverSlot(null);
                  }}
                >
                {/* Sélecteur de petit déj */}
                <div className="flex items-center gap-1 flex-wrap">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors truncate max-w-[120px] ${
                          (() => {
                            const count = matinMeals.length + (getBreakfastForDay(key, iso) ? 1 : 0);
                            return count > 0
                              ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50"
                              : "bg-slate-200/80 dark:bg-slate-700/45 text-slate-700 dark:text-slate-300 border border-dashed border-slate-400/50 dark:border-slate-500/50 hover:bg-slate-300/80 dark:hover:bg-slate-600/50";
                          })()
                        }`}
                        onDoubleClick={() => {
                          const bm = getBreakfastForDay(key, iso);
                          if (bm) setPopupBreakfast({ meal: bm, day: iso });
                        }}
                      >
                        {(() => {
                          const count = matinMeals.length + (getBreakfastForDay(key, iso) ? 1 : 0);
                          if (count > 1) return 'Plusieurs petits déj';
                          if (count === 1) {
                            if (matinMeals.length === 1) return matinMeals[0].meals?.name || '🥐 Petit déj';
                            return getBreakfastForDay(key, iso)?.name || '🥐 Petit déj';
                          }
                          return '🥐 Petit déj';
                        })()}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-2" align="start">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Petit déjeuner</p>
                      <div className="space-y-0.5 max-h-48 overflow-y-auto">
                        <button onClick={() => setBreakfastForDay(iso, null)} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors">
                          — Aucun
                        </button>
                        {possiblePetitDej.length > 0 && (
                          <>
                            <p className="text-[9px] text-muted-foreground/60 px-2 font-semibold uppercase tracking-wide">Possible</p>
                            {possiblePetitDej.map(pm => {
                              const displayIng = pm.ingredients_override ?? pm.meals?.ingredients;
                              const calDisplay = getMealCal(pm.meals || {}, pm.ingredients_override);
                              const proDisplay = getMealPro(pm.meals || {}, pm.ingredients_override);
                              const pmSelId = `pm:${pm.id}`;
                              const isMatinSelected = (pm.day_of_week === key || pm.day_of_week === iso) && pm.meal_time === 'matin';
                              const isDropdownSelected = (iso && breakfastSelections[iso] === pmSelId) || breakfastSelections[key] === pmSelId;
                              const isSelected = isMatinSelected || isDropdownSelected;
                              // Trouver les autres jours où ce petit déjeuner est sélectionné
                              const otherDays = weekDates.filter(wd => wd.iso !== iso && (breakfastSelections[wd.iso] === pmSelId || breakfastSelections[wd.key] === pmSelId || (pm.day_of_week === wd.iso && pm.meal_time === 'matin') || (pm.day_of_week === wd.key && pm.meal_time === 'matin')));
                              const otherDaysLabel = otherDays.length > 0 ? otherDays.map(d => d.display.slice(0, 3)).join(', ') : null;
                              return (
                                <button key={pm.id} onClick={() => {
                                  if (isDropdownSelected) setBreakfastForDay(iso, null);
                                  if (isSelected) {
                                    updatePlanningWithCounters(pm.id, null, null);
                                  } else {
                                    updatePlanningWithCounters(pm.id, iso, 'matin');
                                  }
                                }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : otherDaysLabel ? 'bg-amber-100/40 text-amber-900 dark:text-amber-100' : ''}`}>
                                  {pm.meals?.name} {pm.ingredients_override ? '✏️' : ''} {(calDisplay || proDisplay) ? <span className="inline-flex items-center gap-0.5 ml-1 text-muted-foreground">({calDisplay ? <><Flame className="w-2.5 h-2.5 text-orange-500" />{calDisplay}</> : ''}{calDisplay && proDisplay ? ' · ' : ''}{proDisplay ? `🍗${proDisplay}` : ''})</span> : ''}
                                  {otherDaysLabel && <span className="ml-1 text-[9px] text-amber-600 dark:text-amber-400 font-bold">📅 {otherDaysLabel}</span>}
                                </button>
                              );
                            })}
                            <div className="border-t border-border/40 my-1" />
                          </>
                        )}
                        <p className="text-[9px] text-muted-foreground/60 px-2 font-semibold uppercase tracking-wide">Tous</p>
                        {petitDejMeals.map(m => {
                          const calDisplay = getMealCal(m);
                          const proDisplay = getMealPro(m);
                          const mealSelId = `meal:${m.id}`;
                          const isSelected = (iso && breakfastSelections[iso] === mealSelId) || breakfastSelections[key] === mealSelId;
                          const otherDays = weekDates.filter(wd => wd.iso !== iso && (breakfastSelections[wd.iso] === mealSelId || breakfastSelections[wd.key] === mealSelId));
                          const otherDaysLabel = otherDays.length > 0 ? otherDays.map(d => d.display.slice(0, 3)).join(', ') : null;
                          return (
                            <button key={m.id} onClick={() => {
                              if (isSelected) setBreakfastForDay(iso, null);
                              else setBreakfastForDay(iso, mealSelId);
                            }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : otherDaysLabel ? 'bg-amber-100/40 text-amber-900 dark:text-amber-100' : ''}`}>
                              {m.name} {(calDisplay || proDisplay) ? <span className="inline-flex items-center gap-0.5 ml-1 text-muted-foreground">({calDisplay ? <><Flame className="w-2.5 h-2.5 text-orange-500" />{calDisplay}</> : ''}{calDisplay && proDisplay ? ' · ' : ''}{proDisplay ? `🍗${proDisplay}` : ''})</span> : ''}
                              {otherDaysLabel && <span className="ml-1 text-[9px] text-amber-600 dark:text-amber-400 font-bold">📅 {otherDaysLabel}</span>}
                            </button>
                          );
                        })}
                        {petitDejMeals.length === 0 && possiblePetitDej.length === 0 && (
                          <p className="text-[10px] text-muted-foreground italic px-2 py-1">Aucun petit déj</p>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                  {/* Saisie manuelle de calories quand aucun petit déj n'est sélectionné */}
                  {!getBreakfastForDay(key, iso) && matinMeals.length === 0 && (
                    <>
                      <PlanningInput
                        storageKey={`breakfast-cal-${iso}`}
                        currentValue={(iso && breakfastManualCalories[iso]) || breakfastManualCalories[key] || 0}
                        onSave={(val) => {
                          const updated = { ...breakfastManualCalories };
                          if (val > 0) updated[iso] = val;
                          else { delete updated[iso]; delete updated[key]; }
                          setPreference.mutate({ key: 'planning_breakfast_manual_calories', value: updated });
                          if (weekOffset === 0) {
                            const curProt = (iso && breakfastManualProteins[iso]) || breakfastManualProteins[key] || 0;
                            const nxtC = { ...nextBreakfastManualCalories };
                            const nxtP = { ...nextBreakfastManualProteins };
                            if (val > 0) { nxtC[iso] = val; nxtC[key] = val; }
                            else { delete nxtC[iso]; delete nxtC[key]; }
                            if (curProt > 0) { nxtP[iso] = curProt; nxtP[key] = curProt; }
                            else { delete nxtP[iso]; delete nxtP[key]; }
                            setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: nxtC });
                            setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: nxtP });
                          }
                        }}
                        placeholder="kcal"
                        className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40"
                      />
                      <PlanningInput
                        storageKey={`breakfast-prot-${iso}`}
                        currentValue={(iso && breakfastManualProteins[iso]) || breakfastManualProteins[key] || 0}
                        onSave={(val) => {
                          const updated = { ...breakfastManualProteins };
                          if (val > 0) updated[iso] = val;
                          else { delete updated[iso]; delete updated[key]; }
                          setPreference.mutate({ key: 'planning_breakfast_manual_proteins', value: updated });
                          if (weekOffset === 0) {
                            const curCal = (iso && breakfastManualCalories[iso]) || breakfastManualCalories[key] || 0;
                            const nxtC = { ...nextBreakfastManualCalories };
                            const nxtP = { ...nextBreakfastManualProteins };
                            if (curCal > 0) { nxtC[iso] = curCal; nxtC[key] = curCal; }
                            else { delete nxtC[iso]; delete nxtC[key]; }
                            if (val > 0) { nxtP[iso] = val; nxtP[key] = val; }
                            else { delete nxtP[iso]; delete nxtP[key]; }
                            setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: nxtC });
                            setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: nxtP });
                          }
                        }}
                        placeholder="prot"
                        className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40"
                      />
                    </>
                  )}
                  {/* Interrupteur d'auto-consommation du petit déj */}
                  {getBreakfastForDay(key, iso) && (
                    <button
                      onClick={() => {
                        const updated = { ...autoConsumeBreakfast };
                        if (iso && updated[iso]) delete updated[iso];
                        else if (updated[key]) delete updated[key];
                        else if (iso) updated[iso] = true;
                        else updated[key] = true;
                        setPreference.mutate({ key: 'planning_auto_consume_breakfast', value: updated });
                      }}
                      className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${(iso && autoConsumeBreakfast[iso]) || autoConsumeBreakfast[key]
                        ? 'bg-green-500/20 text-green-400 border border-green-400/50'
                        : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                        }`}
                      title={(iso && autoConsumeBreakfast[iso]) || autoConsumeBreakfast[key] ? 'Auto-consommation activée — sera déduit à 23h59 ou au prochain lancement' : 'Activer la décompte automatique du petit déj'}
                    >🔄</button>
                  )}
                  {!(matinMeals.length > 0 || (iso && breakfastSelections[iso]?.startsWith('pm:')) || breakfastSelections[key]?.startsWith('pm:')) && (
                    <button
                      onClick={() => {
                        const snapKey = `breakfast-${iso}`;
                        const cal = (iso && breakfastManualCalories[iso]) || breakfastManualCalories[key] || 0;
                        const prot = (iso && breakfastManualProteins[iso]) || breakfastManualProteins[key] || 0;
                        const breakfast = getBreakfastForDay(key, iso);
                        const mealId = (iso && breakfastSelections[iso]) || breakfastSelections[key] || undefined;
                        const updated = { ...savedSnapshots, [snapKey]: { cal, prot, name: breakfast?.name, mealId } };
                        setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                        // Synchronisation unidirectionnelle vers la semaine prochaine (Actuelle -> Suivante)
                        if (weekOffset === 0) {
                          if (mealId) {
                            const nxtBf = { ...nextBreakfastSelections };
                            nxtBf[key] = mealId;
                            setPreference.mutate({ key: 'next_week_breakfast', value: nxtBf });
                          }
                          if (cal > 0) {
                            const nxtCal = { ...nextBreakfastManualCalories };
                            nxtCal[key] = cal;
                            setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: nxtCal });
                          }
                          if (prot > 0) {
                            const nxtPro = { ...nextBreakfastManualProteins };
                            nxtPro[key] = prot;
                            setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: nxtPro });
                          }
                        }

                        setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                        setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                      }}
                      onDoubleClick={() => {
                        const snapKey = `breakfast-${iso}`;
                        const updated = { ...savedSnapshots };
                        delete updated[snapKey];
                        const oldSnapKey = `breakfast-${key}`;
                        delete updated[oldSnapKey];
                        setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                        // Nettoyer la sync de la semaine prochaine si oubliée
                        if (weekOffset === 0) {
                          const nxtBf = { ...nextBreakfastSelections }; delete nxtBf[key]; delete nxtBf[iso];
                          setPreference.mutate({ key: 'next_week_breakfast', value: nxtBf });
                          const nxtCal = { ...nextBreakfastManualCalories }; delete nxtCal[key]; delete nxtCal[iso];
                          setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: nxtCal });
                          const nxtPro = { ...nextBreakfastManualProteins }; delete nxtPro[key]; delete nxtPro[iso];
                          setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: nxtPro });
                        }
                      }}
                      className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`breakfast-${iso}`]
                        ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                        : savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]
                          ? 'bg-primary/20 text-primary border border-primary/40'
                          : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                        }`}
                      title={(() => {
                        const snap = (savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]) as any;
                        if (!snap) return 'Sauvegarder les valeurs pour le reset (Double-clic pour oublier)';
                        if (snap.name) return `Sauvegardé: ${snap.name} (Double-clic pour oublier)`;
                        return `Sauvegardé: ${snap.cal || 0} kcal / ${snap.prot || 0} prot (Double-clic pour oublier)`;
                      })()}
                    >💾</button>
                  )}
                {(breakfastTotalCals > 0 || breakfastTotalPro > 0) && (
                  <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full ml-2 border border-border/40 shadow-sm">
                    {breakfastTotalCals > 0 && (
                      <span className="flex items-center gap-1">
                        <Flame className="w-2.5 h-2.5 text-orange-500/60" />
                        {Math.round(breakfastTotalCals)}
                      </span>
                    )}
                    {breakfastTotalCals > 0 && breakfastTotalPro > 0 && <span className="opacity-30">•</span>}
                    {breakfastTotalPro > 0 && (
                      <span className="flex items-center gap-0.5">
                        <span className="text-[10px] opacity-60">🍗</span>
                        {Math.round(breakfastTotalPro)}
                      </span>
                    )}
                  </div>
                )}
                </div>
                {breakfastAssignedSlotIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {breakfastAssignedSlotIds.map((extraId) => {
                      const custom = parseCustomExtraId(extraId);
                      const fi = custom ? null : foodItems.find(f => f.id === extraId);
                      if (!fi && !custom) return null;
                      return (
                        <span
                          key={extraId}
                          draggable
                          onDragStart={(e) => {
                            setDraggedSelectedExtraId(extraId);
                            setDraggedSelectedExtraOrigin({ iso, key });
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', extraId);
                          }}
                          onDragEnd={() => {
                            setDraggedSelectedExtraId(null);
                            setDraggedSelectedExtraOrigin(null);
                          }}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-orange-500/15 text-orange-600 border border-orange-500/20 cursor-grab active:cursor-grabbing"
                          title="Extra assigné au petit déj — glisse pour déplacer"
                        >
                          {formatPlacedExtraLabel(custom?.name || fi?.name || "", fi?.grams)}
                          <button
                            onClick={() => deselectExtraForDay(extraId, iso, key)}
                            className="opacity-60 hover:opacity-100 font-bold"
                            title="Retirer des extras du jour"
                          >×</button>
                        </span>
                      );
                    })}
                  </div>
                )}
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
                  <button
                    onClick={() => { setEditingGoal(true); setGoalInput(String(DAILY_GOAL)); }}
                    className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 whitespace-nowrap hover:bg-muted/80 transition-colors cursor-pointer"
                    title="Cliquer pour modifier l'objectif"
                  >
                    <Flame className="h-2.5 w-2.5 text-orange-500" />
                    {Math.round(dayCalories)} <span className="text-muted-foreground/50 font-normal">/ {DAILY_GOAL}</span>
                  </button>
                  {editingGoal && (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        type="number"
                        inputMode="numeric"
                        value={goalInput}
                        onChange={(e) => setGoalInput(e.target.value)}
                        onBlur={() => {
                          const val = parseInt(goalInput);
                          if (val && val > 0) {
                            setPreference.mutate({ key: 'planning_daily_goal', value: val });
                            setPreference.mutate({ key: 'next_week_daily_goal', value: val });
                          }
                          setEditingGoal(false);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingGoal(false); }}
                        className="w-16 h-5 text-[10px] bg-muted border border-border rounded px-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <span className="text-[9px] text-muted-foreground">kcal/j</span>
                    </div>
                  )}
                  {!editingGoal && dayCalories > 0 && (
                    <span className={`text-[10px] font-bold whitespace-nowrap ${DAILY_GOAL - dayCalories > 0 ? 'text-muted-foreground/60' : 'text-orange-500'}`}>
                      {DAILY_GOAL - dayCalories > 0 ? `reste ${Math.round(DAILY_GOAL - dayCalories)}` : `+${Math.round(dayCalories - DAILY_GOAL)}`}
                    </span>
                  )}
                  {getDayProtein(key, iso) > 0 && (
                    <button
                      onClick={() => { setEditingProteinGoal(true); setProteinGoalInput(String(DAILY_PROTEIN_GOAL_PREF)); }}
                      className="flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-500/10 rounded-full px-2 py-0.5 whitespace-nowrap hover:bg-blue-500/20 transition-colors cursor-pointer"
                      title="Cliquer pour modifier l'objectif protéines"
                    >
                      🍗 {Math.round(getDayProtein(key, iso))} <span className="text-blue-400/50 font-normal">/ {DAILY_PROTEIN_GOAL_PREF}</span>
                    </button>
                  )}
                  {!editingProteinGoal && getDayProtein(key, iso) > 0 && (
                    <span className={`text-[10px] font-bold whitespace-nowrap ${DAILY_PROTEIN_GOAL_PREF - getDayProtein(key, iso) > 0 ? 'text-blue-400/60' : 'text-blue-500'}`}>
                      {DAILY_PROTEIN_GOAL_PREF - getDayProtein(key, iso) > 0 ? `reste ${Math.round(DAILY_PROTEIN_GOAL_PREF - getDayProtein(key, iso))}` : `+${Math.round(getDayProtein(key, iso) - DAILY_PROTEIN_GOAL_PREF)}`}
                    </span>
                  )}
                  {editingProteinGoal && (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        type="number"
                        value={proteinGoalInput}
                        onChange={(e) => setProteinGoalInput(e.target.value)}
                        onBlur={() => {
                          const val = parseInt(proteinGoalInput);
                          if (val && val > 0) {
                            setPreference.mutate({ key: 'planning_protein_goal', value: val });
                            setPreference.mutate({ key: 'next_week_protein_goal', value: val });
                          }
                          setEditingProteinGoal(false);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingProteinGoal(false); }}
                        className="w-16 h-5 text-[10px] bg-muted border border-border rounded px-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <span className="text-[9px] text-muted-foreground">🍗/j</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-1 sm:gap-3">
                {TIMES.map((time) => {
                  const slotKey = `${iso}-${time}`;
                  const slotMeals = getMealsForSlot(key, time, iso);
                  const slotAssignedIds =
                    extraSlotAssignments[`${iso}-${time}`] ?? extraSlotAssignments[`${key}-${time}`] ?? [];
                  const isOver = dragOverSlot === slotKey || touchHighlight === slotKey || dragOverSlot === `${key}-${time}` || touchHighlight === `${key}-${time}`;
                  const slotCalsMeals = slotMeals.reduce((s, p) => s + getCardDisplayCalories(p, calOverrides[p.id], isAvailableCb), 0);
                  const slotProMeals = slotMeals.reduce((s, p) => s + getCardDisplayProtein(p, proOverrides[p.id], isAvailableCb), 0);
                  const slotAssigned = sumExtrasFromSelectionIds(slotAssignedIds, foodItems);
                  const slotCals = slotCalsMeals + slotAssigned.cal;
                  const slotPro = slotProMeals + slotAssigned.pro;
                  return (
                    <div
                      key={time}
                      data-slot
                      data-day={iso}
                      data-time={time}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverSlot(slotKey);
                      }}
                      onDragLeave={() => setDragOverSlot(null)}
                      onDrop={(e) => handleDrop(e, iso, time)}
                      className={`min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed p-1 sm:p-1.5 transition-colors ${isOver ? "border-primary/60 bg-primary/7 ring-1 ring-primary/20" : "border-border/55 bg-background/10 hover:border-primary/40"}`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1">
                          <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                            {TIME_LABELS[time]}
                          </span>
                          <button
                            onClick={() => {
                              const updated = { ...drinkChecks };
                              if (updated[`${iso}-${time}`]) delete updated[`${iso}-${time}`];
                              else if (updated[`${key}-${time}`]) delete updated[`${key}-${time}`];
                              else updated[`${iso}-${time}`] = true;
                              setPreference.mutate({ key: 'planning_drink_checks', value: updated });
                            }}
                            className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${drinkChecks[`${iso}-${time}`] || drinkChecks[`${key}-${time}`]
                              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold'
                              : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60'
                              }`}
                            title="+ Boisson sucrée (+150 cal)"
                          >
                            🥤 {drinkChecks[`${iso}-${time}`] || drinkChecks[`${key}-${time}`] ? '+150' : ''}
                          </button>
                        </div>
                        {(slotCals > 0 || slotPro > 0) && (
                          <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm">
                            {slotCals > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Flame className="w-2 h-2 text-orange-500/60" />
                                {Math.round(slotCals)}
                              </span>
                            )}
                            {slotCals > 0 && slotPro > 0 && <span className="opacity-30">•</span>}
                            {slotPro > 0 && (
                              <span className="flex items-center gap-0.5">
                                <span className="text-[9px] opacity-60">🍗</span>
                                {Math.round(slotPro)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="mt-0.5 space-y-1">
                        {slotMeals.length === 0 ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <PlanningInput
                              storageKey={`manual-${iso}-${time}`}
                              currentValue={manualCalories[`${iso}-${time}`] || manualCalories[`${key}-${time}`] || 0}
                              onSave={(val) => {
                                const updated = { ...manualCalories };
                                if (val > 0) updated[`${iso}-${time}`] = val;
                                else { delete updated[`${iso}-${time}`]; delete updated[`${key}-${time}`]; }
                                setPreference.mutate({ key: 'planning_manual_calories', value: updated });
                                if (weekOffset === 0) {
                                  const kKeySlot = `${key}-${time}`;
                                  const kIsoSlot = `${iso}-${time}`;
                                  const curProt = manualProteins[`${iso}-${time}`] || manualProteins[`${key}-${time}`] || 0;
                                  const nxtCal = { ...nextManualCalories };
                                  const nxtPro = { ...nextManualProteins };
                                  if (val > 0) { nxtCal[kKeySlot] = val; nxtCal[kIsoSlot] = val; }
                                  else { delete nxtCal[kKeySlot]; delete nxtCal[kIsoSlot]; }
                                  if (curProt > 0) { nxtPro[kKeySlot] = curProt; nxtPro[kIsoSlot] = curProt; }
                                  else { delete nxtPro[kKeySlot]; delete nxtPro[kIsoSlot]; }
                                  setPreference.mutate({ key: 'next_week_manual_calories', value: nxtCal });
                                  setPreference.mutate({ key: 'next_week_manual_proteins', value: nxtPro });
                                }
                              }}
                              placeholder="kcal"
                              className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 text-center"
                            />
                            <PlanningInput
                              storageKey={`manual-prot-${iso}-${time}`}
                              currentValue={manualProteins[`${iso}-${time}`] || manualProteins[`${key}-${time}`] || 0}
                              onSave={(val) => {
                                const updated = { ...manualProteins };
                                if (val > 0) updated[`${iso}-${time}`] = val;
                                else { delete updated[`${iso}-${time}`]; delete updated[`${key}-${time}`]; }
                                setPreference.mutate({ key: 'planning_manual_proteins', value: updated });
                                if (weekOffset === 0) {
                                  const kKeySlot = `${key}-${time}`;
                                  const kIsoSlot = `${iso}-${time}`;
                                  const curCal = manualCalories[`${iso}-${time}`] || manualCalories[`${key}-${time}`] || 0;
                                  const nxtCal = { ...nextManualCalories };
                                  const nxtPro = { ...nextManualProteins };
                                  if (curCal > 0) { nxtCal[kKeySlot] = curCal; nxtCal[kIsoSlot] = curCal; }
                                  else { delete nxtCal[kKeySlot]; delete nxtCal[kIsoSlot]; }
                                  if (val > 0) { nxtPro[kKeySlot] = val; nxtPro[kIsoSlot] = val; }
                                  else { delete nxtPro[kKeySlot]; delete nxtPro[kIsoSlot]; }
                                  setPreference.mutate({ key: 'next_week_manual_calories', value: nxtCal });
                                  setPreference.mutate({ key: 'next_week_manual_proteins', value: nxtPro });
                                }
                              }}
                              placeholder="prot"
                              className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center"
                            />
                            <div className="w-14 flex justify-center">
                              <button
                                onClick={() => {
                                  const snapKey = `manual-${iso}-${time}`;
                                  const cal = manualCalories[`${iso}-${time}`] || manualCalories[`${key}-${time}`] || 0;
                                  const prot = manualProteins[`${iso}-${time}`] || manualProteins[`${key}-${time}`] || 0;
                                  const updated = { ...savedSnapshots, [snapKey]: { cal, prot } };
                                  setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                                  // Synchronisation unidirectionnelle vers la semaine prochaine (Actuelle -> Suivante)
                                  if (weekOffset === 0) {
                                    const kKeySlot = `${key}-${time}`;
                                    if (cal > 0) {
                                      const nxtCal = { ...nextManualCalories };
                                      nxtCal[kKeySlot] = cal;
                                      setPreference.mutate({ key: 'next_week_manual_calories', value: nxtCal });
                                    }
                                    if (prot > 0) {
                                      const nxtPro = { ...nextManualProteins };
                                      nxtPro[kKeySlot] = prot;
                                      setPreference.mutate({ key: 'next_week_manual_proteins', value: nxtPro });
                                    }
                                    if (drinkChecks[`${iso}-${time}`] || drinkChecks[`${key}-${time}`]) {
                                      const nxtDrk = { ...nextDrinkChecks };
                                      nxtDrk[kKeySlot] = true;
                                      setPreference.mutate({ key: 'next_week_drink_checks', value: nxtDrk });
                                    }
                                  }

                                  setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                                  setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                                }}
                                onDoubleClick={() => {
                                  const snapKey = `manual-${iso}-${time}`;
                                  const updated = { ...savedSnapshots };
                                  delete updated[snapKey];
                                  delete updated[`manual-${key}-${time}`];
                                  setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                                  // Nettoyer la sync de la semaine prochaine si oubliée
                                  if (weekOffset === 0) {
                                    const kKeySlot = `${key}-${time}`;
                                    const kIsoSlot = `${iso}-${time}`;
                                    const nxtCal = { ...nextManualCalories }; delete nxtCal[kKeySlot]; delete nxtCal[kIsoSlot];
                                    setPreference.mutate({ key: 'next_week_manual_calories', value: nxtCal });
                                    const nxtPro = { ...nextManualProteins }; delete nxtPro[kKeySlot]; delete nxtPro[kIsoSlot];
                                    setPreference.mutate({ key: 'next_week_manual_proteins', value: nxtPro });
                                    const nxtDrk = { ...nextDrinkChecks }; delete nxtDrk[kKeySlot]; delete nxtDrk[kIsoSlot];
                                    setPreference.mutate({ key: 'next_week_drink_checks', value: nxtDrk });
                                  }
                                }}
                                className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`manual-${iso}-${time}`]
                                  ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                                  : savedSnapshots[`manual-${iso}-${time}`] || savedSnapshots[`manual-${key}-${time}`]
                                    ? 'bg-primary/20 text-primary border border-primary/40'
                                    : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                                  }`}
                                title={(savedSnapshots[`manual-${iso}-${time}`] || savedSnapshots[`manual-${key}-${time}`]) ? `Sauvegardé: ${((savedSnapshots[`manual-${iso}-${time}`] || savedSnapshots[`manual-${key}-${time}`]) as any).cal || 0} kcal / ${((savedSnapshots[`manual-${iso}-${time}`] || savedSnapshots[`manual-${key}-${time}`]) as any).prot || 0} prot (Double-clic pour oublier)` : 'Sauvegarder les valeurs pour le reset (Double-clic pour oublier)'}
                              >💾</button>
                            </div>
                          </div>
                        ) : (
                          slotMeals.map((pm) => renderMiniCard(pm, false, time === 'midi' || time === 'soir'))
                        )}
                        {slotAssignedIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {slotAssignedIds.map((extraId) => {
                              const custom = parseCustomExtraId(extraId);
                              const fi = custom ? null : foodItems.find(f => f.id === extraId);
                              if (!fi && !custom) return null;
                              return (
                                <span
                                  key={extraId}
                                  draggable
                                  onDragStart={(e) => {
                                    setDraggedSelectedExtraId(extraId);
                                    setDraggedSelectedExtraOrigin({ iso, key });
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', extraId);
                                  }}
                                  onDragEnd={() => {
                                    setDraggedSelectedExtraId(null);
                                    setDraggedSelectedExtraOrigin(null);
                                  }}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-600 border border-orange-500/25 cursor-grab active:cursor-grabbing"
                                  title={`Extra assigné à ${TIME_LABELS[time] || time} — glisse pour déplacer`}
                                >
                                  {formatPlacedExtraLabel(custom?.name || fi?.name || "", fi?.grams)}
                                  <button
                                    onClick={() => deselectExtraForDay(extraId, iso, key)}
                                    className="opacity-60 hover:opacity-100 font-bold"
                                    title="Retirer des extras du jour"
                                  >×</button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Colonne Extra */}
                {(() => {
                  const extraDropKey = `extra-${iso}`;
                  const isExtraDragOver = dragOverSlot === extraDropKey;
                  return (
                <div
                  className={`min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed p-1 sm:p-1.5 w-12 sm:w-20 flex flex-col items-center transition-colors ${isExtraDragOver ? "border-orange-400/65 bg-orange-500/8 ring-1 ring-orange-400/25" : "border-orange-300/45 bg-orange-500/3"}`}
                  onDragOver={(e) => {
                    const canAccept = !!(draggedSelectedExtraId || e.dataTransfer.types.includes('text/plain'));
                    if (!canAccept) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverSlot(extraDropKey);
                  }}
                  onDragLeave={() => setDragOverSlot((cur) => (cur === extraDropKey ? null : cur))}
                  onDrop={(e) => {
                    const extraId = draggedSelectedExtraId || e.dataTransfer.getData('text/plain');
                    if (!extraId) return;
                    e.preventDefault();
                    unassignExtraFromAllDaySlots(extraId, iso, key);
                    setDraggedSelectedExtraId(null);
                    setDraggedSelectedExtraOrigin(null);
                    setDragOverSlot(null);
                  }}
                  title="Déposer ici pour remettre l'extra dans la catégorie Extras"
                >
                  <span className="text-[8px] sm:text-[9px] font-semibold text-orange-400/80 uppercase tracking-wide">Extra</span>
                  <div className="flex flex-col items-center gap-0.5 mt-1 w-full">
                    <PlanningInput
                      storageKey={`extra-${iso}`}
                      currentValue={(() => {
                        const manual = extraCalories[iso] || extraCalories[key] || 0;
                        const allExtraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                        const ids = allExtraSels[iso] || allExtraSels[key] || [];
                        const assignedSet = new Set(getAssignedExtraIdsForDay(iso, key));
                        const selected = ids.reduce((sum, id) => {
                          if (assignedSet.has(id)) return sum;
                          const custom = parseCustomExtraId(id);
                          if (custom) return sum + custom.cal;
                          return sum + parseCalories(foodItems.find(fi => fi.id === id)?.calories);
                        }, 0);
                        return manual + selected;
                      })()}
                      onSave={(val) => {
                        const allExtraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                        const ids = allExtraSels[iso] || allExtraSels[key] || [];
                        const selected = ids.reduce((sum, id) => {
                          const custom = parseCustomExtraId(id);
                          if (custom) return sum + custom.cal;
                          return sum + parseCalories(foodItems.find(fi => fi.id === id)?.calories);
                        }, 0);
                        const manual = Math.max(0, val - selected);
                        const updated = { ...extraCalories };
                        if (manual > 0) updated[iso] = manual;
                        else { delete updated[iso]; delete updated[key]; }
                        setPreference.mutate({ key: 'planning_extra_calories', value: updated });
                        if (weekOffset === 0) {
                          const nxtEC = { ...nextExtraCalories };
                          if (manual > 0) { nxtEC[iso] = manual; nxtEC[key] = manual; }
                          else { delete nxtEC[iso]; delete nxtEC[key]; }
                          setPreference.mutate({ key: 'next_week_extra_calories', value: nxtEC });
                          const protManual = extraProteins[iso] || extraProteins[key] || 0;
                          const nxtEP = { ...nextExtraProteins };
                          if (protManual > 0) { nxtEP[iso] = protManual; nxtEP[key] = protManual; }
                          else { delete nxtEP[iso]; delete nxtEP[key]; }
                          setPreference.mutate({ key: 'next_week_extra_proteins', value: nxtEP });
                        }
                      }}
                      placeholder="kcal"
                      className="w-full h-5 text-[11px] bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-400 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40 text-center"
                    />
                    <PlanningInput
                      storageKey={`extra-prot-${iso}`}
                      currentValue={(() => {
                        const manual = extraProteins[iso] || extraProteins[key] || 0;
                        const allExtraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                        const ids = allExtraSels[iso] || allExtraSels[key] || [];
                        const assignedSet = new Set(getAssignedExtraIdsForDay(iso, key));
                        const selected = ids.reduce((sum, id) => {
                          if (assignedSet.has(id)) return sum;
                          const custom = parseCustomExtraId(id);
                          if (custom) return sum + custom.prot;
                          return sum + parseProtein(foodItems.find(fi => fi.id === id)?.protein);
                        }, 0);
                        return manual + selected;
                      })()}
                      onSave={(val) => {
                        const allExtraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                        const ids = allExtraSels[iso] || allExtraSels[key] || [];
                        const selected = ids.reduce((sum, id) => {
                          const custom = parseCustomExtraId(id);
                          if (custom) return sum + custom.prot;
                          return sum + parseProtein(foodItems.find(fi => fi.id === id)?.protein);
                        }, 0);
                        const manual = Math.max(0, val - selected);
                        const updated = { ...extraProteins };
                        if (manual > 0) updated[iso] = manual;
                        else { delete updated[iso]; delete updated[key]; }
                        setPreference.mutate({ key: 'planning_extra_proteins', value: updated });
                        if (weekOffset === 0) {
                          const nxtEP = { ...nextExtraProteins };
                          if (manual > 0) { nxtEP[iso] = manual; nxtEP[key] = manual; }
                          else { delete nxtEP[iso]; delete nxtEP[key]; }
                          setPreference.mutate({ key: 'next_week_extra_proteins', value: nxtEP });
                          const calManual = extraCalories[iso] || extraCalories[key] || 0;
                          const nxtEC = { ...nextExtraCalories };
                          if (calManual > 0) { nxtEC[iso] = calManual; nxtEC[key] = calManual; }
                          else { delete nxtEC[iso]; delete nxtEC[key]; }
                          setPreference.mutate({ key: 'next_week_extra_calories', value: nxtEC });
                        }
                      }}
                      placeholder="prot"
                      className="w-full h-5 text-[11px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center"
                    />
                    <div className="flex items-center gap-1 mt-1">
                      <Popover open={openExtrasDay === (iso || key)} onOpenChange={(open) => {
                        setOpenExtrasDay(open ? (iso || key) : null);
                        if (open) { setCustomExtraName(''); setCustomExtraCal(''); setCustomExtraProt(''); }
                      }}>
                        <PopoverTrigger asChild>
                          <button
                            className={`h-5 w-5 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 ${((getPreference<Record<string, string[]>>('planning_extra_selections', {})[iso || ""]?.length || 0) > 0 || (getPreference<Record<string, string[]>>('planning_extra_selections', {})[key]?.length || 0) > 0) ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20'}`}
                            title="Ajouter un Extra"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-3 bg-card/95 backdrop-blur-md border-orange-200/20 shadow-2xl rounded-2xl max-h-[56vh]" align="center">
                          {/* Formulaire d'ajout en une ligne — STYLE MODERNISÉ */}
                          <div className="flex items-center gap-1.5 mb-3 pb-3 border-b border-white/5">
                            <input
                              type="text"
                              value={customExtraName}
                              onChange={(e) => setCustomExtraName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && customExtraName.trim() && customExtraCal.trim()) {
                                  const name = customExtraName.trim();
                                  const cal = customExtraCal.trim();
                                  const prot = customExtraProt.trim() || '0';
                                  const customId = `custom::${name}::${cal}::${prot}`;
                                  const extraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                                  const updated = { ...extraSels };
                                  const current = updated[iso] || updated[key] || [];
                                  if (iso) updated[iso] = [...current, customId]; else updated[key] = [...current, customId];
                                  setPreference.mutate({ key: 'planning_extra_selections', value: updated });
                                  setCustomExtraName(''); setCustomExtraCal(''); setCustomExtraProt('');
                                }
                              }}
                              placeholder="Nom"
                              className="flex-1 min-w-0 h-8 text-[11px] bg-muted/40 border border-white/5 rounded-full px-3 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all shadow-sm"
                            />
                            <div className="relative group/cal shrink-0">
                              <input
                                type="number"
                                inputMode="decimal"
                                value={customExtraCal}
                                onChange={(e) => setCustomExtraCal(e.target.value)}
                                placeholder="kcal"
                                className="w-14 h-8 text-[11px] bg-muted/40 border border-white/5 rounded-full px-1 text-orange-500 placeholder:text-orange-300/30 focus:outline-none focus:ring-2 focus:ring-orange-500/20 text-center transition-all shadow-sm"
                              />
                            </div>
                            <div className="relative group/prot shrink-0">
                              <input
                                type="number"
                                inputMode="decimal"
                                value={customExtraProt}
                                onChange={(e) => setCustomExtraProt(e.target.value)}
                                placeholder="prot"
                                className="w-14 h-8 text-[11px] bg-muted/40 border border-white/5 rounded-full px-1 text-blue-400 placeholder:text-blue-400/20 focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-center transition-all shadow-sm"
                              />
                            </div>
                            <button
                              onClick={() => {
                                const name = customExtraName.trim();
                                const cal = customExtraCal.trim();
                                if (!name || !cal) return;
                                const prot = customExtraProt.trim() || '0';
                                const customId = `custom::${name}::${cal}::${prot}`;
                                const extraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                                const updated = { ...extraSels };
                                const current = updated[iso] || updated[key] || [];
                                if (iso) updated[iso] = [...current, customId]; else updated[key] = [...current, customId];
                                setPreference.mutate({ key: 'planning_extra_selections', value: updated });
                                setCustomExtraName(''); setCustomExtraCal(''); setCustomExtraProt('');
                              }}
                              disabled={!customExtraName.trim() || !customExtraCal.trim()}
                              className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 hover:from-orange-500 hover:to-orange-700 disabled:opacity-30 text-white shadow-lg shadow-orange-500/20 transition-all hover:scale-110 active:scale-95"
                              title="Valider"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1 custom-scrollbar">
                            {/* Aliments extras normaux — au-dessus du trait : rentrent dans les kcal restantes du jour */}
                            {(() => {
                              const sectionItems = foodItems.filter(fi => fi.storage_type === 'extras');
                              const sortedExtras = getSortedFoodItems(
                                sectionItems,
                                foodSortModes['extras'] || "manual",
                                sortDirections['food-extras'] !== false
                              );
                              if (sortedExtras.length === 0) return (
                                <div className="text-center py-3 bg-muted/20 rounded-xl">
                                  <p className="text-[10px] text-muted-foreground italic">Aucun aliment "Extra"</p>
                                  <p className="text-[9px] text-muted-foreground/60 mt-1">Ajoutez-les dans l'onglet Aliments</p>
                                </div>
                              );
                              const extraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                              const currentIds = extraSels[iso] || extraSels[key] || [];
                              const assignedIds = new Set(getAssignedExtraIdsForDay(iso, key));
                              const daySlotKey = iso || key;

                              // Réordonne les extras sélectionnés (standards + custom) en conservant les quantités.
                              const reorderSelectedExtras = (sourceId: string, targetId: string) => {
                                if (!sourceId || !targetId || sourceId === targetId) return;
                                const idsForDay = [...currentIds];
                                const order = Array.from(new Set(idsForDay.filter((id) => !assignedIds.has(id))));
                                const from = order.indexOf(sourceId);
                                const to = order.indexOf(targetId);
                                if (from < 0 || to < 0) return;
                                const nextOrder = [...order];
                                const [moved] = nextOrder.splice(from, 1);
                                nextOrder.splice(to, 0, moved);

                                const counts = new Map<string, number>();
                                for (const id of idsForDay) counts.set(id, (counts.get(id) ?? 0) + 1);
                                const hiddenAssignedIds = idsForDay.filter((id) => assignedIds.has(id));
                                const rebuilt: string[] = [];
                                for (const id of nextOrder) {
                                  const count = counts.get(id) ?? 0;
                                  for (let i = 0; i < count; i++) rebuilt.push(id);
                                }
                                rebuilt.push(...hiddenAssignedIds);

                                const updated = { ...extraSels };
                                if (iso) updated[iso] = rebuilt;
                                else updated[key] = rebuilt;
                                setPreference.mutate({ key: "planning_extra_selections", value: updated });
                              };

                              // Bascule un extra sélectionné dans le compartiment du dessus (au-dessus du trait).
                              const moveSelectedExtraToTopSection = (id: string) => {
                                setSelectedExtrasTopByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: [...cur, id] };
                                });
                                setSelectedExtrasMiddleByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (!cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: cur.filter((x) => x !== id) };
                                });
                              };

                              // Place un extra dans le compartiment du milieu (entre les deux traits).
                              const moveSelectedExtraToMiddleSection = (id: string) => {
                                setSelectedExtrasMiddleByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: [...cur, id] };
                                });
                                setSelectedExtrasTopByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (!cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: cur.filter((x) => x !== id) };
                                });
                              };

                              // Retire un extra des compartiments supérieurs pour le remettre dessous.
                              const moveSelectedExtraToBottomSection = (id: string) => {
                                setSelectedExtrasTopByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (!cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: cur.filter((x) => x !== id) };
                                });
                                setSelectedExtrasMiddleByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (!cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: cur.filter((x) => x !== id) };
                                });
                              };

                              const extrasById = new Map(sortedExtras.map((fi) => [fi.id, fi]));
                              const selectedOrderedIds = Array.from(
                                new Set(currentIds.filter((id) => !assignedIds.has(id)))
                              );
                              const topIds = selectedExtrasTopByDay[daySlotKey] || [];
                              const middleIds = selectedExtrasMiddleByDay[daySlotKey] || [];
                              const selectedTopIds = selectedOrderedIds.filter((id) => topIds.includes(id));
                              const selectedMiddleIds = selectedOrderedIds.filter((id) => !topIds.includes(id) && middleIds.includes(id));
                              const selectedBottomIds = selectedOrderedIds.filter((id) => !topIds.includes(id) && !middleIds.includes(id));
                              const others = sortedExtras.filter(fi => !currentIds.includes(fi.id) && !assignedIds.has(fi.id));
                              const remainingCal = Math.max(0, DAILY_GOAL - getDayCalories(key, iso));
                              const calOf = (fi: FoodItem) => parseCalories(fi.calories);
                              const fitsBudget = others.filter(fi => calOf(fi) > 0 && calOf(fi) <= remainingCal);
                              const overBudget = others.filter(fi => calOf(fi) <= 0 || calOf(fi) > remainingCal);
                              // Rend un extra sélectionné (normal ou custom) avec drag & drop, compte et macros.
                              const renderSelectedRowById = (id: string, selectedSection: "top" | "middle" | "bottom") => {
                                const c = parseCustomExtraId(id);
                                const fi = c ? null : extrasById.get(id);
                                if (!c && !fi) return null;
                                const count = currentIds.filter((cid) => cid === id).length;
                                const label = c ? c.name : (fi?.name || id);
                                const prot = c ? c.prot : parseProtein(fi?.protein);
                                const cal = c ? c.cal : parseCalories(fi?.calories);
                                return (
                                  <div
                                    key={id}
                                    draggable
                                    onDragStart={(e) => {
                                      setDraggedSelectedExtraId(id);
                                      setDraggedSelectedExtraOrigin({ iso, key });
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData("text/plain", id);
                                    }}
                                    onDragOver={(e) => {
                                      if (!draggedSelectedExtraId || draggedSelectedExtraId === id) return;
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = "move";
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      const sourceId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
                                      reorderSelectedExtras(sourceId, id);
                                      if (selectedSection === "top") moveSelectedExtraToTopSection(sourceId);
                                      else if (selectedSection === "middle") moveSelectedExtraToMiddleSection(sourceId);
                                      else moveSelectedExtraToBottomSection(sourceId);
                                      setDraggedSelectedExtraId(null);
                                      setDraggedSelectedExtraOrigin(null);
                                      setSelectedExtrasDropZone(null);
                                    }}
                                    onDragEnd={() => {
                                      setDraggedSelectedExtraId(null);
                                      setDraggedSelectedExtraOrigin(null);
                                      setSelectedExtrasDropZone(null);
                                    }}
                                    className="w-full my-1 p-2.5 rounded-2xl border transition-all group flex items-center gap-3 bg-orange-500/10 border-orange-500/20 shadow-sm backdrop-blur-sm cursor-grab active:cursor-grabbing hover:bg-orange-500/20"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] font-black transition-colors truncate text-orange-600">{label}</p>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        onClick={() => deselectExtraForDay(id, iso, key)}
                                        className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-bold"
                                        title="Désélectionner cet extra"
                                      >−</button>
                                      <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{count}</span>
                                      <button
                                        onClick={() => {
                                          const updated = { ...extraSels };
                                          const current = updated[iso] || updated[key] || [];
                                          if (iso) updated[iso] = [...current, id]; else updated[key] = [...current, id];
                                          setPreference.mutate({ key: 'planning_extra_selections', value: updated });
                                        }}
                                        className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 text-xs font-bold"
                                        title="Ajouter un"
                                      >+</button>
                                      {prot > 0 && (
                                        <div className="flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-blue-500 border border-blue-500/20">
                                          🍗 {prot}
                                        </div>
                                      )}
                                      <div className="flex items-center gap-1 bg-orange-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-orange-500 border border-orange-500/20">
                                        <Flame className="w-2.5 h-2.5" />{cal}
                                      </div>
                                    </div>
                                  </div>
                                );
                              };
                              const renderRow = (fi: FoodItem, selectedSection: "top" | "bottom" | null = null) => {
                                const count = currentIds.filter(id => id === fi.id).length;
                                return (
                                  <div
                                    key={fi.id}
                                    draggable={selectedSection !== null}
                                    onDragStart={(e) => {
                                      if (!selectedSection) return;
                                      setDraggedSelectedExtraId(fi.id);
                                      setDraggedSelectedExtraOrigin({ iso, key });
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData("text/plain", fi.id);
                                    }}
                                    onDragOver={(e) => {
                                      if (!selectedSection || !draggedSelectedExtraId || draggedSelectedExtraId === fi.id) return;
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = "move";
                                    }}
                                    onDrop={(e) => {
                                      if (!selectedSection) return;
                                      e.preventDefault();
                                      const sourceId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
                                      reorderSelectedExtras(sourceId, fi.id);
                                      if (selectedSection === "top") moveSelectedExtraToTopSection(sourceId);
                                      else moveSelectedExtraToBottomSection(sourceId);
                                      setDraggedSelectedExtraId(null);
                                      setDraggedSelectedExtraOrigin(null);
                                    }}
                                    onDragEnd={() => {
                                      setDraggedSelectedExtraId(null);
                                      setDraggedSelectedExtraOrigin(null);
                                    }}
                                    className={`w-full my-0.5 p-2.5 rounded-2xl border transition-all group flex items-center gap-3 ${count > 0 ? 'bg-orange-500/10 border-orange-500/20 shadow-sm backdrop-blur-sm' : 'bg-muted/20 hover:bg-orange-500/5 border-transparent'} ${selectedSection ? 'cursor-grab active:cursor-grabbing' : ''}`}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-[11px] font-black transition-colors truncate ${count > 0 ? 'text-orange-600' : 'text-foreground group-hover:text-orange-600'}`}>{fi.name}</p>
                                      {(fi.grams || fi.quantity) && (
                                        <p className="text-[9px] text-muted-foreground/50 font-medium">{fi.grams ? `${fi.grams}` : ''}{fi.grams && fi.quantity ? ' · ' : ''}{fi.quantity ? `x${fi.quantity}` : ''}</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {count > 0 && (
                                        <>
                                          <button
                                            onClick={() => deselectExtraForDay(fi.id, iso, key)}
                                            className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-bold"
                                            title="Désélectionner cet extra"
                                          >−</button>
                                          <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{count}</span>
                                        </>
                                      )}
                                      <button
                                        onClick={() => {
                                          const updated = { ...extraSels };
                                          const current = updated[iso] || updated[key] || [];
                                          if (iso) updated[iso] = [...current, fi.id]; else updated[key] = [...current, fi.id];
                                          setPreference.mutate({ key: 'planning_extra_selections', value: updated });
                                        }}
                                        className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 text-xs font-bold"
                                        title="Ajouter un"
                                      >+</button>
                                      {fi.protein && (
                                        <div className="flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-blue-500 border border-blue-500/20">
                                          🍗 {fi.protein}
                                        </div>
                                      )}
                                      {fi.calories && (
                                        <div className="flex items-center gap-1 bg-orange-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-orange-500 border border-orange-500/20">
                                          <Flame className="w-2.5 h-2.5" />{fi.calories}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              };
                              return (
                                <>
                                  {selectedOrderedIds.length > 0 && (
                                    <>
                                      <p className="text-[9px] font-semibold text-orange-500 px-1 pb-1">Extras sélectionnés</p>
                                      {selectedTopIds.map((id) => renderSelectedRowById(id, "top"))}
                                      <div
                                        onDragOver={(e) => {
                                          if (!draggedSelectedExtraId) return;
                                          e.preventDefault();
                                          e.dataTransfer.dropEffect = "move";
                                          setSelectedExtrasDropZone(`${daySlotKey}:top`);
                                        }}
                                        onDragLeave={() => setSelectedExtrasDropZone((cur) => (cur === `${daySlotKey}:top` ? null : cur))}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const sourceId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
                                          if (sourceId) moveSelectedExtraToTopSection(sourceId);
                                          setDraggedSelectedExtraId(null);
                                          setDraggedSelectedExtraOrigin(null);
                                          setSelectedExtrasDropZone(null);
                                        }}
                                        className="relative my-0.5 h-1"
                                        title="Dépose ici pour placer l'extra au-dessus du trait"
                                      >
                                        <Separator className={`absolute top-1/2 -translate-y-1/2 ${selectedExtrasDropZone === `${daySlotKey}:top` ? 'opacity-90 bg-orange-400' : 'opacity-35'}`} />
                                      </div>
                                      <div
                                        onDragOver={(e) => {
                                          if (!draggedSelectedExtraId) return;
                                          e.preventDefault();
                                          e.dataTransfer.dropEffect = "move";
                                          setSelectedExtrasDropZone(`${daySlotKey}:middle`);
                                        }}
                                        onDragLeave={() => setSelectedExtrasDropZone((cur) => (cur === `${daySlotKey}:middle` ? null : cur))}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const sourceId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
                                          if (sourceId) moveSelectedExtraToMiddleSection(sourceId);
                                          setDraggedSelectedExtraId(null);
                                          setDraggedSelectedExtraOrigin(null);
                                          setSelectedExtrasDropZone(null);
                                        }}
                                        className={`rounded-sm transition-all ${draggedSelectedExtraId ? 'my-0.5 min-h-6' : 'my-0 min-h-0'} ${selectedExtrasDropZone === `${daySlotKey}:middle` ? 'bg-orange-500/10 ring-1 ring-orange-400/35' : ''}`}
                                        title="Dépose ici pour placer l'extra entre les deux traits"
                                      >
                                        {selectedMiddleIds.map((id) => renderSelectedRowById(id, "middle"))}
                                      </div>
                                      <Separator
                                        className={`${draggedSelectedExtraId && selectedExtrasDropZone === `${daySlotKey}:bottom` ? 'my-0.5 bg-orange-400 opacity-90' : draggedSelectedExtraId ? 'my-0.5' : 'my-px opacity-60'}`}
                                        onDragOver={(e) => {
                                          if (!draggedSelectedExtraId) return;
                                          e.preventDefault();
                                          e.dataTransfer.dropEffect = "move";
                                          setSelectedExtrasDropZone(`${daySlotKey}:bottom`);
                                        }}
                                        onDragLeave={() => setSelectedExtrasDropZone((cur) => (cur === `${daySlotKey}:bottom` ? null : cur))}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const sourceId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
                                          if (sourceId) moveSelectedExtraToBottomSection(sourceId);
                                          setDraggedSelectedExtraId(null);
                                          setDraggedSelectedExtraOrigin(null);
                                          setSelectedExtrasDropZone(null);
                                        }}
                                      />
                                      {selectedBottomIds.map((id) => renderSelectedRowById(id, "bottom"))}
                                    </>
                                  )}
                                  {fitsBudget.length > 0 && (
                                    <p className="text-[9px] font-semibold text-muted-foreground px-1 pb-1">
                                      Rentrent dans le budget restant ({Math.round(remainingCal)} kcal / jour)
                                    </p>
                                  )}
                                  {fitsBudget.map(renderRow)}
                                  {fitsBudget.length > 0 && overBudget.length > 0 && <Separator className="my-2 opacity-50" />}
                                  {overBudget.length > 0 && fitsBudget.length > 0 && (
                                    <p className="text-[9px] font-semibold text-muted-foreground px-1 pb-1">Autres extras</p>
                                  )}
                                  {overBudget.map(renderRow)}
                                </>
                              );
                            })()}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <button
                        onClick={() => {
                          const snapKey = `extra-${iso}`;
                          // Utiliser l'état React courant (source de vérité instantanée) pour éviter
                          // de relire une préférence potentiellement en retard juste après un clic +/−.
                          const currentIds = extraSelections[iso] || extraSelections[key] || [];
                          const cal = (iso && extraCalories[iso]) || extraCalories[key] || 0;
                          const prot = (iso && extraProteins[iso]) || extraProteins[key] || 0;
                          const itemIds = currentIds;
                          const updated = { ...savedSnapshots, [snapKey]: { cal, prot, itemIds } };
                          setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                          // Synchronisation unidirectionnelle vers la semaine prochaine (Actuelle -> Suivante)
                          // Propager via la clé "jour" (lundi/mardi/...) pour que la semaine suivante,
                          // qui a une autre date ISO, récupère bien le visuel des saves.
                          if (weekOffset === 0) {
                            const nxtSel = { ...nextExtraSelections };
                            nxtSel[key] = [...itemIds];
                            setPreference.mutate({ key: 'next_week_extra_selections', value: nxtSel });

                            const nxtCal = { ...nextExtraCalories };
                            if (cal > 0) {
                              nxtCal[key] = cal;
                            } else {
                              delete nxtCal[key];
                            }
                            setPreference.mutate({ key: 'next_week_extra_calories', value: nxtCal });

                            const nxtPro = { ...nextExtraProteins };
                            if (prot > 0) {
                              nxtPro[key] = prot;
                            } else {
                              delete nxtPro[key];
                            }
                            setPreference.mutate({ key: 'next_week_extra_proteins', value: nxtPro });
                          }

                          setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                          setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                        }}
                        onDoubleClick={() => {
                          const snapKey = `extra-${iso}`;
                          const updated = { ...savedSnapshots };
                          delete updated[snapKey];
                          delete updated[`extra-${key}`];
                          setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                          // Nettoyer la sync de la semaine prochaine si oubliée
                          if (weekOffset === 0) {
                            const nxtSel = { ...nextExtraSelections }; delete nxtSel[key]; delete nxtSel[iso];
                            setPreference.mutate({ key: 'next_week_extra_selections', value: nxtSel });
                            const nxtCal = { ...nextExtraCalories }; delete nxtCal[key]; delete nxtCal[iso];
                            setPreference.mutate({ key: 'next_week_extra_calories', value: nxtCal });
                            const nxtPro = { ...nextExtraProteins }; delete nxtPro[key]; delete nxtPro[iso];
                            setPreference.mutate({ key: 'next_week_extra_proteins', value: nxtPro });
                          }
                        }}
                        className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`extra-${iso}`]
                          ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                          : savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]
                            ? 'bg-primary/20 text-primary border border-primary/40'
                            : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                          }`}
                        title={(savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) ? `Sauvegardé: ${((savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any).cal || 0} kcal / ${((savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any).prot || 0} prot, ${((savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any).itemIds?.length || 0} items (Double-clic pour oublier)` : 'Sauvegarder les valeurs pour le reset (Double-clic pour oublier)'}
                      >💾</button>
                    </div>
                  </div>
                </div>
                  );
                })()}
              </div>
              <div
                data-slot
                data-day={iso}
                data-time="gouter"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverSlot(`${iso}-gouter`);
                }}
                onDragLeave={() => setDragOverSlot((cur) => (cur === `${iso}-gouter` ? null : cur))}
                onDrop={(e) => handleDrop(e, iso, 'gouter')}
                className={`mt-1.5 min-h-[34px] rounded-xl border border-dashed p-0.5 sm:p-1 transition-colors flex items-center ${dragOverSlot === `${iso}-gouter` ? "border-orange-400/65 bg-orange-500/8 ring-1 ring-orange-400/25" : "border-orange-300/45 bg-orange-500/3 hover:border-orange-400/45"}`}
              >
                <div className="flex items-center gap-1 sm:gap-2 flex-wrap w-full">
                  <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Goûter</span>
                  <button
                    onClick={() => {
                      const updated = { ...drinkChecks };
                      if (updated[`${iso}-gouter`]) delete updated[`${iso}-gouter`];
                      else if (updated[`${key}-gouter`]) delete updated[`${key}-gouter`];
                      else updated[`${iso}-gouter`] = true;
                      setPreference.mutate({ key: 'planning_drink_checks', value: updated });
                    }}
                    className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${gouterDrink ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold' : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60'}`}
                    title="+ Boisson sucrée (+150 cal)"
                  >
                    🥤 {gouterDrink ? '+150' : ''}
                  </button>
                  <PlanningInput
                    storageKey={`manual-${iso}-gouter`}
                    currentValue={gouterManualCal}
                    onSave={(val) => {
                      const updated = { ...manualCalories };
                      if (val > 0) updated[`${iso}-gouter`] = val;
                      else { delete updated[`${iso}-gouter`]; delete updated[`${key}-gouter`]; }
                      setPreference.mutate({ key: 'planning_manual_calories', value: updated });
                    }}
                    placeholder="kcal"
                    className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 text-center"
                  />
                  <PlanningInput
                    storageKey={`manual-prot-${iso}-gouter`}
                    currentValue={gouterManualPro}
                    onSave={(val) => {
                      const updated = { ...manualProteins };
                      if (val > 0) updated[`${iso}-gouter`] = val;
                      else { delete updated[`${iso}-gouter`]; delete updated[`${key}-gouter`]; }
                      setPreference.mutate({ key: 'planning_manual_proteins', value: updated });
                    }}
                    placeholder="prot"
                    className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center"
                  />
                  {getMealsForSlot(key, 'gouter', iso).map((pm) => renderMiniCard(pm, true))}
                  {gouterAssignedIds.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {gouterAssignedIds.map((extraId) => {
                        const custom = parseCustomExtraId(extraId);
                        const fi = custom ? null : foodItems.find((f) => f.id === extraId);
                        if (!fi && !custom) return null;
                        return (
                          <span
                            key={extraId}
                            draggable
                            onDragStart={(e) => {
                              setDraggedSelectedExtraId(extraId);
                              setDraggedSelectedExtraOrigin({ iso, key });
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', extraId);
                            }}
                            onDragEnd={() => {
                              setDraggedSelectedExtraId(null);
                              setDraggedSelectedExtraOrigin(null);
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-600 border border-orange-500/25 cursor-grab active:cursor-grabbing"
                            title="Extra assigné à Goûter — glisse pour déplacer"
                          >
                            {formatPlacedExtraLabel(custom?.name || fi?.name || "", fi?.grams)}
                            <button onClick={() => deselectExtraForDay(extraId, iso, key)} className="opacity-60 hover:opacity-100 font-bold" title="Retirer des extras du jour">×</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {(gouterTotalCals > 0 || gouterTotalPro > 0) && (
                    <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm">
                      {gouterTotalCals > 0 && <span className="flex items-center gap-0.5"><Flame className="w-2 h-2 text-orange-500/60" />{Math.round(gouterTotalCals)}</span>}
                      {gouterTotalCals > 0 && gouterTotalPro > 0 && <span className="opacity-30">•</span>}
                      {gouterTotalPro > 0 && <span className="flex items-center gap-0.5"><span className="text-[9px] opacity-60">🍗</span>{Math.round(gouterTotalPro)}</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Total calorique de la semaine */}
        {(() => {
          const todayIndexNum = weekDates.findIndex(d => d.iso === todayISO);
          const datesUpToToday = todayIndexNum >= 0 ? weekDates.slice(0, todayIndexNum + 1) : [];
          const totalUpToToday = datesUpToToday.reduce((sum, d) => sum + getDayCalories(d.key, d.iso), 0);
          const avgCal = datesUpToToday.length > 0 ? Math.round(totalUpToToday / datesUpToToday.length) : 0;
          return (
            <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between flex-wrap gap-1">
              <span className="text-sm font-bold text-foreground">Total semaine</span>
              <div className="flex items-center gap-3 flex-wrap ml-auto">
                <span className="text-xs text-muted-foreground font-medium">
                  Moy. {avgCal} kcal/j <span className="text-muted-foreground/40">({datesUpToToday.length}j)</span>
                </span>
                <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
                  <Flame className="h-4 w-4" />
                  {Math.round(weekTotal)} <span className="text-muted-foreground/50 font-normal text-xs">/ {WEEKLY_GOAL}</span>
                </span>
              </div>
            </div>
          );
        })()}

        {/* Hors planning — zone de dépôt pour déplanifier */}
        <div
          data-unplanned
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverUnplanned(true);
          }}
          onDragLeave={() => setDragOverUnplanned(false)}
          onDrop={handleDropUnplanned}
          className={`rounded-2xl p-3 sm:p-4 transition-all ${dragOverUnplanned || touchHighlight === "unplanned" ? "bg-muted/60 ring-2 ring-border" : "bg-card/80 backdrop-blur-sm"}`}
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm sm:text-base font-bold text-foreground">Hors planning</h3>
          </div>
          {unplanned.length === 0 ? (
            <p className={`text-xs italic ${dragOverUnplanned ? "text-foreground/60" : "text-muted-foreground/50"}`}>
              {dragOverUnplanned ? "Relâche pour retirer du planning ↓" : "Tous les repas sont planifiés ✨"}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">{unplanned.map((pm) => renderMiniCard(pm, true))}</div>
          )}
        </div>
      </>) : weekOffset <= -1 ? (
        /* ─── Semaine précédente (Vue de sauvegarde) ─── */
        (() => {
          const backupRaw = getPreference<any>('possible_meals_backup', null);
          if (!backupRaw) return (
            <div className="rounded-2xl bg-card/80 backdrop-blur-sm p-6 text-center">
              <p className="text-sm text-muted-foreground italic">Aucune sauvegarde disponible</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Une sauvegarde est créée automatiquement lors du reset</p>
            </div>
          );
          const isNF = backupRaw && !Array.isArray(backupRaw) && backupRaw.cards;
          const cards: any[] = isNF ? backupRaw.cards : (Array.isArray(backupRaw) ? backupRaw : []);
          const bMC = isNF ? (backupRaw.manualCalories || {}) : {};
          const bMP = isNF ? (backupRaw.manualProteins || {}) : {};
          const bEC = isNF ? (backupRaw.extraCalories || {}) : {};
          const bEP = isNF ? (backupRaw.extraProteins || {}) : {};
          const bES = isNF ? (backupRaw.extraSelections || {}) : {};
          const bESA = isNF ? (backupRaw.extraSlotAssignments || {}) : {};
          const bBC = isNF ? (backupRaw.breakfastManualCalories || {}) : {};
          const bBP = isNF ? (backupRaw.breakfastManualProteins || {}) : {};
          const bBS = isNF ? (backupRaw.breakfastSelections || {}) : {};
          const bDC = isNF ? (backupRaw.drinkChecks || {}) : {};
          const bCO = isNF ? (backupRaw.calOverrides || {}) : {};
          const bPO = isNF ? (backupRaw.proOverrides || {}) : {};

          const renderBackupCards = (slotCards: any[]) => slotCards.map((c: any, i: number) => {
            const m = allMealsById.get(c.meal_id);
            if (!m) return <div key={i} className="rounded-xl px-2 py-1 bg-muted text-[10px] text-muted-foreground">Repas supprimé</div>;
            return (
              <div key={i} className="rounded-xl px-2 py-1 text-white text-[10px] font-semibold" style={{ backgroundColor: getMealColor(c.ingredients_override ?? m.ingredients, m.name) }}>
                {getCategoryEmoji(m.category)} {m.name}
                {bCO[c.id] && <span className="ml-1 opacity-80">🔥{bCO[c.id]}</span>}
                {bPO[c.id] && <span className="ml-1 opacity-80">🍗{bPO[c.id]}</span>}
              </div>
            );
          });

          const dailyTotals: number[] = [];
          const dailyProteins: number[] = [];

          return (
            <div className="space-y-3">
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">📋 Lecture seule — Dernière sauvegarde avant reset</p>
              </div>
              {weekDates.map(({ key, iso, display }) => {
                const dayCards = cards.filter((c: any) => c.day_of_week === iso || c.day_of_week === key);
                const midiCards = dayCards.filter((c: any) => c.meal_time === 'midi');
                const soirCards = dayCards.filter((c: any) => c.meal_time === 'soir');
                const matinCards = dayCards.filter((c: any) => c.meal_time === 'matin');

                // Current totals will be calculated below from slot values

                let bfSlotCal = 0, bfSlotPro = 0;
                let midiSlotCal = 0, midiSlotPro = 0;
                let soirSlotCal = 0, soirSlotPro = 0;

                // Calcul du petit déjeuner
                const bfSel = bBS[iso] || bBS[key];
                if (bfSel?.startsWith('meal:')) {
                  const m = allMealsById.get(bfSel.slice(5));
                  if (m) { bfSlotCal += parseCalories(m.calories); bfSlotPro += parseProtein(m.protein); }
                } else if (bfSel?.startsWith('pm:')) {
                  const pm = cards.find(c => c.id === bfSel.slice(3));
                  if (pm) {
                    const m = allMealsById.get(pm.meal_id);
                    const fullPm = m ? { ...pm, meals: m } : pm;
                    bfSlotCal += getCardDisplayCalories(fullPm, bCO[pm.id], isAvailableCb);
                    bfSlotPro += getCardDisplayProtein(fullPm, bPO[pm.id], isAvailableCb);
                  }
                } else {
                  bfSlotCal += (bBC[iso] || bBC[key] || 0);
                  const bfManualPro = isNF ? (backupRaw.breakfastManualProteins?.[iso] || backupRaw.breakfastManualProteins?.[key] || 0) : 0;
                  bfSlotPro += bfManualPro;
                }

                // Calculs des cartes et des créneaux (slots)
                const processCards = (slotCards: any[]) => {
                  let cals = 0, pros = 0;
                  for (const c of slotCards) {
                    const m = allMealsById.get(c.meal_id);
                    if (!m) continue;
                    const overrideCal = bCO[c.id];
                    const overridePro = bPO[c.id];
                    const fullPm = { ...c, meals: m };
                    cals += getCardDisplayCalories(fullPm, overrideCal, isAvailableCb);
                    pros += getCardDisplayProtein(fullPm, overridePro, isAvailableCb);
                  }
                  return { cals, pros };
                };

                const matinAssignedIds = bESA[`${iso}-matin`] ?? bESA[`${key}-matin`] ?? [];
                const midiAssignedIds = bESA[`${iso}-midi`] ?? bESA[`${key}-midi`] ?? [];
                const soirAssignedIds = bESA[`${iso}-soir`] ?? bESA[`${key}-soir`] ?? [];
                const gouterAssignedIds = bESA[`${iso}-gouter`] ?? bESA[`${key}-gouter`] ?? [];
                const matinAssigned = sumExtrasFromSelectionIds(matinAssignedIds, foodItems);
                const midiAssigned = sumExtrasFromSelectionIds(midiAssignedIds, foodItems);
                const soirAssigned = sumExtrasFromSelectionIds(soirAssignedIds, foodItems);
                const gouterAssigned = sumExtrasFromSelectionIds(gouterAssignedIds, foodItems);

                const resMatin = processCards(matinCards);
                bfSlotCal += resMatin.cals + matinAssigned.cal;
                bfSlotPro += resMatin.pros + matinAssigned.pro;

                const resMidi = processCards(midiCards);
                midiSlotCal = resMidi.cals + midiAssigned.cal;
                midiSlotPro = resMidi.pros + midiAssigned.pro;
                if (midiCards.length === 0) { midiSlotCal += (bMC[`${iso}-midi`] || bMC[`${key}-midi`] || 0); midiSlotPro += (bMP[`${iso}-midi`] || bMP[`${key}-midi`] || 0); }
                if (bDC[`${iso}-midi`] || bDC[`${key}-midi`]) midiSlotCal += 150;

                const resSoir = processCards(soirCards);
                soirSlotCal = resSoir.cals + soirAssigned.cal;
                soirSlotPro = resSoir.pros + soirAssigned.pro;
                if (soirCards.length === 0) { soirSlotCal += (bMC[`${iso}-soir`] || bMC[`${key}-soir`] || 0); soirSlotPro += (bMP[`${iso}-soir`] || bMP[`${key}-soir`] || 0); }
                if (bDC[`${iso}-soir`] || bDC[`${key}-soir`]) soirSlotCal += 150;

                let dayTotal = bfSlotCal + midiSlotCal + soirSlotCal;
                let dayPro = bfSlotPro + midiSlotPro + soirSlotPro;

                // Extras (sauvegarde : mêmes ids que le planning courant, y compris extras saisis à la main)
                dayTotal += (bEC[iso] || bEC[key] || 0);
                dayPro += (bEP[iso] || bEP[key] || 0);
                const backupExtraSum = sumExtrasFromSelectionIds(bES[iso] || bES[key], foodItems);
                const backupAssignedExtraCal = matinAssigned.cal + midiAssigned.cal + soirAssigned.cal + gouterAssigned.cal;
                const backupAssignedExtraPro = matinAssigned.pro + midiAssigned.pro + soirAssigned.pro + gouterAssigned.pro;
                const backupUnassignedExtraCal = Math.max(0, backupExtraSum.cal - backupAssignedExtraCal);
                const backupUnassignedExtraPro = Math.max(0, backupExtraSum.pro - backupAssignedExtraPro);
                dayTotal += backupUnassignedExtraCal;
                dayPro += backupUnassignedExtraPro;

                // Le calcul des boissons est déjà inclus dans les totaux des créneaux (slots)

                dailyTotals.push(dayTotal);
                dailyProteins.push(dayPro);

                return (
                  <div key={iso} className="rounded-2xl bg-card/80 backdrop-blur-sm p-2 sm:p-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="text-sm sm:text-base font-bold text-foreground">{display}</h3>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full font-semibold">
                          {(() => {
                            const count = matinCards.length + (bfSel ? 1 : 0);
                            if (count > 1) return 'Plusieurs petits déj';
                            if (count === 1) {
                              if (matinCards.length === 1) return allMealsById.get(matinCards[0].meal_id)?.name || '🥐 Petit déj';
                              if (bfSel?.startsWith('meal:')) return allMealsById.get(bfSel.slice(5))?.name || '🥐 Petit déj';
                              if (bfSel?.startsWith('pm:')) return allMealsById.get(cards.find(c => c.id === bfSel.slice(3))?.meal_id)?.name || '🥐 Petit déj';
                            }
                            return '🥐 Petit déj';
                          })()}
                        </span>
                        {(bfSlotCal > 0 || bfSlotPro > 0) && (
                          <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm leading-none h-5">
                            {bfSlotCal > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Flame className="w-2 h-2 text-orange-500/60" />
                                {Math.round(bfSlotCal)}
                              </span>
                            )}
                            {bfSlotCal > 0 && bfSlotPro > 0 && <span className="opacity-30">•</span>}
                            {bfSlotPro > 0 && (
                              <span className="flex items-center gap-0.5">
                                <span className="text-[9px] opacity-60">🍗</span>
                                {Math.round(bfSlotPro)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex-1" />
                      <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
                        <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 whitespace-nowrap">
                          <Flame className="h-2.5 w-2.5 text-orange-500" />
                          {Math.round(dayTotal)} <span className="text-muted-foreground/50 font-normal">/ {backupTotals.archivedDailyGoal}</span>
                        </span>
                        {dayTotal > 0 && (
                          <span className={`text-[10px] font-bold whitespace-nowrap ${backupTotals.archivedDailyGoal - dayTotal > 0 ? 'text-muted-foreground/60' : 'text-orange-500'}`}>
                            {backupTotals.archivedDailyGoal - dayTotal > 0 ? `reste ${Math.round(backupTotals.archivedDailyGoal - dayTotal)}` : `+${Math.round(dayTotal - backupTotals.archivedDailyGoal)}`}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-[1fr_1fr_auto] gap-1 sm:gap-3">
                      {TIMES.map(time => {
                        const slotCards = dayCards.filter((c: any) => c.meal_time === time);
                        const kIso = `${iso}-${time}`;
                        const kKey = `${key}-${time}`;
                        return (
                          <div key={time} className="min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-border/55 bg-background/10 p-1 sm:p-1.5">
                            <div className="flex items-center justify-between mb-0.5">
                              <div className="flex items-center gap-1">
                                <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                                {(bDC[kIso] || bDC[kKey]) && (
                                  <span className="flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">🥤 +150</span>
                                )}
                              </div>
                              {(() => {
                                const sCal = time === 'midi' ? midiSlotCal : soirSlotCal;
                                const sPro = time === 'midi' ? midiSlotPro : soirSlotPro;
                                if (sCal <= 0 && sPro <= 0) return null;
                                return (
                                  <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm leading-none h-4 sm:h-5">
                                    {sCal > 0 && (
                                      <span className="flex items-center gap-0.5">
                                        <Flame className="w-2 h-2 text-orange-500/60" />
                                        {Math.round(sCal)}
                                      </span>
                                    )}
                                    {sCal > 0 && sPro > 0 && <span className="opacity-30">•</span>}
                                    {sPro > 0 && (
                                      <span className="flex items-center gap-0.5">
                                        <span className="text-[9px] opacity-60">🍗</span>
                                        {Math.round(sPro)}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                            <div className="mt-0.5 space-y-1">
                              {slotCards.length === 0 ? (
                                <div className="flex flex-col items-start gap-0.5 opacity-60">
                                  <div className="text-[10px] text-muted-foreground px-1">{bMC[kIso] || bMC[kKey] || 0} kcal</div>
                                  <div className="text-[10px] text-blue-400 px-1">{bMP[kIso] || bMP[kKey] || 0} prot</div>
                                </div>
                              ) : (
                                slotCards.map((c: any, i: number) => {
                                  const m = allMealsById.get(c.meal_id);
                                  if (!m) return <div key={i} className="rounded-xl px-2 py-1 bg-muted text-[10px] text-muted-foreground">Repas supprimé</div>;
                                  return (
                                    <div key={i} className="rounded-xl px-2 py-1 text-white text-[9px] sm:text-[10px] font-semibold flex items-center justify-between transition-all" style={{ backgroundColor: getMealColor(c.ingredients_override ?? m.ingredients, m.name) }}>
                                      <span className="truncate">{getCategoryEmoji(m.category)} {m.name}</span>
                                      {bCO[c.id] && <span className="ml-1 opacity-80 shrink-0">🔥{bCO[c.id]}</span>}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {/* Extra column */}
                      <div className="min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-orange-300/45 bg-orange-500/3 p-1 sm:p-1.5 w-12 sm:w-20 flex flex-col items-center">
                        <span className="text-[8px] sm:text-[9px] font-semibold text-orange-400/80 uppercase tracking-wide">Extra</span>
                        <div className="flex flex-col items-center gap-1 mt-1 w-full opacity-60">
                          {(() => {
                            const sel = sumExtrasFromSelectionIds(bES[iso] || bES[key], foodItems);
                            const matinAssigned = sumExtrasFromSelectionIds(bESA[`${iso}-matin`] ?? bESA[`${key}-matin`] ?? [], foodItems);
                            const midiAssigned = sumExtrasFromSelectionIds(bESA[`${iso}-midi`] ?? bESA[`${key}-midi`] ?? [], foodItems);
                            const soirAssigned = sumExtrasFromSelectionIds(bESA[`${iso}-soir`] ?? bESA[`${key}-soir`] ?? [], foodItems);
                            const gouterAssigned = sumExtrasFromSelectionIds(bESA[`${iso}-gouter`] ?? bESA[`${key}-gouter`] ?? [], foodItems);
                            const assignedCal = matinAssigned.cal + midiAssigned.cal + soirAssigned.cal + gouterAssigned.cal;
                            const assignedPro = matinAssigned.pro + midiAssigned.pro + soirAssigned.pro + gouterAssigned.pro;
                            const extraCal = Math.max(0, sel.cal - assignedCal);
                            const extraPro = Math.max(0, sel.pro - assignedPro);
                            return (
                              <>
                                <div className="text-[10px] text-orange-400 font-bold">{Math.round((bEC[iso] || bEC[key] || 0) + extraCal)}</div>
                                <div className="text-[10px] text-blue-400 font-bold">{Math.round((bEP[iso] || bEP[key] || 0) + extraPro)}</div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Total calorique de la semaine (Backup) */}
              {(() => {
                const weekTotalCals = dailyTotals.reduce((a, b) => a + b, 0);
                const processedDays = dailyTotals.length;
                const avgCal = processedDays > 0 ? Math.round(weekTotalCals / processedDays) : 0;

                return (
                  <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between flex-wrap gap-1">
                    <span className="text-sm font-bold text-foreground">Total semaine</span>
                    <div className="flex items-center gap-3 flex-wrap ml-auto">
                      <span className="text-xs text-muted-foreground font-medium">
                        Moy. {avgCal} kcal/j <span className="text-muted-foreground/40">({processedDays}j)</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
                        <Flame className="h-4 w-4" />
                        {Math.round(weekTotalCals)} <span className="text-muted-foreground/50 font-normal text-xs">/ {backupTotals.archivedDailyGoal * 7}</span>
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })()
      ) : (
        /* ─── Planification de la semaine prochaine ─── */
        <div className="space-y-3">
          <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">📅 Aperçu semaine prochaine — inclut les éléments conservés après reset</p>
          </div>
          {weekDates.map(({ key, iso, display }) => {
            // Base post-reset : captures sauvegardées uniquement (ce qui survit au reset)
            const bfSnap = (savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]) as any;
            const baseBfMealId = bfSnap?.mealId || undefined;
            const baseBfManualCal = bfSnap?.cal || 0;
            const baseBfManualPro = bfSnap?.prot || 0;
            const extraSnap = resolveExtraSnapshotForDay(iso, key);
            const baseExtraCal = extraSnap?.cal || 0;
            const baseExtraPro = extraSnap?.prot || 0;
            const baseExtraSel: string[] = extraSnap?.itemIds || [];

            // Surcharges semaine prochaine > base post-reset
            const effBfSel = nextBreakfastSelections[iso] ?? nextBreakfastSelections[key] ?? baseBfMealId;
            const effBfMeal = effBfSel?.startsWith('meal:') ? allMealsById.get(effBfSel.slice(5)) : null;
            // Résoudre les sélections pm: (petit déj dans Possible)
            const effBfPm = effBfSel?.startsWith('pm:') ? possiblePetitDej.find(p => p.id === effBfSel.slice(3)) : null;
            const effBfManualCal = nextBreakfastManualCalories[iso] ?? nextBreakfastManualCalories[key] ?? baseBfManualCal;
            const effBfManualPro = nextBreakfastManualProteins[iso] ?? nextBreakfastManualProteins[key] ?? baseBfManualPro;
            const effExtraCal = nextExtraCalories[iso] ?? nextExtraCalories[key] ?? baseExtraCal;
            const effExtraPro = nextExtraProteins[iso] ?? nextExtraProteins[key] ?? baseExtraPro;
            const effExtraSel = nextExtraSelections[iso] ?? nextExtraSelections[key] ?? baseExtraSel;

            // Macros calculées pour le petit déj (gère les transferts de cartes, pm: et l'analyse des ingrédients)
            const nxtBfCal = effBfMeal
              ? (effBfManualCal || getMealCal(effBfMeal))
              : effBfPm?.meals
                ? (effBfManualCal || getMealCal(effBfPm.meals, effBfPm.ingredients_override))
                : effBfManualCal;
            const nxtBfPro = effBfMeal
              ? (effBfManualPro || getMealPro(effBfMeal))
              : effBfPm?.meals
                ? (effBfManualPro || getMealPro(effBfPm.meals, effBfPm.ingredients_override))
                : effBfManualPro;

            const matinMeals = getMealsForSlot(key, 'matin', iso);
            const matinCals = matinMeals.reduce((s, pm) => s + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb), 0);
            const matinPro = matinMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, proOverrides[pm.id], isAvailableCb), 0);

            // Indicateur unifié pour savoir si un petit déj est sélectionné (meal: ou pm: ou programmed matin)
            const hasNextBf = !!(effBfMeal || effBfPm || matinMeals.length > 0);

            let dayTotal = nxtBfCal + matinCals;
            for (const time of TIMES) {
              const kIso = `${iso}-${time}`;
              const kKey = `${key}-${time}`;
              const manualSnap = (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`]) as any;
              const baseManualCal = manualSnap?.cal || 0;
              dayTotal += nextManualCalories[kIso] ?? nextManualCalories[kKey] ?? baseManualCal;
              if (nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) dayTotal += 150;
              // Inclure les cartes programmées
              const slotMeals = getMealsForSlot(key, time, iso);
              dayTotal += slotMeals.reduce((s, pm) => s + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb), 0);
            }
            const nextExtraSelMacros = sumExtrasFromSelectionIds(effExtraSel, foodItems);
            dayTotal += effExtraCal + nextExtraSelMacros.cal;

            const extraSelCalSum = nextExtraSelMacros.cal;
            const dayCalBeforeExtras = dayTotal - effExtraCal - extraSelCalSum;
            const remainingNextCal = Math.max(0, NEXT_DAILY_GOAL - dayCalBeforeExtras);

            let nxtDayPro = nxtBfPro + matinPro;
            for (const time of TIMES) {
              const kIso = `${iso}-${time}`;
              const kKey = `${key}-${time}`;
              const manualSnap = (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`]) as any;
              const baseManualPro = manualSnap?.prot || 0;
              nxtDayPro += nextManualProteins[kIso] ?? nextManualProteins[kKey] ?? baseManualPro;
              // Inclure les cartes programmées
              const slotMeals = getMealsForSlot(key, time, iso);
              nxtDayPro += slotMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, proOverrides[pm.id], isAvailableCb), 0);
            }
            nxtDayPro += effExtraPro + nextExtraSelMacros.pro;

            return (
              <div key={iso} className="rounded-2xl bg-card/80 backdrop-blur-sm p-2 sm:p-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-bold text-foreground">{display}</h3>
                  {/* Petit déj selector */}
                  <div className="flex items-center gap-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors truncate max-w-[120px] ${
                            (() => {
                              const count = matinMeals.length + (hasNextBf && !matinMeals.length ? 1 : 0);
                              return count > 0
                                ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50"
                                : "bg-slate-200/80 dark:bg-slate-700/45 text-slate-700 dark:text-slate-300 border border-dashed border-slate-400/50 dark:border-slate-500/50 hover:bg-slate-300/80 dark:hover:bg-slate-600/50";
                            })()
                          }`}
                        >
                          {(() => {
                            const count = matinMeals.length + (hasNextBf && !matinMeals.length ? 1 : 0);
                            if (count > 1) return 'Plusieurs petits déj';
                            if (count === 1) {
                              if (matinMeals.length === 1) return matinMeals[0].meals?.name || '🥐 Petit déj';
                              return effBfMeal ? effBfMeal.name : effBfPm?.meals?.name ? effBfPm.meals.name : '🥐 Petit déj';
                            }
                            return '🥐 Petit déj';
                          })()}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-52 p-2" align="start">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Petit déjeuner</p>
                        <div className="space-y-0.5 max-h-48 overflow-y-auto">
                          <button onClick={() => {
                            const updated = { ...nextBreakfastSelections }; delete updated[iso]; delete updated[key];
                            setPreference.mutate({ key: 'next_week_breakfast', value: updated });
                          }} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors">— Aucun</button>
                          {possiblePetitDej.length > 0 && (
                            <>
                              <p className="text-[9px] text-muted-foreground/60 px-2 font-semibold uppercase tracking-wide">Possible</p>
                              {possiblePetitDej.map(pm => {
                                const pmSelId = `pm:${pm.id}`;
                                const isSelected = nextBreakfastSelections[iso] === pmSelId || nextBreakfastSelections[key] === pmSelId;
                                const calDisplay = getMealCal(pm.meals || {}, pm.ingredients_override);
                                const proDisplay = getMealPro(pm.meals || {}, pm.ingredients_override);
                                return (
                                  <button key={pm.id} onClick={() => {
                                    const updated = { ...nextBreakfastSelections };
                                    if (isSelected) { delete updated[iso]; delete updated[key]; } else { updated[iso] = pmSelId; }
                                    setPreference.mutate({ key: 'next_week_breakfast', value: updated });
                                  }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : ''} flex items-center justify-between`}>
                                    <span className="truncate">{pm.meals?.name} {pm.ingredients_override ? '✏️' : ''}</span>
                                    <span className="inline-flex items-center gap-1.5 ml-1 text-muted-foreground shrink-0 text-[10px]">
                                      <span className="flex items-center gap-0.5">
                                        <Flame className="w-2.5 h-2.5 text-orange-500" />
                                        {calDisplay}
                                      </span>
                                      <span>•</span>
                                      <span className="flex items-center gap-0.5">
                                        <span className="grayscale brightness-125 saturate-50 leading-none">🍗</span>
                                        {proDisplay}
                                      </span>
                                    </span>
                                  </button>
                                );
                              })}
                              <div className="border-t border-border/40 my-1" />
                            </>
                          )}
                          <p className="text-[9px] text-muted-foreground/60 px-2 font-semibold uppercase tracking-wide">Tous</p>
                          {petitDejMeals.map(m => {
                            const mealSelId = `meal:${m.id}`;
                            const isSelected = nextBreakfastSelections[iso] === mealSelId || nextBreakfastSelections[key] === mealSelId;
                            return (
                              <button key={m.id} onClick={() => {
                                const updated = { ...nextBreakfastSelections };
                                if (isSelected) { delete updated[iso]; delete updated[key]; } else { updated[iso] = mealSelId; }
                                setPreference.mutate({ key: 'next_week_breakfast', value: updated });
                              }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : ''} flex items-center justify-between`}>
                                <span className="truncate">{m.name}</span>
                                <span className="inline-flex items-center gap-1.5 ml-1 text-muted-foreground shrink-0 text-[10px]">
                                  <span className="flex items-center gap-0.5">
                                    <Flame className="w-2.5 h-2.5 text-orange-500" />
                                    {getMealCal(m)}
                                  </span>
                                  <span>•</span>
                                  <span className="flex items-center gap-0.5">
                                    <span className="grayscale brightness-125 saturate-50 leading-none">🍗</span>
                                    {getMealPro(m)}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {hasNextBf && (
                      <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm leading-none h-5">
                        {(nxtBfCal + matinCals) > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Flame className="w-2 h-2 text-orange-500/60" />
                            {Math.round(nxtBfCal + matinCals)}
                          </span>
                        )}
                        {(nxtBfCal + matinCals) > 0 && (nxtBfPro + matinPro) > 0 && (
                          <span className="opacity-30">•</span>
                        )}
                        {(nxtBfPro + matinPro) > 0 && (
                          <span className="flex items-center gap-0.5">
                            <span className="text-[9px] opacity-60">🍗</span>
                            {Math.round(nxtBfPro + matinPro)}
                          </span>
                        )}
                      </div>
                    )}
                    {!hasNextBf && (
                      <>
                        <PlanningInput storageKey={`next-bf-cal-${iso}`} currentValue={nextBreakfastManualCalories[iso] ?? nextBreakfastManualCalories[key] ?? baseBfManualCal}
                          onSave={(val) => { const u = { ...nextBreakfastManualCalories }; u[iso] = Math.max(0, val); setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: u }); }}
                          placeholder="kcal" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40" />
                        <PlanningInput storageKey={`next-bf-prot-${iso}`} currentValue={nextBreakfastManualProteins[iso] ?? nextBreakfastManualProteins[key] ?? baseBfManualPro}
                          onSave={(val) => { const u = { ...nextBreakfastManualProteins }; u[iso] = Math.max(0, val); setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: u }); }}
                          placeholder="prot" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40" />
                      </>
                    )}
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
                    <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 whitespace-nowrap">
                      <Flame className="h-2.5 w-2.5 text-orange-500" />
                      {Math.round(dayTotal)} <span className="text-muted-foreground/50 font-normal">/ {NEXT_DAILY_GOAL}</span>
                    </span>
                    {dayTotal > 0 && (
                      <span className={`text-[10px] font-bold whitespace-nowrap ${NEXT_DAILY_GOAL - dayTotal > 0 ? 'text-muted-foreground/60' : 'text-orange-500'}`}>
                        {NEXT_DAILY_GOAL - dayTotal > 0 ? `reste ${Math.round(NEXT_DAILY_GOAL - dayTotal)}` : `+${Math.round(dayTotal - NEXT_DAILY_GOAL)}`}
                      </span>
                    )}
                    {nxtDayPro > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-500/10 rounded-full px-2 py-0.5 whitespace-nowrap">
                        🍗 {Math.round(nxtDayPro)} <span className="text-blue-400/50 font-normal">/ {NEXT_PROTEIN_GOAL}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-1 sm:gap-3">
                  {TIMES.map(time => {
                    const kIso = `${iso}-${time}`;
                    const kKey = `${key}-${time}`;
                    const slotId = `${key}-${time}`;
                    const isOver = dragOverSlot === slotId;
                    return (
                      <div
                        key={time}
                        data-slot={slotId}
                        data-day={iso}
                        data-time={time}
                        onDragOver={(e) => { e.preventDefault(); setDragOverSlot(slotId); }}
                        onDragLeave={() => setDragOverSlot(null)}
                        onDrop={(e) => { e.preventDefault(); handleDrop(e, iso, time); }}
                        className={`min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed p-1 sm:p-1.5 transition-all ${isOver ? 'bg-primary/16 border-primary/70 scale-[1.02] shadow-lg ring-1 ring-primary/25' : 'border-border/55 bg-background/10'}`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1">
                            <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                            <button onClick={() => {
                              const u = { ...nextDrinkChecks }; if (nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) { delete u[kIso]; delete u[kKey]; } else { u[kIso] = true; }
                              setPreference.mutate({ key: 'next_week_drink_checks', value: u });
                            }} className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${(nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold' : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60'}`}>
                              🥤 {(nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) ? '+150' : ''}
                            </button>
                          </div>
                        </div>
                        <div className="mt-0.5 space-y-1">
                          {getMealsForSlot(key, time, iso).map((pm) => renderMiniCard(pm, false, time === 'midi' || time === 'soir'))}
                          <div className="flex flex-col items-start gap-0.5">
                            <PlanningInput storageKey={`next-mc-${iso}-${time}`} currentValue={nextManualCalories[kIso] ?? nextManualCalories[kKey] ?? (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`] as any)?.cal ?? 0}
                              onSave={(val) => { const u = { ...nextManualCalories }; u[kIso] = Math.max(0, val); setPreference.mutate({ key: 'next_week_manual_calories', value: u }); }}
                              placeholder="kcal" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 text-center" />
                            <PlanningInput storageKey={`next-mp-${iso}-${time}`} currentValue={nextManualProteins[kIso] ?? nextManualProteins[kKey] ?? (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`] as any)?.prot ?? 0}
                              onSave={(val) => { const u = { ...nextManualProteins }; u[kIso] = Math.max(0, val); setPreference.mutate({ key: 'next_week_manual_proteins', value: u }); }}
                              placeholder="prot" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {/* Colonne Extra */}
                  <div className="min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-orange-300/45 bg-orange-500/3 p-1 sm:p-1.5 w-12 sm:w-20 flex flex-col items-center">
                    <span className="text-[8px] sm:text-[9px] font-semibold text-orange-400/80 uppercase tracking-wide">Extra</span>
                    <div className="flex flex-col items-center gap-0.5 mt-1 w-full">
                      <PlanningInput storageKey={`next-ec-${iso}`}
                        currentValue={(() => { const m = nextExtraCalories[iso] ?? nextExtraCalories[key] ?? baseExtraCal; const ids = effExtraSel; return m + ids.reduce((s, id) => s + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0); })()}
                        onSave={(val) => { const ids = effExtraSel; const sel = sumExtrasFromSelectionIds(ids, foodItems).cal; const m = Math.max(0, val - sel); const u = { ...nextExtraCalories }; if (m > 0) u[iso] = m; else { delete u[iso]; } delete u[key]; setPreference.mutate({ key: 'next_week_extra_calories', value: u }); }}
                        placeholder="kcal" className="w-full h-5 text-[11px] bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-400 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40 text-center" />
                      <PlanningInput storageKey={`next-ep-${iso}`}
                        currentValue={(() => { const m = nextExtraProteins[iso] ?? nextExtraProteins[key] ?? baseExtraPro; const ids = effExtraSel; return m + ids.reduce((s, id) => s + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0); })()}
                        onSave={(val) => { const ids = effExtraSel; const sel = sumExtrasFromSelectionIds(ids, foodItems).pro; const m = Math.max(0, val - sel); const u = { ...nextExtraProteins }; if (m > 0) u[iso] = m; else { delete u[iso]; } delete u[key]; setPreference.mutate({ key: 'next_week_extra_proteins', value: u }); }}
                        placeholder="prot" className="w-full h-5 text-[11px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center" />
                      <div className="flex items-center gap-1 mt-1">
                        <Popover open={openExtrasDay === `next-${iso}`} onOpenChange={(open) => setOpenExtrasDay(open ? `next-${iso}` : null)}>
                          <PopoverTrigger asChild>
                            <button className={`h-5 w-5 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 ${effExtraSel.length > 0 ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20'}`} title="Ajouter un Extra">
                              <Plus className="h-3 w-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 p-3 bg-card/95 backdrop-blur-md border-orange-200/20 shadow-2xl rounded-2xl" align="center">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Extras disponibles</p>
                              <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
                            </div>
                            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                              {(() => {
                                const availableExtras = foodItems.filter(fi => fi.storage_type === 'extras');
                                const sortedItems = getSortedFoodItems(
                                  availableExtras,
                                  foodSortModes['extras'] || "manual",
                                  sortDirections['food-extras'] !== false
                                );
                                const selected = sortedItems.filter(fi => effExtraSel.includes(fi.id));
                                const others = sortedItems.filter(fi => !effExtraSel.includes(fi.id));
                                const ordered = [...selected, ...others];
                                const calOf = (fi: FoodItem) => parseCalories(fi.calories);
                                const fitsBudget = ordered.filter(fi => calOf(fi) > 0 && calOf(fi) <= remainingNextCal);
                                const overBudget = ordered.filter(fi => calOf(fi) <= 0 || calOf(fi) > remainingNextCal);
                                const renderRow = (fi: FoodItem) => {
                                  const count = effExtraSel.filter(id => id === fi.id).length;
                                  return (
                                    <div key={fi.id} className={`w-full p-2 rounded-xl border transition-all group flex items-center gap-3 ${count > 0 ? 'bg-orange-500/20 border-orange-500/40 shadow-inner' : 'bg-muted/30 hover:bg-orange-500/10 border-transparent hover:border-orange-500/20'}`}>
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-[11px] font-bold transition-colors truncate ${count > 0 ? 'text-orange-600' : 'text-foreground group-hover:text-orange-600'}`}>{fi.name}</p>
                                        {(fi.grams || fi.quantity) && (
                                          <p className="text-[9px] text-muted-foreground/60">{fi.grams ? `${fi.grams}` : ''}{fi.grams && fi.quantity ? ' · ' : ''}{fi.quantity ? `x${fi.quantity}` : ''}</p>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {count > 0 && (<>
                                          <button onClick={() => { const u = { ...nextExtraSelections }; const c = u[iso] || u[key] || []; const idx = c.lastIndexOf(fi.id); if (idx >= 0) u[iso] = [...c.slice(0, idx), ...c.slice(idx + 1)]; delete u[key]; setPreference.mutate({ key: 'next_week_extra_selections', value: u }); }} className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-500 text-xs font-bold">−</button>
                                          <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{count}</span>
                                        </>)}
                                        <button onClick={() => { const u = { ...nextExtraSelections }; u[iso] = [...(u[iso] || u[key] || []), fi.id]; delete u[key]; setPreference.mutate({ key: 'next_week_extra_selections', value: u }); }} className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/20 hover:bg-orange-500/40 text-orange-500 text-xs font-bold">+</button>
                                        {fi.protein && (
                                          <div className="flex items-center gap-1 bg-blue-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-blue-500 border border-blue-500/10">
                                            🍗 {fi.protein}
                                          </div>
                                        )}
                                        {fi.calories && (
                                          <div className="flex items-center gap-1 bg-orange-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-orange-500">
                                            <Flame className="w-2.5 h-2.5" />
                                            {fi.calories}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                };
                                return (
                                  <>
                                    {fitsBudget.length > 0 && (
                                      <p className="text-[9px] font-semibold text-muted-foreground px-1 pb-1">
                                        Rentrent dans le budget restant ({Math.round(remainingNextCal)} kcal / jour)
                                      </p>
                                    )}
                                    {fitsBudget.map(renderRow)}
                                    {fitsBudget.length > 0 && overBudget.length > 0 && <Separator className="my-2 opacity-50" />}
                                    {overBudget.length > 0 && fitsBudget.length > 0 && (
                                      <p className="text-[9px] font-semibold text-muted-foreground px-1 pb-1">Autres extras</p>
                                    )}
                                    {overBudget.map(renderRow)}
                                  </>
                                );
                              })()}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {/* Total semaine suivante */}
          {(() => {
            let total = 0;
            let totalPro = 0;
            for (const { key, iso } of weekDates) {
              const bfSnap = (savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]) as any;
              const eBfSel = nextBreakfastSelections[iso] ?? nextBreakfastSelections[key] ?? bfSnap?.mealId;
              const eBfMeal = eBfSel?.startsWith('meal:') ? allMealsById.get(eBfSel.slice(5)) : null;
              if (eBfMeal) { total += parseCalories(eBfMeal.calories); totalPro += parseProtein(eBfMeal.protein); }
              else { total += nextBreakfastManualCalories[iso] ?? nextBreakfastManualCalories[key] ?? bfSnap?.cal ?? 0; totalPro += nextBreakfastManualProteins[iso] ?? nextBreakfastManualProteins[key] ?? bfSnap?.prot ?? 0; }
              for (const time of TIMES) {
                const kIso = `${iso}-${time}`;
                const kKey = `${key}-${time}`;
                const manualSnap = (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`]) as any;
                total += nextManualCalories[kIso] ?? nextManualCalories[kKey] ?? manualSnap?.cal ?? 0;
                totalPro += nextManualProteins[kIso] ?? nextManualProteins[kKey] ?? manualSnap?.prot ?? 0;
                if (nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) total += 150;
              }
              const extraSnap = (savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any;
              total += nextExtraCalories[iso] ?? nextExtraCalories[key] ?? extraSnap?.cal ?? 0;
              totalPro += nextExtraProteins[iso] ?? nextExtraProteins[key] ?? extraSnap?.prot ?? 0;
              for (const id of (nextExtraSelections[iso] ?? nextExtraSelections[key] ?? extraSnap?.itemIds ?? [])) {
                const fi = foodItems.find(f => f.id === id);
                if (fi) { total += parseCalories(fi.calories); totalPro += parseProtein(fi.protein); }
              }
            }
            const avgCal = Math.round(total / 7);
            return (
              <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between flex-wrap gap-1">
                <span className="text-sm font-bold text-foreground">Total prévu</span>
                <div className="flex items-center gap-3 flex-wrap ml-auto">
                  <span className="text-xs text-muted-foreground font-medium">Moy. {avgCal} kcal/j</span>
                  <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
                    <Flame className="h-4 w-4" /> {Math.round(total)} <span className="text-muted-foreground/50 font-normal text-xs">/ {WEEKLY_GOAL}</span>
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <Dialog open={!!popupPm} onOpenChange={(open) => { if (!open) setPopupPm(null); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Détails du repas</DialogTitle>
          {popupPm && popupPm.meals && (() => {
            const meal = popupPm.meals;
            const displayIngredients = popupPm.ingredients_override ?? meal.ingredients;
            const mealForAnalysis = { ...meal, ingredients: displayIngredients };
            const analysis = analyzeMealIngredients(mealForAnalysis, foodItems);
            const effectiveStart =
              resolveCounterStartForPossibleBadge(
                popupPm,
                possibleMeals,
                analysis.earliestCounterDate,
                popupPm.counter_start_date ?? undefined,
                foodItems,
                undefined,
              ) ??
              analysis.earliestCounterDate ??
              popupPm.counter_start_date ??
              null;
            const displayCal = String(getCardDisplayCalories(popupPm, calOverrides[popupPm.id], isAvailableCb));
            const displayPro = String(getCardDisplayProtein(popupPm, proOverrides[popupPm.id], isAvailableCb));
            const counterDays = getAdaptedCounterDays(effectiveStart, popupPm.day_of_week, popupPm.created_at, popupPm.meal_time);
            const counterBadgeTitle =
              counterDays !== null && effectiveStart
                ? getCounterDaysBadgeTooltip(effectiveStart, popupPm.day_of_week, popupPm.meal_time, counterDays)
                : undefined;
            const expired = isExpiredOnDay(popupPm.expiration_date, popupPm.day_of_week);
            return (
              <div className="rounded-2xl p-5 text-white" style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}>
                <h3 className="text-lg font-bold mb-2">{getCategoryEmoji(meal.category)} {meal.name}</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {displayCal && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5" /> {displayCal} kcal
                    </span>
                  )}
                  {displayPro && (
                    <span className="text-sm font-bold bg-blue-600/50 px-2.5 py-1 rounded-full flex items-center gap-1">
                      🍗 {displayPro}g
                    </span>
                  )}
                  {meal.grams && (
                    <span className="text-sm bg-white/20 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Weight className="h-3.5 w-3.5" /> {meal.grams}
                    </span>
                  )}
                  {counterDays !== null && (
                    <span
                      className={`text-sm font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${counterDays >= 3 ? 'bg-red-600' : 'bg-black/40'}`}
                      title={counterBadgeTitle}
                    >
                      <Timer className="h-3.5 w-3.5" /> {counterDays}j
                    </span>
                  )}
                  {counterDays === null && popupPm.counter_start_date && new Date(popupPm.counter_start_date).getTime() > new Date().getTime() && (
                    <span
                      className="text-sm font-bold bg-blue-500/40 px-2.5 py-1 rounded-full flex items-center gap-1 border border-blue-300/30"
                    >
                      <Timer className="h-3.5 w-3.5" /> 📅 Prog.
                    </span>
                  )}
                </div>
                {popupPm.expiration_date && (
                  <p className={`text-sm mb-2 ${expired ? 'text-red-200 font-bold' : 'text-white/70'}`}>
                    📅 {format(parseISO(popupPm.expiration_date), "d MMMM yyyy", { locale: fr })}
                  </p>
                )}
                {displayIngredients && (
                  <div className="bg-black/20 rounded-xl p-3 mt-1">
                    <p className="text-xs font-semibold text-white/60 mb-1 uppercase tracking-wide">Ingrédients</p>
                    <div className="text-sm text-white/90">
                      <StructuredIngredientInline
                        ingredients={displayIngredients}
                        stockMap={stockMap}
                        softUnavailableStyle
                      />
                    </div>
                  </div>
                )}
                {(meal.oven_temp || meal.oven_minutes) && (
                  <p className="text-sm text-white/80 mt-2 flex items-center gap-1"><Thermometer className="h-3.5 w-3.5" /> {meal.oven_temp && `${meal.oven_temp}°C`}{meal.oven_temp && meal.oven_minutes && ' · '}{meal.oven_minutes && `${meal.oven_minutes} min`}</p>
                )}
                {popupPm.day_of_week && popupPm.meal_time && (
                  <p className="text-xs text-white/50 mt-3">
                    {getDisplayDay(popupPm.day_of_week)} — {TIME_LABELS[popupPm.meal_time]}
                  </p>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Popup au double-clic sur le petit déjeuner */}
      <Dialog open={!!popupBreakfast} onOpenChange={(open) => { if (!open) setPopupBreakfast(null); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Détails du petit déjeuner</DialogTitle>
          {popupBreakfast && (() => {
            const meal = popupBreakfast.meal;
            const displayCal = getMealCal(meal);
            const displayPro = getMealPro(meal);
            return (
              <div className="rounded-2xl p-5 text-white" style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}>
                <h3 className="text-lg font-bold mb-2">🥐 {meal.name}</h3>
                <p className="text-[10px] text-white/60 mb-2 uppercase font-black tracking-widest">
                  {getDisplayDay(popupBreakfast.day)}
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {displayCal && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5" /> {displayCal} kcal
                    </span>
                  )}
                  {displayPro && (
                    <span className="text-sm font-bold bg-blue-600/50 px-2.5 py-1 rounded-full flex items-center gap-1">
                      🍗 {displayPro}g
                    </span>
                  )}
                  {meal.grams && (
                    <span className="text-sm bg-white/20 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Weight className="h-3.5 w-3.5" /> {meal.grams}
                    </span>
                  )}
                </div>
                {meal.ingredients && (
                  <div className="bg-black/20 rounded-xl p-3 mt-1">
                    <p className="text-xs font-semibold text-white/60 mb-1 uppercase tracking-wide">Ingrédients</p>
                    <div className="text-sm text-white/90">
                      <StructuredIngredientInline
                        ingredients={meal.ingredients}
                        stockMap={stockMap}
                        softUnavailableStyle
                      />
                    </div>
                  </div>
                )}
                {(meal.oven_temp || meal.oven_minutes) && (
                  <p className="text-sm text-white/80 mt-2 flex items-center gap-1"><Thermometer className="h-3.5 w-3.5" /> {meal.oven_temp && `${meal.oven_temp}°C`}{meal.oven_temp && meal.oven_minutes && ' · '}{meal.oven_minutes && `${meal.oven_minutes} min`}</p>
                )}
                <p className="text-xs text-white/50 mt-3">
                  {DAY_LABELS[popupBreakfast.day]}
                </p>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
