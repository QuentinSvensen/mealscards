/**
 * Utilitaires partagés pour le parsing et le calcul des ingrédients.
 * 
 * Ce module fournit toutes les fonctions nécessaires pour :
 * - Parser les chaînes d'ingrédients (quantités, grammes, alternatives)
 * - Normaliser les noms pour la correspondance (accents, pluriels, typos)
 * - Calculer les macros (calories, protéines) à partir des ingrédients
 * - Gérer les compteurs d'ouverture (jours/heures depuis l'ouverture)
 * - Éditer et sérialiser les ingrédients (pour l'UI)
 * - Propager les macros entre repas partageant les mêmes ingrédients
 * 
 * Utilisé par : MealCard, PossibleMealCard, MealPlanGenerator, Index, stockUtils
 */

import type { FoodItem } from "@/hooks/useFoodItems";
import { colorFromName } from "./foodColors";
export { colorFromName };

import { differenceInDays, differenceInCalendarDays, parseISO, startOfDay, addDays } from "date-fns";

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 : Dates et compteurs d'ouverture
// ═══════════════════════════════════════════════════════════════════════════════

/** Vérifie si une date ISO est strictement dans le passé (avant aujourd'hui 00:00) */
export function isExpiredDate(dateIso: string | null | undefined): boolean {
  if (!dateIso) return false;
  const d = startOfDay(parseISO(dateIso));
  const today = startOfDay(new Date());
  return d.getTime() < today.getTime();
}

/** Table de correspondance jour français → index (0=Lundi, 6=Dimanche) */
export const DAY_KEY_TO_INDEX: Record<string, number> = {
  lundi: 0, mardi: 1, mercredi: 2, jeudi: 3, vendredi: 4, samedi: 5, dimanche: 6,
};

/**
 * Formate une date ISO stockée (UTC) pour l’affichage debug en heure de Paris (fuseau français).
 */
export function formatIsoInFrance(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return String(iso);
  }
}

/**
 * Calcule le nombre de jours écoulés depuis counter_start_date.
 * Retourne null si pas de compteur ou si le compteur est dans le futur (programmé).
 */
export function computeCounterDays(counterStartDate: string | null | undefined): number | null {
  if (!counterStartDate) return null;
  const start = parseISO(counterStartDate);
  const now = new Date();
  if (now < start) return null;
  return differenceInDays(now, start);
}

/**
 * Calcule le nombre d’heures entre counter_start_date et une date de fin (ex. créneau du repas).
 * Si `end` n’est pas fourni, utilise l’instant présent (heures réellement écoulées depuis l’ouverture).
 */
export function computeCounterHours(counterStartDate: string | null | undefined, end?: Date): number | null {
  if (!counterStartDate) return null;
  const start = parseISO(counterStartDate);
  const ref = end || new Date();
  const diffMs = ref.getTime() - start.getTime();
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60));
}

/**
 * Convertit une clé de jour (ex: "lundi" ou "2024-03-15") en objet Date stable.
 * Pour les jours nommés, calcule la date relative à la semaine de `ref`.
 */
export function getDateForDayKey(dayKey: string, ref: Date = new Date()): Date {
  // Si c'est déjà une date ISO (YYYY-MM-DD), l'utiliser directement
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return startOfDay(parseISO(dayKey));
  }

  const d = startOfDay(ref);
  const refDow = d.getDay(); // 0=Dim
  const refIdx = refDow === 0 ? 6 : refDow - 1; // 0=Lun
  const lowKey = (dayKey || "").toLowerCase();
  const targetIdx = DAY_KEY_TO_INDEX[lowKey] ?? 0;
  const diff = targetIdx - refIdx;
  const target = new Date(d);
  target.setDate(d.getDate() + diff);
  return target;
}

/**
 * Calcule la date cible du planning, en ajustant l'heure selon le repas.
 * Si le compteur a démarré après la date cible, avance d'une semaine.
 * 
 * @param dayKey - Jour du planning ("lundi" ou "2024-03-15")
 * @param refDate - Date de référence (aujourd'hui)
 * @param startDate - Date de début du compteur (optionnel)
 * @param mealTime - Moment du repas : "midi" (12h), "soir" (19h), "matin" (8h)
 */
export function getTargetDate(dayKey: string | null | undefined, refDate: Date, startDate?: string | null, mealTime?: string | null): Date {
  let target: Date;

  if (!dayKey) {
    target = new Date(refDate);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    target = parseISO(dayKey);
  } else {
    target = getDateForDayKey(dayKey, refDate);
  }

  // Appliquer l'heure du repas (Midi=12h, Soir=19h, Matin=8h)
  const lowTime = (mealTime || "").trim().toLowerCase();
  if (lowTime === "soir") {
    target.setHours(19, 0, 0, 0);
  } else if (lowTime === "midi") {
    target.setHours(12, 0, 0, 0);
  } else if (lowTime === "matin") {
    target.setHours(8, 0, 0, 0);
  }

  if (!startDate) return target;

  // Si le compteur a démarré après la date cible, avancer d'une semaine
  const start = parseISO(startDate);
  if (start > target && !(/^\d{4}-\d{2}-\d{2}$/.test(dayKey || ""))) {
    const nextWeek = addDays(target, 7);
    if (nextWeek >= start) return nextWeek;
  }
  return target;
}

/** 
 * Calcule le nombre de jours du compteur d'ouverture pour une carte "Possible".
 *
 * Comportement historique inchangé tant que le compteur a déjà démarré (start ≤ maintenant) :
 * même formules qu’avant (créneau planifié, figé sur created_at si pas de jour, etc.).
 *
 * Ajout ciblé : si l’ouverture est encore dans le futur (ex. aliment entamé jeudi midi au prochain repas)
 * et que cette carte a un jour planifié **après** cette ouverture d’au moins 1 jour calendaire
 * (ex. vendredi midi), on affiche une estimation (ex. 1j) — sans modifier les autres cas (futur sans jour → null).
 *
 * Si un autre repas entame le stock maintenant alors que ce repas est planifié plus tard (ex. burger jeudi midi),
 * le compteur sur la carte reflète le nombre de jours **entre l’ouverture réelle et le créneau du repas**
 * (ex. ~1–2 j), et non un compteur « figé à zéro ».
 */
export function getAdaptedCounterDays(
  startDate: string | null,
  dayKey?: string | null,
  createdAt?: string,
  mealTime?: string | null,
  fixedNow?: Date
): number | null {
  if (!startDate) return null;

  const now = fixedNow || new Date();
  const start = parseISO(startDate);

  // Ajout seulement : ouverture future + repas planifié plus tard (≥ 1 jour calendaire, ex. jeu. midi → ven. midi)
  if (start.getTime() > now.getTime()) {
    if (!dayKey) return null;
    const target = getTargetDate(dayKey, now, null, mealTime);
    const days = differenceInCalendarDays(target, start);
    if (days < 1) return null;
    return days;
  }

  // Sans jour planifié : figer le compteur au moment de la création
  if (!dayKey && createdAt) {
    const createdDate = parseISO(createdAt);
    const diffMs = createdDate.getTime() - start.getTime();
    // Cette carte est elle-même à l'origine de l'ouverture (start ≈ createdAt) :
    // on masque le badge — il n'a pas de sens d'afficher « 0j » sur la carte qui vient juste d'entamer.
    // Tolérance d'une minute pour absorber les écarts d'écriture (deduction vs insert).
    if (Math.abs(diffMs) <= 60_000) return null;
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return days < 0 ? 0 : days;
  }

  // Calcul basé sur la date planifiée (relative à aujourd'hui)
  const target = getTargetDate(dayKey, now, startDate, mealTime);
  const diffMs = target.getTime() - start.getTime();

  // Masquer « 0j » seulement si l'ouverture coïncide avec le créneau (cette carte ouvre le lot).
  // Si le lot était déjà entamé avant, conserver le badge.
  if (Math.abs(diffMs) <= 60_000 && start.getTime() + 60_000 >= target.getTime()) return null;

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return days < 0 ? null : days;
}

/**
 * Indique si la date de début du compteur est strictement postérieure à l’instant de référence
 * (compteur programmé, aliment pas encore entamé).
 */
export function isCounterStartInFuture(startDate: string | null | undefined, fixedNow?: Date): boolean {
  if (!startDate?.trim()) return false;
  const t = parseISO(startDate).getTime();
  if (Number.isNaN(t)) return false;
  return t > (fixedNow ?? new Date()).getTime();
}

/**
 * Formate la date/heure d’ouverture prévue du compteur pour une infobulle (fuseau Europe/Paris).
 * Sert à afficher clairement « quand » l’ingrédient sera entamé (ex. « Jeudi 23 12h »).
 */
export function formatPlannedCounterOpenFr(iso: string): string {
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase("fr-FR") + s.slice(1) : "");
  const hh = String(Number.parseInt(hour, 10));
  const timeLabel = minute === "00" ? `${hh}h` : `${hh}h${minute}`;
  return `${cap(weekday)} ${day} ${timeLabel}`.trim();
}

/**
 * Construit le texte d’infobulle du badge « X j » : estimation quand l’ouverture est future,
 * sinon durée entre ouverture et créneau du repas (avec rappel debug fuseau France).
 */
export function getCounterDaysBadgeTooltip(
  startDate: string | null,
  dayKey: string | null | undefined,
  mealTime: string | null | undefined,
  counterDays: number,
  fixedNow?: Date,
): string {
  const now = fixedNow ?? new Date();
  if (!startDate) {
    return `${counterDays} jour(s) — aucune date de départ enregistrée`;
  }
  const start = parseISO(startDate);
  if (start.getTime() > now.getTime()) {
    const when = formatPlannedCounterOpenFr(startDate);
    return `Estimation : ${counterDays} jour(s) entre l'ouverture prévue le ${when} et ce repas (compteur pas encore démarré)`;
  }
  const target = getTargetDate(dayKey, now, startDate, mealTime);
  const h = computeCounterHours(startDate, target);
  const debug = formatIsoInFrance(startDate);
  if (h !== null && h > 0) {
    return `Arrêter le compteur (${h} h entre l'ouverture et ce créneau)\n(Debug départ — heure affichée France : ${debug})`;
  }
  return `Arrêter le compteur\n(Debug départ — heure affichée France : ${debug})`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 : Normalisation de texte (avec cache LRU)
// ═══════════════════════════════════════════════════════════════════════════════

const _normCache = new Map<string, string>();
const _keyCache = new Map<string, string>();
const _lightCache = new Map<string, string>();
const NORM_CACHE_MAX = 600;

/** Normalise un texte pour la correspondance : minuscule, sans accents, sans caractères spéciaux */
export function normalizeForMatch(text: string): string {
  const cached = _normCache.get(text);
  if (cached !== undefined) return cached;
  const result = text.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim();
  if (_normCache.size > NORM_CACHE_MAX) _normCache.clear();
  _normCache.set(text, result);
  return result;
}

/** Minuscule mais conserve les accents — utilisé pour détecter "pâte" vs "pâté" */
export function lightNormalize(text: string): string {
  const cached = _lightCache.get(text);
  if (cached !== undefined) return cached;
  const result = text.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[^a-zà-ÿ0-9\s]/g, "").replace(/\s+/g, " ").trim();
  if (_lightCache.size > NORM_CACHE_MAX) _lightCache.clear();
  _lightCache.set(text, result);
  return result;
}

/** Normalise + supprime le 's' final pour la correspondance d'ingrédients (singulier/pluriel) */
export function normalizeKey(name: string): string {
  const cached = _keyCache.get(name);
  if (cached !== undefined) return cached;
  const result = normalizeForMatch(name).replace(/s$/, "");
  if (_keyCache.size > NORM_CACHE_MAX) _keyCache.clear();
  _keyCache.set(name, result);
  return result;
}

/**
 * Comparaison de clés tenant compte des accents.
 * Empêche "épicé" de matcher "épice" tout en autorisant "epice" == "épice".
 */
export function accentSafeKeyMatch(a: string, b: string): boolean {
  if (normalizeKey(a) !== normalizeKey(b)) return false;
  const la = lightNormalize(a).replace(/s$/, "");
  const lb = lightNormalize(b).replace(/s$/, "");
  if (la === lb) return true;
  if (Math.abs(la.length - lb.length) > 1) return false;
  const shorter = la.length <= lb.length ? la : lb;
  const longer = la.length <= lb.length ? lb : la;
  if (longer.startsWith(shorter)) return true;
  if (shorter.length === longer.length) {
    let diffs = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (shorter[i] !== longer[i]) diffs++;
    }
    return diffs === 0;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 : Correspondance intelligente des noms d'aliments
// ═══════════════════════════════════════════════════════════════════════════════

/** Prépositions/articles français signalant un nom composé */
const FOOD_PREPOSITIONS = new Set(['de', 'du', 'au', 'aux', 'a', 'la', 'le', 'les', 'des']);

/** Assouplit la fin d’un mot pour rapprocher singulier / pluriel dans la correspondance fuzzy. */
const fuzzyWord = (s: string) => s.replace(/[es]+$/i, '');

/**
 * Correspondance intelligente "contient" pour les aliments :
 * - Accepte les adjectifs : "pâte intégrale" matche "pâte" ✓
 * - Rejette les noms composés : "pain de mie" NE matche PAS "pain" ✗
 * - Rejette les accents différents : "pâté" NE matche PAS "pâte" ✗
 * - Tolère le 'e' final : "hachée" matche "haché" ✓
 */
export function smartFoodContains(a: string, b: string): boolean {
  const aNorm = normalizeForMatch(a);
  const bNorm = normalizeForMatch(b);
  if (!aNorm || !bNorm) return false;

  const wordsA = aNorm.split(/\s+/);
  const wordsB = bNorm.split(/\s+/);
  const [shorter, longer, shorterIsA] = wordsA.length <= wordsB.length
    ? [wordsA, wordsB, true] : [wordsB, wordsA, false];

  // Tous les mots du plus court doivent être trouvés dans le plus long (tolérance fuzzy)
  const matchedPairs: [number, number][] = [];
  const matchedIndices = new Set<number>();
  for (let si = 0; si < shorter.length; si++) {
    const sw = shorter[si];
    let found = false;
    for (let i = 0; i < longer.length; i++) {
      if (matchedIndices.has(i)) continue;
      if (longer[i] === sw || fuzzyWord(longer[i]) === fuzzyWord(sw)) {
        matchedIndices.add(i);
        matchedPairs.push([si, i]);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  // Vérification des accents sur les paires matchées (empêche "épicée" → "épice")
  const aLight = lightNormalize(a).split(/\s+/);
  const bLight = lightNormalize(b).split(/\s+/);
  const shorterLight = shorterIsA ? aLight : bLight;
  const longerLight = shorterIsA ? bLight : aLight;
  const singularize = (s: string) => s.replace(/s$/, '');
  for (const [si, li] of matchedPairs) {
    const sWord = shorterLight[si];
    const lWord = longerLight[li];
    if (!sWord || !lWord) continue;
    if (sWord === normalizeForMatch(sWord) || lWord === normalizeForMatch(lWord)) continue;
    const sSing = singularize(sWord);
    const lSing = singularize(lWord);
    if (sSing !== lSing) {
      const sBase = sSing.replace(/e$/, '');
      const lBase = lSing.replace(/e$/, '');
      if (sBase !== lBase) return false;
    }
  }

  if (shorter.length === longer.length) return true;

  // Mots supplémentaires : rejeter si contient des prépositions (nom composé)
  const extraWords = longer.filter((_, i) => !matchedIndices.has(i));
  if (extraWords.some(w => FOOD_PREPOSITIONS.has(w))) return false;

  return true;
}

/**
 * Correspondance stricte de noms : gère singulier/pluriel, casse, diacritiques,
 * et tolère maximum 1 typo (distance d'édition ≤ 1).
 * Les mots courts (≤3 car.) exigent une correspondance exacte.
 */
export function strictNameMatch(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (na === nb) return true;
  if (!na || !nb) return false;
  if (na.length <= 3 || nb.length <= 3) return false;
  const wordsA = na.split(/\s+/);
  const wordsB = nb.split(/\s+/);
  if (wordsA.length !== wordsB.length) return false;
  if (Math.abs(na.length - nb.length) > 1) return false;

  if (na.length === nb.length) {
    let mismatches = 0;
    for (let i = 0; i < na.length; i++) {
      if (na[i] !== nb[i]) { mismatches++; if (mismatches > 1) return false; }
    }
    return true;
  }

  const [shorter, longer] = na.length < nb.length ? [na, nb] : [nb, na];
  let si = 0, li = 0, diff = 0;
  while (si < shorter.length && li < longer.length) {
    if (shorter[si] === longer[li]) { si++; li++; } else { diff++; if (diff > 1) return false; li++; }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 : Parsing numérique
// ═══════════════════════════════════════════════════════════════════════════════

/** Parse une quantité en grammes depuis une chaîne (ex: "150g" → 150, "100|30" → 100) */
export function parseQty(qty: string | null | undefined): number {
  if (!qty) return 0;
  const [base] = qty.split("|");
  const match = base.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) || 0 : 0;
}

/** Parse la partie partielle d'une quantité encodée "base|partiel" (ex: "100|30" → 30) */
export function parsePartialQty(qty: string | null | undefined): number {
  if (!qty || !qty.includes("|")) return 0;
  const [, partial] = qty.split("|");
  const match = (partial || "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) || 0 : 0;
}

/** Formate un nombre pour l'affichage/stockage (arrondi à 1 décimale, sans ".0" inutile) */
export function formatNumeric(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded).replace(/\.0$/, "");
}

/**
 * Encode les grammes pour le stockage : "unité|partiel"
 * Ex: unité=100g, partiel=30g → "100|30"
 * Si pas de partiel ou partiel ≥ unité → juste "100"
 */
export function encodeStoredGrams(unit: number, partial: number | null): string {
  const unitPart = formatNumeric(unit);
  if (!partial || partial <= 0 || partial >= unit) return unitPart;
  return `${unitPart}|${formatNumeric(partial)}`;
}

/**
 * Calcule le poids total d'un aliment en stock.
 * Tient compte des unités complètes + éventuel reliquat partiel.
 * Ex: 3 × 100g avec 30g de partiel → 2×100 + 30 = 230g
 */
export function getFoodItemTotalGrams(fi: FoodItem): number {
  const unit = parseQty(fi.grams);
  if (unit <= 0) return 0;
  if (!fi.quantity || fi.quantity < 1) return unit;
  const partial = parsePartialQty(fi.grams);
  if (partial > 0 && partial < unit) return unit * Math.max(0, fi.quantity - 1) + partial;
  return unit * fi.quantity;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 : Parsing d'ingrédients (version numérique — pour les calculs)
// ═══════════════════════════════════════════════════════════════════════════════

/** Ingrédient parsé pour les calculs de stock */
export interface ParsedIngredient { qty: number; count: number; name: string; optional: boolean; }
/** Ingrédient parsé avec le nom brut (non normalisé) pour l'affichage */
export interface ParsedIngredientRaw { qty: number; count: number; name: string; rawName: string; optional: boolean; }

// Regex pré-compilées pour éviter la recompilation à chaque appel
const _RE_METRIC_STRIP = /(?:\{-?\d+(?:[.,]\d+)?\})?(?:\s*\[-?\d+(?:[.,]\d+)?\])?(?:\s*<-?\d+(?:[.,]\d+)?>)?\s*$/;
const _UNIT = "(?:g|gr|grammes?|kg|ml|cl|l)";
const _RE_FULL = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${_UNIT}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i");
const _RE_UNIT = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${_UNIT}\\s+(.+)$`, "i");
const _RE_NUM = /^(\d+(?:[.,]\d+)?)\s+(.+)$/;

/**
 * Parse une ligne d'ingrédient en valeurs numériques.
 * Formats reconnus :
 * - "100g 2 poulet" → qty=100, count=2, name="poulet"
 * - "150g salade"   → qty=150, count=0, name="salade"
 * - "3 oeufs"       → qty=0,   count=3, name="oeufs"
 * - "sel"           → qty=0,   count=0, name="sel"
 * Les préfixes "?" marquent un ingrédient optionnel.
 * Les suffixes {cal} et [pro] sont retirés avant le parsing.
 */
export function parseIngredientLine(ing: string): ParsedIngredient {
  let trimmed = ing.trim().replace(/\s+/g, " ");
  const optional = trimmed.startsWith("?");
  if (optional) trimmed = trimmed.slice(1).trim();
  trimmed = trimmed.replace(_RE_METRIC_STRIP, "").trim();

  const matchFull = trimmed.match(_RE_FULL);
  if (matchFull) return { qty: parseFloat(matchFull[1].replace(",", ".")), count: parseFloat(matchFull[2].replace(",", ".")), name: normalizeForMatch(matchFull[3]), optional };

  const matchUnit = trimmed.match(_RE_UNIT);
  if (matchUnit) return { qty: parseFloat(matchUnit[1].replace(",", ".")), count: 0, name: normalizeForMatch(matchUnit[2]), optional };

  const matchNum = trimmed.match(_RE_NUM);
  if (matchNum) return { qty: 0, count: parseFloat(matchNum[1].replace(",", ".")), name: normalizeForMatch(matchNum[2]), optional };

  return { qty: 0, count: 0, name: normalizeForMatch(trimmed), optional };
}

/** Comme parseIngredientLine mais conserve le nom original (non normalisé) dans rawName */
export function parseIngredientLineRaw(ing: string): ParsedIngredientRaw {
  let trimmed = ing.trim().replace(/\s+/g, " ");
  const optional = trimmed.startsWith("?");
  if (optional) trimmed = trimmed.slice(1).trim();
  trimmed = trimmed.replace(_RE_METRIC_STRIP, "").trim();

  const matchFull = trimmed.match(_RE_FULL);
  if (matchFull) return { qty: parseFloat(matchFull[1].replace(",", ".")), count: parseFloat(matchFull[2].replace(",", ".")), name: normalizeForMatch(matchFull[3]), rawName: matchFull[3].trim(), optional };

  const matchUnit = trimmed.match(_RE_UNIT);
  if (matchUnit) return { qty: parseFloat(matchUnit[1].replace(",", ".")), count: 0, name: normalizeForMatch(matchUnit[2]), rawName: matchUnit[2].trim(), optional };

  const matchNum = trimmed.match(_RE_NUM);
  if (matchNum) return { qty: 0, count: parseFloat(matchNum[1].replace(",", ".")), name: normalizeForMatch(matchNum[2]), rawName: matchNum[2].trim(), optional };

  return { qty: 0, count: 0, name: normalizeForMatch(trimmed), rawName: trimmed, optional };
}

/**
 * Parse une chaîne d'ingrédients en groupes d'alternatives (OR) contenant des bundles (AND).
 * 
 * Exemple : "A | B + C, D"
 * Résultat : [
 *   [ [{A}], [{B}, {C}] ], // Groupe 1 : (A OR (B AND C))
 *   [ [{D}] ]              // Groupe 2 : (D)
 * ]
 * 
 * Structure : ParsedIngredient[][][]
 * Level 1 : Groupes (AND)
 * Level 2 : Alternatives (OR)
 * Level 3 : Bundles (AND)
 */
const _groupsCache = new Map<string, ParsedIngredient[][][]>();
const GROUPS_CACHE_MAX = 300;

export function parseIngredientGroups(raw: string): ParsedIngredient[][][] {
  if (!raw?.trim()) return [];
  const cached = _groupsCache.get(raw);
  if (cached) return cached;

  const rawGroups = raw.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
  const filteredRawGroups = rawGroups.filter(group => !group.split(/\|/).some(alt => hasNegativeMetric(alt.trim())));
  
  const result = filteredRawGroups.map(groupStr => {
    const alts = groupStr.split(/\|/).map(s => s.trim()).filter(Boolean);
    return alts.map(altStr => {
      const bundle = altStr.split(/\+/).map(s => s.trim()).filter(Boolean);
      return bundle.map(parseIngredientLine);
    });
  });

  if (_groupsCache.size > GROUPS_CACHE_MAX) _groupsCache.clear();
  _groupsCache.set(raw, result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 : Édition d'ingrédients (version string — pour l'UI)
// ═══════════════════════════════════════════════════════════════════════════════

/** Ligne d'ingrédient pour l'éditeur UI (toutes les valeurs en string) */
export interface IngLine { 
  qty: string; 
  count: string; 
  name: string; 
  cal: string; 
  pro: string; 
  fiber: string;
  isOr: boolean; 
  isAnd: boolean; // Nouveau : lié au précédent par un ET
  isOptional: boolean; 
}

/** Extrait les suffixes {cal}, [pro] et <fibres> d'un token d'ingrédient brut. */
export function extractMetrics(raw: string): { text: string; cal: string; pro: string; fiber: string } {
  const match = raw.match(/(.*?)(?:\{(-?\d+(?:[.,]\d+)?)\})?(?:\s*\[(-?\d+(?:[.,]\d+)?)\])?(?:\s*<(-?\d+(?:[.,]\d+)?)>)?\s*$/);
  if (match) {
    return {
      text: match[1].trim(),
      cal: match[2] ? match[2].replace(",", ".") : "",
      pro: match[3] ? match[3].replace(",", ".") : "",
      fiber: match[4] ? match[4].replace(",", ".") : "",
    };
  }
  return { text: raw, cal: "", pro: "", fiber: "" };
}

/** Vérifie si un token d'ingrédient a une valeur macro négative (marqueur interne à filtrer). */
export function hasNegativeMetric(raw: string): boolean {
  const { cal, pro, fiber } = extractMetrics(raw);
  return (cal !== "" && parseFloat(cal) < 0) || (pro !== "" && parseFloat(pro) < 0) || (fiber !== "" && parseFloat(fiber) < 0);
}

/** Nettoie une chaîne d'ingrédients en retirant tous les marqueurs macros pour l'affichage. */
export function cleanIngredientText(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\{[^}]*\}/g, "").replace(/\[[^\]]*\]/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// Regex pré-compilées pour parseIngredientLineDisplay
const _DISP_UNIT = "(?:g|gr|gramme?s?|kg|ml|cl|l)";
const _RE_DISP_FULL = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${_DISP_UNIT}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i");
const _RE_DISP_UNIT = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${_DISP_UNIT}\\s+(.+)$`, "i");
const _RE_DISP_NUM = /^(\d+(?:[.,]\d+)?)\s+(.+)$/;

/** Parse une ligne d'ingrédient pour l'affichage dans l'éditeur (conserve les strings) */
export function parseIngredientLineDisplay(raw: string): IngLine {
  let trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { qty: "", count: "", name: "", cal: "", pro: "", fiber: "", isOr: false, isAnd: false, isOptional: false };
  const isOptional = trimmed.startsWith("?");
  if (isOptional) trimmed = trimmed.slice(1).trim();
  const { text: withoutMetrics, cal, pro, fiber } = extractMetrics(trimmed);
  trimmed = withoutMetrics;

  const matchFull = trimmed.match(_RE_DISP_FULL);
  if (matchFull) return { qty: matchFull[1], count: matchFull[2], name: matchFull[3].trim(), cal, pro, fiber, isOr: false, isAnd: false, isOptional };

  const matchUnit = trimmed.match(_RE_DISP_UNIT);
  if (matchUnit) return { qty: matchUnit[1], count: "", name: matchUnit[2].trim(), cal, pro, fiber, isOr: false, isAnd: false, isOptional };

  const matchNum = trimmed.match(_RE_DISP_NUM);
  if (matchNum) return { qty: "", count: matchNum[1], name: matchNum[2].trim(), cal, pro, fiber, isOr: false, isAnd: false, isOptional };

  return { qty: "", count: "", name: trimmed, cal, pro, fiber, isOr: false, isAnd: false, isOptional };
}

/** Formate une quantité pour l'affichage : ajoute "g" si c'est juste un nombre */
export function formatQtyDisplay(qty: string): string {
  const trimmed = qty.trim();
  if (!trimmed) return "";
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return trimmed + "g";
  return trimmed;
}

/** Convertit une chaîne d'ingrédients brute en tableau de IngLine pour l'éditeur */
export function parseIngredientsToLines(raw: string | null): IngLine[] {
  if (!raw) return [{ qty: "", count: "", name: "", cal: "", pro: "", fiber: "", isOr: false, isAnd: false, isOptional: false }];
  const groups = raw.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
  const lines: IngLine[] = [];
  for (const groupStr of groups) {
    const alts = groupStr.split(/\|/).map(s => s.trim()).filter(Boolean);
    alts.forEach((altStr, ai) => {
      const bundle = altStr.split(/\+/).map(s => s.trim()).filter(Boolean);
      bundle.forEach((itemStr, bi) => {
        const parsed = parseIngredientLineDisplay(itemStr);
        parsed.isOr = (ai > 0 && bi === 0);
        parsed.isAnd = (bi > 0);
        lines.push(parsed);
      });
    });
  }
  if (lines.length < 2) lines.push({ qty: "", count: "", name: "", cal: "", pro: "", fiber: "", isOr: false, isAnd: false, isOptional: false });
  return lines;
}

/**
 * Indique si une ligne d’ingrédient est un marqueur « négatif » ou porte des macros strictement négatives,
 * auquel cas elle ne doit pas apparaître dans les listes compactes (Tous, planning, possibles, menu).
 */
export function isNegativeIngredientLine(l: IngLine): boolean {
  const normName = normalizeKey(l.name || "");
  if (normName === "negatif" || normName === "négatif") return true;
  const cal = l.cal?.trim() ? parseFloat(l.cal.trim().replace(",", ".")) : 0;
  const pro = l.pro?.trim() ? parseFloat(l.pro.trim().replace(",", ".")) : 0;
  const fiber = l.fiber?.trim() ? parseFloat(l.fiber.trim().replace(",", ".")) : 0;
  return (!Number.isNaN(cal) && cal < 0) || (!Number.isNaN(pro) && pro < 0) || (!Number.isNaN(fiber) && fiber < 0);
}

/**
 * Regroupe les lignes déjà parsées en blocs séparés par virgule/saut de ligne, puis alternatives « | »,
 * puis sous-listes reliées par « + » ; supprime les alternatives vides après filtrage des lignes négatives.
 * Sert à l’affichage unifié (ou en jaune, bundle entre parenthèses avec des « + » en ligne).
 */
export function groupParsedIngredientLinesForDisplay(lines: IngLine[]): IngLine[][][] {
  const resGroups: IngLine[][][] = [];
  let currentGroup: IngLine[][] = [];
  let currentAlt: IngLine[] = [];

  for (const line of lines) {
    const hasContent = line.qty || line.count || line.name;
    if (!hasContent) continue;
    if (isNegativeIngredientLine(line)) continue;

    if (line.isAnd) {
      currentAlt.push(line);
    } else if (line.isOr) {
      if (currentAlt.length > 0) currentGroup.push(currentAlt);
      currentAlt = [line];
    } else {
      if (currentAlt.length > 0) currentGroup.push(currentAlt);
      if (currentGroup.length > 0) resGroups.push(currentGroup);
      currentGroup = [];
      currentAlt = [line];
    }
  }
  if (currentAlt.length > 0) currentGroup.push(currentAlt);
  if (currentGroup.length > 0) resGroups.push(currentGroup);

  return resGroups
    .map((group) =>
      group
        .map((alt) => alt.filter((item) => !isNegativeIngredientLine(item)))
        .filter((alt) => alt.length > 0),
    )
    .filter((group) => group.length > 0);
}

/** Quantité « grammes » purement numérique et <= 0 (ex. 0, 0g) : la ligne ne doit pas être persistée. */
function isZeroGramQtyField(qtyRaw: string): boolean {
  const t = qtyRaw.trim().replace(/\s/g, "").replace(/,/g, ".");
  if (!t) return false;
  if (!/^\d+(\.\d+)?g?$/i.test(t)) return false;
  const n = parseFloat(t.replace(/g$/i, ""));
  return !isNaN(n) && n <= 0;
}

/** Compteur entier <= 0 : ignoré à la sérialisation. */
function isZeroOrInvalidCount(countRaw: string): boolean {
  const t = countRaw.trim();
  if (!t || !/^\d+$/.test(t)) return false;
  return parseInt(t, 10) <= 0;
}

/** Sérialise un tableau de IngLine en chaîne d'ingrédients pour le stockage */
export function serializeIngredients(lines: IngLine[]): string | null {
  const result: string[] = [];
  let currentGroupText = "";
  
  const flushGroup = () => { if (currentGroupText) { result.push(currentGroupText); currentGroupText = ""; } };
  
  for (const l of lines) {
    let qtyStr = formatQtyDisplay(l.qty);
    if (isZeroGramQtyField(l.qty)) qtyStr = "";
    let countStr = l.count.trim();
    if (isZeroOrInvalidCount(l.count)) countStr = "";
    const nameStr = l.name.trim();
    if (!qtyStr && !countStr && !nameStr) continue;
    
    let token = [qtyStr, countStr, nameStr].filter(Boolean).join(" ");
    if (l.cal?.trim()) token += `{${l.cal.trim()}}`;
    if (l.pro?.trim()) token += ` [${l.pro.trim()}]`;
    if (l.fiber?.trim()) token += ` <${l.fiber.trim()}>`;
    const finalToken = l.isOptional ? `?${token}` : token;
    
    if (l.isAnd) {
      currentGroupText += ` + ${finalToken}`;
    } else if (l.isOr) {
      currentGroupText += ` | ${finalToken}`;
    } else {
      flushGroup();
      currentGroupText = finalToken;
    }
  }
  flushGroup();
  return result.length ? result.join(", ") : null;
}

/**
 * Réduit une recette pour l'affichage compact d'une carte Possible :
 * garde le premier choix de chaque groupe « ou » et retire les ingrédients optionnels (?).
 */
export function ingredientsForPossibleCardDisplay(ingredients: string | null | undefined): string | null {
  if (!ingredients?.trim()) return ingredients ?? null;
  const lines = parseIngredientsToLines(ingredients);
  const displayLines = lines.filter((l) => !l.isOr && !l.isOptional);
  return serializeIngredients(displayLines) ?? ingredients;
}

/**
 * Construit une table nom normalisé → nom affiché depuis une recette de référence.
 * Sert à réafficher les apostrophes/accents quand un override a été généré avec des noms normalisés.
 */
function buildReferenceIngredientDisplayNameMap(referenceIngredients: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!referenceIngredients?.trim()) return map;
  for (const line of parseIngredientsToLines(referenceIngredients)) {
    const name = line.name?.trim();
    if (!name) continue;
    const key = normalizeKey(name);
    if (key && !map.has(key)) map.set(key, name);
  }
  return map;
}

/**
 * Remplace seulement les noms d'un override par ceux de la recette maître quand ils matchent.
 * Préserve les quantités scalées de la carte Possible tout en restaurant `Flocon d'avoine`, accents, etc.
 */
export function restoreIngredientDisplayNamesFromReference(
  ingredients: string | null | undefined,
  referenceIngredients: string | null | undefined,
): string | null {
  if (!ingredients?.trim()) return ingredients ?? null;
  const displayNames = buildReferenceIngredientDisplayNameMap(referenceIngredients);
  if (displayNames.size === 0) return ingredients;

  const lines = parseIngredientsToLines(ingredients);
  let changed = false;
  for (const line of lines) {
    const key = normalizeKey(line.name || "");
    const displayName = key ? displayNames.get(key) : undefined;
    if (displayName && displayName !== line.name) {
      line.name = displayName;
      changed = true;
    }
  }
  return changed ? serializeIngredients(lines) ?? ingredients : ingredients;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 : Calcul des macros (calories et protéines)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcule les macros (cal ou pro) depuis une chaîne d'ingrédients.
 * 
 * Logique de calcul par ingrédient :
 * - Si qty (grammes) > 0 : macro = valeur × qty / 100
 * - Si count > 0         : macro = valeur × count
 * - Sinon                : macro = valeur brute
 * 
 * Pour les groupes d'alternatives (A | B), prend celui qui est disponible en stock.
 * Les ingrédients optionnels (?) sont ignorés.
 * 
 * Résultats mis en cache (LRU 500 entrées).
 */
const _calCache = new Map<string, number | null>();
const _proCache = new Map<string, number | null>();
const _fiberCache = new Map<string, number | null>();
const MACRO_CACHE_MAX = 500;

/**
 * Index inversé nom normalisé → fiches aliments (même structure que `buildFoodItemIndex` dans stockUtils).
 * Sert à résoudre rapidement les protéines pour 100 g à partir du garde-manger.
 */
export type FoodItemMacroIndex = Map<string, FoodItem[]>;

/**
 * Trouve les fiches aliments dont le nom correspond à un ingrédient de recette (lookup exact puis fuzzy).
 * Évite d’importer stockUtils ici pour ne pas créer de dépendance circulaire.
 */
function lookupFoodItemsForMacro(name: string, foodItems: FoodItem[], index?: FoodItemMacroIndex): FoodItem[] {
  if (index) {
    const exact = index.get(normalizeKey(name));
    if (exact && exact.length > 0) return exact;
    const results: FoodItem[] = [];
    for (const [, items] of index) {
      if (items.length > 0 && strictNameMatch(items[0].name, name)) {
        results.push(...items);
      }
    }
    return results;
  }
  return foodItems.filter((fi) => fi.storage_type !== "extras" && strictNameMatch(fi.name, name));
}

/**
 * Extrait une macro pour 100 g depuis une fiche aliment (chaîne potentiellement annotée).
 */
function parseFoodItemMacroPer100(fi: FoodItem, field: "protein" | "fiber"): number | null {
  const raw = field === "protein" ? fi.protein : fi.fiber;
  if (!raw?.trim()) return null;
  const n = parseFloat(raw.replace(",", ".").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Retourne une macro pour 100 g du premier aliment matché qui définit une valeur exploitable, sinon null.
 */
function resolveMacroPer100FromFoodItems(name: string, field: "protein" | "fiber", foodItems: FoodItem[], index?: FoodItemMacroIndex): number | null {
  for (const fi of lookupFoodItemsForMacro(name, foodItems, index)) {
    const p = parseFoodItemMacroPer100(fi, field);
    if (p !== null) return p;
  }
  return null;
}

/** Calcule calories ou protéines agrégées sur une chaîne d’ingrédients (avec cache LRU). */
function _computeMacro(
  ingredientStr: string | null,
  field: 'cal' | 'pro' | 'fiber',
  cache: Map<string, number | null>,
  isAvailable?: (name: string) => boolean,
  ratio: number = 1,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number | null {
  if (!ingredientStr?.trim()) return null;
  const useFoodMacroFallback = (field === "pro" || field === "fiber") && !!foodItems?.length;
  if (!isAvailable && ratio === 1 && !useFoodMacroFallback) {
    const cached = cache.get(ingredientStr);
    if (cached !== undefined) return cached;
  }
  const lines = parseIngredientsToLines(ingredientStr);
  let total = 0;
  let hasValue = false;

  // Regrouper les lignes en groupes d'alternatives de bundles
  const groups: IngLine[][][] = [];
  let currentGroup: IngLine[][] = [];
  let currentAlt: IngLine[] = [];
  
  for (const line of lines) {
    if (line.isOptional) continue;
    
    if (line.isAnd) {
      currentAlt.push(line);
    } else if (line.isOr) {
      if (currentAlt.length > 0) currentGroup.push(currentAlt);
      currentAlt = [line];
    } else {
      if (currentAlt.length > 0) currentGroup.push(currentAlt);
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [];
      currentAlt = [line];
    }
  }
  if (currentAlt.length > 0) currentGroup.push(currentAlt);
  if (currentGroup.length > 0) groups.push(currentGroup);

  for (const alternativeList of groups) {
    // Choisir l'alternative dont le PREMIER ingrédient est dispo (simplification pour le choix)
    // OU si isAvailable n'est pas fourni, prendre la première alternative.
    let chosenAlt = alternativeList[0];
    if (isAvailable) {
      for (const alt of alternativeList) {
        if (isAvailable(alt[0].name)) { chosenAlt = alt; break; }
      }
    }
    
    // Sommer les composants du bundle choisi
    for (const item of chosenAlt) {
      const rawVal = field === 'cal' ? item.cal : field === 'pro' ? item.pro : item.fiber;
      let val = parseFloat(rawVal.replace(",", "."));
      if ((!val || isNaN(val)) && useFoodMacroFallback) {
        const fromFood = resolveMacroPer100FromFoodItems(item.name, field === "fiber" ? "fiber" : "protein", foodItems!, foodItemIndex);
        if (fromFood !== null) val = fromFood;
      }
      if (!val || isNaN(val)) continue;
      hasValue = true;
      const qty = parseFloat(item.qty.replace(",", "."));
      const count = parseFloat(item.count.replace(",", "."));
      if (qty > 0) total += val * qty / 100;
      else if (count > 0) total += val * count;
      else total += val;
    }
  }
  const result = hasValue ? Math.round(total * ratio) : null;
  if (!isAvailable && ratio === 1 && !useFoodMacroFallback) {
    if (cache.size > MACRO_CACHE_MAX) cache.clear();
    cache.set(ingredientStr!, result);
  }
  return result;
}

/** Calcule les calories totales depuis une chaîne d'ingrédients */
export function computeIngredientCalories(ingredientStr: string | null, isAvailable?: (name: string) => boolean, ratio: number = 1): number | null {
  return _computeMacro(ingredientStr, 'cal', _calCache, isAvailable, ratio);
}

/**
 * Calcule les protéines totales depuis une chaîne d'ingrédients ; peut compléter les [pro] absents
 * avec les protéines pour 100 g des fiches aliments correspondantes (`foodItems` + index optionnel).
 */
export function computeIngredientProtein(
  ingredientStr: string | null,
  isAvailable?: (name: string) => boolean,
  ratio: number = 1,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number | null {
  return _computeMacro(ingredientStr, 'pro', _proCache, isAvailable, ratio, foodItems, foodItemIndex);
}

/**
 * Calcule les fibres totales depuis une chaîne d'ingrédients ; peut compléter les <fibres> absentes
 * avec les fibres pour 100 g des fiches aliments correspondantes.
 */
export function computeIngredientFiber(
  ingredientStr: string | null,
  isAvailable?: (name: string) => boolean,
  ratio: number = 1,
  foodItems?: FoodItem[],
  foodItemIndex?: FoodItemMacroIndex,
): number | null {
  return _computeMacro(ingredientStr, 'fiber', _fiberCache, isAvailable, ratio, foodItems, foodItemIndex);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 : Propagation des macros entre repas
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extrait une map nom_ingrédient → { cal, pro } depuis une chaîne d'ingrédients.
 * Ne retourne que les ingrédients ayant au moins une valeur cal ou pro définie.
 */
export function extractIngredientMacros(ingredientStr: string | null): Map<string, { cal: string; pro: string; fiber: string }> {
  const map = new Map<string, { cal: string; pro: string; fiber: string }>();
  if (!ingredientStr?.trim()) return map;
  const lines = parseIngredientsToLines(ingredientStr);
  for (const line of lines) {
    if (!line.name.trim()) continue;
    const cal = line.cal?.trim() || "";
    const pro = line.pro?.trim() || "";
    const fiber = line.fiber?.trim() || "";
    if (cal || pro || fiber) {
      map.set(normalizeKey(line.name), { cal, pro, fiber });
    }
  }
  return map;
}

/**
 * Applique des macros depuis une map source sur une chaîne d'ingrédients.
 * Pour chaque ingrédient correspondant, écrase cal/pro avec les valeurs de la map.
 * Retourne la chaîne mise à jour, ou null si rien n'a changé.
 */
export function applyIngredientMacros(ingredientStr: string | null, macros: Map<string, { cal: string; pro: string; fiber?: string }>): string | null {
  if (!ingredientStr?.trim() || macros.size === 0) return null;
  const lines = parseIngredientsToLines(ingredientStr);
  let changed = false;
  for (const line of lines) {
    if (!line.name.trim()) continue;
    const key = normalizeKey(line.name);
    const macro = macros.get(key);
    if (macro) {
      if (macro.cal && line.cal !== macro.cal) { line.cal = macro.cal; changed = true; }
      if (macro.pro && line.pro !== macro.pro) { line.pro = macro.pro; changed = true; }
      if (macro.fiber && line.fiber !== macro.fiber) { line.fiber = macro.fiber; changed = true; }
    }
  }
  return changed ? serializeIngredients(lines) : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9 : Couleur des cartes de repas
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Génère une couleur HSL cohérente basée sur le premier ingrédient du repas.
 * Si pas d'ingrédients, utilise le nom du repas.
 */
export function getMealColor(ingredients: string | null, mealName: string): string {
  if (!ingredients || !ingredients.trim()) return colorFromName(mealName);

  const firstIngLine = ingredients.split(/(?:\n|,(?!\d))/)[0].trim();
  const parsed = parseIngredientLineDisplay(firstIngLine);
  return colorFromName(parsed.name || firstIngLine || mealName);
}
