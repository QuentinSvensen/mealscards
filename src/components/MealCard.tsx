/**
 * MealCard — Carte individuelle de repas dans le catalogue.
 *
 * Affiche le nom du repas, ses macros (calories, protéines, fibres), grammage,
 * température/durée de cuisson, statut favori, et la liste d'ingrédients
 * avec mise en évidence des périmés/manquants/compteurs.
 *
 * Fonctionnalités :
 * - Édition inline du nom, calories, protéines, fibres, grammes, cuisson
 * - Édition des ingrédients via IngredientEditor
 * - Description (consignes) via menu, visible uniquement au double-clic
 * - Mémorisation React.memo avec comparaison personnalisée pour la performance
 * - StructuredIngredientInline : affiche les ingrédients avec OU, optionnels, manquants
 */
import React, { useState, useRef, forwardRef } from "react";
import { ArrowRight, MoreVertical, Pencil, Trash2, Flame, Weight, List, Star, Thermometer, Timer, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IngredientEditor } from "@/components/IngredientEditor";
import { AutoGrowDescriptionTextarea } from "@/components/AutoGrowDescriptionTextarea";
import { usePreferenceValue } from "@/hooks/usePreferences";
import { PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY } from "@/lib/planningDisplayPrefs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { autofillIngredientLinesMacros, type IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import {
  type IngLine,
  parseIngredientsToLines, serializeIngredients,
  computeIngredientCalories, computeIngredientProtein, computeIngredientFiber,
  getMealColor, computeCounterHours
} from "@/lib/ingredientUtils";
import { findStockKey, type StockInfo, type FoodItemIndex, getDisplayedCalories, getDisplayedProtein, getDisplayedFiber } from "@/lib/stockUtils";
import { StructuredIngredientInline } from "@/components/StructuredIngredientInline";
import { NutritionScoreBadge } from "@/components/NutritionScoreBadge";
import { SatietyIndexBadge } from "@/components/SatietyIndexBadge";
import { getMealNutritionScore } from "@/lib/nutritionScore";
import { getMealSatietyDetails } from "@/lib/satietyIndex";

interface MealCardProps {
  meal: Meal;
  onMoveToPossible: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUpdateCalories: (calories: string | null) => void;
  onUpdateProtein?: (protein: string | null) => void;
  onUpdateFiber?: (fiber: string | null) => void;
  onUpdateGrams: (grams: string | null) => void;
  onUpdateIngredients: (ingredients: string | null) => void;
  onToggleFavorite?: () => void;
  onUpdateOvenTemp?: (temp: string | null) => void;
  onUpdateOvenMinutes?: (minutes: string | null) => void;
  /** Enregistre les consignes de préparation du repas. */
  onUpdateDescription?: (description: string | null) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isHighlighted?: boolean;
  hideDelete?: boolean;
  expirationLabel?: string | null;
  expirationDate?: string | null;
  expirationIsToday?: boolean;
  expiringIngredientName?: string | null;
  expiredIngredientNames?: Set<string>;
  maxIngredientCounter?: number | null;
  missingIngredientNames?: Set<string>;
  counterIngredientNames?: Set<string>;
  expiringSoonIngredientNames?: Set<string>;
  stockMap?: Map<string, StockInfo>;
  earliestCounterDate?: string | null;
  hideCounter?: boolean;
  ingredientSuggestions?: string[];
  ingredientMacroSources?: IngredientMacroAutofillSources;
  foodItems?: FoodItem[];
  foodItemIndex?: FoodItemIndex;
}

// Utilitaires d'analyse d'ingrédients importés de @/lib/ingredientUtils

/**
 * Compare deux Sets de chaînes par taille et appartenance (évite les faux égaux sur .size seul).
 */
function sameStringSet(a?: Set<string>, b?: Set<string>) {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export const MealCard = React.memo(forwardRef<HTMLDivElement, MealCardProps>(function MealCard({
  meal, onMoveToPossible, onRename, onDelete, onUpdateCalories, onUpdateProtein, onUpdateFiber, onUpdateGrams,
  onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes, onUpdateDescription, onDragStart,
  onDragOver, onDrop, isHighlighted, hideDelete, expirationLabel, expirationDate,
  expirationIsToday, expiringIngredientName, expiredIngredientNames, expiringSoonIngredientNames,
  maxIngredientCounter, missingIngredientNames, counterIngredientNames, stockMap,
  earliestCounterDate, hideCounter, ingredientSuggestions, ingredientMacroSources,
  foodItems, foodItemIndex
}, _ref) {
  const [editing, setEditing] = useState<"name" | "calories" | "protein" | "fiber" | "grams" | "oven_temp" | "oven_minutes" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [ingLines, setIngLines] = useState<IngLine[]>([]);
  const [descriptionEditorOpen, setDescriptionEditorOpen] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [detailPopupOpen, setDetailPopupOpen] = useState(false);
  /** Contrôle du menu ⋮ : fermé avant d’ouvrir le Dialog description (évite le blocage Radix). */
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * Flag synchrone (ref) : l’état React arrive trop tard quand Radix ferme le menu
   * dans le même tick que onSelect → le Dialog ne s’ouvrait jamais.
   */
  const pendingDescriptionOpenRef = useRef(false);
  const hideCalorieDisplay = usePreferenceValue<boolean>(PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY, false);

  const handleSave = () => {
    const val = editValue.trim();
    if (editing === "name" && val && val !== meal.name) onRename(val);
    if (editing === "calories") onUpdateCalories(val || null);
    if (editing === "protein") onUpdateProtein?.(val || null);
    if (editing === "fiber") onUpdateFiber?.(val || null);
    if (editing === "grams") onUpdateGrams(val || null);
    if (editing === "oven_temp") onUpdateOvenTemp?.(val || null);
    if (editing === "oven_minutes") onUpdateOvenMinutes?.(val || null);
    setEditing(null);
  };

  /** Ouvre le Dialog description après fermeture du menu ⋮ (blur + nettoyage pointer-events). */
  const launchDescriptionEditor = () => {
    if (!pendingDescriptionOpenRef.current) return;
    pendingDescriptionOpenRef.current = false;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    document.body.style.removeProperty("pointer-events");
    setDescriptionEditorOpen(true);
  };

  /**
   * Prépare l’ouverture de l’éditeur : ferme d’abord le menu ⋮.
   * Le Dialog s’ouvre via onMenuOpenChange ou le timeout de secours.
   */
  const openDescriptionEditor = () => {
    setDescriptionDraft(meal.description || "");
    pendingDescriptionOpenRef.current = true;
    setMenuOpen(false);
    // Secours si onOpenChange ne voit pas le pending (fermeture Radix déjà en cours).
    window.setTimeout(launchDescriptionEditor, 0);
  };

  /**
   * Gère l’ouverture/fermeture du menu ⋮ et lance le Dialog description une fois fermé.
   */
  const onMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (open) {
      // Débloque un body coincé après un Dialog précédent (pointer-events: none).
      document.body.style.removeProperty("pointer-events");
      return;
    }
    window.requestAnimationFrame(launchDescriptionEditor);
  };

  /** Enregistre les consignes puis ferme l'éditeur. */
  const saveDescription = () => {
    const val = descriptionDraft.trim();
    onUpdateDescription?.(val || null);
    closeDescriptionEditor();
  };

  /** Ferme l’éditeur de description et nettoie un éventuel pointer-events résiduel. */
  const closeDescriptionEditor = () => {
    setDescriptionEditorOpen(false);
    pendingDescriptionOpenRef.current = false;
    document.body.style.removeProperty("pointer-events");
  };

  const openIngredients = () => {
    const parsed = parseIngredientsToLines(meal.ingredients);
    setIngLines(
      ingredientMacroSources
        ? autofillIngredientLinesMacros(parsed, ingredientMacroSources)
        : parsed,
    );
    setEditingIngredients(true);
  };

  // Persiste les ingrédients validés depuis l'éditeur (lignes passées = état le plus récent).
  const commitIngredients = (committedLines: IngLine[]) => {
    onUpdateIngredients(serializeIngredients(committedLines));
    setEditingIngredients(false);
  };


  // Construire le rappel isAvailable à partir de stockMap pour le calcul des macros
  const isAvailableCb = stockMap ? (name: string) => {
    const key = findStockKey(stockMap, name);
    if (!key) return false;
    const stock = stockMap.get(key);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  } : undefined;

  const ovenTemp = meal.oven_temp;
  const ovenMinutes = meal.oven_minutes;
  const hasCuisson = ovenTemp || ovenMinutes;
  const nutritionScore = getMealNutritionScore(meal, isAvailableCb);
  // Satiété : somme pondérée ÷ 4,5, clamp [0, 100] + volume (g) ; catalogue = recette écrite (pas de filtre stock).
  const mealSatietyDetails = getMealSatietyDetails(meal, ingredientMacroSources);
  const headerCal = getDisplayedCalories(meal, undefined, undefined, isAvailableCb, foodItems, foodItemIndex);
  const headerPro = getDisplayedProtein(meal, undefined, undefined, isAvailableCb, foodItems, foodItemIndex);
  const headerFiber = getDisplayedFiber(meal, undefined, undefined, isAvailableCb, foodItems, foodItemIndex);
  const hasIngredientMacros = Boolean(meal.ingredients?.trim());
  const hasDirectMacros = !hasIngredientMacros && (headerCal != null || (headerPro != null && headerPro !== 0) || (headerFiber != null && headerFiber !== 0));

  return (
    <>
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.closest("button")) return;
        setDetailPopupOpen(true);
      }}
      className={`group flex flex-col rounded-2xl px-4 py-3 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg ${isHighlighted ? 'ring-4 ring-yellow-400 scale-105' : ''}`}
      style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}
    >
      {editing ? (
        <Input
          autoFocus
          placeholder={editing === "name" ? "Nom" : editing === "calories" ? "Ex: 350 kcal" : editing === "fiber" ? "Ex: 8" : editing === "grams" ? "Ex: 150g" : editing === "oven_temp" ? "Ex: 180" : "Ex: 25"}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          inputMode={editing === "oven_temp" || editing === "oven_minutes" ? "numeric" : undefined}
          className="h-8 border-white/30 bg-white/20 text-white placeholder:text-white/60 flex-1"
        />
      ) : editingIngredients ? (
        <IngredientEditor
          lines={ingLines}
          onUpdate={setIngLines}
          onCommit={commitIngredients}
          ingredientSuggestions={ingredientSuggestions}
          ingredientMacroSources={ingredientMacroSources}
        />
      ) : (
        <>
          {/* Ligne de titre */}
          <div className="flex items-start gap-1 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0 flex-shrink basis-full sm:basis-auto sm:flex-1">
              <span className="font-semibold text-white text-sm min-w-0 break-words whitespace-normal">
                {meal.name}
              </span>
              <NutritionScoreBadge score={nutritionScore} />
              <SatietyIndexBadge
                index={mealSatietyDetails?.index ?? null}
                totalGrams={mealSatietyDetails?.totalGrams}
                hideWhenMissing
                onMealCard
                recipeTotal
              />
            </div>
            {/* Ligne d'options - s'enroule sous le titre sur les écrans étroits et reste alignée à droite */}
            <div className="ml-auto flex w-full sm:w-auto items-center justify-end gap-1 shrink-0 flex-wrap">
              {maxIngredientCounter !== null && maxIngredientCounter !== undefined && !hideCounter && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 font-bold ${maxIngredientCounter >= 3 ? 'bg-red-500/50 text-red-100' :
                  maxIngredientCounter >= 1 ? 'bg-amber-400/30 text-amber-100' :
                    'bg-white/25 text-white/80'
                  }`}
                  title={earliestCounterDate ? `${computeCounterHours(earliestCounterDate)}h écoulées` : undefined}
                >
                  <Timer className="h-3 w-3" /> {maxIngredientCounter}j
                </span>
              )}
              {meal.grams && (
                <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                  <Weight className="h-3 w-3" />{meal.grams}
                </span>
              )}
              {(() => {
                if (hideCalorieDisplay) return null;
                const displayCal = headerCal;
                const isComputed = computeIngredientCalories(meal.ingredients, isAvailableCb) !== null || hasDirectMacros;
                return displayCal ? (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 ${isComputed ? 'bg-orange-500/50 text-white font-bold' : 'text-white/70 bg-white/20'
                    }`}>
                    <Flame className="h-3 w-3" />{displayCal}
                  </span>
                ) : null;
              })()}
              {(() => {
                const displayPro = headerPro;
                const isComputedPro = computeIngredientProtein(meal.ingredients, isAvailableCb) !== null || hasDirectMacros;
                return displayPro && displayPro !== 0 ? (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 font-semibold ${isComputedPro ? 'bg-blue-600/60 text-white' : 'text-white/70 bg-blue-500/30'
                    }`}>
                    🍗 {displayPro}
                  </span>
                ) : null;
              })()}
              {(() => {
                const displayFiber = headerFiber;
                const isComputedFiber = computeIngredientFiber(meal.ingredients, isAvailableCb) !== null || hasDirectMacros;
                return displayFiber && displayFiber !== 0 ? (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 font-semibold ${isComputedFiber ? 'bg-emerald-600/60 text-white' : 'text-white/70 bg-emerald-500/30'
                    }`}>
                    🌾 {displayFiber}
                  </span>
                ) : null;
              })()}
              {hasCuisson && (
                <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                  <Thermometer className="h-3 w-3" />
                  {ovenTemp ? `${ovenTemp}°C` : ''}{ovenTemp && ovenMinutes ? ' · ' : ''}{ovenMinutes ? `${ovenMinutes}min` : ''}
                </span>
              )}
              {onToggleFavorite && (
                <button
                  onClick={onToggleFavorite}
                  className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-full transition-all hover:bg-white/20 ${meal.is_favorite ? 'text-yellow-300' : 'text-white/40 hover:text-yellow-200'}`}
                  title={meal.is_favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                >
                  <Star className={`h-3.5 w-3.5 ${meal.is_favorite ? 'fill-yellow-300' : ''}`} />
                </button>
              )}
              <Button size="icon" variant="ghost" onClick={onMoveToPossible} className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20" data-testid="meal-move-to-possible-btn">
                <ArrowRight className="h-4 w-4" />
              </Button>
              <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange} modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { setEditValue(meal.name); setEditing("name"); }}>
                    <Pencil className="mr-2 h-4 w-4" /> Renommer
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }}>
                    <Flame className="mr-2 h-4 w-4" /> Calories
                  </DropdownMenuItem>
                  {onUpdateProtein && (
                    <DropdownMenuItem onClick={() => { setEditValue(meal.protein || ""); setEditing("protein"); }}>
                      <Weight className="mr-2 h-4 w-4" /> Protéines
                    </DropdownMenuItem>
                  )}
                  {onUpdateFiber && (
                    <DropdownMenuItem onClick={() => { setEditValue(meal.fiber || ""); setEditing("fiber"); }}>
                      <Weight className="mr-2 h-4 w-4" /> Fibres
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }}>
                    <Weight className="mr-2 h-4 w-4" /> Grammes
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openIngredients}>
                    <List className="mr-2 h-4 w-4" /> Ingrédients
                  </DropdownMenuItem>
                  {onUpdateOvenTemp && (
                    <DropdownMenuItem onClick={() => { setEditValue(ovenTemp || ""); setEditing("oven_temp"); }}>
                      <Thermometer className="mr-2 h-4 w-4" /> Température (°C)
                    </DropdownMenuItem>
                  )}
                  {onUpdateOvenMinutes && (
                    <DropdownMenuItem onClick={() => { setEditValue(ovenMinutes || ""); setEditing("oven_minutes"); }}>
                      <Thermometer className="mr-2 h-4 w-4" /> Durée (min)
                    </DropdownMenuItem>
                  )}
                  {onUpdateDescription && (
                    <DropdownMenuItem onSelect={() => openDescriptionEditor()}>
                      <FileText className="mr-2 h-4 w-4" /> Description
                    </DropdownMenuItem>
                  )}
                  {!hideDelete && (
                    <DropdownMenuItem onClick={onDelete} className="text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Supprimer
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Affichage Péremption + Ingrédients */}
          {(expirationLabel || meal.ingredients) && (
            <div className="flex items-center gap-2 mt-1">
              {expirationLabel && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 font-semibold ${expirationIsToday
                  ? 'text-red-200 bg-red-500/30 ring-2 ring-red-500'
                  : expirationDate && new Date(expirationDate) < new Date(new Date().toDateString())
                    ? 'text-red-200 bg-red-500/30'
                    : 'text-white/70 bg-white/20'
                  }`}>
                  📅 {expirationLabel}
                </span>
              )}
              {meal.ingredients && (
                <p className="text-[11px] text-white/65 leading-tight flex-1 flex flex-wrap gap-x-1">
                  <StructuredIngredientInline
                    ingredients={meal.ingredients}
                    expiredIngredientNames={expiredIngredientNames}
                    missingIngredientNames={missingIngredientNames}
                    counterIngredientNames={counterIngredientNames}
                    expiringSoonIngredientNames={expiringSoonIngredientNames}
                    stockMap={stockMap}
                  />
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>

    {/* Éditeur des consignes de préparation */}
    <Dialog
      open={descriptionEditorOpen}
      onOpenChange={(open) => {
        if (open) setDescriptionEditorOpen(true);
        else closeDescriptionEditor();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Description — {meal.name}</DialogTitle>
        </DialogHeader>
        <AutoGrowDescriptionTextarea
          value={descriptionDraft}
          onChange={setDescriptionDraft}
        />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={closeDescriptionEditor}>Annuler</Button>
          <Button type="button" onClick={saveDescription}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Pop-up détail (double-clic) : consignes visibles ici uniquement */}
    <Dialog open={detailPopupOpen} onOpenChange={setDetailPopupOpen}>
      <DialogContent className="max-w-md p-0 overflow-hidden" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Détails du repas</DialogTitle>
        <div className="rounded-2xl p-5 text-white" style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}>
          <h3 className="text-lg font-bold mb-3">{meal.name}</h3>
          {meal.description?.trim() ? (
            <div className="bg-black/20 rounded-xl p-3">
              <p className="text-xs font-semibold text-white/60 mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" /> Préparation
              </p>
              <p className="text-sm text-white/90 whitespace-pre-wrap leading-relaxed">{meal.description}</p>
            </div>
          ) : (
            <p className="text-sm text-white/50 italic">Aucune consigne de préparation</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}), (prevProps, nextProps) => {
  return prevProps.meal.id === nextProps.meal.id &&
    prevProps.meal.name === nextProps.meal.name &&
    prevProps.meal.category === nextProps.meal.category &&
    prevProps.meal.calories === nextProps.meal.calories &&
    prevProps.meal.protein === nextProps.meal.protein &&
    prevProps.meal.fiber === nextProps.meal.fiber &&
    prevProps.meal.grams === nextProps.meal.grams &&
    prevProps.meal.ingredients === nextProps.meal.ingredients &&
    prevProps.meal.oven_temp === nextProps.meal.oven_temp &&
    prevProps.meal.oven_minutes === nextProps.meal.oven_minutes &&
    prevProps.meal.description === nextProps.meal.description &&
    prevProps.meal.is_favorite === nextProps.meal.is_favorite &&
    prevProps.isHighlighted === nextProps.isHighlighted &&
    prevProps.hideDelete === nextProps.hideDelete &&
    prevProps.hideCounter === nextProps.hideCounter &&
    prevProps.earliestCounterDate === nextProps.earliestCounterDate &&
    prevProps.ingredientSuggestions === nextProps.ingredientSuggestions &&
    prevProps.ingredientMacroSources === nextProps.ingredientMacroSources &&
    prevProps.expirationLabel === nextProps.expirationLabel &&
    prevProps.expirationDate === nextProps.expirationDate &&
    prevProps.expirationIsToday === nextProps.expirationIsToday &&
    prevProps.expiringIngredientName === nextProps.expiringIngredientName &&
    prevProps.maxIngredientCounter === nextProps.maxIngredientCounter &&
    prevProps.stockMap === nextProps.stockMap &&
    prevProps.foodItems === nextProps.foodItems &&
    prevProps.foodItemIndex === nextProps.foodItemIndex &&
    sameStringSet(prevProps.expiredIngredientNames, nextProps.expiredIngredientNames) &&
    sameStringSet(prevProps.expiringSoonIngredientNames, nextProps.expiringSoonIngredientNames) &&
    sameStringSet(prevProps.missingIngredientNames, nextProps.missingIngredientNames) &&
    sameStringSet(prevProps.counterIngredientNames, nextProps.counterIngredientNames);
});
