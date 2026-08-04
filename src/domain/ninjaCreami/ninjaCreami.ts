/**
 * Domaine Ninja Creami : catalogues d’ingrédients Tests, totaux macros,
 * filtrage Recettes testées hors « Tous · Desserts ».
 */
import {
  serializeIngredients,
  type IngLine,
} from "@/lib/ingredientUtils";
import {
  createIngredientMacroLibraryItem,
  upsertIngredientMacroLibraryItem,
  type IngredientMacroLibraryItem,
} from "@/domain/macros/ingredientMacroDatabase";

/** Clés de préférences Ninja Creami. */
export const NINJA_CREAMI_MEAL_IDS_KEY = "ninja_creami_meal_ids";
/** Noms d’affichage Recettes testées (indépendants du nom Possible / meals.name). */
export const NINJA_CREAMI_MEAL_DISPLAY_NAMES_KEY = "ninja_creami_meal_display_names";
export const NINJA_CREAMI_BASE_LINES_KEY = "ninja_creami_base_lines";
export const NINJA_CREAMI_BASE_GROUPS_KEY = "ninja_creami_base_groups";
export const NINJA_CREAMI_EXTRAS_LINES_KEY = "ninja_creami_extras_lines";
export const NINJA_CREAMI_TEST_PM_IDS_KEY = "ninja_creami_test_pm_ids";

/** MIME drag & drop pour déplacer une ligne entre sous-catégories Base. */
export const NINJA_CREAMI_LINE_DND_MIME = "application/x-ninja-creami-line";

/** MIME drag & drop pour réordonner les sous-catégories Base. */
export const NINJA_CREAMI_GROUP_DND_MIME = "application/x-ninja-creami-group";

/** Id stable de la sous-catégorie créée lors de la migration depuis la liste plate. */
export const NINJA_CREAMI_DEFAULT_BASE_GROUP_ID = "ninja-base-general";

/** Ligne catalogue Tests avec id stable pour la sélection. */
export type NinjaCreamiCatalogLine = IngLine & { id: string };

/** Sous-catégorie d’ingrédients dans Base (Tests). */
export type NinjaCreamiBaseGroup = {
  id: string;
  name: string;
  lines: NinjaCreamiCatalogLine[];
};

/** Payload DnD d’une ligne catalogue entre sous-catégories. */
export type NinjaCreamiLineDragPayload = {
  fromGroupId: string;
  line: NinjaCreamiCatalogLine;
};

/** Totaux macros d’une sélection d’ingrédients. */
export type NinjaCreamiMacroTotals = {
  calories: number;
  protein: number;
  fiber: number;
};

/**
 * Génère un id stable pour une nouvelle ligne catalogue Tests.
 */
export function createNinjaCreamiLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ninja-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Génère un id pour une sous-catégorie Base.
 */
export function createNinjaCreamiGroupId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ninja-group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Crée une sous-catégorie Base vide (avec une ligne de saisie).
 */
export function createEmptyNinjaCreamiBaseGroup(
  name = "Nouvelle sous-catégorie",
): NinjaCreamiBaseGroup {
  return {
    id: createNinjaCreamiGroupId(),
    name,
    lines: [createEmptyNinjaCreamiCatalogLine()],
  };
}

/**
 * Aplatit toutes les lignes des sous-catégories Base (totaux / sync macros).
 */
export function flattenNinjaCreamiBaseGroups(
  groups: NinjaCreamiBaseGroup[],
): NinjaCreamiCatalogLine[] {
  return groups.flatMap((g) => g.lines);
}

/**
 * Indique si une ligne catalogue a un contenu utile (pas seulement la ligne vide de fin).
 */
export function catalogLineHasContent(line: NinjaCreamiCatalogLine): boolean {
  return Boolean(
    line.name.trim() ||
      line.qty.trim() ||
      line.count.trim() ||
      line.cal.trim() ||
      line.pro.trim() ||
      line.fiber.trim(),
  );
}

/**
 * Indique si au moins une sous-catégorie Base contient un ingrédient.
 */
export function ninjaCreamiBaseGroupsHaveContent(groups: NinjaCreamiBaseGroup[]): boolean {
  return groups.some((g) => g.lines.some(catalogLineHasContent));
}

/** Clé localStorage : backup anti-wipe des sous-catégories Base. */
export const NINJA_CREAMI_BASE_GROUPS_LOCAL_BACKUP_KEY = "ninja_creami_base_groups_local_backup";

/**
 * Sauvegarde locale des sous-catégories Base (uniquement si non vides).
 */
export function saveNinjaCreamiBaseGroupsLocalBackup(groups: NinjaCreamiBaseGroup[]): void {
  if (typeof localStorage === "undefined") return;
  if (!ninjaCreamiBaseGroupsHaveContent(groups)) return;
  try {
    localStorage.setItem(NINJA_CREAMI_BASE_GROUPS_LOCAL_BACKUP_KEY, JSON.stringify(groups));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Charge le backup local des sous-catégories Base, ou null.
 */
export function loadNinjaCreamiBaseGroupsLocalBackup(): NinjaCreamiBaseGroup[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(NINJA_CREAMI_BASE_GROUPS_LOCAL_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const groups: NinjaCreamiBaseGroup[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Partial<NinjaCreamiBaseGroup>;
      const id = typeof e.id === "string" && e.id ? e.id : createNinjaCreamiGroupId();
      const name =
        typeof e.name === "string" && e.name.trim() ? e.name.trim() : "Sous-catégorie";
      groups.push({
        id,
        name,
        lines: normalizeNinjaCreamiCatalogLines(e.lines),
      });
    }
    return ninjaCreamiBaseGroupsHaveContent(groups) ? groups : null;
  } catch {
    return null;
  }
}

/**
 * Normalise les sous-catégories Base ; migre / répare depuis l’ancienne liste plate ou le backup local.
 */
export function normalizeNinjaCreamiBaseGroups(
  rawGroups: unknown,
  legacyLines: unknown = [],
  localBackup: NinjaCreamiBaseGroup[] | null = null,
): NinjaCreamiBaseGroup[] {
  const legacyNormalized = normalizeNinjaCreamiCatalogLines(legacyLines);
  const legacyHasContent = legacyNormalized.some(catalogLineHasContent);
  const backupHasContent = Boolean(localBackup && ninjaCreamiBaseGroupsHaveContent(localBackup));

  if (Array.isArray(rawGroups) && rawGroups.length > 0) {
    const groups: NinjaCreamiBaseGroup[] = [];
    for (const entry of rawGroups) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Partial<NinjaCreamiBaseGroup>;
      const name =
        typeof e.name === "string" && e.name.trim() ? e.name.trim() : "Sous-catégorie";
      const id = typeof e.id === "string" && e.id ? e.id : createNinjaCreamiGroupId();
      groups.push({
        id,
        name,
        lines: normalizeNinjaCreamiCatalogLines(e.lines),
      });
    }
    if (groups.length > 0) {
      const groupsHaveContent = ninjaCreamiBaseGroupsHaveContent(groups);
      // Sous-cats vides alors que l’ancienne liste plate a encore des données → récupération.
      if (!groupsHaveContent && legacyHasContent) {
        return [
          {
            id: NINJA_CREAMI_DEFAULT_BASE_GROUP_ID,
            name: "Général",
            lines: legacyNormalized,
          },
        ];
      }
      // Prefs cloud vides mais backup local encore plein → récupération.
      if (!groupsHaveContent && backupHasContent && localBackup) {
        return localBackup;
      }
      return groups;
    }
  }

  if (legacyHasContent) {
    return [
      {
        id: NINJA_CREAMI_DEFAULT_BASE_GROUP_ID,
        name: "Général",
        lines: legacyNormalized,
      },
    ];
  }

  if (backupHasContent && localBackup) {
    return localBackup;
  }

  return [
    {
      id: NINJA_CREAMI_DEFAULT_BASE_GROUP_ID,
      name: "Général",
      lines: legacyNormalized,
    },
  ];
}

/**
 * Met à jour les lignes d’une sous-catégorie Base.
 */
export function updateNinjaCreamiBaseGroupLines(
  groups: NinjaCreamiBaseGroup[],
  groupId: string,
  lines: NinjaCreamiCatalogLine[],
): NinjaCreamiBaseGroup[] {
  return groups.map((g) => (g.id === groupId ? { ...g, lines } : g));
}

/**
 * Renomme une sous-catégorie Base (conserve le texte tel quel ; le UI gère le fallback au blur).
 */
export function renameNinjaCreamiBaseGroup(
  groups: NinjaCreamiBaseGroup[],
  groupId: string,
  name: string,
): NinjaCreamiBaseGroup[] {
  return groups.map((g) => (g.id === groupId ? { ...g, name } : g));
}

/**
 * Ajoute une sous-catégorie Base à la fin.
 */
export function addNinjaCreamiBaseGroup(
  groups: NinjaCreamiBaseGroup[],
  name?: string,
): NinjaCreamiBaseGroup[] {
  return [...groups, createEmptyNinjaCreamiBaseGroup(name)];
}

/**
 * Réordonne les sous-catégories Base (drag & drop manuel).
 */
export function reorderNinjaCreamiBaseGroups(
  groups: NinjaCreamiBaseGroup[],
  fromIndex: number,
  toIndex: number,
): NinjaCreamiBaseGroup[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= groups.length ||
    toIndex >= groups.length
  ) {
    return groups;
  }
  const next = [...groups];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return groups;
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Supprime une sous-catégorie Base (conserve au moins une).
 * Les lignes non vides sont fusionnées dans la première sous-catégorie restante.
 */
export function removeNinjaCreamiBaseGroup(
  groups: NinjaCreamiBaseGroup[],
  groupId: string,
): NinjaCreamiBaseGroup[] {
  if (groups.length <= 1) return groups;
  const removed = groups.find((g) => g.id === groupId);
  const remaining = groups.filter((g) => g.id !== groupId);
  if (!removed || remaining.length === 0) return groups;

  const moved = removed.lines.filter(
    (l) => l.name.trim() || l.qty.trim() || l.count.trim() || l.cal.trim() || l.pro.trim() || l.fiber.trim(),
  );
  if (moved.length === 0) return remaining;

  const [first, ...rest] = remaining;
  const mergedLines = normalizeNinjaCreamiCatalogLines([...first.lines, ...moved]);
  return [{ ...first, lines: mergedLines }, ...rest];
}

/**
 * Déplace une ligne d’une sous-catégorie Base vers une autre (ou réordonne si même groupe).
 */
export function moveLineBetweenNinjaCreamiBaseGroups(
  groups: NinjaCreamiBaseGroup[],
  fromGroupId: string,
  lineId: string,
  toGroupId: string,
  toIndex: number,
): NinjaCreamiBaseGroup[] {
  const fromGroup = groups.find((g) => g.id === fromGroupId);
  if (!fromGroup) return groups;
  const lineIdx = fromGroup.lines.findIndex((l) => l.id === lineId);
  if (lineIdx < 0) return groups;
  const line = fromGroup.lines[lineIdx];

  if (fromGroupId === toGroupId) {
    const nextLines = [...fromGroup.lines];
    nextLines.splice(lineIdx, 1);
    const insertAt = Math.max(0, Math.min(toIndex, nextLines.length));
    nextLines.splice(insertAt, 0, line);
    return updateNinjaCreamiBaseGroupLines(
      groups,
      fromGroupId,
      normalizeNinjaCreamiCatalogLines(nextLines),
    );
  }

  const without = updateNinjaCreamiBaseGroupLines(
    groups,
    fromGroupId,
    normalizeNinjaCreamiCatalogLines(fromGroup.lines.filter((l) => l.id !== lineId)),
  );
  const toGroup = without.find((g) => g.id === toGroupId);
  if (!toGroup) return groups;
  const nextTo = [...toGroup.lines];
  const insertAt = Math.max(0, Math.min(toIndex, nextTo.length));
  nextTo.splice(insertAt, 0, line);
  return updateNinjaCreamiBaseGroupLines(
    without,
    toGroupId,
    normalizeNinjaCreamiCatalogLines(nextTo),
  );
}

/**
 * Crée une ligne catalogue vide (prête pour saisie).
 */
export function createEmptyNinjaCreamiCatalogLine(): NinjaCreamiCatalogLine {
  return {
    id: createNinjaCreamiLineId(),
    qty: "",
    count: "",
    name: "",
    cal: "",
    pro: "",
    fiber: "",
    isOr: false,
    isAnd: false,
    isOptional: false,
  };
}

/**
 * Normalise un tableau issu des prefs en lignes catalogue valides.
 */
export function normalizeNinjaCreamiCatalogLines(raw: unknown): NinjaCreamiCatalogLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [createEmptyNinjaCreamiCatalogLine()];
  }
  const lines: NinjaCreamiCatalogLine[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Partial<NinjaCreamiCatalogLine>;
    lines.push({
      id: typeof e.id === "string" && e.id ? e.id : createNinjaCreamiLineId(),
      qty: typeof e.qty === "string" ? e.qty : "",
      count: typeof e.count === "string" ? e.count : "",
      name: typeof e.name === "string" ? e.name : "",
      cal: typeof e.cal === "string" ? e.cal : "",
      pro: typeof e.pro === "string" ? e.pro : "",
      fiber: typeof e.fiber === "string" ? e.fiber : "",
      isOr: Boolean(e.isOr),
      isAnd: Boolean(e.isAnd),
      isOptional: Boolean(e.isOptional),
    });
  }
  if (lines.length === 0) return [createEmptyNinjaCreamiCatalogLine()];
  const last = lines[lines.length - 1];
  if (last.name.trim() || last.qty.trim() || last.count.trim()) {
    lines.push(createEmptyNinjaCreamiCatalogLine());
  }
  return lines;
}

/**
 * Indique si une ligne catalogue a un contenu utilisable (nom non vide).
 */
export function isNinjaCreamiLineSelectable(line: NinjaCreamiCatalogLine): boolean {
  return Boolean(line.name?.trim());
}

/**
 * Parse une macro ligne (virgule ou point) en nombre ; vide / invalide → 0.
 */
function parseLineMacro(raw: string | undefined): number {
  if (!raw?.trim()) return 0;
  const n = parseFloat(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Contribution macros d’une ligne catalogue :
 * - grammes (qty) → valeur × qty / 100 (macros saisies au 100 g)
 * - nombre (count) → valeur × count
 * - sinon → valeur brute
 */
function ninjaCreamiLineMacroContribution(
  line: NinjaCreamiCatalogLine,
  field: "cal" | "pro" | "fiber",
): number {
  const value = parseLineMacro(line[field]);
  if (!value) return 0;
  const qty = parseLineMacro(line.qty);
  if (qty > 0) return (value * qty) / 100;
  const count = parseLineMacro(line.count);
  if (count > 0) return value * count;
  return value;
}

/**
 * Calcule le total macros des lignes dont l’id est dans `selectedIds`.
 * Scale les macros /100g selon les grammes (ou × count si pas de grammes).
 */
export function sumSelectedNinjaCreamiMacros(
  lines: NinjaCreamiCatalogLine[],
  selectedIds: ReadonlySet<string> | string[],
): NinjaCreamiMacroTotals {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  let calories = 0;
  let protein = 0;
  let fiber = 0;
  for (const line of lines) {
    if (!selected.has(line.id) || !isNinjaCreamiLineSelectable(line)) continue;
    calories += ninjaCreamiLineMacroContribution(line, "cal");
    protein += ninjaCreamiLineMacroContribution(line, "pro");
    fiber += ninjaCreamiLineMacroContribution(line, "fiber");
  }
  return {
    calories: Math.round(calories * 10) / 10,
    protein: Math.round(protein * 10) / 10,
    fiber: Math.round(fiber * 10) / 10,
  };
}

/**
 * Fusionne Base + Extras sélectionnés puis sérialise au format recettes.
 */
export function serializeSelectedNinjaCreamiIngredients(
  baseLines: NinjaCreamiCatalogLine[],
  extrasLines: NinjaCreamiCatalogLine[],
  selectedIds: ReadonlySet<string> | string[],
): string | null {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const picked: IngLine[] = [];
  for (const line of [...baseLines, ...extrasLines]) {
    if (!selected.has(line.id) || !isNinjaCreamiLineSelectable(line)) continue;
    picked.push({
      qty: line.qty,
      count: line.count,
      name: line.name,
      cal: line.cal,
      pro: line.pro,
      fiber: line.fiber,
      isOr: false,
      isAnd: false,
      isOptional: false,
    });
  }
  return serializeIngredients(picked);
}

/**
 * Exclut les IDs Recettes testées du catalogue « Tous · Desserts ».
 */
export function filterOutNinjaCreamiMeals<T extends { id: string }>(
  meals: T[],
  ninjaMealIds: ReadonlySet<string> | string[],
): T[] {
  if (!ninjaMealIds || (Array.isArray(ninjaMealIds) && ninjaMealIds.length === 0)) {
    return meals;
  }
  const ids = ninjaMealIds instanceof Set ? ninjaMealIds : new Set(ninjaMealIds);
  if (ids.size === 0) return meals;
  return meals.filter((m) => !ids.has(m.id));
}

/**
 * Ne garde que les meals marqués Recettes testées (ordre de la pref si possible).
 */
export function filterNinjaCreamiTestedMeals<T extends { id: string }>(
  meals: T[],
  ninjaMealIds: string[],
): T[] {
  if (!ninjaMealIds.length) return [];
  const byId = new Map(meals.map((m) => [m.id, m]));
  const out: T[] = [];
  for (const id of ninjaMealIds) {
    const meal = byId.get(id);
    if (meal) out.push(meal);
  }
  return out;
}

/**
 * Ingrédients à persister sur le meal lors de « Enregistrer dans Recettes testées »
 * (priorité à l’override Possible, sinon les ingrédients du meal).
 */
export function resolveIngredientsForNinjaCreamiTestedSave(pm: {
  ingredients_override?: string | null;
  meals?: { ingredients?: string | null } | null;
}): string | null {
  if (pm.ingredients_override != null) {
    const trimmed = String(pm.ingredients_override).trim();
    // Override volontairement vide : on le respecte.
    return trimmed === "" ? "" : pm.ingredients_override;
  }
  return pm.meals?.ingredients ?? null;
}

/**
 * Indique si une carte Possible Ninja Creami ne doit pas toucher au stock
 * (créée depuis Tests, ou meal déjà en Recettes testées).
 */
export function isNinjaCreamiStockExemptPossibleMeal(
  pmId: string,
  mealId: string | null | undefined,
  testPmIds: ReadonlySet<string> | readonly string[] | null | undefined,
  testedMealIds: ReadonlySet<string> | readonly string[] | null | undefined,
): boolean {
  if (!pmId?.trim()) return false;
  const testSet =
    testPmIds instanceof Set
      ? testPmIds
      : new Set(Array.isArray(testPmIds) ? testPmIds : []);
  if (testSet.has(pmId)) return true;
  if (!mealId?.trim() || !testedMealIds) return false;
  const mealSet =
    testedMealIds instanceof Set
      ? testedMealIds
      : new Set(Array.isArray(testedMealIds) ? testedMealIds : []);
  return mealSet.has(mealId);
}

/**
 * Ajoute un meal id à la liste Recettes testées (sans doublon).
 */
export function addNinjaCreamiMealId(ids: string[], mealId: string): string[] {
  if (!mealId || ids.includes(mealId)) return ids;
  return [...ids, mealId];
}

/**
 * Retire un meal id de la liste Recettes testées.
 */
export function removeNinjaCreamiMealId(ids: string[], mealId: string): string[] {
  return ids.filter((id) => id !== mealId);
}

/**
 * Normalise la map des noms d’affichage Recettes testées.
 */
export function normalizeNinjaCreamiMealDisplayNames(
  raw: unknown,
): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [id, name] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || typeof name !== "string") continue;
    const trimmed = name.trim();
    if (!trimmed) continue;
    out[id] = trimmed;
  }
  return out;
}

/**
 * Nom affiché dans Recettes testées (override local, sinon meals.name).
 */
export function resolveNinjaCreamiMealDisplayName(
  mealId: string,
  mealName: string,
  displayNames: Record<string, string> | null | undefined,
): string {
  const override = displayNames?.[mealId]?.trim();
  return override || mealName;
}

/**
 * Enregistre / met à jour le nom d’affichage d’une recette testée.
 */
export function setNinjaCreamiMealDisplayName(
  displayNames: Record<string, string>,
  mealId: string,
  name: string,
): Record<string, string> {
  if (!mealId) return displayNames;
  const trimmed = name.trim();
  if (!trimmed) {
    const next = { ...displayNames };
    delete next[mealId];
    return next;
  }
  return { ...displayNames, [mealId]: trimmed };
}

/**
 * Retire le nom d’affichage d’une recette retirée de Recettes testées.
 */
export function removeNinjaCreamiMealDisplayName(
  displayNames: Record<string, string>,
  mealId: string,
): Record<string, string> {
  if (!mealId || !(mealId in displayNames)) return displayNames;
  const next = { ...displayNames };
  delete next[mealId];
  return next;
}

/**
 * Applique les noms d’affichage Recettes testées sur une liste de repas.
 */
export function applyNinjaCreamiMealDisplayNames<T extends { id: string; name: string }>(
  meals: T[],
  displayNames: Record<string, string> | null | undefined,
): T[] {
  if (!displayNames || Object.keys(displayNames).length === 0) return meals;
  return meals.map((meal) => {
    const name = resolveNinjaCreamiMealDisplayName(meal.id, meal.name, displayNames);
    return name === meal.name ? meal : { ...meal, name };
  });
}

/** Préfixe affiché dans « Au choix » pour les recettes Ninja Creami. */
export const NINJA_CREAMI_AU_CHOIX_NAME_PREFIX = "Glace : ";

/**
 * Préfixe « Glace : » pour l’affichage Au choix des recettes Ninja Creami
 * (sans modifier le nom stocké / Possible).
 */
export function applyNinjaCreamiAuChoixDisplayNames<T extends { id: string; name: string }>(
  meals: T[],
  ninjaMealIds: readonly string[] | Set<string>,
  displayNames?: Record<string, string> | null,
): T[] {
  const idSet = ninjaMealIds instanceof Set ? ninjaMealIds : new Set(ninjaMealIds);
  if (idSet.size === 0 && (!displayNames || Object.keys(displayNames).length === 0)) {
    return meals;
  }
  const withDisplay = applyNinjaCreamiMealDisplayNames(meals, displayNames);
  return withDisplay.map((meal) => {
    if (!idSet.has(meal.id)) return meal;
    const base = meal.name.trim();
    if (!base) return meal;
    if (base.startsWith(NINJA_CREAMI_AU_CHOIX_NAME_PREFIX)) return meal;
    return { ...meal, name: `${NINJA_CREAMI_AU_CHOIX_NAME_PREFIX}${base}` };
  });
}

/**
 * Ajoute un possible id issu de Tests (sans doublon).
 */
export function addNinjaCreamiTestPmId(ids: string[], pmId: string): string[] {
  if (!pmId || ids.includes(pmId)) return ids;
  return [...ids, pmId];
}

/**
 * Indique si une macro référentiel est absente ou nulle (à compléter depuis Ninja Creami).
 */
export function isUnsetIngredientMacroValue(value: string | undefined | null): boolean {
  const t = (value ?? "").trim();
  if (!t) return true;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n === 0;
}

/**
 * Choisit la valeur macro à garder : conserve une saisie référentiel non nulle, sinon prend Ninja.
 */
function pickMacroForNinjaUpsert(existingValue: string | undefined | null, incomingValue: string): string {
  if (!isUnsetIngredientMacroValue(existingValue)) return (existingValue ?? "").trim();
  return incomingValue.trim();
}

/**
 * Upsert Macro ingrédients depuis une ligne Ninja Creami.
 * - fillEmpty (défaut) : complète seulement les champs vides/0
 * - overwrite : remplace les macros non vides saisies dans Ninja (commit utilisateur)
 */
export function upsertMacroLibraryFromNinjaLineName(
  library: IngredientMacroLibraryItem[],
  name: string,
  cal: string,
  pro: string,
  fiber: string,
  options?: { overwrite?: boolean },
): IngredientMacroLibraryItem[] {
  const item = createIngredientMacroLibraryItem(name, cal, pro, fiber);
  if (!item) return library;
  const overwrite = Boolean(options?.overwrite);

  const hasIncomingMacros =
    !isUnsetIngredientMacroValue(item.calories) ||
    !isUnsetIngredientMacroValue(item.protein) ||
    !isUnsetIngredientMacroValue(item.fiber);

  const existing = library.find((e) => e.key === item.key);
  if (existing) {
    if (!hasIncomingMacros) return library;

    const merged = createIngredientMacroLibraryItem(
      existing.displayName || item.displayName,
      overwrite
        ? item.calories.trim() || existing.calories
        : pickMacroForNinjaUpsert(existing.calories, item.calories),
      overwrite
        ? item.protein.trim() || existing.protein
        : pickMacroForNinjaUpsert(existing.protein, item.protein),
      overwrite
        ? item.fiber.trim() || (existing.fiber ?? "")
        : pickMacroForNinjaUpsert(existing.fiber, item.fiber),
    );
    if (!merged) return library;
    if (
      merged.displayName === existing.displayName &&
      merged.calories === existing.calories &&
      merged.protein === existing.protein &&
      (merged.fiber ?? "") === (existing.fiber ?? "")
    ) {
      return library;
    }
    return upsertIngredientMacroLibraryItem(library, merged);
  }

  // Nouvelle entrée : nécessite au moins une macro utile (évite les lignes à 0 partout).
  if (!hasIncomingMacros) return library;
  // Pour une création, "0" compte comme macro renseignée (fibres à zéro).
  return upsertIngredientMacroLibraryItem(library, item);
}

/**
 * Pousse les macros des lignes Ninja Creami vers Macro ingrédients (complète vides/0).
 */
export function syncNinjaCatalogLinesToMacroLibrary(
  library: IngredientMacroLibraryItem[],
  lines: NinjaCreamiCatalogLine[],
): IngredientMacroLibraryItem[] {
  let next = library;
  for (const line of lines) {
    if (!line.name.trim()) continue;
    next = upsertMacroLibraryFromNinjaLineName(next, line.name, line.cal, line.pro, line.fiber);
  }
  return next;
}

/**
 * Formate les totaux pour affichage / insert meal (chaînes).
 */
export function formatNinjaCreamiTotalsForMeal(totals: NinjaCreamiMacroTotals): {
  calories: string;
  protein: string;
  fiber: string;
} {
  const fmt = (n: number) => {
    if (!n) return "0";
    return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
  };
  return {
    calories: fmt(totals.calories),
    protein: fmt(totals.protein),
    fiber: fmt(totals.fiber),
  };
}
