import { addDays, format } from "date-fns";
import type { PlanningWeekDayLike } from "@/lib/planningWeekUtils";
import {
  collectIsoDatesFromBackup,
  isIsoDateString,
  isIsoWithinRange,
  withExplicitBackupWeekRange,
} from "./dailyCalorieHistory";
import { filterBackupCardsForArchiveWeek } from "./filterArchiveWeekMeals";
import type { PossibleMealBackupCard, PossibleMealsFullBackup } from "./types";

/** Retourne l’indice lundi=0…dimanche=6 pour une date ISO. */
export function weekdayIndexFromIso(iso: string): number {
  const d = new Date(`${iso}T12:00:00`);
  const dow = d.getDay();
  return dow === 0 ? 6 : dow - 1;
}

/** Retourne le lundi (ISO) de la semaine contenant une date ISO. */
export function mondayIsoOfWeek(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const idx = weekdayIndexFromIso(iso);
  d.setDate(d.getDate() - idx);
  return format(d, "yyyy-MM-dd");
}

/** Déduit le lundi de la semaine archivée depuis les dates présentes dans le backup. */
export function deriveArchivedMondayIso(backup: PossibleMealsFullBackup): string | null {
  const isos = collectIsoDatesFromBackup(backup);
  if (isos.length === 0) return null;
  return mondayIsoOfWeek(isos[0]);
}

/**
 * Vérifie que la plage ISO déclarée couvre au moins une date réelle du backup.
 */
export function backupWeekRangeMatchesContent(
  backup: PossibleMealsFullBackup,
): boolean {
  if (!backup.weekStartISO || !backup.weekEndISO) return false;
  const isos = collectIsoDatesFromBackup(backup);
  if (isos.length === 0) return true;
  return isos.some((iso) =>
    isIsoWithinRange(iso, backup.weekStartISO!, backup.weekEndISO!),
  );
}

/**
 * Réaligne weekStartISO / weekEndISO sur les dates réellement présentes
 * quand la plage déclarée ne correspond pas au contenu.
 */
export function reconcileBackupWeekRange(
  backup: PossibleMealsFullBackup,
): PossibleMealsFullBackup {
  let next = backup;
  if (!next.weekStartISO || !next.weekEndISO) {
    const isos = collectIsoDatesFromBackup(next);
    if (isos.length > 0) {
      next = withExplicitBackupWeekRange(next, isos[0], isos[isos.length - 1]);
    }
    return next;
  }
  if (!backupWeekRangeMatchesContent(next)) {
    const isos = collectIsoDatesFromBackup(next);
    if (isos.length > 0) {
      return withExplicitBackupWeekRange(next, isos[0], isos[isos.length - 1]);
    }
  }
  return next;
}

/**
 * Remappe les cartes dont day_of_week est une ISO hors de la plage déclarée
 * vers l’ISO du même jour de semaine dans la plage weekStartISO.
 */
export function realignBackupCardsToWeekStart(
  backup: PossibleMealsFullBackup,
): PossibleMealsFullBackup {
  const start = backup.weekStartISO;
  if (!start) return backup;
  const end = backup.weekEndISO ?? start;
  const cards = backup.cards.map((card) => {
    const dow = card.day_of_week;
    if (!dow || !isIsoDateString(dow)) return card;
    if (isIsoWithinRange(dow, start, end)) return card;
    const idx = weekdayIndexFromIso(dow);
    const alignedIso = format(addDays(new Date(`${start}T12:00:00`), idx), "yyyy-MM-dd");
    if (alignedIso === dow) return card;
    return { ...card, day_of_week: alignedIso };
  });
  if (cards === backup.cards) return backup;
  return { ...backup, cards };
}

/**
 * Mappe chaque jour affiché (lun→dim de la vue Préc.) vers l’ISO équivalent
 * dans la semaine archivée (même position dans la semaine).
 */
export function buildDisplayToArchivedIsoMap(
  displayWeekDates: PlanningWeekDayLike[],
  backup: PossibleMealsFullBackup,
): Record<string, string> {
  const reconciled = reconcileBackupWeekRange(backup);
  const archivedMonday =
    reconciled.weekStartISO && backupWeekRangeMatchesContent(reconciled)
      ? reconciled.weekStartISO
      : deriveArchivedMondayIso(reconciled);
  if (!archivedMonday || displayWeekDates.length === 0) return {};
  const map: Record<string, string> = {};
  for (let i = 0; i < displayWeekDates.length; i++) {
    const archivedIso = format(
      addDays(new Date(`${archivedMonday}T12:00:00`), i),
      "yyyy-MM-dd",
    );
    map[displayWeekDates[i].iso] = archivedIso;
  }
  return map;
}

/** ISO archivé correspondant au jour affiché (alignement lun→dim). */
export function resolveArchivedIsoForDisplay(
  displayIso: string,
  displayToArchivedIso: Record<string, string>,
): string {
  return displayToArchivedIso[displayIso] ?? displayIso;
}

/** Filtre les cartes d’un jour affiché (ISO archivé en priorité ; clé jour seulement en repli). */
export function filterBackupCardsForDisplayDay(
  cards: PossibleMealBackupCard[],
  displayIso: string,
  displayKey: string,
  archivedIso: string,
): PossibleMealBackupCard[] {
  const isoMatches = cards.filter(
    (c) => c.day_of_week === archivedIso || c.day_of_week === displayIso,
  );
  if (isoMatches.length > 0) return isoMatches;
  return cards.filter((c) => c.day_of_week === displayKey);
}

/**
 * Remappe les clés ISO archivées vers les ISO de la semaine affichée (lun→dim).
 * Conserve les clés jour (lundi-midi…) et fusionne sans écraser une valeur déjà présente.
 */
export function remapBackupRecordKeysToDisplayWeek(
  record: Record<string, number>,
  displayWeekDates: PlanningWeekDayLike[],
  displayToArchivedIso: Record<string, string>,
): Record<string, number> {
  const out: Record<string, number> = { ...record };
  const slots = ["midi", "soir", "gouter", "matin"];
  for (const { iso, key } of displayWeekDates) {
    const archivedIso = displayToArchivedIso[iso] ?? iso;
    if (archivedIso !== iso) {
      if (out[archivedIso] != null && out[iso] == null) {
        out[iso] = out[archivedIso];
      }
      for (const [k, v] of Object.entries(record)) {
        if (k.startsWith(`${archivedIso}-`) && out[`${iso}${k.slice(archivedIso.length)}`] == null) {
          out[`${iso}${k.slice(archivedIso.length)}`] = v;
        }
      }
    }
    if (out[key] != null && out[iso] == null) {
      out[iso] = out[key];
    }
    for (const slot of slots) {
      const fromKey = `${key}-${slot}`;
      const toKey = `${iso}-${slot}`;
      if (out[fromKey] != null && out[toKey] == null) {
        out[toKey] = out[fromKey];
      }
    }
  }
  return out;
}

/** Remappe les listes d’extras (clés ISO) vers la semaine affichée. */
export function remapBackupStringArrayKeysToDisplayWeek(
  record: Record<string, string[]>,
  displayWeekDates: PlanningWeekDayLike[],
  displayToArchivedIso: Record<string, string>,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...record };
  for (const { iso, key } of displayWeekDates) {
    const archivedIso = displayToArchivedIso[iso] ?? iso;
    if (archivedIso !== iso && out[archivedIso] && !out[iso]) {
      out[iso] = [...out[archivedIso]];
    }
    if (out[key] && !out[iso]) {
      out[iso] = [...out[key]];
    }
  }
  return out;
}

/** Remappe les affectations d’extras par créneau (clés ISO-slot) vers la semaine affichée. */
export function remapBackupSlotArrayKeysToDisplayWeek(
  record: Record<string, string[]>,
  displayWeekDates: PlanningWeekDayLike[],
  displayToArchivedIso: Record<string, string>,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...record };
  const slots = ["midi", "soir", "gouter", "matin"];
  for (const { iso, key } of displayWeekDates) {
    const archivedIso = displayToArchivedIso[iso] ?? iso;
    if (archivedIso !== iso) {
      for (const [k, v] of Object.entries(record)) {
        if (k.startsWith(`${archivedIso}-`)) {
          const newKey = `${iso}${k.slice(archivedIso.length)}`;
          if (!out[newKey]?.length) out[newKey] = [...v];
        }
      }
    }
    for (const slot of slots) {
      const fromKey = `${key}-${slot}`;
      const toKey = `${iso}-${slot}`;
      if (out[fromKey]?.length && !out[toKey]?.length) {
        out[toKey] = [...out[fromKey]];
      }
    }
  }
  return out;
}

/** Remappe les cases boisson (clés ISO-slot ou jour-slot) vers la semaine affichée. */
export function remapBackupBooleanKeysToDisplayWeek(
  record: Record<string, boolean>,
  displayWeekDates: PlanningWeekDayLike[],
  displayToArchivedIso: Record<string, string>,
): Record<string, boolean> {
  const out: Record<string, boolean> = { ...record };
  const slots = ["midi", "soir", "gouter", "matin"];
  for (const { iso, key } of displayWeekDates) {
    const archivedIso = displayToArchivedIso[iso] ?? iso;
    if (archivedIso !== iso) {
      for (const [k, v] of Object.entries(record)) {
        if (k.startsWith(`${archivedIso}-`)) {
          const newKey = `${iso}${k.slice(archivedIso.length)}`;
          if (out[newKey] == null) out[newKey] = v;
        }
      }
    }
    for (const slot of slots) {
      const fromKey = `${key}-${slot}`;
      const toKey = `${iso}-${slot}`;
      if (out[fromKey] != null && out[toKey] == null) {
        out[toKey] = out[fromKey];
      }
    }
  }
  return out;
}

/** Remappe les sélections petit-déj / clés string vers la semaine affichée. */
export function remapBackupStringKeysToDisplayWeek(
  record: Record<string, string>,
  displayWeekDates: PlanningWeekDayLike[],
  displayToArchivedIso: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...record };
  for (const { iso, key } of displayWeekDates) {
    const archivedIso = displayToArchivedIso[iso] ?? iso;
    if (archivedIso !== iso && out[archivedIso] && !out[iso]) {
      out[iso] = out[archivedIso];
    }
    if (out[key] && !out[iso]) {
      out[iso] = out[key];
    }
  }
  return out;
}

/**
 * Résout les objectifs archivés : si la fourchette basse est absente dans la backup,
 * retombe sur les objectifs courants (ex. 2000–2200).
 */
export function resolveArchivedPlanningGoals(
  backup: PossibleMealsFullBackup,
  currentDailyGoal: number,
  currentDailyGoalLow: number,
  currentProteinGoal: number,
  currentFiberGoal: number,
  defaultDailyGoal: number,
): {
  archivedDailyGoal: number;
  archivedDailyGoalLow: number;
  archivedProteinGoal: number;
  archivedFiberGoal: number;
} {
  const backupLow =
    backup.daily_goal_low != null && backup.daily_goal_low > 0 ? backup.daily_goal_low : 0;
  const backupHigh =
    backup.daily_goal != null && backup.daily_goal > 0 ? backup.daily_goal : 0;
  const backupPro =
    backup.protein_goal != null && backup.protein_goal > 0 ? backup.protein_goal : 0;
  const backupFiber =
    backup.fiber_goal != null && backup.fiber_goal > 0 ? backup.fiber_goal : 0;

  const hasCompleteRange = backupLow > 0 && backupHigh > 0;
  if (hasCompleteRange) {
    return {
      archivedDailyGoal: backupHigh,
      archivedDailyGoalLow: Math.min(backupLow, backupHigh),
      archivedProteinGoal: backupPro > 0 ? backupPro : currentProteinGoal,
      archivedFiberGoal: backupFiber > 0 ? backupFiber : currentFiberGoal,
    };
  }

  const liveHigh = currentDailyGoal > 0 ? currentDailyGoal : backupHigh;
  const liveLow =
    currentDailyGoalLow > 0
      ? currentDailyGoalLow
      : backupLow > 0
        ? backupLow
        : 0;
  const high = liveHigh > 0 ? liveHigh : defaultDailyGoal;

  return {
    archivedDailyGoal: high,
    archivedDailyGoalLow: liveLow > 0 ? Math.min(liveLow, high) : 0,
    archivedProteinGoal: backupPro > 0 ? backupPro : currentProteinGoal,
    archivedFiberGoal: backupFiber > 0 ? backupFiber : currentFiberGoal,
  };
}

/** Variantes ISO/clé jour pour lire une valeur de backup (alignement + clés historiques). */
export function collectBackupDayKeyVariants(
  displayIso: string,
  displayKey: string,
  archivedIso: string,
): string[] {
  const variants = new Set<string>([archivedIso, displayIso, displayKey]);
  return [...variants];
}

/** Lit une valeur journalière dans un record backup (première clé trouvée). */
export function pickBackupDayNumber(
  record: Record<string, number> | undefined,
  variants: string[],
): number {
  if (!record) return 0;
  for (const k of variants) {
    const v = record[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

/** Lit une valeur de créneau (ex. midi) dans un record backup. */
export function pickBackupSlotNumber(
  record: Record<string, number> | undefined,
  slot: string,
  variants: string[],
): number {
  if (!record) return 0;
  for (const v of variants) {
    const k = `${v}-${slot}`;
    const n = record[k];
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return 0;
}

/** Lit une liste d’ids extras pour un jour archivé. */
export function pickBackupDayStringArray(
  record: Record<string, string[]> | undefined,
  variants: string[],
): string[] {
  if (!record) return [];
  for (const k of variants) {
    const arr = record[k];
    if (Array.isArray(arr) && arr.length > 0) return arr;
  }
  return [];
}

/** Lit une liste d’ids extras affectés à un créneau. */
export function pickBackupSlotStringArray(
  record: Record<string, string[]> | undefined,
  slot: string,
  dayVariants: string[],
): string[] {
  if (!record) return [];
  for (const v of dayVariants) {
    const arr = record[`${v}-${slot}`];
    if (Array.isArray(arr) && arr.length > 0) return arr;
  }
  return [];
}

/** Lit une sélection string (petit-déj) pour un jour archivé. */
export function pickBackupDayString(
  record: Record<string, string> | undefined,
  variants: string[],
): string | undefined {
  if (!record) return undefined;
  for (const k of variants) {
    const v = record[k];
    if (v && String(v).trim()) return String(v);
  }
  return undefined;
}

/** Lit une case boisson pour un créneau. */
export function pickBackupSlotBoolean(
  record: Record<string, boolean> | undefined,
  slot: string,
  dayVariants: string[],
): boolean {
  if (!record) return false;
  for (const v of dayVariants) {
    if (record[`${v}-${slot}`]) return true;
  }
  return false;
}

/**
 * Répare une sauvegarde pour l’affichage de la semaine précédente :
 * plage ISO cohérente + cartes alignées + clés manuelles/extras remappées sur la semaine affichée.
 */
export function prepareBackupForDisplayWeek(
  backup: PossibleMealsFullBackup,
  displayWeekDates: PlanningWeekDayLike[],
): {
  backup: PossibleMealsFullBackup;
  displayToArchivedIso: Record<string, string>;
} {
  let next = reconcileBackupWeekRange(backup);
  next = realignBackupCardsToWeekStart(next);
  next = {
    ...next,
    cards: filterBackupCardsForArchiveWeek(
      next.cards ?? [],
      displayWeekDates,
      next.weekStartISO,
      next.weekEndISO,
    ),
  };
  const displayToArchivedIso = buildDisplayToArchivedIsoMap(displayWeekDates, next);
  const remapped: PossibleMealsFullBackup = {
    ...next,
    manualCalories: remapBackupRecordKeysToDisplayWeek(
      next.manualCalories ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    manualProteins: remapBackupRecordKeysToDisplayWeek(
      next.manualProteins ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    manualFibers: remapBackupRecordKeysToDisplayWeek(
      next.manualFibers ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    extraCalories: remapBackupRecordKeysToDisplayWeek(
      next.extraCalories ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    extraProteins: remapBackupRecordKeysToDisplayWeek(
      next.extraProteins ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    extraFibers: remapBackupRecordKeysToDisplayWeek(
      next.extraFibers ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    extraSelections: remapBackupStringArrayKeysToDisplayWeek(
      next.extraSelections ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    extraSlotAssignments: remapBackupSlotArrayKeysToDisplayWeek(
      next.extraSlotAssignments ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    breakfastManualCalories: remapBackupRecordKeysToDisplayWeek(
      next.breakfastManualCalories ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    breakfastManualProteins: remapBackupRecordKeysToDisplayWeek(
      next.breakfastManualProteins ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    breakfastSelections: remapBackupStringKeysToDisplayWeek(
      next.breakfastSelections ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
    drinkChecks: remapBackupBooleanKeysToDisplayWeek(
      next.drinkChecks ?? {},
      displayWeekDates,
      displayToArchivedIso,
    ),
  };
  return { backup: remapped, displayToArchivedIso };
}
