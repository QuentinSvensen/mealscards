import { DAY_KEY_TO_INDEX, PLANNING_DAY_KEYS, type PlanningWeekDayInfo } from "@/lib/planningWeekUtils";

type DayScopedKey = {
  day: string;
  suffix: string | null;
};

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Indique si une clé correspond à une date ISO ou à un jour de planning (lundi…dimanche). */
function isPlanningDayToken(value: string): boolean {
  return ISO_DAY_RE.test(value) || DAY_KEY_TO_INDEX[value.toLowerCase()] !== undefined;
}

/** Retourne l'index lundi=0…dimanche=6 pour une date ISO ou une clé de jour. */
function getPlanningDayIndex(day: string): number | null {
  if (ISO_DAY_RE.test(day)) {
    const d = new Date(`${day}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.getDay() === 0 ? 6 : d.getDay() - 1;
  }
  const idx = DAY_KEY_TO_INDEX[day.toLowerCase()];
  return typeof idx === "number" ? idx : null;
}

/** Sépare une clé de préférence en partie jour et suffixe éventuel (ex. "lundi-midi"). */
function splitDayScopedKey(key: string): DayScopedKey | null {
  if (ISO_DAY_RE.test(key)) return { day: key, suffix: null };

  const isoWithSuffix = key.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (isoWithSuffix) return { day: isoWithSuffix[1], suffix: isoWithSuffix[2] };

  for (const day of PLANNING_DAY_KEYS) {
    if (key === day) return { day, suffix: null };
    if (key.startsWith(`${day}-`)) return { day, suffix: key.slice(day.length + 1) };
  }

  return null;
}

/** Convertit une clé jour / jour-créneau vers l'ISO de la semaine cible. */
export function remapPlanningKeyToTargetWeek(
  key: string,
  targetWeek: PlanningWeekDayInfo[] | undefined,
): string {
  if (!targetWeek?.length) return key;
  const parsed = splitDayScopedKey(key);
  if (!parsed || !isPlanningDayToken(parsed.day)) return key;

  const dayIdx = getPlanningDayIndex(parsed.day);
  if (dayIdx === null) return key;

  const target = targetWeek[dayIdx]?.iso;
  if (!target) return key;

  return parsed.suffix ? `${target}-${parsed.suffix}` : target;
}

/** Remappe toutes les clés d'un record de préférences vers la semaine cible. */
export function remapPlanningRecordToTargetWeek<T>(
  record: Record<string, T>,
  targetWeek: PlanningWeekDayInfo[] | undefined,
): Record<string, T> {
  if (!targetWeek?.length) return { ...record };
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    out[remapPlanningKeyToTargetWeek(key, targetWeek)] = value;
  }
  return out;
}
