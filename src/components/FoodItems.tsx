/**
 * FoodItems — Gestion complète des aliments en stock.
 *
 * Ce fichier contient :
 * 1. Types et interfaces (StorageType, FoodType, FoodItem)
 * 2. FoodItemCard — Carte individuelle d'aliment avec édition inline de :
 *    nom, grammage (avec reste partiel), calories, protéines, fibres, quantité,
 *    péremption, compteur, type (viande/féculent), indivisible, is_meal
 * 3. FoodItems — Composant principal qui organise les aliments par section
 *    de stockage (Frigo, Placard sec, Surgelés, Extras, Toujours présent)
 *    avec formulaire d'ajout, tri, drag & drop, et recherche
 *
 * parseStoredGrams() / encodeStoredGramsFR() : gère le format "unité|reste"
 *   pour les aliments entamés (ex: "500|120" = 500g par unité, 120g restants)
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { z } from "zod";
import { Plus, Copy, Trash2, Timer, Flame, Weight, Calendar, ArrowUpDown, CalendarDays, Infinity as InfinityIcon, UtensilsCrossed, Refrigerator, Package, Snowflake, Hash, ChevronDown, ChevronRight, Minus, Search, Wheat, Drumstick, Lock, Scan, Cake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { colorFromName, computeCounterDays, computeCounterHours, formatFoodCounterStartTooltip, isExpiredDate, normalizeKey, parseQty } from "@/lib/ingredientUtils";
import { usePreferences } from "@/hooks/usePreferences";
import { useSortModes, FoodSortMode } from "@/hooks/useSortModes";
import { getSortedFoodItems } from "@/lib/foodSortUtils";
import { applyContainerReorderDrop } from "@/lib/listReorderDnD";
import {
  FOOD_EXTRAS_DIVIDER_PREF_KEY,
  extrasDividerMoveState,
  moveExtrasDividerDown,
  moveExtrasDividerUp,
  placeNewExtraAboveDivider,
  resolveExtrasDividerAfterId,
  splitSortedExtrasByDivider,
  syncLocalExtrasDividerBackup,
} from "@/lib/extrasDividerUtils";
import { useExtrasDividerRecovery } from "@/hooks/useExtrasDividerRecovery";
import { ExtrasMovableDivider } from "@/components/planning/ExtrasMovableDivider";
import { getFoodItemDefaultTotalGrams, resolveFoodItemBaselineTotalGrams, parseMacroDisplay } from "@/lib/stockUtils";
import { resolveFoodItemCounterStartForDisplay, useMealTransfers } from "@/hooks/useMealTransfers";
import { useFoodItems, type StorageType, type FoodType, type FoodItem } from "@/hooks/useFoodItems";
import { useProgCounterReconcile } from "@/hooks/useProgCounterReconcile";
import {
  markFoodCounterManuallyStarted,
  markFoodCounterManuallyStopped,
} from "@/lib/counters/manualCounterOverrides";
import {
  MASTER_SOURCE_PM_IDS_PREF_KEY,
  filterStockAffectingPossibleMeals,
} from "@/lib/masterSourcePossibleMeals";
import { DESSERT_FOOD_PREF_KEY, DESSERT_FOOD_NAME_KEYS_PREF_KEY, addDessertFoodNameKey, removeDessertFoodNameKey, shouldMarkNewFoodAsDessert, reconcileDessertFoodPreferences } from "@/lib/foodDessertUtils";
import type { PossibleMeal } from "@/hooks/useMeals";
import { useMeals } from "@/hooks/useMeals";
import { useFoodLibrary, type FoodLibraryEntry } from "@/hooks/useFoodLibrary";
import { lookupFoodTypeMemory } from "@/lib/foodTypeUtils";
import { BarcodeScanner } from "./BarcodeScanner";
import MaxMealGenerator from "@/components/MaxMealGenerator";
import {
  upsertFoodItemMacroLibraryItem,
  computeFoodItemPortionMacros,
  type IngredientMacroAutofillSources,
  type IngredientMacroLibraryItem,
  type FoodItemPortionMacros,
} from "@/domain/macros/ingredientMacroDatabase";
import { NutritionScoreBadge } from "@/components/NutritionScoreBadge";
import {
  getIngredientMacroNutritionScore,
  getIngredientMacroNutritionScoreRaw,
} from "@/lib/nutritionScore";
import { resolveFoodItemSatietyOptions } from "@/lib/satietyIndex";

export { colorFromName };

// ─── Types ──────────────────────────────────────────────────────────────────
// Source unique de vérité pour les types : @/hooks/useFoodItems
export type { StorageType, FoodType, FoodItem } from "@/hooks/useFoodItems";

// ─── Colors ─────────────────────────────────────────────────────────────────
// colorFromName est importé depuis ingredientUtils (→ foodColors) et ré-exporté ci-dessus

/** Formate un nombre pour l'affichage avec virgule décimale (notation FR) */
function formatNumericFR(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return String(Math.trunc(rounded));
  return String(rounded).replace(/\.0$/, "").replace(".", ",");
}

/** Décode la chaîne stockée « unité|reste » (aliment entamé) vers des nombres. */
function parseStoredGrams(raw: string | null | undefined): { unit: number | null; remainder: number | null } {
  if (!raw) return { unit: null, remainder: null };
  const [base, partial] = raw.split("|");
  const parse = (v?: string) => {
    if (!v) return null;
    const normalized = v.replace(",", ".");
    const m = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const num = parseFloat(m[0]);
    return isNaN(num) ? null : num;
  };
  const unit = parse(base);
  const remainder = parse(partial);
  if (unit === null) return { unit: null, remainder: null };
  if (remainder === null || remainder <= 0 || remainder >= unit) return { unit, remainder: null };
  return { unit, remainder };
}

/** Encode unité et reste partiel au format français stocké en base (« 500|120 »). */
function encodeStoredGramsFR(unit: number, remainder: number | null): string {
  const unitText = formatNumericFR(unit);
  if (!remainder || remainder <= 0 || remainder >= unit) return unitText;
  return `${unitText}|${formatNumericFR(remainder)}`;
}

/** Indique si une macro doit être affichée sur la carte Aliment, en masquant la valeur exacte "0". */
function isVisibleFoodMacro(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed && trimmed !== "0");
}

type FoodMacroField = "calories" | "protein" | "fiber";
type FoodManualMacroFields = Record<string, Partial<Record<FoodMacroField, boolean>>>;

// Indique si une macro doit être visible sur la carte Aliment (valeur saisie depuis l'onglet Aliment).
function isManualFoodMacroVisible(
  item: FoodItem,
  field: FoodMacroField,
  manualMacroFields: FoodManualMacroFields,
): boolean {
  const value = field === "calories" ? item.calories : field === "protein" ? item.protein : item.fiber;
  return Boolean(manualMacroFields[item.id]?.[field]) && isVisibleFoodMacro(value);
}

// isExpiredDate est importé depuis @/lib/ingredientUtils

// ─── FoodItemCard ────────────────────────────────────────────────────────────

interface FoodItemCardProps {
  item: FoodItem;
  possibleMeals: PossibleMeal[];
  baselineTotalGrams?: number | null;
  /** Quantité d'origine à l'ajout (détecte un prélèvement unitaire sans grammes). */
  baselineQuantity?: number | null;
  onUpdate: (updates: Partial<FoodItem>) => void;
  manualMacroFields: FoodManualMacroFields;
  isMorningMeal: boolean;
  isDessertFood: boolean;
  onCycleMealMode: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveToExtras?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  draggableEnabled?: boolean;
  /** Macros recalculées (Macro / catalogue) pour un aliment-repas dont la fiche est vide. */
  computedPortionMacros?: FoodItemPortionMacros | null;
}

/** Carte d’un aliment : édition inline, péremption, compteur, glisser-déposer. */
function FoodItemCard({ item, possibleMeals, baselineTotalGrams, baselineQuantity, onUpdate, manualMacroFields, isMorningMeal, isDessertFood, onCycleMealMode, onDelete, onDuplicate, onMoveToExtras, onDragStart, onDragOver, onDrop, draggableEnabled = true, computedPortionMacros }: FoodItemCardProps) {
  const color = colorFromName(item.name);
  const [editing, setEditing] = useState<"name" | "grams" | "calories" | "protein" | "fiber" | "quantity" | "partial" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [calOpen, setCalOpen] = useState(false);

  const gramsData = parseStoredGrams(item.grams);
  const displayDefaultGrams = gramsData.unit !== null ? `${formatNumericFR(gramsData.unit)}g` : item.grams;

  const effectiveCounterStart = resolveFoodItemCounterStartForDisplay(
    item,
    possibleMeals,
    undefined,
    baselineTotalGrams,
    baselineQuantity,
  );
  const isFuture = effectiveCounterStart ? new Date(effectiveCounterStart) > new Date() : false;
  const counterDays = computeCounterDays(effectiveCounterStart);
  const counterHours = computeCounterHours(effectiveCounterStart);
  // Infobulle du badge Timer : date/heure de démarrage (+ heures écoulées).
  const counterBadgeTitle = effectiveCounterStart
    ? `${formatFoodCounterStartTooltip(effectiveCounterStart)}${counterHours !== null && !isFuture ? ` · ${counterHours}h écoulées` : ''}`
    : undefined;
  const counterUrgent = counterDays !== null && counterDays >= 3;
  const expired = isExpiredDate(item.expiration_date);
  const expIsToday = item.expiration_date ? (() => {
    const d = new Date(item.expiration_date!);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  })() : false;
  const effectiveQty = item.quantity === 1 ? null : item.quantity;
  const displayPartialGrams = gramsData.remainder !== null ? `${formatNumericFR(gramsData.remainder)}g` : null;
  const canEditPartial = !item.is_infinite && gramsData.unit !== null && (effectiveQty ? effectiveQty > 1 : true);
  const showPartialLabel = gramsData.remainder !== null;
  const showCalories = isManualFoodMacroVisible(item, "calories", manualMacroFields);
  const showProtein = isManualFoodMacroVisible(item, "protein", manualMacroFields);
  const showFiber = isManualFoodMacroVisible(item, "fiber", manualMacroFields);
  const computedCal = computedPortionMacros?.calories?.trim() || null;
  const computedPro = computedPortionMacros?.protein?.trim() || null;
  const computedFiber = computedPortionMacros?.fiber?.trim() || null;
  const calorieBadge = showCalories ? item.calories : (item.is_meal ? computedCal : null);
  const proteinBadge = showProtein ? item.protein : (item.is_meal ? computedPro : null);
  const fiberBadge = showFiber ? item.fiber : (item.is_meal ? computedFiber : null);

  // Indique si la prochaine version simulée de l'aliment est entièrement scellée
  // (aucune unité entamée). Utilisé pour arrêter automatiquement les compteurs.
  const isNextStateFullySealed = (nextGrams: string | null | undefined, nextQuantity: number | null | undefined): boolean => {
    if (!nextGrams) return true;
    const parsed = parseStoredGrams(nextGrams);
    if (parsed.unit === null || parsed.unit <= 0) return true;
    if (parsed.remainder !== null && parsed.remainder > 0 && parsed.remainder < parsed.unit) return false;
    const q = nextQuantity ?? 1;
    return q >= 0;
  };

  // Décide si on doit nettoyer le compteur lors d'une édition manuelle :
  // - L'aliment possède un compteur actuellement actif (passé, non programmé)
  // - L'état projeté après édition est entièrement scellé
  const counterShouldStop = (nextGrams: string | null | undefined, nextQuantity: number | null | undefined): boolean => {
    if (!item.counter_start_date) return false;
    if (new Date(item.counter_start_date).getTime() > Date.now()) return false;
    return isNextStateFullySealed(nextGrams, nextQuantity);
  };

  /** Arrête le compteur affiché (badge / Stop) et bloque le force-start auto en session. */
  const stopDisplayedCounter = () => {
    markFoodCounterManuallyStopped(item.id);
    onUpdate({ counter_start_date: null });
  };

  /** Démarre un compteur manuel maintenant (honore aussi les lots encore scellés). */
  const startManualCounter = () => {
    markFoodCounterManuallyStarted(item.id);
    onUpdate({ counter_start_date: new Date().toISOString() });
  };

  /** Bascule Compteur ↔ Stop selon l'état réellement affiché (pas seulement la DB). */
  const toggleManualCounter = () => {
    if (effectiveCounterStart) stopDisplayedCounter();
    else startManualCounter();
  };

  const saveEdit = () => {
    const val = editValue.trim();
    if (editing === "name" && val) onUpdate({ name: val });
    if (editing === "grams") {
      const g = val || null;
      const clearCtr = counterShouldStop(g, item.quantity);
      onUpdate({
        grams: g,
        ...(!g ? { no_counter: true } : {}),
        ...(clearCtr ? { counter_start_date: null } : {}),
      });
    }
    if (editing === "calories") onUpdate({ calories: val || null });
    if (editing === "protein") onUpdate({ protein: val || null });
    if (editing === "fiber") onUpdate({ fiber: val || null });
    if (editing === "quantity") {
      const nextQty = val ? parseInt(val) || null : null;
      const clearCtr = counterShouldStop(item.grams, nextQty);
      onUpdate({
        quantity: nextQty,
        ...(clearCtr ? { counter_start_date: null } : {}),
      });
    }
    if (editing === "partial" && gramsData.unit !== null) {
      const applyPartialUpdate = (nextGrams: string) => {
        const clearCtr = counterShouldStop(nextGrams, item.quantity);
        onUpdate({
          grams: nextGrams,
          ...(clearCtr ? { counter_start_date: null } : {}),
        });
      };
      if (!val) {
        applyPartialUpdate(formatNumericFR(gramsData.unit));
      } else {
        const parsed = parseFloat(val.replace(",", "."));
        if (!isNaN(parsed) && parsed > 0) {
          if (parsed >= gramsData.unit) {
            applyPartialUpdate(formatNumericFR(gramsData.unit));
          } else {
            applyPartialUpdate(encodeStoredGramsFR(gramsData.unit, parsed));
          }
        }
      }
    }
    setEditing(null);
  };

  const startEdit = (field: "name" | "grams" | "calories" | "protein" | "fiber" | "quantity" | "partial") => {
    if (field === "quantity") {
      setEditValue(item.quantity ? String(item.quantity) : "");
    } else if (field === "grams") {
      setEditValue(gramsData.unit !== null ? formatNumericFR(gramsData.unit) : "");
    } else if (field === "calories") {
      setEditValue(item.calories ?? "");
    } else if (field === "protein") {
      setEditValue(item.protein ?? "");
    } else if (field === "fiber") {
      setEditValue(item.fiber ?? "");
    } else if (field === "partial") {
      setEditValue(gramsData.remainder !== null ? formatNumericFR(gramsData.remainder) : "");
    } else {
      setEditValue(item.name);
    }
    setEditing(field);
  };

  const selectedDate = item.expiration_date ? parseISO(item.expiration_date) : undefined;

  const handleGramsCycle = () => {
    if (item.is_infinite) {
      onUpdate({ is_infinite: false, grams: null });
    } else {
      startEdit("grams");
    }
  };

  const handleDecrementQuantity = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentQty = item.quantity ?? 1;
    const hasRemainder = gramsData.remainder !== null;

    if (hasRemainder) {
      if (currentQty <= 1) {
        onDelete();
      } else {
        // "Retire le reste": on finit l'unité en cours, donc -1 quantité et on reset le reste
        // On arrête aussi le compteur car l'unité ouverte est terminée.
        onUpdate({
          quantity: currentQty - 1,
          grams: gramsData.unit !== null ? formatNumericFR(gramsData.unit) : item.grams,
          counter_start_date: null
        });
      }
    } else {
      if (currentQty <= 1) {
        onDelete();
      } else {
        // Unité entière consommée, les suivantes sont scellées, donc on arrête le compteur
        onUpdate({ quantity: currentQty - 1, counter_start_date: null });
      }
    }
  };

  return (
    <div
      draggable={draggableEnabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex flex-col rounded-2xl px-3 py-2.5 shadow-md transition-all hover:scale-[1.01] hover:shadow-lg select-none cursor-grab active:cursor-grabbing overflow-hidden ${expired ? 'ring-2 ring-red-500 shadow-red-500/30 shadow-lg' : ''} ${expIsToday ? 'ring-2 ring-red-500 shadow-red-500/30 shadow-lg' : ''}`}
      style={{ backgroundColor: color }}
    >
      {/* Ligne 1 : nom à gauche, les options passent à la ligne 2 si nécessaire */}
      <div className="flex flex-wrap items-start gap-1.5 min-w-0">
        {/* Gauche : nom + saisies de texte */}
        <div className="min-w-0 flex-shrink-0" style={{ maxWidth: '100%' }}>
          {editing === "name" ? (
            <Input
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={e => e.key === "Enter" && saveEdit()}
              className="h-7 w-full border-white/30 bg-white/20 text-white placeholder:text-white/60 text-sm min-w-0"
            />
          ) : (
            <button
              onClick={() => startEdit("name")}
              className="font-semibold text-white text-sm text-left hover:underline decoration-white/40 min-w-0 break-words whitespace-normal"
            >
              {item.name}
            </button>
          )}
        </div>

        {/* Droite : tous les badges d'options - passent à la ligne suivante si le titre est trop long */}
        <div className="flex items-center gap-1 flex-wrap justify-end ml-auto min-w-0">
          {/* Badge de compteur actif (clic = Stop) — visible seulement si un compteur est affiché */}
          {counterDays !== null && (
            <button
              onClick={stopDisplayedCounter}
              className={`text-[11px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5 border shrink-0 transition-all ${counterUrgent ? 'bg-red-600 text-white border-red-300 shadow-md animate-pulse' : 'bg-black/40 text-white border-white/30'}`}
              title={counterBadgeTitle ? `${counterBadgeTitle} · cliquer pour arrêter` : 'Arrêter le compteur'}
            >
              <Timer className="h-2.5 w-2.5" />{counterDays}j
            </button>
          )}

          {/* Quantité */}
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
          ) : item.quantity && item.quantity >= 1 ? (
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

          {/* Grammes / Infini */}
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
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={handleGramsCycle}
                className="text-[10px] text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30"
                title="Modifier les grammes"
              >
                <Weight className="h-2.5 w-2.5" />{displayDefaultGrams}
              </button>
              {/* Reste — en ligne à côté des grammes */}
              {canEditPartial && (
                editing === "partial" ? (
                  <Input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={e => e.key === "Enter" && saveEdit()}
                    placeholder="Reste"
                    inputMode="decimal"
                    className="h-6 w-16 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1"
                  />
                ) : showPartialLabel ? (
                  <button
                    onClick={() => startEdit("partial")}
                    className="text-[10px] text-white bg-yellow-500/40 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-yellow-500/50 font-semibold"
                    title="Modifier le reste de la dernière quantité"
                  >
                    →{displayPartialGrams}
                  </button>
                ) : (
                  <button
                    onClick={() => startEdit("partial")}
                    className="text-[10px] text-white/50 bg-white/10 hover:bg-white/20 px-1 py-0.5 rounded-full"
                    title="Indiquer un reste partiel"
                  >
                    ✎
                  </button>
                )
              )}
            </div>
          ) : null}

          {/* Calories */}
          {editing === "calories" ? (
            <Input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key === "Enter" && saveEdit()} placeholder="Ex: 200 kcal" className="h-6 w-24 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5" />
          ) : calorieBadge ? (
            <button onClick={() => startEdit("calories")} className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30 shrink-0 ${showCalories ? "text-white/70 bg-white/20" : "text-white font-bold bg-orange-500/50 hover:bg-orange-500/60"}`}>
              <Flame className="h-2.5 w-2.5" />{calorieBadge}
            </button>
          ) : null}

          {/* Protéines */}
          {editing === "protein" ? (
            <Input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key === "Enter" && saveEdit()} placeholder="Ex: 25" inputMode="numeric" className="h-6 w-16 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5" />
          ) : proteinBadge ? (
            <button onClick={() => startEdit("protein")} className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 font-semibold ${showProtein ? "text-white/70 bg-blue-500/30 hover:bg-blue-500/40" : "text-white bg-blue-600/60 hover:bg-blue-600/70"}`}>
              🍗 {Math.round(parseFloat(String(proteinBadge).replace(',', '.')) || 0)}
            </button>
          ) : null}

          {/* Fibres */}
          {editing === "fiber" ? (
            <Input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key === "Enter" && saveEdit()} placeholder="Ex: 8" inputMode="decimal" className="h-6 w-16 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5" />
          ) : fiberBadge ? (
            <button onClick={() => startEdit("fiber")} className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 font-semibold ${showFiber ? "text-white/70 bg-emerald-500/30 hover:bg-emerald-500/40" : "text-white bg-emerald-600/60 hover:bg-emerald-600/70"}`}>
              🌾 {Math.round(parseFloat(String(fiberBadge).replace(',', '.')) || 0)}
            </button>
          ) : null}

          {/* Bascule Indivisible */}
          {item.grams && !item.is_infinite && (
            <button
              onClick={() => onUpdate({ is_indivisible: !item.is_indivisible })}
              className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${item.is_indivisible ? 'bg-orange-400/30 text-orange-200 border-orange-400/50 font-bold' : 'bg-white/10 text-white/50 border-white/20'}`}
              title={item.is_indivisible ? "Indivisible (cliquer pour désactiver)" : "Marquer comme indivisible (grammage entier obligatoire)"}
            >
              <Lock className="h-2.5 w-2.5" />{item.is_indivisible ? 'Indiv.' : ''}
            </button>
          )}

          {/* Bascule repas : off -> repas entier -> repas matin -> dessert -> off */}
          <button
            onClick={onCycleMealMode}
            className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${isMorningMeal
              ? 'bg-sky-400/30 text-sky-100 border-sky-400/60 font-bold'
              : isDessertFood
                ? 'bg-fuchsia-400/30 text-fuchsia-100 border-fuchsia-400/60 font-bold'
              : item.is_meal
                ? 'bg-white/30 text-white border-white/50 font-bold'
                : 'bg-white/10 text-white/50 border-white/20'
              }`}
            title={isMorningMeal
              ? "Repas matin (cliquer pour passer en dessert)"
              : isDessertFood
                ? "Dessert planning (cliquer pour désactiver)"
                : item.is_meal
                  ? "Repas entier (cliquer: Repas matin)"
                  : "Marquer comme repas à part entière"}
          >
            {isDessertFood ? <Cake className="h-2.5 w-2.5" /> : <UtensilsCrossed className="h-2.5 w-2.5" />}
            {isMorningMeal ? 'Matin' : isDessertFood ? 'Dessert' : item.is_meal ? 'Repas' : ''}
          </button>

          {/* Bascule food_type : cycle null -> féculent -> viande -> null */}
          <button
            onClick={() => {
              const next = item.food_type === null ? 'feculent' : item.food_type === 'feculent' ? 'viande' : null;
              onUpdate({ food_type: next });
            }}
            className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${item.food_type === 'feculent' ? 'bg-amber-400/30 text-amber-200 border-amber-400/50 font-bold'
              : item.food_type === 'viande' ? 'bg-red-400/30 text-red-200 border-red-400/50 font-bold'
                : 'bg-white/10 text-white/50 border-white/20'
              }`}
            title={item.food_type === 'feculent' ? 'Féculent (cliquer: Viande)' : item.food_type === 'viande' ? 'Viande (cliquer: Aucun)' : 'Aucun type (cliquer: Féculent)'}
          >
            {item.food_type === 'viande' ? <Drumstick className="h-2.5 w-2.5" /> : <Wheat className="h-2.5 w-2.5" />}
            {item.food_type === 'feculent' ? 'Féc' : item.food_type === 'viande' ? 'Via' : ''}
          </button>

          <Button size="icon" variant="ghost" onClick={onDuplicate} className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/20" title="Dupliquer">
            <Copy className="h-3 w-3" />
          </Button>
          {onMoveToExtras && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onMoveToExtras}
              className="h-6 px-2 shrink-0 text-[10px] text-white/80 hover:text-white hover:bg-white/20"
              title="Déplacer vers Extras"
            >
              Vers Extras
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={onDelete} className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/20" title="Supprimer">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Ligne 2 : ajout rapide + péremption + compteur + reste */}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {(!item.quantity || item.quantity < 1) && editing !== "quantity" && (
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
        {!showCalories && !calorieBadge && editing !== "calories" && (
          <button onClick={() => startEdit("calories")} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Flame className="h-2.5 w-2.5" />+ calories
          </button>
        )}
        {!showProtein && !proteinBadge && editing !== "protein" && (
          <button onClick={() => startEdit("protein")} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            🍗 + protéines
          </button>
        )}
        {!showFiber && !fiberBadge && editing !== "fiber" && (
          <button onClick={() => startEdit("fiber")} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            🌾 + fibres
          </button>
        )}

        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button className={`h-5 min-w-[88px] border bg-white/10 text-white text-[10px] px-1.5 rounded-md flex items-center gap-0.5 hover:bg-white/20 transition-colors ${expIsToday ? 'border-red-500 ring-1 ring-red-500 text-red-200 font-bold' : expired ? 'border-red-500/60 bg-red-500/20 text-red-200 font-bold animate-pulse' : 'border-white/20'
              }`}>
              <Calendar className="h-2.5 w-2.5 shrink-0" />
              {item.expiration_date
                ? (expired ? '⚠️ ' : '') + format(parseISO(item.expiration_date), 'd MMM yy', { locale: fr })
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

        {/* Contrôles manuels du compteur : forcer lancement ou arrêt */}
        {effectiveCounterStart ? (
          <div className="inline-flex items-center gap-0.5">
            {isFuture && (
              <button
                type="button"
                onClick={startManualCounter}
                className="text-[10px] text-emerald-300 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 font-medium transition-colors"
                title="Forcer le lancement immédiat du compteur (ouvert maintenant)"
              >
                <Timer className="h-2.5 w-2.5" />
                Lancer
              </button>
            )}
            <button
              type="button"
              onClick={stopDisplayedCounter}
              className="text-[10px] text-rose-300 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 font-medium transition-colors"
              title={isFuture ? "Annuler le compteur programmé" : `Forcer l'arrêt du compteur${counterHours !== null ? ` (${counterHours}h écoulées)` : ''}`}
            >
              <Timer className="h-2.5 w-2.5" />
              Stop
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startManualCounter}
            className="text-[10px] text-white/50 bg-white/10 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/40 border border-white/10 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 transition-colors"
            title="Forcer le lancement du compteur (démarrer maintenant)"
          >
            <Timer className="h-2.5 w-2.5" />
            Compteur
          </button>
        )}

        {/* Bascule No-counter (logique de compteur automatique) */}
        {(() => {
          const isGrams = !!item.grams;
          const isInfinite = !!item.is_infinite;
          if (isInfinite) return null;

          const counterEffectivelyDisabled = item.no_counter;
          // For quantitative-only items, we "enable" (default is off). 
          // For grams items, we "disable" (default is on).
          const isHighlighted = isGrams ? counterEffectivelyDisabled : !counterEffectivelyDisabled;

          return (
            <button
              onClick={() => onUpdate({ no_counter: !item.no_counter })}
              className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${isHighlighted
                ? 'bg-cyan-400/30 text-cyan-200 border-cyan-400/50 font-bold'
                : 'bg-white/10 text-white/50 border-white/20'
                }`}
              title={isGrams
                ? (counterEffectivelyDisabled ? 'Compteur auto désactivé (cliquer pour activer)' : 'Désactiver le compteur automatique')
                : (counterEffectivelyDisabled ? 'Activer le compteur automatique' : 'Compteur auto activé (cliquer pour désactiver)')
              }
            >
              <Timer className="h-2.5 w-2.5" />
              {isGrams ? '⏱✗' : (counterEffectivelyDisabled ? '⏱' : '⏱✓')}
            </button>
          );
        })()}

      </div>
    </div>
  );
}

// ─── Validation schema ───────────────────────────────────────────────────────
const foodItemSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(100, "Nom trop long (100 car. max)"),
});

const FOOD_LIBRARY_AMOUNT_PREF_KEY = "food_library_amounts";
const INGREDIENT_MACRO_LIBRARY_PREF_KEY = "ingredient_macro_library";
const INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY = "ingredient_macro_unit_grams";

type FoodLibraryAmountMemory = Record<string, { grams: string; quantity?: string; is_indivisible?: boolean }>;

/** Retourne la clé stable utilisée pour mémoriser la valeur initiale d'un aliment saisi. */
function getFoodLibraryAmountKey(name: string): string {
  return normalizeKey(name);
}

/** Prépare la valeur initiale stockée : quantité et grammes ensemble, plus l'option indivisible. */
function buildFoodLibraryAmountMemory(
  quantity: string | number | null | undefined,
  grams: string | null | undefined,
  isIndivisible?: boolean,
) {
  const initialGrams = (grams || "").trim();
  const initialQuantity = quantity == null ? "" : String(quantity).trim();
  return {
    grams: initialGrams,
    quantity: initialQuantity,
    ...(isIndivisible !== undefined ? { is_indivisible: isIndivisible } : {}),
  };
}

/** Affiche la valeur mémorisée d'une suggestion : quantité et grammes si les deux existent. */
function formatFoodLibraryAmountLabel(amount: { grams?: string; quantity?: string } | undefined): string | null {
  if (!amount) return null;
  const grams = (amount.grams || "").trim();
  const quantity = (amount.quantity || "").trim();
  const gramsLabel = grams ? (/[a-zA-Z]/.test(grams) ? grams : `${grams}g`) : "";
  const quantityLabel = quantity ? `x${quantity}` : "";
  if (quantityLabel && gramsLabel) return `${quantityLabel} · ${gramsLabel}`;
  if (gramsLabel) return gramsLabel;
  if (quantityLabel) return quantityLabel;
  return null;
}

// ─── Main component ──────────────────────────────────────────────────────────

type SortMode = "manual" | "expiration";

const STORAGE_SECTIONS: { type: StorageType; label: string; emoji: React.ReactNode }[] = [
  { type: 'frigo', label: 'Frigo', emoji: <Refrigerator className="h-4 w-4 text-blue-400" /> },
  { type: 'sec', label: 'Placard sec', emoji: <Package className="h-4 w-4 text-amber-500" /> },
  { type: 'surgele', label: 'Surgelés', emoji: <Snowflake className="h-4 w-4 text-cyan-400" /> },
  { type: 'extras', label: 'Extras', emoji: <span className="text-base">✨</span> },
  { type: 'toujours', label: 'Toujours présent', emoji: <span className="text-base">📌</span> },
];

const MORNING_MEAL_PREF_KEY = 'morning_meal_food_item_ids';
const FOOD_MANUAL_MACRO_FIELDS_PREF_KEY = 'food_manual_macro_fields';
/** Référence quantité/grammage enregistrée à l'ajout de chaque aliment (pour détecter entamé vs entier). */
const FOOD_STOCK_BASELINE_PREF_KEY = 'food_item_stock_baselines';

export type FoodStockBaseline = {
  quantity: number | null;
  grams: string | null;
  totalGrams: number;
};

/** Écran principal des aliments : sections de stockage, ajout, tri et recherche. */
export function FoodItems() {
  const { items, isLoading: itemsLoading, addItem, updateItem, deleteItem, duplicateItem, reorderItems } = useFoodItems();
  const { meals = [], possibleMeals = [] } = useMeals();
  const { reconcileMissedProgCounters } = useMealTransfers(items);
  const { library: foodTypeLibrary, searchLibrary, upsertEntry, deleteEntry } = useFoodLibrary();
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const {
    foodSortModes, sortDirections, toggleFoodSort, toggleSortDirection, resetFoodSortToManual
  } = useSortModes({ enabled: true });

  const { getPreference, setPreference, isLoading: prefsLoading } = usePreferences();
  const isLoading = itemsLoading || prefsLoading;
  // Cartes « Tous » : pas de déduction → exclues du calcul Prog. / badge Timer aliments.
  const masterSourcePmIds = getPreference<string[]>(MASTER_SOURCE_PM_IDS_PREF_KEY, []);
  const stockAffectingPossibleMeals = useMemo(
    () => filterStockAffectingPossibleMeals(possibleMeals, masterSourcePmIds),
    [possibleMeals, masterSourcePmIds],
  );
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["food_items"] });
  const morningMealFoodItemIds = getPreference<string[]>(MORNING_MEAL_PREF_KEY, []);
  const morningMealFoodItemIdSet = new Set(morningMealFoodItemIds);
  const dessertFoodItemIds = getPreference<string[]>(DESSERT_FOOD_PREF_KEY, []);
  const dessertFoodItemIdSet = new Set(dessertFoodItemIds);
  const dessertFoodNameKeys = getPreference<string[]>(DESSERT_FOOD_NAME_KEYS_PREF_KEY, []);
  const dessertExtraStockSnapshots = getPreference<Record<string, Record<string, FoodItem[][]>>>(
    'planning_dessert_extra_stock_snapshots',
    {},
  );

  /** Réaligne dessert (ids + noms) quand le stock change — recréation, suppression, etc. */
  useEffect(() => {
    if (isLoading || setPreference.isPending) return;
    const reconciled = reconcileDessertFoodPreferences(
      items,
      dessertFoodItemIds,
      dessertFoodNameKeys,
      dessertExtraStockSnapshots,
    );
    const nextDessertIds = JSON.stringify(reconciled.dessertIds);
    const currentDessertIds = JSON.stringify(dessertFoodItemIds);
    const nextNameKeys = JSON.stringify(reconciled.nameKeys);
    const currentNameKeys = JSON.stringify(dessertFoodNameKeys);
    if (nextDessertIds !== currentDessertIds) {
      setPreference.mutate({ key: DESSERT_FOOD_PREF_KEY, value: reconciled.dessertIds });
    }
    if (nextNameKeys !== currentNameKeys) {
      setPreference.mutate({ key: DESSERT_FOOD_NAME_KEYS_PREF_KEY, value: reconciled.nameKeys });
    }
  }, [dessertExtraStockSnapshots, dessertFoodItemIds, dessertFoodNameKeys, isLoading, items, setPreference]);
  const manualMacroFields = getPreference<FoodManualMacroFields>(FOOD_MANUAL_MACRO_FIELDS_PREF_KEY, {});
  const macroLibrary = getPreference<IngredientMacroLibraryItem[]>(INGREDIENT_MACRO_LIBRARY_PREF_KEY, []);
  const macroUnitGramsByKey = getPreference<Record<string, number>>(INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY, {});
  const mealMacroSources = useMemo<IngredientMacroAutofillSources>(
    () => ({
      foodItems: items,
      macroLibrary,
      mealMacros: new Map(),
      unitGramsByKey: macroUnitGramsByKey,
      catalogMeals: meals,
    }),
    [items, macroLibrary, macroUnitGramsByKey, meals],
  );

  const [newName, setNewName] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [newGrams, setNewGrams] = useState("");
  const [newCalories, setNewCalories] = useState("");
  const [newProtein, setNewProtein] = useState("");
  const [newFiber, setNewFiber] = useState("");
  const [newManualMacroFields, setNewManualMacroFields] = useState<Partial<Record<FoodMacroField, boolean>>>({});
  const [newFoodType, setNewFoodType] = useState<FoodType>(null);
  const [newIsIndivisible, setNewIsIndivisible] = useState(false);
  const [newMealMode, setNewMealMode] = useState<"off" | "repas" | "matin" | "dessert">("off");
  const [newExpiration, setNewExpiration] = useState<Date | undefined>(undefined);
  const [expCalOpen, setExpCalOpen] = useState(false);
  const [showStoragePrompt, setShowStoragePrompt] = useState(false);

  // Bibliothèque d'aliments — autocomplete
  const [suggestions, setSuggestions] = useState<FoodLibraryEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestedStorageType, setSuggestedStorageType] = useState<string | null>(null);
  const [suggestedIsMeal, setSuggestedIsMeal] = useState<boolean | null>(null);
  const [suggestedNoCounter, setSuggestedNoCounter] = useState<boolean | null>(null);
  const [suggestedIsIndivisible, setSuggestedIsIndivisible] = useState<boolean | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Synchroniser les mutations du hook useFoodItems localement
  const [pendingName, setPendingName] = useState("");
  const [pendingQuantity, setPendingQuantity] = useState("");
  const [pendingGrams, setPendingGrams] = useState("");
  const [pendingCalories, setPendingCalories] = useState("");
  const [pendingProtein, setPendingProtein] = useState("");
  const [pendingFiber, setPendingFiber] = useState("");
  const [pendingManualMacroFields, setPendingManualMacroFields] = useState<Partial<Record<FoodMacroField, boolean>>>({});
  const [pendingFoodType, setPendingFoodType] = useState<FoodType>(null);
  const [pendingIsIndivisible, setPendingIsIndivisible] = useState(false);
  const [pendingMealMode, setPendingMealMode] = useState<"off" | "repas" | "matin" | "dessert">("off");
  const [pendingExpiration, setPendingExpiration] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const newFoodScoreOptions = useMemo(
    () => resolveFoodItemSatietyOptions(newQuantity, newGrams, newFoodType),
    [newQuantity, newGrams, newFoodType],
  );

  const newFoodNutritionScore = useMemo(
    () =>
      getIngredientMacroNutritionScore(newCalories, newProtein, newFiber, newFoodScoreOptions),
    [newCalories, newProtein, newFiber, newFoodScoreOptions],
  );

  const newFoodNutritionScoreRaw = useMemo(
    () =>
      getIngredientMacroNutritionScoreRaw(newCalories, newProtein, newFiber, newFoodScoreOptions),
    [newCalories, newProtein, newFiber, newFoodScoreOptions],
  );

  const pendingFoodScoreOptions = useMemo(
    () => resolveFoodItemSatietyOptions(pendingQuantity, pendingGrams, pendingFoodType),
    [pendingQuantity, pendingGrams, pendingFoodType],
  );

  const pendingFoodNutritionScore = useMemo(
    () =>
      getIngredientMacroNutritionScore(
        pendingCalories,
        pendingProtein,
        pendingFiber,
        pendingFoodScoreOptions,
      ),
    [pendingCalories, pendingProtein, pendingFiber, pendingFoodScoreOptions],
  );

  const pendingFoodNutritionScoreRaw = useMemo(
    () =>
      getIngredientMacroNutritionScoreRaw(
        pendingCalories,
        pendingProtein,
        pendingFiber,
        pendingFoodScoreOptions,
      ),
    [pendingCalories, pendingProtein, pendingFiber, pendingFoodScoreOptions],
  );

  const testItemIds = getPreference<string[]>("food_test_ids", []);
  const extrasDividerAfterId = getPreference<string | null>(FOOD_EXTRAS_DIVIDER_PREF_KEY, null);

  /** Persiste le trait extras (Supabase + miroir local pour recovery après incident). */
  const setExtrasDividerAfterId = useCallback(
    (id: string | null, sortedExtrasForMirror?: { id: string }[]) => {
      if (sortedExtrasForMirror && sortedExtrasForMirror.length > 0) {
        syncLocalExtrasDividerBackup(sortedExtrasForMirror, id);
      } else if (id) {
        // Fallback : au moins l’id, aboveCount inconnu → 0 (ne bloque pas une future recovery plus riche)
        syncLocalExtrasDividerBackup([{ id }], id);
      }
      setPreference.mutate({ key: FOOD_EXTRAS_DIVIDER_PREF_KEY, value: id });
    },
    [setPreference],
  );
  const testItemIdSet = new Set(testItemIds);
  const foodLibraryAmountMemory = getPreference<FoodLibraryAmountMemory>(FOOD_LIBRARY_AMOUNT_PREF_KEY, {});
  const foodStockBaselines = getPreference<Record<string, FoodStockBaseline>>(FOOD_STOCK_BASELINE_PREF_KEY, {});

  useProgCounterReconcile({
    isLoading,
    possibleMeals,
    foodItems: items,
    foodStockBaselines,
    masterSourcePmIds,
    reconcileMissedProgCounters,
  });

  /** Mémorise la première valeur de création et l'option indivisible pour les prochains ajouts du même aliment. */
  const rememberInitialFoodLibraryAmount = useCallback((
    name: string,
    quantity: string | number | null | undefined,
    grams: string | null | undefined,
    isIndivisible?: boolean,
  ) => {
    const key = getFoodLibraryAmountKey(name);
    if (!key) return;
    const current = getPreference<FoodLibraryAmountMemory>(FOOD_LIBRARY_AMOUNT_PREF_KEY, {});
    const existing = current[key];
    const nextAmount = buildFoodLibraryAmountMemory(quantity, grams, isIndivisible);
    const mergedAmount = {
      grams: (() => {
        const nextG = parseQty(nextAmount.grams);
        const prevG = parseQty(existing?.grams);
        const best = Math.max(nextG, prevG);
        return best > 0 ? String(best) : (nextAmount.grams || existing?.grams || "");
      })(),
      quantity: nextAmount.quantity || existing?.quantity || "",
      is_indivisible: nextAmount.is_indivisible ?? existing?.is_indivisible ?? false,
    };
    if (
      existing?.grams === mergedAmount.grams &&
      (existing?.quantity || "") === mergedAmount.quantity &&
      existing.is_indivisible === mergedAmount.is_indivisible
    ) return;
    setPreference.mutate({
      key: FOOD_LIBRARY_AMOUNT_PREF_KEY,
      value: {
        ...current,
        [key]: mergedAmount,
      },
    });
  }, [getPreference, setPreference]);

  /** Synchronise le référentiel Macro quand un aliment reçoit des macros nutritionnelles. */
  const syncFoodItemMacroLibrary = useCallback((name: string, calories: string | null | undefined, protein: string | null | undefined, fiber: string | null | undefined) => {
    const current = getPreference<IngredientMacroLibraryItem[]>(INGREDIENT_MACRO_LIBRARY_PREF_KEY, []);
    const next = upsertFoodItemMacroLibraryItem(current, name, calories, protein, fiber);
    if (next === current) return;
    setPreference.mutate({ key: INGREDIENT_MACRO_LIBRARY_PREF_KEY, value: next });
  }, [getPreference, setPreference]);

  /** Mémorise les macros explicitement saisies sur une fiche Aliment pour autoriser leur affichage. */
  const markManualFoodMacroFields = useCallback((id: string, updates: Partial<FoodItem>) => {
    const touchedFields: FoodMacroField[] = [];
    if (updates.calories !== undefined) touchedFields.push("calories");
    if (updates.protein !== undefined) touchedFields.push("protein");
    if (updates.fiber !== undefined) touchedFields.push("fiber");
    if (touchedFields.length === 0) return;

    const current = getPreference<FoodManualMacroFields>(FOOD_MANUAL_MACRO_FIELDS_PREF_KEY, {});
    const nextForItem = { ...(current[id] ?? {}) };
    for (const field of touchedFields) {
      const value = field === "calories" ? updates.calories : field === "protein" ? updates.protein : updates.fiber;
      if (isVisibleFoodMacro(value)) nextForItem[field] = true;
      else delete nextForItem[field];
    }

    const next = { ...current };
    if (Object.keys(nextForItem).length > 0) next[id] = nextForItem;
    else delete next[id];
    setPreference.mutate({ key: FOOD_MANUAL_MACRO_FIELDS_PREF_KEY, value: next });
  }, [getPreference, setPreference]);

  // Mise à jour des suggestions à chaque frappe ; pré-sélectionne le type mémorisé si le nom matche.
  const handleNameChange = useCallback((value: string) => {
    setNewName(value);
    if (value.trim().length >= 1) {
      const results = searchLibrary(value.trim());
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      const memorizedType = lookupFoodTypeMemory(value, foodTypeLibrary);
      if (memorizedType !== undefined) setNewFoodType(memorizedType);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [foodTypeLibrary, searchLibrary]);

  // Auto-fill au clic sur une suggestion
  const handleSelectSuggestion = useCallback((entry: FoodLibraryEntry) => {
    setNewName(entry.name);
    setNewFoodType(entry.food_type);
    setSuggestedStorageType(entry.storage_type);
    setSuggestedIsMeal(entry.is_meal);
    setSuggestedNoCounter(entry.no_counter);
    const amountKey = getFoodLibraryAmountKey(entry.name);
    const storedAmount = foodLibraryAmountMemory[amountKey];
    setNewGrams(storedAmount?.grams || "");
    setNewQuantity(storedAmount?.quantity || "");
    setNewIsIndivisible(storedAmount?.is_indivisible ?? false);
    setSuggestedIsIndivisible(storedAmount?.is_indivisible ?? null);
    if (shouldMarkNewFoodAsDessert(entry.name, dessertFoodNameKeys)) {
      setNewMealMode("dessert");
    } else if (entry.is_meal) {
      setNewMealMode("repas");
    } else {
      setNewMealMode("off");
    }
    if (entry.storage_type === "extras") {
      if (entry.calories) setNewCalories(entry.calories);
      if (entry.protein) setNewProtein(entry.protein);
      if (entry.fiber) setNewFiber(entry.fiber);
    }
    setNewManualMacroFields({});
    setSuggestions([]);
    setShowSuggestions(false);
    // Focus le champ suivant (quantité) pour fluidité
    setTimeout(() => {
      const qtyInput = document.querySelector<HTMLInputElement>('input[placeholder*="Quantité"]');
      qtyInput?.focus();
    }, 50);
  }, [dessertFoodNameKeys, foodLibraryAmountMemory]);

  /** Fait tourner le mode repas du formulaire de création. */
  const cycleNewMealMode = () => {
    setNewMealMode((prev) => {
      if (prev === "off") return "repas";
      if (prev === "repas") return "matin";
      if (prev === "matin") return "dessert";
      return "off";
    });
    setSuggestedIsMeal(null);
  };

  /** Met à jour un aliment en stock et synchronise la bibliothèque / macros. */
  const handleUpdate = useCallback((id: string, updates: Partial<FoodItem>) => {
    // 1. Mise à jour de l'aliment en stock
    updateItem.mutate({ id, ...updates });
    markManualFoodMacroFields(id, updates);

    // 2. Synchronisation avec la bibliothèque (Mémoire globale)
    const item = items.find(i => i.id === id);
    if (item && (
      updates.is_meal !== undefined ||
      updates.no_counter !== undefined ||
      updates.is_indivisible !== undefined ||
      updates.food_type !== undefined ||
      updates.storage_type !== undefined ||
      updates.calories !== undefined ||
      updates.protein !== undefined ||
      updates.fiber !== undefined
    )) {
      upsertEntry.mutate({
        name: item.name,
        food_type: updates.food_type !== undefined ? updates.food_type : item.food_type,
        storage_type: updates.storage_type !== undefined ? (updates.storage_type as any) : (item.storage_type as any),
        is_meal: updates.is_meal !== undefined ? updates.is_meal : item.is_meal,
        no_counter: updates.no_counter !== undefined ? updates.no_counter : item.no_counter,
        calories: updates.calories !== undefined ? updates.calories : item.calories,
        protein: updates.protein !== undefined ? updates.protein : item.protein,
        fiber: updates.fiber !== undefined ? updates.fiber : item.fiber,
      });
      if (updates.is_indivisible !== undefined) {
        rememberInitialFoodLibraryAmount(item.name, item.quantity, item.grams, updates.is_indivisible);
      }
    }
    if (item && (updates.name !== undefined || updates.calories !== undefined || updates.protein !== undefined || updates.fiber !== undefined)) {
      syncFoodItemMacroLibrary(
        updates.name !== undefined ? updates.name : item.name,
        updates.calories !== undefined ? updates.calories : item.calories,
        updates.protein !== undefined ? updates.protein : item.protein,
        updates.fiber !== undefined ? updates.fiber : item.fiber,
      );
    }
  }, [items, updateItem, markManualFoodMacroFields, upsertEntry, rememberInitialFoodLibraryAmount, syncFoodItemMacroLibrary]);

  /** Retire un aliment de la catégorie "repas matin" stockée en préférence. */
  const removeMorningMealId = useCallback((id: string) => {
    if (!morningMealFoodItemIdSet.has(id)) return;
    setPreference.mutate({
      key: MORNING_MEAL_PREF_KEY,
      value: morningMealFoodItemIds.filter((storedId) => storedId !== id),
    });
  }, [morningMealFoodItemIdSet, morningMealFoodItemIds, setPreference]);

  /** Retire l'id dessert et mémorise le nom si la fiche était en mode dessert (recréation future). */
  const detachDessertFoodId = useCallback((id: string, opts?: { rememberName?: string }) => {
    const wasDessert = dessertFoodItemIdSet.has(id);
    if (wasDessert) {
      setPreference.mutate({
        key: DESSERT_FOOD_PREF_KEY,
        value: dessertFoodItemIds.filter((storedId) => storedId !== id),
      });
    }
    if (opts?.rememberName && wasDessert) {
      const nextNameKeys = addDessertFoodNameKey(dessertFoodNameKeys, opts.rememberName);
      if (nextNameKeys.length !== dessertFoodNameKeys.length) {
        setPreference.mutate({ key: DESSERT_FOOD_NAME_KEYS_PREF_KEY, value: nextNameKeys });
      }
    }
  }, [dessertFoodItemIdSet, dessertFoodItemIds, dessertFoodNameKeys, setPreference]);

  /** Active le mode dessert sur une fiche et mémorise son nom pour les recréations futures. */
  const assignDessertFoodMode = useCallback((item: FoodItem) => {
    const nextIds = [...dessertFoodItemIds.filter((id) => id !== item.id), item.id];
    const nextNameKeys = addDessertFoodNameKey(dessertFoodNameKeys, item.name);
    setPreference.mutate({ key: DESSERT_FOOD_PREF_KEY, value: nextIds });
    if (nextNameKeys.length !== dessertFoodNameKeys.length) {
      setPreference.mutate({ key: DESSERT_FOOD_NAME_KEYS_PREF_KEY, value: nextNameKeys });
    }
  }, [dessertFoodItemIds, dessertFoodNameKeys, setPreference]);

  /** Désactive complètement le mode dessert (id + mémoire nom). */
  const clearDessertFoodMode = useCallback((item: FoodItem) => {
    if (!dessertFoodItemIdSet.has(item.id)) return;
    setPreference.mutate({
      key: DESSERT_FOOD_PREF_KEY,
      value: dessertFoodItemIds.filter((storedId) => storedId !== item.id),
    });
    const nextNameKeys = removeDessertFoodNameKey(dessertFoodNameKeys, item.name);
    if (nextNameKeys.length !== dessertFoodNameKeys.length) {
      setPreference.mutate({ key: DESSERT_FOOD_NAME_KEYS_PREF_KEY, value: nextNameKeys });
    }
  }, [dessertFoodItemIdSet, dessertFoodItemIds, dessertFoodNameKeys, setPreference]);

  /** @deprecated Alias pour FoodSection. */
  const removeDessertFoodId = (id: string) => detachDessertFoodId(id);

  /** Supprime une fiche aliment et conserve la mémoire dessert si besoin. */
  const handleDeleteFoodItem = useCallback((id: string) => {
    const deleted = items.find((item) => item.id === id);
    removeMorningMealId(id);
    if (deleted && dessertFoodItemIdSet.has(id)) {
      detachDessertFoodId(id, { rememberName: deleted.name });
    } else {
      detachDessertFoodId(id);
    }
    deleteItem.mutate(id);
  }, [deleteItem, dessertFoodItemIdSet, detachDessertFoodId, items, removeMorningMealId]);

  /** Fait tourner le mode repas : désactivé -> repas entier -> repas matin -> dessert -> désactivé. */
  const cycleMealMode = useCallback((item: FoodItem) => {
    const isMorningMeal = morningMealFoodItemIdSet.has(item.id);
    const isDessertFood = dessertFoodItemIdSet.has(item.id);

    if (!item.is_meal && !isMorningMeal && !isDessertFood) {
      handleUpdate(item.id, { is_meal: true });
      removeMorningMealId(item.id);
      detachDessertFoodId(item.id);
      return;
    }
    if (item.is_meal && !isMorningMeal && !isDessertFood) {
      setPreference.mutate({
        key: MORNING_MEAL_PREF_KEY,
        value: [...morningMealFoodItemIds.filter((id) => id !== item.id), item.id],
      });
      return;
    }
    if (isMorningMeal && !isDessertFood) {
      removeMorningMealId(item.id);
      assignDessertFoodMode(item);
      handleUpdate(item.id, { is_meal: false });
      return;
    }
    if (isDessertFood) {
      clearDessertFoodMode(item);
      handleUpdate(item.id, { is_meal: false });
      return;
    }
    handleUpdate(item.id, { is_meal: false });
    removeMorningMealId(item.id);
    detachDessertFoodId(item.id);
  }, [
    assignDessertFoodMode,
    clearDessertFoodMode,
    dessertFoodItemIdSet,
    detachDessertFoodId,
    handleUpdate,
    morningMealFoodItemIdSet,
    morningMealFoodItemIds,
    removeMorningMealId,
    setPreference,
  ]);

  // Fermer les suggestions quand on clique ailleurs
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
        nameInputRef.current && !nameInputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  /** Retourne les items triés d'une section, avec "test" géré comme sous-ensemble virtuel de extras. */
  const getSortedItems = (storageType: StorageType): FoodItem[] => {
    let sectionItems: FoodItem[] = [];
    if (storageType === "test") {
      sectionItems = items.filter((i) => i.storage_type === "extras" && testItemIdSet.has(i.id));
    } else if (storageType === "extras") {
      sectionItems = items.filter((i) => i.storage_type === "extras" && !testItemIdSet.has(i.id));
    } else {
      sectionItems = items.filter((i) => i.storage_type === storageType);
    }
    const mode = foodSortModes[storageType] || "manual";
    const asc = sortDirections[`food-${storageType}`] !== false; // default to true (ascending)

    // Aligne le départage compteur sur le badge Timer (ignore les counter_start_date orphelins).
    return getSortedFoodItems(sectionItems, mode, asc, searchQuery, (fi) =>
      resolveFoodItemCounterStartForDisplay(
        fi,
        stockAffectingPossibleMeals,
        undefined,
        resolveFoodItemBaselineTotalGrams(
          fi,
          foodStockBaselines[fi.id],
          parseQty(foodLibraryAmountMemory[getFoodLibraryAmountKey(fi.name)]?.grams) || null,
        ),
        foodStockBaselines[fi.id]?.quantity ?? null,
      ),
    );
  };

  const sortedExtrasForDivider = useMemo(
    () => getSortedItems("extras"),
    // getSortedItems dépend de items / tris / recherche / baselines
    // eslint-disable-next-line react-hooks/exhaustive-deps -- aligné sur le rendu liste extras
    [
      items,
      testItemIds,
      foodSortModes,
      sortDirections,
      searchQuery,
      stockAffectingPossibleMeals,
      foodStockBaselines,
      foodLibraryAmountMemory,
    ],
  );

  useExtrasDividerRecovery(
    sortedExtrasForDivider,
    extrasDividerAfterId,
    !isLoading && !prefsLoading,
    setPreference,
  );

  const handleAdd = () => {
    const result = foodItemSchema.safeParse({ name: newName });
    if (!result.success) {
      toast({ title: "Données invalides", description: result.error.issues[0].message, variant: "destructive" });
      return;
    }
    setPendingName(result.data.name);
    setPendingQuantity(newQuantity);
    setPendingGrams(newGrams);
    setPendingCalories(newCalories);
    setPendingProtein(newProtein);
    setPendingFiber(newFiber);
    setPendingManualMacroFields(newManualMacroFields);
    setPendingFoodType(newFoodType);
    setPendingIsIndivisible(newIsIndivisible);
    setPendingMealMode(newMealMode);
    setPendingExpiration(newExpiration ? format(newExpiration, 'yyyy-MM-dd') : null);
    setShowStoragePrompt(true);
  };

  const confirmAdd = (storageType: StorageType) => {
    const qty = pendingQuantity ? parseInt(pendingQuantity) || null : null;
    const grams = pendingGrams.trim() || null;
    const calories = pendingCalories.trim() || null;
    const protein = pendingProtein.trim() || null;
    const fiber = pendingFiber.trim() || null;
    const finalNoCounter = suggestedNoCounter !== null ? suggestedNoCounter : ((storageType === 'extras' || storageType === 'test') ? true : !grams);
    const finalIsMeal =
      pendingMealMode === "repas" || pendingMealMode === "matin"
        ? true
        : pendingMealMode === "dessert"
          ? false
          : (suggestedIsMeal !== null ? suggestedIsMeal : false);
    const finalIsIndivisible = Boolean(grams) && pendingIsIndivisible;
    const persistedStorageType: StorageType = storageType === "test" ? "extras" : storageType;

    addItem.mutate({
      name: pendingName,
      storage_type: persistedStorageType,
      quantity: qty,
      grams,
      food_type: pendingFoodType,
      expiration_date: pendingExpiration,
      calories,
      protein,
      fiber,
      is_meal: finalIsMeal,
      no_counter: finalNoCounter,
      is_indivisible: finalIsIndivisible,
    }, {
      onSuccess: (created: any) => {
        // Sauvegarder dans la bibliothèque pour auto-complétion future
        upsertEntry.mutate({
          name: pendingName,
          food_type: pendingFoodType,
          is_meal: finalIsMeal || pendingMealMode === "dessert",
          no_counter: finalNoCounter,
          storage_type: persistedStorageType,
          calories,
          protein,
          fiber,
        });
        rememberInitialFoodLibraryAmount(pendingName, pendingQuantity, grams, finalIsIndivisible);
        syncFoodItemMacroLibrary(pendingName, calories, protein, fiber);
        if (created?.id) {
          const updates: Partial<FoodItem> = {};
          if (pendingManualMacroFields.calories) updates.calories = calories;
          if (pendingManualMacroFields.protein) updates.protein = protein;
          if (pendingManualMacroFields.fiber) updates.fiber = fiber;
          markManualFoodMacroFields(created.id, updates);
          const createdFood = {
            ...(created as FoodItem),
            id: created.id,
            name: pendingName,
          };
          if (pendingMealMode === "matin") {
            setPreference.mutate({
              key: MORNING_MEAL_PREF_KEY,
              value: [...morningMealFoodItemIds.filter((id) => id !== created.id), created.id],
            });
          } else if (pendingMealMode === "dessert") {
            assignDessertFoodMode(createdFood);
          } else if (pendingMealMode === "off" && shouldMarkNewFoodAsDessert(pendingName, dessertFoodNameKeys)) {
            assignDessertFoodMode(createdFood);
          }
          const baselineFi = {
            id: created.id,
            name: pendingName,
            grams,
            quantity: qty,
          } as FoodItem;
          setPreference.mutate({
            key: FOOD_STOCK_BASELINE_PREF_KEY,
            value: {
              ...foodStockBaselines,
              [created.id]: {
                quantity: qty,
                grams,
                totalGrams: getFoodItemDefaultTotalGrams(baselineFi),
              },
            },
          });
        }
        if (storageType === "test" && created?.id) {
          setPreference.mutate({ key: "food_test_ids", value: Array.from(new Set([...testItemIds, created.id])) });
        }
        // Nouvel extra (hors Test) : placé juste au-dessus du trait par défaut.
        if (persistedStorageType === "extras" && storageType !== "test" && created?.id) {
          const currentExtras = getSortedItems("extras").filter((fi) => fi.id !== created.id);
          const { ordered, nextDividerAfterId } = placeNewExtraAboveDivider(
            currentExtras,
            { id: created.id },
            extrasDividerAfterId,
          );
          reorderItems.mutate(ordered.map((item, i) => ({ id: item.id, sort_order: i })));
          setExtrasDividerAfterId(nextDividerAfterId, ordered);
          resetFoodSortToManual("extras");
        }
        setNewName(""); setNewQuantity(""); setNewGrams(""); setNewCalories(""); setNewProtein(""); setNewFiber(""); setNewManualMacroFields({}); setNewFoodType(null); setNewIsIndivisible(false); setNewMealMode("off"); setNewExpiration(undefined);
        setPendingName(""); setPendingQuantity(""); setPendingGrams(""); setPendingCalories(""); setPendingProtein(""); setPendingFiber(""); setPendingManualMacroFields({}); setPendingFoodType(null); setPendingIsIndivisible(false); setPendingMealMode("off"); setPendingExpiration(null);
        setSuggestedStorageType(null); setSuggestedIsMeal(null); setSuggestedNoCounter(null); setSuggestedIsIndivisible(null);
        setShowStoragePrompt(false); toast({ title: "Aliment ajouté 🥕", duration: 800 });
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast({ title: "Erreur lors de l'ajout", description: msg, variant: "destructive" });
      },
    });
  };

  const handleDuplicate = useCallback((id: string) => {
    const source = items.find((item) => item.id === id);
    const sourceWasDessert = source ? dessertFoodItemIdSet.has(source.id) : false;
    duplicateItem.mutate(id, {
      onSuccess: (result) => {
        if (result?.newId && sourceWasDessert && source) {
          assignDessertFoodMode({ ...source, id: result.newId });
        }
      },
    });
  }, [assignDessertFoodMode, dessertFoodItemIdSet, duplicateItem, items]);

  const handleReorder = (storageType: StorageType, fromIndex: number, toIndex: number) => {
    const sectionItems = getSortedItems(storageType);
    const reordered = [...sectionItems];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    reorderItems.mutate(reordered.map((item, i) => ({ id: item.id, sort_order: i })));
    resetFoodSortToManual(storageType);
  };

  /** Déplace un aliment de section en gérant la section virtuelle "test". */
  const handleChangeStorage = (id: string, st: StorageType) => {
    const nextSet = new Set(testItemIds);
    if (st === "test") {
      nextSet.add(id);
      setPreference.mutate({ key: "food_test_ids", value: Array.from(nextSet) });
      handleUpdate(id, { storage_type: "extras", is_dry: false });
      return;
    }
    if (nextSet.has(id)) {
      nextSet.delete(id);
      setPreference.mutate({ key: "food_test_ids", value: Array.from(nextSet) });
    }
    handleUpdate(id, { storage_type: st, is_dry: st === 'sec' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground animate-pulse">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Add form + search */}
      <div className="flex gap-2 mb-2 relative">
        {/* Input Nom avec Autocomplete */}
        <div className="flex-1">
          <Input
            ref={nameInputRef}
            placeholder="Nom de l'aliment (ex : Crème fraîche)"
            value={newName}
            onChange={e => handleNameChange(e.target.value)}
            onFocus={() => { if (newName.trim().length >= 1) { const r = searchLibrary(newName.trim()); setSuggestions(r); setShowSuggestions(true); } }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                setShowSuggestions(false);
                handleAdd();
              }
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            className="w-full rounded-xl"
            autoComplete="off"
          />
        </div>
        <div className="relative shrink-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Rechercher…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-28 sm:w-36 rounded-xl pl-7 h-10"
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            onClick={() => setIsScannerOpen(true)}
            variant="outline"
            className="rounded-full w-10 h-10 p-0 border-primary/20 text-primary hover:bg-primary/10 overflow-hidden relative group"
            title="Scanner un code-barres"
          >
            <div className="absolute inset-0 bg-primary/5 group-hover:bg-primary/10 transition-colors" />
            <Scan className="h-4 w-4 relative z-10" />
          </Button>
          <Button onClick={handleAdd} disabled={!newName.trim()} className="rounded-full gap-1 shrink-0 h-10 px-4">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Ajouter</span>
          </Button>
        </div>

        {/* Dropdown de suggestions (déplacé ici pour être plus large sur mobile) */}
        {showSuggestions && (
          <div
            ref={suggestionsRef}
            className="absolute z-[100] left-0 right-0 top-full mt-1 rounded-xl border border-white/20 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden"
          >
            <div className="max-h-64 overflow-y-auto custom-scrollbar">
              {suggestions.length === 0 ? (
                <div className="px-4 py-3 text-xs text-center text-muted-foreground italic">
                  Aucun résultat dans la bibliothèque
                </div>
              ) : (
                suggestions.map((entry) => {
                  const amountLabel = formatFoodLibraryAmountLabel(
                    foodLibraryAmountMemory[getFoodLibraryAmountKey(entry.name)],
                  );
                  return (
                    <div
                      key={entry.id}
                      className="w-full px-3 py-2 flex items-center gap-2 hover:bg-primary/10 transition-colors group border-b border-white/5 last:border-b-0"
                    >
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(entry); }}
                        className="flex-1 text-left flex items-center min-w-0"
                      >
                        <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate flex-1">
                          {entry.name}
                        </span>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          {amountLabel && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-bold">
                              {amountLabel}
                            </span>
                          )}
                          {entry.food_type === 'feculent' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30 font-bold flex items-center gap-0.5">
                              <Wheat className="h-2.5 w-2.5" />Féc
                            </span>
                          )}
                          {entry.food_type === 'viande' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-400/30 font-bold flex items-center gap-0.5">
                              <Drumstick className="h-2.5 w-2.5" />Via
                            </span>
                          )}
                          {entry.is_meal && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/20 text-white/80 border border-white/30 font-bold flex items-center gap-0.5">
                              <UtensilsCrossed className="h-2.5 w-2.5" />
                            </span>
                          )}
                          {foodLibraryAmountMemory[getFoodLibraryAmountKey(entry.name)]?.is_indivisible && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-400/30 font-bold flex items-center gap-0.5">
                              <Lock className="h-2.5 w-2.5" />Indiv.
                            </span>
                          )}
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 border border-white/15 flex items-center gap-0.5">
                            {entry.storage_type === 'frigo' && <Refrigerator className="h-2.5 w-2.5" />}
                            {entry.storage_type === 'sec' && <Package className="h-2.5 w-2.5" />}
                            {entry.storage_type === 'surgele' && <Snowflake className="h-2.5 w-2.5" />}
                            {entry.storage_type === 'extras' && '✨'}
                            {entry.storage_type === 'toujours' && '📌'}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        deleteEntry.mutate(entry.id);
                        setSuggestions(prev => prev.filter(s => s.id !== entry.id));
                      }}
                      className="shrink-0 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                      title="Supprimer de la base de données"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    </div>
                  );
                })
              )}
              </div>
            </div>
          )}
        </div>

      {isScannerOpen && (
        <BarcodeScanner
          onClose={() => setIsScannerOpen(false)}
          onScanSuccess={(data) => {
            setNewName(data.name);
            if (data.grams) setNewGrams(data.grams);
            if (data.calories) setNewCalories(data.calories);
            if (data.protein) setNewProtein(data.protein);
            if ((data as any).fiber) setNewFiber((data as any).fiber);
            setNewManualMacroFields({});
          }}
        />
      )}

      {/* Quantity + Grams + Expiration + Food type inputs */}
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <Input
          placeholder="Quantité (ex : 3)"
          value={newQuantity}
          onChange={e => setNewQuantity(e.target.value)}
          inputMode="numeric"
          className="flex-1 rounded-xl h-8 text-sm min-w-[100px]"
        />
        <Input
          placeholder="Grammes (ex : 500)"
          value={newGrams}
          onChange={e => setNewGrams(e.target.value)}
          className="flex-1 rounded-xl h-8 text-sm min-w-[100px]"
        />
        <Input
          placeholder="Kcal"
          value={newCalories}
          onChange={e => {
            setNewCalories(e.target.value);
            setNewManualMacroFields(prev => ({ ...prev, calories: true }));
          }}
          className="w-16 rounded-xl h-8 text-sm text-center"
        />
        <Input
          placeholder="Prot"
          value={newProtein}
          onChange={e => {
            setNewProtein(e.target.value);
            setNewManualMacroFields(prev => ({ ...prev, protein: true }));
          }}
          className="w-16 rounded-xl h-8 text-sm text-center"
        />
        <Input
          placeholder="Fib"
          value={newFiber}
          onChange={e => {
            setNewFiber(e.target.value);
            setNewManualMacroFields(prev => ({ ...prev, fiber: true }));
          }}
          className="w-16 rounded-xl h-8 text-sm text-center"
        />
        <div className="flex items-center justify-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setNewFoodType((prev) => (prev === "feculent" ? null : "feculent"))}
            className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-0.5 border transition-all ${
              newFoodType === "feculent"
                ? "bg-amber-500/20 text-amber-300 border-amber-400/50 font-bold"
                : "bg-muted text-muted-foreground border-border"
            }`}
            title="Marquer comme féculent (note Macro adaptée)"
          >
            <Wheat className="h-3 w-3" />
            Féc
          </button>
          <button
            type="button"
            onClick={() => setNewFoodType((prev) => (prev === "viande" ? null : "viande"))}
            className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-0.5 border transition-all ${
              newFoodType === "viande"
                ? "bg-red-500/20 text-red-300 border-red-400/50 font-bold"
                : "bg-muted text-muted-foreground border-border"
            }`}
            title="Marquer comme viande (note Macro adaptée)"
          >
            <Drumstick className="h-3 w-3" />
            Via
          </button>
          <NutritionScoreBadge
            score={newFoodNutritionScore}
            rawScore={newFoodNutritionScoreRaw}
          />
        </div>
        <Popover open={expCalOpen} onOpenChange={setExpCalOpen}>
          <PopoverTrigger asChild>
            <button className={`h-8 min-w-[120px] border rounded-xl text-sm px-2 flex items-center gap-1 transition-colors ${newExpiration ? 'bg-muted text-foreground border-border font-medium' : 'bg-muted/50 text-muted-foreground border-border'
              }`}>
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              {newExpiration ? format(newExpiration, 'd MMM yy', { locale: fr }) : 'Péremption'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarPicker
              mode="single"
              selected={newExpiration}
              onSelect={(date) => { setNewExpiration(date || undefined); setExpCalOpen(false); }}
              initialFocus
              className="p-3 pointer-events-auto"
            />
            {newExpiration && (
              <div className="p-2 border-t">
                <button onClick={() => { setNewExpiration(undefined); setExpCalOpen(false); }} className="text-xs text-muted-foreground hover:text-destructive w-full text-center">
                  Effacer la date
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>
        <div className="flex gap-1 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={cycleNewMealMode}
            className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-0.5 border transition-all ${newMealMode === "matin"
              ? "bg-sky-500/20 text-sky-300 border-sky-400/50 font-bold"
              : newMealMode === "dessert"
                ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/50 font-bold"
                : newMealMode === "repas"
                  ? "bg-primary/20 text-foreground border-primary/40 font-bold"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            title={
              newMealMode === "matin"
                ? "Repas matin (cliquer pour dessert)"
                : newMealMode === "dessert"
                  ? "Dessert (cliquer pour désactiver)"
                  : newMealMode === "repas"
                    ? "Repas entier (cliquer: Matin)"
                    : "Marquer comme Repas / Matin / Dessert"
            }
          >
            {newMealMode === "dessert" ? <Cake className="h-3 w-3" /> : <UtensilsCrossed className="h-3 w-3" />}
            {newMealMode === "matin" ? "Matin" : newMealMode === "dessert" ? "Dessert" : newMealMode === "repas" ? "Repas" : ""}
          </button>
          <button
            type="button"
            onClick={() => {
              setSuggestedIsIndivisible(null);
              setNewIsIndivisible((prev) => !prev);
            }}
            className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-0.5 border transition-all ${newIsIndivisible ? "bg-orange-500/20 text-orange-300 border-orange-400/50 font-bold" : "bg-muted text-muted-foreground border-border"}`}
            title={newIsIndivisible ? "Indivisible activé" : "Marquer comme indivisible"}
          >
            <Lock className="h-3 w-3" />Indiv.
          </button>
        </div>
      </div>

      {/* Storage type prompt */}
      {showStoragePrompt && (
        <div className="mb-4 rounded-2xl bg-card border p-4 shadow-lg">
          <p className="text-sm font-semibold text-foreground mb-1">Où ranger « {pendingName} » ?</p>
          {(pendingQuantity || pendingGrams) && (
            <p className="text-xs text-muted-foreground mb-3">
              {pendingQuantity && `Quantité : ${pendingQuantity}`}
              {pendingQuantity && pendingGrams && ' • '}
              {pendingGrams && `Grammes : ${pendingGrams}`}
            </p>
          )}
          {(pendingCalories || pendingProtein || pendingFiber) && (
            <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-muted-foreground">
              {pendingCalories && <span>Kcal : {pendingCalories}</span>}
              {pendingProtein && <span>Prot. : {pendingProtein}</span>}
              {pendingFiber && <span>Fib. : {pendingFiber}</span>}
              {pendingFoodType && (
                <span>{pendingFoodType === "viande" ? "Via" : "Féc"}</span>
              )}
              <NutritionScoreBadge
                score={pendingFoodNutritionScore}
                rawScore={pendingFoodNutritionScoreRaw}
              />
            </div>
          )}
          {suggestedStorageType && (
            <div className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
              💡 Suggestion :
              <span className="font-bold text-foreground flex items-center gap-1 ml-1">
                {suggestedStorageType === 'frigo' && <><Refrigerator className="h-3 w-3 text-blue-400" /> Frigo</>}
                {suggestedStorageType === 'sec' && <><Package className="h-3 w-3 text-amber-500" /> Sec</>}
                {suggestedStorageType === 'surgele' && <><Snowflake className="h-3 w-3 text-cyan-400" /> Surgelé</>}
                {suggestedStorageType === 'extras' && <><span className="text-base leading-none">✨</span> Extras</>}
                {!['frigo', 'sec', 'surgele', 'extras'].includes(suggestedStorageType) && suggestedStorageType}
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Button onClick={() => confirmAdd('frigo')} variant="outline" className={`flex-1 gap-1.5 ${suggestedStorageType === 'frigo' ? 'ring-2 ring-primary/50 bg-primary/10' : ''}`}>
              <Refrigerator className="h-4 w-4 text-blue-400" /> Frigo
            </Button>
            <Button onClick={() => confirmAdd('sec')} variant="outline" className={`flex-1 gap-1.5 ${suggestedStorageType === 'sec' ? 'ring-2 ring-primary/50 bg-primary/10' : ''}`}>
              <Package className="h-4 w-4 text-amber-500" /> Sec
            </Button>
            <Button onClick={() => confirmAdd('surgele')} variant="outline" className={`flex-1 gap-1.5 ${suggestedStorageType === 'surgele' ? 'ring-2 ring-primary/50 bg-primary/10' : ''}`}>
              <Snowflake className="h-4 w-4 text-cyan-400" /> Surgelé
            </Button>
            <Button onClick={() => confirmAdd('extras')} variant="outline" className={`flex-1 gap-1.5 ${suggestedStorageType === 'extras' ? 'ring-2 ring-primary/50 bg-primary/10' : ''}`}>
              <span className="text-base leading-none">✨</span> Extras
            </Button>
          </div>
          <button onClick={() => { setShowStoragePrompt(false); setSuggestedStorageType(null); setSuggestedIsMeal(null); setSuggestedNoCounter(null); setSuggestedIsIndivisible(null); }} className="text-xs text-muted-foreground mt-2 w-full text-center hover:text-foreground">
            Annuler
          </button>
        </div>
      )}

      <div className="mb-4">
        <MaxMealGenerator foodItems={items} meals={meals} />
      </div>

      {/* Sections: Frigo + Sec side by side on desktop — FULL WIDTH like meal cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-none">
        {STORAGE_SECTIONS.filter(s => s.type === 'frigo' || s.type === 'sec').map((section) => (
          <FoodSection
            key={section.type}
            emoji={section.emoji}
            title={section.label}
            storageType={section.type}
            items={getSortedItems(section.type)}
            onUpdate={handleUpdate}
            onDelete={(id) => {
              const extrasItems = getSortedItems("extras");
              if (resolveExtrasDividerAfterId(extrasItems, extrasDividerAfterId) === id) {
                const remaining = extrasItems.filter((item) => item.id !== id);
                setExtrasDividerAfterId(
                  remaining.length > 0
                    ? resolveExtrasDividerAfterId(remaining, null, { useLocalBackup: false })
                    : null,
                  remaining,
                );
              }
              handleDeleteFoodItem(id);
            }}
            onDuplicate={handleDuplicate}
            sortMode={foodSortModes[section.type] || "manual"}
            onToggleSort={() => toggleFoodSort(section.type)}
            sortDirection={sortDirections[`food-${section.type}`] !== false}
            onToggleSortDirection={() => toggleSortDirection(`food-${section.type}`)}
            onReorder={(from, to) => handleReorder(section.type, from, to)}
            dragIndex={dragIndex}
            setDragIndex={setDragIndex}
            allItems={items}
            manualMacroFields={manualMacroFields}
            mealMacroSources={mealMacroSources}
            onChangeStorage={handleChangeStorage}
            morningMealFoodItemIdSet={morningMealFoodItemIdSet}
            dessertFoodItemIdSet={dessertFoodItemIdSet}
            cycleMealMode={cycleMealMode}
            removeMorningMealId={removeMorningMealId}
            removeDessertFoodId={removeDessertFoodId}
            possibleMeals={stockAffectingPossibleMeals}
            foodStockBaselines={foodStockBaselines}
            foodLibraryAmountMemory={foodLibraryAmountMemory}
          />
        ))}
      </div>
      <div className="mt-4 flex justify-center">
        <div className="flex flex-col gap-4 w-full max-w-3xl">
          {STORAGE_SECTIONS.filter(s => s.type === 'surgele' || s.type === 'extras' || s.type === 'test' || s.type === 'toujours').map((section) => (
            <FoodSection
              key={section.type}
              emoji={section.emoji}
              title={section.label}
              storageType={section.type}
              items={getSortedItems(section.type)}
              onUpdate={handleUpdate}
              onDelete={(id) => {
                const extrasItems = getSortedItems("extras");
                if (resolveExtrasDividerAfterId(extrasItems, extrasDividerAfterId) === id) {
                  const remaining = extrasItems.filter((item) => item.id !== id);
                  setExtrasDividerAfterId(
                    remaining.length > 0
                      ? resolveExtrasDividerAfterId(remaining, null, { useLocalBackup: false })
                      : null,
                    remaining,
                  );
                }
                handleDeleteFoodItem(id);
              }}
              onDuplicate={handleDuplicate}
              sortMode={foodSortModes[section.type] || "manual"}
              onToggleSort={() => toggleFoodSort(section.type)}
              sortDirection={sortDirections[`food-${section.type}`] !== false}
              onToggleSortDirection={() => toggleSortDirection(`food-${section.type}`)}
              onReorder={(from, to) => handleReorder(section.type, from, to)}
              dragIndex={dragIndex}
              setDragIndex={setDragIndex}
              allItems={items}
              manualMacroFields={manualMacroFields}
              mealMacroSources={mealMacroSources}
              onChangeStorage={handleChangeStorage}
              morningMealFoodItemIdSet={morningMealFoodItemIdSet}
              dessertFoodItemIdSet={dessertFoodItemIdSet}
              cycleMealMode={cycleMealMode}
              removeMorningMealId={removeMorningMealId}
              removeDessertFoodId={removeDessertFoodId}
              possibleMeals={stockAffectingPossibleMeals}
              foodStockBaselines={foodStockBaselines}
              foodLibraryAmountMemory={foodLibraryAmountMemory}
              extrasDividerAfterId={section.type === "extras" ? extrasDividerAfterId : undefined}
              onSetExtrasDividerAfterId={
                section.type === "extras"
                  ? (id) => setExtrasDividerAfterId(id, getSortedItems("extras"))
                  : undefined
              }
            />
          ))}
        </div>
      </div>


    </div>
  );
}

// ─── FoodSection ─────────────────────────────────────────────────────────────

interface FoodSectionProps {
  emoji: React.ReactNode;
  title: string;
  storageType: StorageType;
  items: FoodItem[];
  onUpdate: (id: string, updates: Partial<FoodItem>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  sortMode: FoodSortMode;
  onToggleSort: () => void;
  sortDirection: boolean;
  onToggleSortDirection: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
  allItems: FoodItem[];
  manualMacroFields: FoodManualMacroFields;
  onChangeStorage: (id: string, storageType: StorageType) => void;
  morningMealFoodItemIdSet: Set<string>;
  dessertFoodItemIdSet: Set<string>;
  cycleMealMode: (item: FoodItem) => void;
  removeMorningMealId: (id: string) => void;
  removeDessertFoodId: (id: string) => void;
  possibleMeals: PossibleMeal[];
  foodStockBaselines: Record<string, FoodStockBaseline>;
  foodLibraryAmountMemory: FoodLibraryAmountMemory;
  extrasDividerAfterId?: string | null;
  onSetExtrasDividerAfterId?: (id: string | null) => void;
  mealMacroSources?: IngredientMacroAutofillSources;
}

/** Bloc repliable pour un type de stockage (frigo, placard…) avec tri et DnD. */
function FoodSection({ emoji, title, storageType, items, onUpdate, onDelete, onDuplicate, sortMode, onToggleSort, sortDirection, onToggleSortDirection, onReorder, dragIndex, setDragIndex, allItems, manualMacroFields, onChangeStorage, morningMealFoodItemIdSet, dessertFoodItemIdSet, cycleMealMode, removeMorningMealId, removeDessertFoodId, possibleMeals, foodStockBaselines, foodLibraryAmountMemory, extrasDividerAfterId, onSetExtrasDividerAfterId, mealMacroSources }: FoodSectionProps) {
  const effectiveDividerAfterId =
    storageType === "extras" ? resolveExtrasDividerAfterId(items, extrasDividerAfterId) : null;
  const dividerSplit =
    storageType === "extras" ? splitSortedExtrasByDivider(items, extrasDividerAfterId) : null;
  const dividerMove =
    storageType === "extras"
      ? extrasDividerMoveState(items, extrasDividerAfterId)
      : { canMoveUp: false, canMoveDown: false };
  const SortIcon = sortMode === "expiration" ? CalendarDays : sortMode === "name" ? ArrowUpDown : sortMode === "calories" ? Flame : sortMode === "protein" ? UtensilsCrossed : ArrowUpDown;
  const sortLabel = sortMode === "expiration" ? "Péremption" : sortMode === "name" ? "Nom" : sortMode === "calories" ? "Calories" : sortMode === "protein" ? "Protéines" : "Manuel";
  const [sectionDragOver, setSectionDragOver] = useState(false);
  const [collapsed, setCollapsed] = useState(storageType === 'toujours' || storageType === 'extras' || storageType === 'test');
  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  // Touch drag & drop for mobile
  const touchDragRef = useRef<{ itemId: string; itemIdx: number; ghost: HTMLElement; startX: number; startY: number; origTop: number; origLeft: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const touchTargetElRef = useRef<HTMLElement | null>(null);
  const [touchDragActive, setTouchDragActive] = useState(false);

  /** Restaure le scroll natif après annulation / fin d'un drag tactile. */
  const clearTouchLock = () => {
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
    if (touchTargetElRef.current) {
      touchTargetElRef.current.style.touchAction = "";
      touchTargetElRef.current = null;
    }
  };

  useEffect(() => {
    const finishTouchDrag = (touch: Touch) => {
      const s = touchDragRef.current;
      if (!s) return;

      touchDragRef.current = null;
      setTouchDragActive(false);
      clearTouchLock();

      s.ghost.style.visibility = "hidden";
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      s.ghost.remove();

      const cardEl = el?.closest("[data-food-idx]");
      if (cardEl) {
        const toIdx = parseInt(cardEl.getAttribute("data-food-idx") || "-1");
        if (toIdx >= 0 && toIdx !== s.itemIdx) onReorder(s.itemIdx, toIdx);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchDragRef.current) {
        // Pendant l'attente du long-press : bloquer le scroll si le doigt reste quasi immobile,
        // sinon annuler le drag et laisser scroller.
        if (longPressTimerRef.current && touchStartPosRef.current) {
          const touch = e.touches[0];
          const dx = touch.clientX - touchStartPosRef.current.x;
          const dy = touch.clientY - touchStartPosRef.current.y;
          if (Math.sqrt(dx * dx + dy * dy) > 10) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
            touchStartPosRef.current = null;
            clearTouchLock();
          } else {
            e.preventDefault();
          }
        }
        return;
      }
      e.preventDefault();
      const touch = e.touches[0];
      const s = touchDragRef.current;
      s.ghost.style.top = `${s.origTop + (touch.clientY - s.startY)}px`;
      s.ghost.style.left = `${s.origLeft + (touch.clientX - s.startX)}px`;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (!touchDragRef.current) {
        clearTouchLock();
        touchStartPosRef.current = null;
        return;
      }
      const touch = e.changedTouches[0];
      if (touch) finishTouchDrag(touch);
    };

    const onTouchCancel = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (touchDragRef.current) {
        touchDragRef.current.ghost.remove();
        touchDragRef.current = null;
      }
      setTouchDragActive(false);
      clearTouchLock();
      touchStartPosRef.current = null;
    };

    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: false });
    window.addEventListener("touchcancel", onTouchCancel);

    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [onReorder]);

  /** Démarre un long-press tactile pour réordonner une carte (tri manuel uniquement). */
  const handleTouchStart = (e: React.TouchEvent, item: FoodItem, sectionIdx: number) => {
    if (sortMode !== "manual") return;
    const touch = e.touches[0];
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();

    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    touchTargetElRef.current = el;
    // Bloquer le scroll natif dès le début du geste (sinon le navigateur « vole » le touch avant 500ms).
    el.style.touchAction = "none";
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);

    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";

      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;z-index:9999;pointer-events:none;opacity:0.85;transform:scale(1.05);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.35);transition:none;`;
      document.body.appendChild(ghost);

      touchDragRef.current = {
        itemId: item.id,
        itemIdx: sectionIdx,
        ghost,
        startX: touch.clientX,
        startY: touch.clientY,
        origTop: rect.top,
        origLeft: rect.left,
      };
      setTouchDragActive(true);
    }, 350);
  };

  /**
   * Drop dans le vide de la section aliments : réordonne dans la même zone, sinon change de stockage.
   */
  const handleSectionContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setSectionDragOver(false);
    const itemId = e.dataTransfer.getData("foodItemId");
    const fromStorage = e.dataTransfer.getData("foodItemStorage");
    if (fromStorage === storageType) {
      applyContainerReorderDrop(
        dragIndex,
        e.clientY,
        e.currentTarget,
        onReorder,
        "[data-food-idx]",
      );
      setDragIndex(null);
      return;
    }
    if (itemId && fromStorage !== storageType) {
      onChangeStorage(itemId, storageType);
      setDragIndex(null);
    }
  };

  return (
    <div
      className="rounded-3xl bg-card/80 backdrop-blur-sm p-4"
      onDragOver={(e) => { e.preventDefault(); setSectionDragOver(true); }}
      onDragLeave={() => setSectionDragOver(false)}
      onDrop={handleSectionContainerDrop}
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
        <div className="flex items-center gap-1">
          {sortMode !== "manual" && (
            <Button size="sm" variant="ghost" onClick={onToggleSortDirection} className="h-7 w-7 p-0 rounded-full">
              {sortDirection ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5 rotate-180" />}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onToggleSort} className={`text-[10px] gap-0.5 h-7 px-2 rounded-full border transition-all ${sortMode !== "manual" ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/20' : 'border-transparent'}`}>
            <SortIcon className="h-3 w-3" />
            <span className="hidden sm:inline">{sortLabel}</span>
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className={`flex flex-col gap-2 ${touchDragActive ? "touch-none" : ""}`}>
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6 italic">
              Aucun aliment — glisse une carte depuis une autre section
            </p>
          ) : (
            items.map((item, sectionIdx) => (
              <div key={item.id}>
                <div
                  data-food-idx={sectionIdx}
                  data-reorder-idx={sectionIdx}
                  onTouchStart={(e) => handleTouchStart(e, item, sectionIdx)}
                  className={sortMode === "manual" && isTouchDevice ? "touch-manipulation select-none" : undefined}
                  style={sortMode === "manual" && isTouchDevice ? { WebkitUserSelect: "none", userSelect: "none" } : undefined}
                >
                  <FoodItemCard
                  item={item}
                  possibleMeals={possibleMeals}
                  baselineTotalGrams={resolveFoodItemBaselineTotalGrams(
                    item,
                    foodStockBaselines[item.id],
                    parseQty(foodLibraryAmountMemory[getFoodLibraryAmountKey(item.name)]?.grams) || null,
                  )}
                  baselineQuantity={foodStockBaselines[item.id]?.quantity ?? null}
                  onUpdate={(updates) => onUpdate(item.id, updates)}
                  manualMacroFields={manualMacroFields}
                  isMorningMeal={morningMealFoodItemIdSet.has(item.id)}
                  isDessertFood={dessertFoodItemIdSet.has(item.id)}
                  onCycleMealMode={() => cycleMealMode(item)}
                  onDelete={() => onDelete(item.id)}
                  onDuplicate={() => onDuplicate(item.id)}
                  computedPortionMacros={
                    item.is_meal
                      ? computeFoodItemPortionMacros(item, { macroSources: mealMacroSources })
                      : null
                  }
                  onMoveToExtras={storageType === 'test' ? () => onChangeStorage(item.id, 'extras') : undefined}
                  draggableEnabled={!isTouchDevice}
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
                </div>
                {storageType === "extras" &&
                  onSetExtrasDividerAfterId &&
                  effectiveDividerAfterId === item.id &&
                  items.length > 1 && (
                    <ExtrasMovableDivider
                      canMoveUp={dividerMove.canMoveUp}
                      canMoveDown={dividerMove.canMoveDown}
                      aboveCount={dividerSplit?.above.length ?? 0}
                      belowCount={dividerSplit?.below.length ?? 0}
                      onMoveUp={() => {
                        const next = moveExtrasDividerUp(items, extrasDividerAfterId);
                        if (next) onSetExtrasDividerAfterId(next);
                      }}
                      onMoveDown={() => {
                        onSetExtrasDividerAfterId(
                          moveExtrasDividerDown(items, extrasDividerAfterId),
                        );
                      }}
                    />
                  )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
