import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Drumstick, Flame, Hash, Plus, Scale, Search, Save, Trash2, Wheat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { toast } from "@/hooks/use-toast";
import {
  applyIngredientMacroToText,
  applyIngredientRenameToText,
  buildIngredientMacroUpdatePlan,
  buildIngredientRenamePlan,
  collectIngredientMacroEntries,
  createIngredientMacroLibraryItem,
  areIngredientMacroLibrariesEqual,
  persistMissingIngredientMacroEntries,
  removeIngredientMacroLibraryItem,
  renameIngredientMacroLibraryItem,
  upsertIngredientMacroLibraryItem,
  type IngredientMacroEntry,
  type IngredientMacroLibraryItem,
} from "@/domain/macros/ingredientMacroDatabase";
import { normalizeForMatch, normalizeKey } from "@/lib/ingredientUtils";
import { parseMacroDisplay } from "@/lib/stockUtils";
import { NutritionScoreBadge } from "@/components/NutritionScoreBadge";
import { SatietyIndexBadge } from "@/components/SatietyIndexBadge";
import { ClickToEditText } from "@/components/ClickToEditText";
import {
  getIngredientMacroNutritionScore,
  getIngredientMacroNutritionScoreRaw,
} from "@/lib/nutritionScore";
import { getIngredientSatietyIndex } from "@/lib/satietyIndex";
import {
  cycleFoodType,
  listFoodItemsMatchingIngredientKey,
  resolveIngredientFoodType,
} from "@/lib/foodTypeUtils";
import { useFoodLibrary } from "@/hooks/useFoodLibrary";
import { usePreferences } from "@/hooks/usePreferences";
import type { FoodType } from "@/types/food";

/**
 * Clé de préférence : map clé-ingrédient → grammes d'une unité.
 * Sert **uniquement** au calcul de la note nutritionnelle dans Macro
 * (jamais aux recettes, ni au stock Aliments).
 */
export const INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY = "ingredient_macro_unit_grams";

/** Modes de tri de la liste Macro. */
export type MacroSortMode = "name" | "note" | "calories" | "protein" | "satiety";

/** Filtre viande / féculent de la liste Macro (`all` = aucun filtre). */
export type MacroFoodTypeFilter = "all" | "viande" | "feculent";

interface MacroIngredientsProps {
  meals: Meal[];
  possibleMeals: PossibleMeal[];
  foodItems: FoodItem[];
  macroLibrary: IngredientMacroLibraryItem[];
  onSaveMacroLibrary: (library: IngredientMacroLibraryItem[]) => void;
  onUpdateMealIngredients: (id: string, ingredients: string) => void;
  onUpdatePossibleIngredients: (id: string, ingredients_override: string | null) => void;
  onUpdateFoodItemMacro: (
    id: string,
    updates: {
      name?: string;
      calories?: string | null;
      protein?: string | null;
      fiber?: string | null;
      food_type?: FoodType;
    },
  ) => void;
}

interface DraftMacro {
  displayName: string;
  calories: string;
  protein: string;
  fiber: string;
}

/** Parse la saisie « grammes par unité » (accepte virgule) ; null si vide ou invalide. */
export function parseUnitGramsInput(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Libellé du badge Base affiché : reste « Quantité » / « 100g ».
 * Les grammes/unité pour la note ne sont PAS montrés ici (évite de croire
 * que l'aliment se compte ou se stocke en grammes).
 */
export function formatMacroBasisBadgeLabel(
  basisLabel: string | null | undefined,
  _unitGrams?: number | null | undefined,
): string {
  return basisLabel?.trim() || "-";
}

/**
 * Tooltip du badge Quantité : invite à saisir le poids d'une unité (pour la note).
 */
export function formatUnitGramsNoteTooltip(
  _displayName: string,
  unitGrams: number | null | undefined,
): string {
  if (unitGrams != null && unitGrams > 0) {
    const rounded = Number.isInteger(unitGrams) ? String(unitGrams) : String(Math.round(unitGrams * 10) / 10);
    return `Poids d'une unité : ${rounded} g`;
  }
  return "Indiquer le poids d'une unité";
}

/**
 * Met à jour (ou retire) les grammes/unité utilisés **seulement** pour la note Macro.
 * grams null ou ≤ 0 → suppression de la clé. N'écrit jamais food_items / recettes.
 */
export function upsertIngredientMacroUnitGrams(
  map: Record<string, number>,
  ingredientKey: string,
  grams: number | null,
): Record<string, number> {
  if (!ingredientKey) return map;
  const next = { ...map };
  if (grams == null || !(grams > 0)) {
    delete next[ingredientKey];
  } else {
    next[ingredientKey] = grams;
  }
  return next;
}

// Renvoie les valeurs actuellement visibles, en tenant compte des edits non sauvegardés.
function getDraftValue(entry: IngredientMacroEntry, drafts: Record<string, DraftMacro>): DraftMacro {
  return (
    drafts[entry.key] ?? {
      displayName: entry.displayName,
      calories: entry.calories,
      protein: entry.protein,
      fiber: entry.fiber,
    }
  );
}

// Indique si la ligne a été modifiée (nom ou macros) par rapport à la référence chargée.
function hasDraftChanged(entry: IngredientMacroEntry, drafts: Record<string, DraftMacro>): boolean {
  const draft = drafts[entry.key];
  if (!draft) return false;
  return (
    draft.displayName.trim() !== entry.displayName ||
    draft.calories.trim() !== entry.calories ||
    draft.protein.trim() !== entry.protein ||
    draft.fiber.trim() !== entry.fiber
  );
}

// Produit une signature stable du référentiel pour éviter de relancer deux fois la même sauvegarde automatique.
function getMacroLibrarySignature(library: IngredientMacroLibraryItem[]): string {
  return JSON.stringify(
    [...library]
      .sort((a, b) => a.key.localeCompare(b.key, "fr"))
      .map((entry) => [entry.key, entry.displayName, entry.calories, entry.protein, entry.fiber ?? ""]),
  );
}

/** Passe au filtre type suivant : Tous → Viande → Féculent → Tous. */
export function cycleMacroFoodTypeFilter(filter: MacroFoodTypeFilter): MacroFoodTypeFilter {
  if (filter === "all") return "viande";
  if (filter === "viande") return "feculent";
  return "all";
}

/** Passe au mode de tri suivant : Nom → Note → Calories → Protéines → Satiété → Nom. */
export function cycleMacroSortMode(mode: MacroSortMode): MacroSortMode {
  if (mode === "name") return "note";
  if (mode === "note") return "calories";
  if (mode === "calories") return "protein";
  if (mode === "protein") return "satiety";
  return "name";
}

/**
 * Compare deux lignes Macro selon le mode (nom, note, calories, protéines, satiété).
 * Les valeurs manquantes (note/kcal/prot/sat null) sont poussées en fin de liste.
 * Pour la note / satiété en base Quantité, utilise les grammes/unité pour normaliser au 100 g.
 */
export function compareMacroIngredientEntries(
  a: IngredientMacroEntry,
  b: IngredientMacroEntry,
  drafts: Record<string, DraftMacro>,
  mode: MacroSortMode,
  ascending: boolean,
  unitGramsByKey: Record<string, number> = {},
  foodTypeByKey: Record<string, FoodType | undefined> = {},
): number {
  const dir = ascending ? 1 : -1;
  const draftA = getDraftValue(a, drafts);
  const draftB = getDraftValue(b, drafts);
  const byName = () => a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" });

  if (mode === "name") return dir * byName();

  if (mode === "note") {
    // Tri sur le score brut non plafonné pour départager les notes affichées à 100
    const scoreA = getIngredientMacroNutritionScoreRaw(draftA.calories, draftA.protein, draftA.fiber, {
      basisLabel: a.basisLabel,
      unitGrams: unitGramsByKey[a.key],
      foodType: foodTypeByKey[a.key] ?? null,
    });
    const scoreB = getIngredientMacroNutritionScoreRaw(draftB.calories, draftB.protein, draftB.fiber, {
      basisLabel: b.basisLabel,
      unitGrams: unitGramsByKey[b.key],
      foodType: foodTypeByKey[b.key] ?? null,
    });
    if (scoreA == null && scoreB == null) return byName();
    if (scoreA == null) return 1;
    if (scoreB == null) return -1;
    if (scoreA !== scoreB) return dir * (scoreA - scoreB);
    return byName();
  }

  if (mode === "satiety") {
    const scoreOptionsA = {
      basisLabel: a.basisLabel,
      unitGrams: unitGramsByKey[a.key],
      foodType: foodTypeByKey[a.key] ?? null,
    };
    const scoreOptionsB = {
      basisLabel: b.basisLabel,
      unitGrams: unitGramsByKey[b.key],
      foodType: foodTypeByKey[b.key] ?? null,
    };
    const satA = getIngredientSatietyIndex(
      draftA.calories,
      draftA.protein,
      draftA.fiber,
      scoreOptionsA,
    );
    const satB = getIngredientSatietyIndex(
      draftB.calories,
      draftB.protein,
      draftB.fiber,
      scoreOptionsB,
    );
    if (satA == null && satB == null) return byName();
    if (satA == null) return 1;
    if (satB == null) return -1;
    if (satA !== satB) return dir * (satA - satB);
    return byName();
  }

  /** Compare deux macros numériques (kcal ou prot) avec nulls en fin. */
  const compareNumericMacro = (rawA: string, rawB: string): number => {
    const valA = parseMacroDisplay(rawA);
    const valB = parseMacroDisplay(rawB);
    if (valA == null && valB == null) return byName();
    if (valA == null) return 1;
    if (valB == null) return -1;
    if (valA !== valB) return dir * (valA - valB);
    return byName();
  };

  if (mode === "protein") return compareNumericMacro(draftA.protein, draftB.protein);
  return compareNumericMacro(draftA.calories, draftB.calories);
}

// Affiche le référentiel central des macros d'ingrédients et propage chaque modification aux recettes.
export function MacroIngredients({
  meals,
  possibleMeals,
  foodItems,
  macroLibrary,
  onSaveMacroLibrary,
  onUpdateMealIngredients,
  onUpdatePossibleIngredients,
  onUpdateFoodItemMacro,
}: MacroIngredientsProps) {
  const { library: foodLibrary, upsertEntry } = useFoodLibrary();
  const { getPreference, setPreference } = usePreferences();
  const unitGramsByKey = getPreference<Record<string, number>>(INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY, {});
  const [searchQuery, setSearchQuery] = useState("");
  const [foodTypeFilter, setFoodTypeFilter] = useState<MacroFoodTypeFilter>("all");
  const [sortMode, setSortMode] = useState<MacroSortMode>("name");
  const [sortAscending, setSortAscending] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, DraftMacro>>({});
  const [newIngredientName, setNewIngredientName] = useState("");
  const [newIngredientCalories, setNewIngredientCalories] = useState("");
  const [newIngredientProtein, setNewIngredientProtein] = useState("");
  const [newIngredientFiber, setNewIngredientFiber] = useState("");
  const [newIngredientFoodType, setNewIngredientFoodType] = useState<FoodType>(null);
  const [manuallyDeletedKeys, setManuallyDeletedKeys] = useState<Set<string>>(() => new Set());
  const pendingAutoPersistSignature = useRef<string | null>(null);
  const [unitGramsDialogEntry, setUnitGramsDialogEntry] = useState<IngredientMacroEntry | null>(null);
  const [unitGramsDraft, setUnitGramsDraft] = useState("");

  const entries = useMemo(
    () => collectIngredientMacroEntries(meals, possibleMeals, macroLibrary, foodItems),
    [meals, possibleMeals, macroLibrary, foodItems],
  );

  // Map clé → type viande/féculent pour le tri et la note (aligné sur la colonne Type).
  const foodTypeByKey = useMemo(() => {
    const map: Record<string, FoodType> = {};
    for (const entry of entries) {
      map[entry.key] = resolveIngredientFoodType(entry.key, foodItems, foodLibrary);
    }
    return map;
  }, [entries, foodItems, foodLibrary]);

  // Filtre (recherche + type) puis trie la liste, en tenant compte des brouillons non sauvegardés.
  const filteredEntries = useMemo(() => {
    const query = normalizeForMatch(searchQuery);
    let filtered = query
      ? entries.filter((entry) => normalizeForMatch(entry.displayName).includes(query))
      : [...entries];
    if (foodTypeFilter !== "all") {
      filtered = filtered.filter(
        (entry) => foodTypeByKey[entry.key] === foodTypeFilter,
      );
    }
    filtered.sort((a, b) =>
      compareMacroIngredientEntries(a, b, drafts, sortMode, sortAscending, unitGramsByKey, foodTypeByKey),
    );
    return filtered;
  }, [entries, searchQuery, foodTypeFilter, foodTypeByKey, drafts, sortMode, sortAscending, unitGramsByKey]);

  const sortLabel =
    sortMode === "name"
      ? "Nom"
      : sortMode === "note"
        ? "Note"
        : sortMode === "calories"
          ? "Calories"
          : sortMode === "protein"
            ? "Protéines"
            : "Satiété";
  const SortIcon =
    sortMode === "name"
      ? ArrowUpDown
      : sortMode === "note"
        ? Hash
        : sortMode === "calories"
          ? Flame
          : sortMode === "protein"
            ? Drumstick
            : Scale;
  const showSortDirection =
    sortMode === "note" ||
    sortMode === "calories" ||
    sortMode === "protein" ||
    sortMode === "satiety";
  const foodTypeFilterLabel =
    foodTypeFilter === "viande" ? "Via" : foodTypeFilter === "feculent" ? "Féc" : "Type";

  const newIngredientScoreOptions = useMemo(
    () => ({ basisLabel: "100g" as const, foodType: newIngredientFoodType }),
    [newIngredientFoodType],
  );

  const newIngredientSatiety = useMemo(
    () =>
      getIngredientSatietyIndex(
        newIngredientCalories,
        newIngredientProtein,
        newIngredientFiber,
        newIngredientScoreOptions,
      ),
    [newIngredientCalories, newIngredientProtein, newIngredientFiber, newIngredientScoreOptions],
  );

  const newIngredientNutritionScore = useMemo(
    () =>
      getIngredientMacroNutritionScore(
        newIngredientCalories,
        newIngredientProtein,
        newIngredientFiber,
        newIngredientScoreOptions,
      ),
    [newIngredientCalories, newIngredientProtein, newIngredientFiber, newIngredientScoreOptions],
  );

  const newIngredientNutritionScoreRaw = useMemo(
    () =>
      getIngredientMacroNutritionScoreRaw(
        newIngredientCalories,
        newIngredientProtein,
        newIngredientFiber,
        newIngredientScoreOptions,
      ),
    [newIngredientCalories, newIngredientProtein, newIngredientFiber, newIngredientScoreOptions],
  );

  /** Alterne le filtre type Macro (Tous → Viande → Féculent). */
  const toggleFoodTypeFilter = () => {
    setFoodTypeFilter((current) => cycleMacroFoodTypeFilter(current));
  };

  /** Alterne le mode de tri Macro (Nom → Note → Calories → Protéines → Satiété). */
  const toggleSortMode = () => {
    setSortMode((current) => cycleMacroSortMode(current));
    setSortAscending(true);
  };

  useEffect(() => {
    const nextLibrary = persistMissingIngredientMacroEntries(macroLibrary, entries, manuallyDeletedKeys);
    if (areIngredientMacroLibrariesEqual(nextLibrary, macroLibrary)) {
      pendingAutoPersistSignature.current = null;
      return;
    }

    const nextSignature = getMacroLibrarySignature(nextLibrary);
    if (pendingAutoPersistSignature.current === nextSignature) return;

    pendingAutoPersistSignature.current = nextSignature;
    onSaveMacroLibrary(nextLibrary);
  }, [entries, macroLibrary, manuallyDeletedKeys, onSaveMacroLibrary]);

  // Met à jour le brouillon local d'une cellule (nom / calories / protéines / fibres).
  const updateDraft = (
    entry: IngredientMacroEntry,
    field: keyof DraftMacro,
    value: string,
  ) => {
    setDrafts((current) => {
      const draft = getDraftValue(entry, current);
      return {
        ...current,
        [entry.key]: { ...draft, [field]: value },
      };
    });
  };

  // Ajoute un ingrédient libre au référentiel macros persistant.
  const addIngredient = () => {
    const item = createIngredientMacroLibraryItem(newIngredientName, newIngredientCalories, newIngredientProtein, newIngredientFiber);
    if (!item) {
      toast({ title: "Nom requis", description: "Indique le nom de l'ingrédient à ajouter.", variant: "destructive" });
      return;
    }
    if (!item.calories && !item.protein && !item.fiber) {
      toast({ title: "Macros requises", description: "Ajoute au moins une valeur de macro.", variant: "destructive" });
      return;
    }

    onSaveMacroLibrary(upsertIngredientMacroLibraryItem(macroLibrary, item));

    // Mémorise Via/Féc pour la note Macro et la prochaine création Aliments.
    const existingLibrary = foodLibrary.find((entry) => normalizeKey(entry.name || "") === item.key);
    upsertEntry.mutate({
      name: existingLibrary?.name ?? item.displayName,
      food_type: newIngredientFoodType,
      is_meal: existingLibrary?.is_meal ?? false,
      no_counter: existingLibrary?.no_counter ?? false,
      storage_type: existingLibrary?.storage_type ?? "frigo",
      calories: item.calories || existingLibrary?.calories || null,
      protein: item.protein || existingLibrary?.protein || null,
      fiber: item.fiber || existingLibrary?.fiber || null,
    });

    setNewIngredientName("");
    setNewIngredientCalories("");
    setNewIngredientProtein("");
    setNewIngredientFiber("");
    setNewIngredientFoodType(null);
    setSearchQuery(item.displayName);
    toast({ title: "Ingrédient ajouté", description: `${item.displayName} est maintenant dans le référentiel macros.` });
  };

  // Sauvegarde nom + macros et propage aux recettes, possibles et aliments.
  const saveEntry = (entry: IngredientMacroEntry) => {
    const draft = getDraftValue(entry, drafts);
    const calories = draft.calories.trim();
    const protein = draft.protein.trim();
    const fiber = draft.fiber.trim();
    const nextItem = createIngredientMacroLibraryItem(draft.displayName, calories, protein, fiber);
    if (!nextItem) {
      toast({
        title: "Nom requis",
        description: "Indique un nom d'ingrédient valide.",
        variant: "destructive",
      });
      return;
    }

    const nameChanged =
      nextItem.key !== entry.key || nextItem.displayName !== entry.displayName;

    if (nameChanged && nextItem.key !== entry.key) {
      const keyTaken =
        macroLibrary.some((item) => item.key === nextItem.key) ||
        entries.some((e) => e.key === nextItem.key);
      if (keyTaken) {
        toast({
          title: "Nom déjà utilisé",
          description: `« ${nextItem.displayName} » existe déjà dans Macro. Choisis un autre nom.`,
          variant: "destructive",
        });
        return;
      }
    }

    let renamedMeals = 0;
    let renamedPossibles = 0;
    let renamedFoods = 0;
    let macroMeals = 0;
    let macroPossibles = 0;
    let macroFoods = 0;

    if (nameChanged) {
      const renamePlan = buildIngredientRenamePlan(
        meals,
        possibleMeals,
        foodItems,
        entry.key,
        nextItem.displayName,
      );
      renamedMeals = renamePlan.mealUpdates.length;
      renamedPossibles = renamePlan.possibleUpdates.length;
      renamedFoods = renamePlan.foodUpdates.length;
    }

    // Une seule passe locale : rename puis macros sur le texte résultant (évite d’écraser le rename).
    for (const meal of meals) {
      let nextText = meal.ingredients ?? "";
      const before = nextText;
      if (nameChanged) {
        nextText =
          applyIngredientRenameToText(nextText, entry.key, nextItem.displayName) ?? nextText;
      }
      nextText =
        applyIngredientMacroToText(nextText, nextItem.key, calories, protein, fiber) ??
        applyIngredientMacroToText(nextText, entry.key, calories, protein, fiber) ??
        nextText;
      if (nextText !== before) {
        onUpdateMealIngredients(meal.id, nextText);
        macroMeals += 1;
      }
    }

    for (const pm of possibleMeals) {
      if (pm.ingredients_override == null) continue;
      let nextText = pm.ingredients_override;
      const before = nextText;
      if (nameChanged) {
        nextText =
          applyIngredientRenameToText(nextText, entry.key, nextItem.displayName) ?? nextText;
      }
      nextText =
        applyIngredientMacroToText(nextText, nextItem.key, calories, protein, fiber) ??
        applyIngredientMacroToText(nextText, entry.key, calories, protein, fiber) ??
        nextText;
      if (nextText !== before) {
        onUpdatePossibleIngredients(pm.id, nextText);
        macroPossibles += 1;
      }
    }

    for (const foodItem of foodItems) {
      if (normalizeKey(foodItem.name || "") !== entry.key) continue;
      const updates: {
        name?: string;
        calories?: string | null;
        protein?: string | null;
        fiber?: string | null;
      } = {};
      if (nameChanged && (foodItem.name || "").trim() !== nextItem.displayName) {
        updates.name = nextItem.displayName;
      }
      const macroPlan = buildIngredientMacroUpdatePlan(
        [],
        [],
        [foodItem],
        entry.key,
        calories,
        protein,
        fiber,
      );
      if (macroPlan.foodUpdates[0]) {
        updates.calories = macroPlan.foodUpdates[0].calories;
        updates.protein = macroPlan.foodUpdates[0].protein;
        updates.fiber = macroPlan.foodUpdates[0].fiber;
        macroFoods += 1;
      }
      if (Object.keys(updates).length > 0) {
        onUpdateFoodItemMacro(foodItem.id, updates);
      }
    }

    setDrafts((current) => {
      const next = { ...current };
      delete next[entry.key];
      delete next[nextItem.key];
      return next;
    });

    setManuallyDeletedKeys((current) => {
      const next = new Set(current);
      next.delete(nextItem.key);
      if (nextItem.key !== entry.key) next.delete(entry.key);
      return next;
    });

    const nextLibrary = renameIngredientMacroLibraryItem(
      macroLibrary,
      entry.key,
      nextItem.displayName,
      calories,
      protein,
      fiber,
    );
    if (nextLibrary) onSaveMacroLibrary(nextLibrary);

    if (nextItem.key !== entry.key) {
      const oldGrams = unitGramsByKey[entry.key];
      if (oldGrams != null) {
        let nextMap = upsertIngredientMacroUnitGrams(unitGramsByKey, entry.key, null);
        nextMap = upsertIngredientMacroUnitGrams(nextMap, nextItem.key, oldGrams);
        setPreference.mutate({
          key: INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY,
          value: nextMap,
        });
      }
    }

    const existingLibrary = foodLibrary.find((item) => normalizeKey(item.name || "") === entry.key);
    upsertEntry.mutate({
      name: nextItem.displayName,
      food_type: existingLibrary?.food_type ?? foodTypeByKey[entry.key] ?? null,
      is_meal: existingLibrary?.is_meal ?? false,
      no_counter: existingLibrary?.no_counter ?? false,
      storage_type: existingLibrary?.storage_type ?? "frigo",
      calories: calories || existingLibrary?.calories || null,
      protein: protein || existingLibrary?.protein || null,
      fiber: fiber || existingLibrary?.fiber || null,
    });

    if (nameChanged) {
      setSearchQuery(nextItem.displayName);
    }

    const parts: string[] = [];
    if (nameChanged) {
      parts.push(
        `renommé en « ${nextItem.displayName} » (${renamedMeals} recette(s)${
          renamedPossibles ? `, ${renamedPossibles} possible(s)` : ""
        }${renamedFoods ? `, ${renamedFoods} aliment(s)` : ""})`,
      );
    }
    parts.push(
      `macros synchronisées (${macroMeals} recette(s)${
        macroPossibles ? `, ${macroPossibles} possible(s)` : ""
      }${macroFoods ? ` et ${macroFoods} aliment(s)` : ""})`,
    );

    toast({
      title: nameChanged ? "Ingrédient renommé" : "Macros synchronisées",
      description: parts.join(" · "),
    });
  };

  /**
   * Change le type viande/féculent d'une ligne Macro : met à jour les aliments matchés
   * et mémorise le choix dans food_library pour la prochaine création Aliments.
   */
  const setEntryFoodType = (entry: IngredientMacroEntry, next: FoodType) => {
    const matching = listFoodItemsMatchingIngredientKey(entry.key, foodItems);
    for (const foodItem of matching) {
      if (foodItem.food_type === next) continue;
      onUpdateFoodItemMacro(foodItem.id, { food_type: next });
    }

    const existingLibrary = foodLibrary.find((item) => normalizeKey(item.name || "") === entry.key);
    upsertEntry.mutate({
      name: existingLibrary?.name ?? entry.displayName,
      food_type: next,
      is_meal: existingLibrary?.is_meal ?? false,
      no_counter: existingLibrary?.no_counter ?? false,
      storage_type: existingLibrary?.storage_type ?? "frigo",
      calories: existingLibrary?.calories ?? null,
      protein: existingLibrary?.protein ?? null,
      fiber: existingLibrary?.fiber ?? null,
    });
  };

  // Supprime une ligne du référentiel et efface ses macros dans recettes, possibles et aliments.
  const deleteEntry = (entry: IngredientMacroEntry) => {
    const plan = buildIngredientMacroUpdatePlan(meals, possibleMeals, foodItems, entry.key, "", "", "");

    for (const update of plan.mealUpdates) {
      onUpdateMealIngredients(update.id, update.ingredients);
    }
    for (const update of plan.possibleUpdates) {
      onUpdatePossibleIngredients(update.id, update.ingredients_override);
    }
    for (const update of plan.foodUpdates) {
      onUpdateFoodItemMacro(update.id, { calories: update.calories, protein: update.protein, fiber: update.fiber });
    }

    setDrafts((current) => {
      const next = { ...current };
      delete next[entry.key];
      return next;
    });
    setManuallyDeletedKeys((current) => new Set(current).add(entry.key));
    onSaveMacroLibrary(removeIngredientMacroLibraryItem(macroLibrary, entry.key));

    if (unitGramsByKey[entry.key] != null) {
      setPreference.mutate({
        key: INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY,
        value: upsertIngredientMacroUnitGrams(unitGramsByKey, entry.key, null),
      });
    }

    toast({
      title: "Ligne supprimée",
      description: `${entry.displayName} retiré du référentiel macros.`,
    });
  };

  /** Ouvre le dialog du poids unitaire (pour la note uniquement). */
  const openUnitGramsDialog = (entry: IngredientMacroEntry) => {
    if (entry.basisLabel !== "Quantité") return;
    const existing = unitGramsByKey[entry.key];
    setUnitGramsDraft(existing != null && existing > 0 ? String(existing) : "");
    setUnitGramsDialogEntry(entry);
  };

  /** Ferme le dialog poids-pour-la-note sans enregistrer. */
  const closeUnitGramsDialog = () => {
    setUnitGramsDialogEntry(null);
    setUnitGramsDraft("");
  };

  /** Enregistre le poids unitaire pour la note Macro seulement (pas de stock / recettes). */
  const saveUnitGramsDialog = () => {
    if (!unitGramsDialogEntry) return;
    const trimmed = unitGramsDraft.trim();
    if (!trimmed) {
      setPreference.mutate({
        key: INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY,
        value: upsertIngredientMacroUnitGrams(unitGramsByKey, unitGramsDialogEntry.key, null),
      });
      toast({
        title: "Poids note retiré",
        description: `Plus utilisé pour la note de ${unitGramsDialogEntry.displayName} (recettes et stock inchangés).`,
      });
      closeUnitGramsDialog();
      return;
    }

    const grams = parseUnitGramsInput(unitGramsDraft);
    if (grams == null) {
      toast({
        title: "Valeur invalide",
        description: "Indique un nombre de grammes strictement positif (ex. 80).",
        variant: "destructive",
      });
      return;
    }

    setPreference.mutate({
      key: INGREDIENT_MACRO_UNIT_GRAMS_PREF_KEY,
      value: upsertIngredientMacroUnitGrams(unitGramsByKey, unitGramsDialogEntry.key, grams),
    });
    toast({
      title: "Poids pour la note",
      description: `1 ${unitGramsDialogEntry.displayName} = ${grams} g — uniquement pour la note (pas les recettes ni le stock).`,
    });
    closeUnitGramsDialog();
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-2xl border bg-card/80 p-3 sm:p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-lime-500/15 p-2 text-lime-600 dark:text-lime-400">
            <Wheat className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-extrabold">Macro ingrédients</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Référentiel des calories, protéines et fibres précisées dans les onglets Repas et Aliments. Une sauvegarde propage la macro à toutes les occurrences.
            </p>
          </div>
        </div>

        <div className="relative mt-3 flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Rechercher un ingrédient..."
              className="rounded-xl pl-9 text-sm"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={toggleFoodTypeFilter}
            className={`h-9 shrink-0 gap-1 rounded-xl border px-2 text-[10px] ${
              foodTypeFilter === "feculent"
                ? "border-amber-400/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : foodTypeFilter === "viande"
                  ? "border-red-400/50 bg-red-500/15 text-red-700 dark:text-red-300"
                  : "border-border/40"
            }`}
            title={
              foodTypeFilter === "all"
                ? "Filtrer : tous les types"
                : foodTypeFilter === "viande"
                  ? "Filtre Viande (cliquer : Féculent)"
                  : "Filtre Féculent (cliquer : Tous)"
            }
          >
            {foodTypeFilter === "viande" ? (
              <Drumstick className="h-3.5 w-3.5" />
            ) : (
              <Wheat className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{foodTypeFilterLabel}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={toggleSortMode}
            className="h-9 shrink-0 gap-1 rounded-xl border border-border/40 px-2 text-[10px]"
            title="Changer le tri"
          >
            <SortIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{sortLabel}</span>
          </Button>
          {showSortDirection && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSortAscending((current) => !current)}
              className="h-9 w-9 shrink-0 rounded-xl border border-border/40 p-0"
              title={sortAscending ? "Croissant" : "Décroissant"}
            >
              {sortAscending ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(180px,1fr)_90px_90px_90px_auto_auto]">
          <Input
            value={newIngredientName}
            onChange={(event) => setNewIngredientName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addIngredient()}
            placeholder="Nouvel ingrédient"
            className="rounded-xl text-sm"
          />
          <Input
            value={newIngredientCalories}
            onChange={(event) => setNewIngredientCalories(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addIngredient()}
            inputMode="decimal"
            placeholder="Kcal"
            className="rounded-xl text-center text-sm"
          />
          <Input
            value={newIngredientProtein}
            onChange={(event) => setNewIngredientProtein(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addIngredient()}
            inputMode="decimal"
            placeholder="Prot."
            className="rounded-xl text-center text-sm"
          />
          <Input
            value={newIngredientFiber}
            onChange={(event) => setNewIngredientFiber(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addIngredient()}
            inputMode="decimal"
            placeholder="Fib."
            className="rounded-xl text-center text-sm"
          />
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setNewIngredientFoodType((prev) => (prev === "feculent" ? null : "feculent"))
              }
              className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-0.5 border transition-all ${
                newIngredientFoodType === "feculent"
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-400/50 font-bold"
                  : "bg-muted text-muted-foreground border-border"
              }`}
              title="Marquer comme féculent (note Macro adaptée)"
            >
              <Wheat className="h-3 w-3" />
              Féc
            </button>
            <button
              type="button"
              onClick={() =>
                setNewIngredientFoodType((prev) => (prev === "viande" ? null : "viande"))
              }
              className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-0.5 border transition-all ${
                newIngredientFoodType === "viande"
                  ? "bg-red-500/20 text-red-700 dark:text-red-300 border-red-400/50 font-bold"
                  : "bg-muted text-muted-foreground border-border"
              }`}
              title="Marquer comme viande (note Macro adaptée)"
            >
              <Drumstick className="h-3 w-3" />
              Via
            </button>
            <NutritionScoreBadge
              score={newIngredientNutritionScore}
              rawScore={newIngredientNutritionScoreRaw}
            />
            <span title="Indice Meals Cards pour 100 g">
              <SatietyIndexBadge
                index={newIngredientSatiety}
                caloriesPer100g={parseMacroDisplay(newIngredientCalories)}
                compact
              />
            </span>
          </div>
          <Button onClick={addIngredient} className="rounded-xl gap-1 text-xs">
            <Plus className="h-3.5 w-3.5" />
            Ajouter
          </Button>
        </div>
      </div>

      <div className="mx-auto w-fit max-w-full overflow-x-auto rounded-2xl border bg-card shadow-sm">
        <div className="grid grid-cols-[180px_88px_52px_72px_72px_72px_52px_64px_48px] sm:grid-cols-[260px_128px_56px_96px_96px_96px_64px_80px_56px] gap-0 border-b bg-muted/70 px-2 py-2 text-[10px] sm:text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <span>Ingrédient</span>
          <span className="text-center">Base</span>
          <span className="text-center">Type</span>
          <span className="flex items-center justify-center gap-1"><Flame className="h-3 w-3 text-orange-500" />Kcal</span>
          <span className="flex items-center justify-center gap-1"><Drumstick className="h-3 w-3 text-blue-500" />Prot.</span>
          <span className="flex items-center justify-center gap-1"><Wheat className="h-3 w-3 text-emerald-500" />Fib.</span>
          <span className="flex items-center justify-center gap-1" title="Indice Meals Cards estimé pour 100 g"><Scale className="h-3 w-3 text-violet-500" />Sat.</span>
          <span className="text-center">Save</span>
          <span className="text-center">Suppr.</span>
        </div>

        {filteredEntries.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Aucun ingrédient avec macros trouvées. Ajoute des valeurs dans les ingrédients d'une recette, ex. <span className="font-mono">100g Dinde{"{105}"} [24]</span>.
          </div>
        ) : (
          <div className="divide-y">
            {filteredEntries.map((entry) => {
              const draft = getDraftValue(entry, drafts);
              const changed = hasDraftChanged(entry, drafts);
              const hasConflict = entry.hasConflictingCalories || entry.hasConflictingProtein || entry.hasConflictingFiber;
              const hasMissingMacro = !draft.calories.trim() || !draft.protein.trim() || !draft.fiber.trim();
              const foodType = foodTypeByKey[entry.key] ?? null;
              const unitGrams = unitGramsByKey[entry.key];
              const scoreOptions = {
                basisLabel: entry.basisLabel,
                unitGrams,
                foodType: foodTypeByKey[entry.key] ?? null,
              };

              const satietyIndex = getIngredientSatietyIndex(
                draft.calories,
                draft.protein,
                draft.fiber,
                scoreOptions,
              );

              return (
                <div key={entry.key} className="grid grid-cols-[180px_88px_52px_72px_72px_72px_52px_64px_48px] sm:grid-cols-[260px_128px_56px_96px_96px_96px_64px_80px_56px] items-center gap-0 px-2 py-2">
                  <div className="min-w-0 pr-2">
                    <ClickToEditText
                      value={draft.displayName}
                      onChange={(value) => updateDraft(entry, "displayName", value)}
                      emptyLabel="Nom de l'ingrédient"
                      placeholder="Nom"
                      title="Cliquer pour renommer (recettes, aliments, possibles)"
                      textClassName={`text-xs sm:text-sm font-semibold ${
                        hasMissingMacro ? "text-red-500" : ""
                      }`}
                      inputClassName={`min-w-0 flex-1 h-8 text-xs sm:text-sm font-semibold ${
                        hasMissingMacro ? "text-red-500 border-red-500/40" : ""
                      }`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && changed) {
                          e.preventDefault();
                          saveEntry(entry);
                        }
                      }}
                      trailing={
                        <NutritionScoreBadge
                          score={getIngredientMacroNutritionScore(draft.calories, draft.protein, draft.fiber, scoreOptions)}
                          rawScore={getIngredientMacroNutritionScoreRaw(draft.calories, draft.protein, draft.fiber, scoreOptions)}
                        />
                      }
                    />
                    <p className="break-words whitespace-normal text-[10px] text-muted-foreground leading-snug mt-0.5">
                      {entry.recipeCount} recette(s){entry.foodCount ? ` · ${entry.foodCount} aliment(s)` : ""}{entry.overrideCount ? ` · ${entry.overrideCount} possible(s)` : ""}
                    </p>
                    {hasConflict && (
                      <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        Valeurs différentes détectées
                      </p>
                    )}
                  </div>

                  {entry.basisLabel === "Quantité" ? (
                    <button
                      type="button"
                      onClick={() => openUnitGramsDialog(entry)}
                      className={`mx-auto max-w-[80px] truncate rounded-full px-2 py-1 text-center text-[10px] font-semibold sm:max-w-[120px] border transition-colors ${
                        unitGrams != null && unitGrams > 0
                          ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/15"
                          : "bg-muted text-red-400 border-transparent hover:bg-muted/80 hover:border-border"
                      }`}
                      title={formatUnitGramsNoteTooltip(entry.displayName, unitGrams)}
                    >
                      {formatMacroBasisBadgeLabel(entry.basisLabel, unitGrams)}
                    </button>
                  ) : (
                    <span className="mx-auto max-w-[80px] truncate rounded-full bg-muted px-2 py-1 text-center text-[10px] font-semibold text-muted-foreground sm:max-w-[120px]">
                      {formatMacroBasisBadgeLabel(entry.basisLabel, unitGrams)}
                    </span>
                  )}

                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setEntryFoodType(entry, cycleFoodType(foodType))}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${
                        foodType === "feculent"
                          ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-400/50 font-bold"
                          : foodType === "viande"
                            ? "bg-red-500/20 text-red-700 dark:text-red-300 border-red-400/50 font-bold"
                            : "bg-muted text-muted-foreground border-border"
                      }`}
                      title={
                        foodType === "feculent"
                          ? "Féculent (cliquer: Viande)"
                          : foodType === "viande"
                            ? "Viande (cliquer: Aucun)"
                            : "Aucun type (cliquer: Féculent)"
                      }
                    >
                      {foodType === "viande" ? <Drumstick className="h-2.5 w-2.5" /> : <Wheat className="h-2.5 w-2.5" />}
                      {foodType === "feculent" ? "Féc" : foodType === "viande" ? "Via" : ""}
                    </button>
                  </div>

                  <Input
                    value={draft.calories}
                    onChange={(event) => updateDraft(entry, "calories", event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && saveEntry(entry)}
                    inputMode="decimal"
                    className="mx-auto h-8 w-16 sm:w-20 rounded-lg text-center text-xs placeholder:text-red-500 placeholder:opacity-100"
                    placeholder="0"
                  />

                  <Input
                    value={draft.protein}
                    onChange={(event) => updateDraft(entry, "protein", event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && saveEntry(entry)}
                    inputMode="decimal"
                    className="mx-auto h-8 w-16 sm:w-20 rounded-lg text-center text-xs placeholder:text-red-500 placeholder:opacity-100"
                    placeholder="0"
                  />

                  <Input
                    value={draft.fiber}
                    onChange={(event) => updateDraft(entry, "fiber", event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && saveEntry(entry)}
                    inputMode="decimal"
                    className="mx-auto h-8 w-16 sm:w-20 rounded-lg text-center text-xs placeholder:text-red-500 placeholder:opacity-100"
                    placeholder="0"
                  />

                  <div className="flex justify-center">
                    <SatietyIndexBadge
                      index={satietyIndex}
                      caloriesPer100g={parseMacroDisplay(draft.calories)}
                      missingTitle={
                        entry.basisLabel === "Quantité" && !(unitGrams != null && unitGrams > 0)
                          ? "Indiquer le poids d'une unité pour calculer la satiété au 100 g"
                          : "Satiété : renseigne kcal, prot. et fib."
                      }
                    />
                  </div>

                  <div className="flex justify-center">
                    <Button
                      size="sm"
                      variant={changed ? "default" : "secondary"}
                      disabled={!changed}
                      onClick={() => saveEntry(entry)}
                      className="h-8 w-10 sm:w-auto rounded-xl px-2 text-xs"
                    >
                      <Save className="h-3.5 w-3.5 sm:mr-1" />
                      <span className="hidden sm:inline">OK</span>
                    </Button>
                  </div>

                  <div className="flex justify-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteEntry(entry)}
                      className="h-8 w-8 rounded-xl p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      title={`Supprimer ${entry.displayName}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={unitGramsDialogEntry != null}
        onOpenChange={(open) => {
          if (!open) closeUnitGramsDialog();
        }}
      >
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Poids pour la note</DialogTitle>
            <DialogDescription>
              {unitGramsDialogEntry
                ? `Combien pèse 1 ${unitGramsDialogEntry.displayName} ? Sert uniquement à ajuster la note nutritionnelle — n'affecte ni les recettes ni le stock Aliments.`
                : "Poids d'une unité pour la note uniquement."}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={unitGramsDraft}
            onChange={(event) => setUnitGramsDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && saveUnitGramsDialog()}
            inputMode="decimal"
            placeholder="ex. 80"
            className="rounded-xl text-center"
            autoFocus
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={closeUnitGramsDialog} className="rounded-xl">
              Annuler
            </Button>
            <Button type="button" onClick={saveUnitGramsDialog} className="rounded-xl">
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
