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

/** Clé de préférence : sous-catégories du catalogue Tous · bas en calorie. */
export const BONUS_LOW_CALORIE_GROUPS_KEY = "bonus_low_calorie_groups";

/** Id stable du groupe créé à la migration depuis la liste plate. */
export const BONUS_ZERO_CALORIE_DEFAULT_GROUP_ID = "bonus-zero-cal-default";

/** Id stable du groupe par défaut Tous · bas en calorie. */
export const BONUS_LOW_CALORIE_DEFAULT_GROUP_ID = "bonus-low-cal-default";

/** Liste initiale d’ingrédients pour Tous · bas en calorie. */
export const BONUS_LOW_CALORIE_SEED_NAMES = [
  "Haricots verts",
  "Fraise",
  "Pêche",
  "Carottes",
  "Nectarine",
  "Framboise",
  "Blanc d'oeuf",
  "Fromage blanc",
  "Compote",
  "Melon",
  "Oeuf",
  "Sauce bolognaise",
  "Pomme de terre",
] as const;

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

/** Ingrédients à garantir dans Tous · 0 calorie (ajoutés s’ils manquent). */
export const BONUS_ZERO_CALORIE_ENSURE_NAMES = ["Glaçon"] as const;

/**
 * Noms connus du catalogue utilisateur (récupération après écrasement accidentel).
 * Fusionnés s’ils manquent — ne remplacent jamais le contenu existant.
 */
export const BONUS_ZERO_CALORIE_RECOVERY_NAMES = [
  "Soda",
  "Glace sirop",
  "Eau",
  "Coulis Prozis",
  "Sirop",
  "Glaçon",
] as const;

/**
 * Compte les lignes avec un vrai contenu (hors ligne vide de fin).
 */
export function countBonusCatalogMeaningfulLines(
  groupsOrLines: BonusZeroCalorieGroup[] | NinjaCreamiCatalogLine[],
): number {
  if (groupsOrLines.length === 0) return 0;
  const first = groupsOrLines[0] as BonusZeroCalorieGroup | NinjaCreamiCatalogLine;
  const lines =
    first && typeof first === "object" && "lines" in first && Array.isArray(first.lines)
      ? flattenBonusZeroCalorieGroups(groupsOrLines as BonusZeroCalorieGroup[])
      : (groupsOrLines as NinjaCreamiCatalogLine[]);
  return lines.filter(catalogLineHasContent).length;
}

/**
 * Ajoute des noms manquants dans la première sous-catégorie (sans doublon, sans supprimer).
 */
export function ensureNamedIngredientsInBonusGroups(
  groups: BonusZeroCalorieGroup[],
  names: readonly string[],
): BonusZeroCalorieGroup[] {
  if (groups.length === 0 || names.length === 0) return groups;
  const existing = new Set(
    flattenBonusZeroCalorieGroups(groups)
      .map((line) => line.name.trim().toLowerCase())
      .filter(Boolean),
  );
  const missing = names.filter((name) => !existing.has(name.trim().toLowerCase()));
  if (missing.length === 0) return groups;

  const [first, ...rest] = groups;
  const kept = first.lines.filter(catalogLineHasContent);
  const added = missing.map((name) => ({
    id: `bonus-zero-cal-${name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")}`,
    qty: "",
    count: "",
    name,
    cal: "",
    pro: "",
    fiber: "",
  }));
  return [
    {
      ...first,
      lines: normalizeNinjaCreamiCatalogLines([...kept, ...added]),
    },
    ...rest,
  ];
}

/**
 * Ajoute des noms manquants dans la première sous-catégorie (sans doublon, sans supprimer).
 * Ignore les lignes legacy dont l’id est déjà présent (ex. renommage Sirop → Sucre).
 */
export function mergeLegacyLinesIntoBonusGroups(
  groups: BonusZeroCalorieGroup[],
  legacyLines: NinjaCreamiCatalogLine[],
  defaultGroupId: string = BONUS_ZERO_CALORIE_DEFAULT_GROUP_ID,
): BonusZeroCalorieGroup[] {
  const legacyContent = legacyLines.filter(catalogLineHasContent);
  if (legacyContent.length === 0) return groups;

  if (groups.length === 0) {
    return [
      {
        id: defaultGroupId,
        name: "Général",
        lines: normalizeNinjaCreamiCatalogLines(legacyContent),
      },
    ];
  }

  const flat = flattenBonusZeroCalorieGroups(groups);
  const existingNames = new Set(
    flat.map((line) => line.name.trim().toLowerCase()).filter(Boolean),
  );
  const existingIds = new Set(flat.map((line) => line.id).filter(Boolean));
  const missing = legacyContent.filter((line) => {
    if (existingIds.has(line.id)) return false;
    return !existingNames.has(line.name.trim().toLowerCase());
  });
  if (missing.length === 0) return groups;

  const [first, ...rest] = groups;
  const kept = first.lines.filter(catalogLineHasContent);
  return [
    {
      ...first,
      lines: normalizeNinjaCreamiCatalogLines([...kept, ...missing]),
    },
    ...rest,
  ];
}

/**
 * Normalise les sous-catégories ; migre / fusionne l’ancienne liste plate si besoin.
 */
export function normalizeBonusZeroCalorieGroups(
  rawGroups: unknown,
  legacyLines: unknown = [],
  defaultGroupId: string = BONUS_ZERO_CALORIE_DEFAULT_GROUP_ID,
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
            id: defaultGroupId,
            name: "Général",
            lines: legacyNormalized,
          },
        ];
      }
      // Groupes déjà remplis = source de vérité (ne pas réinjecter d’anciennes lignes
      // depuis l’autre onglet / une pref lines périmée — cause d’écrasement multi-session).
      if (ninjaCreamiBaseGroupsHaveContent(groups)) {
        return groups;
      }
      return mergeLegacyLinesIntoBonusGroups(groups, legacyNormalized, defaultGroupId);
    }
  }

  if (legacyHasContent) {
    return [
      {
        id: defaultGroupId,
        name: "Général",
        lines: legacyNormalized,
      },
    ];
  }

  return [
    {
      id: defaultGroupId,
      name: "Général",
      lines: createEmptyBonusZeroCalorieLines(),
    },
  ];
}

/**
 * Construit les lignes seedées du catalogue bas en calorie (ids stables).
 */
export function createBonusLowCalorieSeedLines(): NinjaCreamiCatalogLine[] {
  return normalizeNinjaCreamiCatalogLines(
    BONUS_LOW_CALORIE_SEED_NAMES.map((name, index) => ({
      id: `bonus-low-cal-seed-${index + 1}`,
      qty: "",
      count: "",
      name,
      cal: "",
      pro: "",
      fiber: "",
    })),
  );
}

/**
 * Catalogue Tous · bas en calorie prérempli.
 */
export function createSeededBonusLowCalorieGroups(): BonusZeroCalorieGroup[] {
  return [
    {
      id: BONUS_LOW_CALORIE_DEFAULT_GROUP_ID,
      name: "Général",
      lines: createBonusLowCalorieSeedLines(),
    },
  ];
}

/**
 * Normalise le catalogue Tous · bas en calorie (seed si encore vide).
 */
export function normalizeBonusLowCalorieGroups(rawGroups: unknown): BonusZeroCalorieGroup[] {
  const groups = normalizeBonusZeroCalorieGroups(rawGroups, [], BONUS_LOW_CALORIE_DEFAULT_GROUP_ID);
  if (!ninjaCreamiBaseGroupsHaveContent(groups)) {
    return createSeededBonusLowCalorieGroups();
  }
  return groups;
}

/**
 * Remplit les macros vides des lignes nommées du catalogue bas en calorie
 * depuis Macro / Aliments / recettes (sans écraser une saisie existante).
 */
export function autofillBonusLowCalorieGroupsMacros(
  groups: BonusZeroCalorieGroup[],
  sources: {
    resolve: (line: Pick<NinjaCreamiCatalogLine, "name" | "qty" | "count">) => {
      cal: string;
      pro: string;
      fiber: string;
    };
  },
): BonusZeroCalorieGroup[] {
  let changed = false;
  const next = groups.map((group) => {
    let groupChanged = false;
    const lines = group.lines.map((line) => {
      if (!line.name.trim()) return line;
      if (line.cal.trim() || line.pro.trim() || line.fiber.trim()) return line;
      const resolved = sources.resolve(line);
      if (!resolved.cal && !resolved.pro && !resolved.fiber) return line;
      groupChanged = true;
      changed = true;
      return {
        ...line,
        cal: resolved.cal || line.cal,
        pro: resolved.pro || line.pro,
        fiber: resolved.fiber || line.fiber,
      };
    });
    return groupChanged ? { ...group, lines } : group;
  });
  return changed ? next : groups;
}

/** Clé localStorage : backup catalogue Tous · 0 calorie. */
export const BONUS_ZERO_CALORIE_LOCAL_BACKUP_KEY = "bonus_zero_calorie_groups_local_backup";

/** Clé localStorage : backup catalogue Tous · bas en calorie. */
export const BONUS_LOW_CALORIE_LOCAL_BACKUP_KEY = "bonus_low_calorie_groups_local_backup";

export type BonusCatalogLocalBackup = {
  savedAt: number;
  groups: BonusZeroCalorieGroup[];
};

/**
 * Sauvegarde locale versionnée d’un catalogue Bonus (anti perte au refresh / multi-session).
 */
export function saveBonusCatalogLocalBackup(
  storageKey: string,
  groups: BonusZeroCalorieGroup[],
): void {
  if (typeof localStorage === "undefined") return;
  if (!ninjaCreamiBaseGroupsHaveContent(groups)) return;
  const payload: BonusCatalogLocalBackup = {
    savedAt: Date.now(),
    groups,
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Charge le backup local d’un catalogue Bonus, ou null.
 */
export function loadBonusCatalogLocalBackup(
  storageKey: string,
): BonusCatalogLocalBackup | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BonusCatalogLocalBackup>;
    if (!parsed || !Array.isArray(parsed.groups) || typeof parsed.savedAt !== "number") {
      return null;
    }
    if (!ninjaCreamiBaseGroupsHaveContent(parsed.groups as BonusZeroCalorieGroup[])) {
      return null;
    }
    return {
      savedAt: parsed.savedAt,
      groups: parsed.groups as BonusZeroCalorieGroup[],
    };
  } catch {
    return null;
  }
}

/**
 * Empreinte stable du contenu utile d’un catalogue (détecte renommages / réordonnancements).
 */
export function bonusCatalogContentSignature(groups: BonusZeroCalorieGroup[]): string {
  return flattenBonusZeroCalorieGroups(groups)
    .filter(catalogLineHasContent)
    .map(
      (l) =>
        `${l.id}\t${l.name.trim()}\t${l.qty.trim()}\t${l.count.trim()}\t${l.cal.trim()}\t${l.pro.trim()}\t${l.fiber.trim()}`,
    )
    .join("\n");
}

/**
 * Indique si le backup local doit remplacer le catalogue cloud/cache (édition plus récente perdue).
 * Compare avec l’horodatage de dernière sync réussie — ne réécrit pas un cloud plus récent.
 */
export function shouldRestoreBonusCatalogFromLocalBackup(
  cloudGroups: BonusZeroCalorieGroup[],
  backup: BonusCatalogLocalBackup | null,
  storageKey: string,
): boolean {
  if (!backup) return false;
  const cloudCount = countBonusCatalogMeaningfulLines(cloudGroups);
  const backupCount = countBonusCatalogMeaningfulLines(backup.groups);
  if (backupCount === 0) return false;
  if (cloudCount === 0) return true;
  if (bonusCatalogContentSignature(cloudGroups) === bonusCatalogContentSignature(backup.groups)) {
    return false;
  }
  if (backupCount > cloudCount) return true;
  const syncedAt = getBonusCatalogSyncedAt(storageKey);
  return backup.savedAt > syncedAt;
}

/**
 * Mémorise l’horodatage de dernière écriture cloud réussie pour un catalogue Bonus.
 */
export function markBonusCatalogSynced(storageKey: string, savedAt: number = Date.now()): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${storageKey}:synced`, String(savedAt));
  } catch {
    /* ignore */
  }
}

/**
 * Lit l’horodatage de dernière sync cloud réussie.
 */
export function getBonusCatalogSyncedAt(storageKey: string): number {
  if (typeof localStorage === "undefined") return 0;
  try {
    return Number(localStorage.getItem(`${storageKey}:synced`) || 0);
  } catch {
    return 0;
  }
}
