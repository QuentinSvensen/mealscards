/**
 * Catalogue « Tous · 0 calorie » (onglet Bonus) :
 * sous-catégories d’ingrédients sélectionnables (même modèle que Base Ninja).
 */
import {
  catalogLineHasContent,
  createEmptyNinjaCreamiBaseGroup,
  createNinjaCreamiGroupId,
  flattenNinjaCreamiBaseGroups,
  normalizeNinjaCreamiCatalogLines,
  ninjaCreamiBaseGroupsHaveContent,
  type NinjaCreamiBaseGroup,
  type NinjaCreamiCatalogLine,
} from "@/domain/ninjaCreami/ninjaCreami";

/** Clé legacy : anciennes lignes plates (migration → groupes). */
export const BONUS_ZERO_CALORIE_LINES_KEY = "bonus_zero_calorie_lines";

/** Clé de préférence : sous-catégories du catalogue Tous · 0 calorie. */
export const BONUS_ZERO_CALORIE_GROUPS_KEY = "bonus_zero_calorie_groups";

/** Id stable du groupe créé à la migration depuis la liste plate. */
export const BONUS_ZERO_CALORIE_DEFAULT_GROUP_ID = "bonus-zero-cal-default";

export type BonusZeroCalorieGroup = NinjaCreamiBaseGroup;

/**
 * Normalise les lignes persistées (garantit au moins une ligne vide en bas).
 * Conservé pour compat / tests ; préférer les groupes.
 */
export function normalizeBonusZeroCalorieLines(raw: unknown): NinjaCreamiCatalogLine[] {
  return normalizeNinjaCreamiCatalogLines(raw);
}

/**
 * Catalogue vide prêt pour l’éditeur (une ligne vide).
 */
export function createEmptyBonusZeroCalorieLines(): NinjaCreamiCatalogLine[] {
  return normalizeNinjaCreamiCatalogLines([]);
}

/**
 * Une sous-catégorie vide (avec ligne de saisie).
 */
export function createEmptyBonusZeroCalorieGroup(
  name = "Nouvelle sous-catégorie",
): BonusZeroCalorieGroup {
  return createEmptyNinjaCreamiBaseGroup(name);
}

/**
 * Catalogue groupes vide (une sous-catégorie « Général »).
 */
export function createEmptyBonusZeroCalorieGroups(): BonusZeroCalorieGroup[] {
  return [
    {
      id: BONUS_ZERO_CALORIE_DEFAULT_GROUP_ID,
      name: "Général",
      lines: createEmptyBonusZeroCalorieLines(),
    },
  ];
}

/**
 * Aplatit toutes les lignes des sous-catégories (totaux / Créer).
 */
export function flattenBonusZeroCalorieGroups(
  groups: BonusZeroCalorieGroup[],
): NinjaCreamiCatalogLine[] {
  return flattenNinjaCreamiBaseGroups(groups);
}

/**
 * Normalise les sous-catégories ; migre l’ancienne liste plate si besoin.
 */
export function normalizeBonusZeroCalorieGroups(
  rawGroups: unknown,
  legacyLines: unknown = [],
): BonusZeroCalorieGroup[] {
  const legacyNormalized = normalizeNinjaCreamiCatalogLines(legacyLines);
  const legacyHasContent = legacyNormalized.some(catalogLineHasContent);

  if (Array.isArray(rawGroups) && rawGroups.length > 0) {
    const groups: BonusZeroCalorieGroup[] = [];
    for (const entry of rawGroups) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Partial<BonusZeroCalorieGroup>;
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
      if (!ninjaCreamiBaseGroupsHaveContent(groups) && legacyHasContent) {
        return [
          {
            id: BONUS_ZERO_CALORIE_DEFAULT_GROUP_ID,
            name: "Général",
            lines: legacyNormalized,
          },
        ];
      }
      return groups;
    }
  }

  if (legacyHasContent) {
    return [
      {
        id: BONUS_ZERO_CALORIE_DEFAULT_GROUP_ID,
        name: "Général",
        lines: legacyNormalized,
      },
    ];
  }

  return createEmptyBonusZeroCalorieGroups();
}
