import { parseISO } from "date-fns";

/** Table de correspondance jour français → index (0=Lun) */
export const DAY_KEY_TO_INDEX: Record<string, number> = {
  lundi: 0, mardi: 1, mercredi: 2, jeudi: 3, vendredi: 4, samedi: 5, dimanche: 6,
};

/**
 * Aligne l'heure d'une date sur le créneau repas (matin 8h, midi 12h, goûter 16h, soir 19h).
 * Aligné sur getTargetDate (ingredientUtils) ; sans défaut « midi » si le créneau est absent.
 */
export function setMealTimeHours(d: Date, mealTime: string | null) {
  const low = (mealTime || "").trim().toLowerCase();
  if (low === "soir") d.setHours(19, 0, 0, 0);
  else if (low === "matin") d.setHours(8, 0, 0, 0);
  else if (low === "midi") d.setHours(12, 0, 0, 0);
  else if (low === "gouter") d.setHours(16, 0, 0, 0);
  // Pas de défaut « midi » si absent : évite une fausse heure (12h) quand le créneau n’est pas encore choisi
}

/**
 * Calcule la date ISO du compteur d'ouverture pour un repas planifié.
 * Matin = 8h, midi = 12h, goûter = 16h, soir = 19h. Accepte les jours nommés ("lundi") ou les dates ISO.
 */
export function computePlannedCounterDate(dayOfWeek: string, mealTime: string | null): string {
  // Si c'est déjà une date ISO (YYYY-MM-DD), l'utiliser directement
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayOfWeek)) {
    const d = parseISO(dayOfWeek);
    setMealTimeHours(d, mealTime);
    return d.toISOString();
  }

  const today = new Date();
  const todayDow = today.getDay(); // 0=Dim
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1; // 0=Lun
  const targetIdx = DAY_KEY_TO_INDEX[dayOfWeek] ?? 0;
  const diff = targetIdx - todayIdx;

  const d = new Date(today);
  d.setDate(d.getDate() + diff);
  setMealTimeHours(d, mealTime);
  return d.toISOString();
}
