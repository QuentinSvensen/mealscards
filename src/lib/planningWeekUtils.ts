import { format, startOfWeek, addDays, addWeeks } from "date-fns";
import { fr } from "date-fns/locale";

/** Clés de jour utilisées dans le planning (lundi → dimanche). */
export const PLANNING_DAY_KEYS = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
] as const;

export type PlanningDayKey = (typeof PLANNING_DAY_KEYS)[number];

export interface PlanningWeekDayInfo {
  key: PlanningDayKey;
  iso: string;
  display: string;
}

export const DAY_KEY_TO_INDEX: Record<string, number> = {
  lundi: 0,
  mardi: 1,
  mercredi: 2,
  jeudi: 3,
  vendredi: 4,
  samedi: 5,
  dimanche: 6,
};

/** Date calendaire pour une clé jour (lundi…dimanche) par rapport à `refDate` (début de « aujourd’hui »). */
export function getDateForDayKey(dayKey: string, refDate: Date = new Date()): Date {
  const todayDow = refDate.getDay();
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1;
  const targetIdx = DAY_KEY_TO_INDEX[dayKey] ?? 0;
  const diff = targetIdx - todayIdx;
  const d = new Date(refDate);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Lundi–dimanche pour un décalage de semaine (0 = semaine courante). */
export function buildWeekDates(weekOffset: number, ref: Date = new Date()): PlanningWeekDayInfo[] {
  const now = addWeeks(ref, weekOffset);
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  return PLANNING_DAY_KEYS.map((key, i) => {
    const date = addDays(monday, i);
    return {
      key,
      iso: format(date, "yyyy-MM-dd"),
      display: format(date, "EEEE d/MM", { locale: fr }).toUpperCase(),
    };
  });
}
