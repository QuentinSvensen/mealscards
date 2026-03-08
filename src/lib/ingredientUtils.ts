/**
 * Shared ingredient parsing utilities.
 * Used by MealCard, PossibleMealCard, MealPlanGenerator, Index, and stockUtils.
 */

import type { FoodItem } from "@/components/FoodItems";

// ─── Text Normalization ─────────────────────────────────────────────────────

export function normalizeForMatch(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim();
}

/** Normalize + strip trailing 's' for ingredient key matching */
export function normalizeKey(name: string): string {
  return normalizeForMatch(name).replace(/s$/, "");
}

/**
 * Strict name matching: handles singular/plural ('s'), case, diacritics,
 * and a maximum distance of 1 typo.
 */
export function strictNameMatch(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (na === nb) return true;
  if (!na || !nb) return false;
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

// ─── Numeric Parsing ────────────────────────────────────────────────────────

export function parseQty(qty: string | null | undefined): number {
  if (!qty) return 0;
  const [base] = qty.split("|");
  const match = base.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) || 0 : 0;
}

export function parsePartialQty(qty: string | null | undefined): number {
  if (!qty || !qty.includes("|")) return 0;
  const [, partial] = qty.split("|");
  const match = (partial || "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) || 0 : 0;
}

export function formatNumeric(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded).replace(/\.0$/, "");
}

export function encodeStoredGrams(unit: number, partial: number | null): string {
  const unitPart = formatNumeric(unit);
  if (!partial || partial <= 0 || partial >= unit) return unitPart;
  return `${unitPart}|${formatNumeric(partial)}`;
}

export function getFoodItemTotalGrams(fi: FoodItem): number {
  const unit = parseQty(fi.grams);
  if (unit <= 0) return 0;
  if (!fi.quantity || fi.quantity < 1) return unit;
  const partial = parsePartialQty(fi.grams);
  if (partial > 0 && partial < unit) return unit * Math.max(0, fi.quantity - 1) + partial;
  return unit * fi.quantity;
}

// ─── Ingredient Parsing (Numeric — for computation) ─────────────────────────

export interface ParsedIngredient { qty: number; count: number; name: string; optional: boolean; }
export interface ParsedIngredientRaw { qty: number; count: number; name: string; rawName: string; optional: boolean; }

export function parseIngredientLine(ing: string): ParsedIngredient {
  let trimmed = ing.trim().replace(/\s+/g, " ");
  const optional = trimmed.startsWith("?");
  if (optional) trimmed = trimmed.slice(1).trim();
  const unitRegex = "(?:g|gr|grammes?|kg|ml|cl|l)";

  const matchFull = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i"));
  if (matchFull) return { qty: parseFloat(matchFull[1].replace(",", ".")), count: parseFloat(matchFull[2].replace(",", ".")), name: normalizeForMatch(matchFull[3]), optional };

  const matchUnit = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(.+)$`, "i"));
  if (matchUnit) return { qty: parseFloat(matchUnit[1].replace(",", ".")), count: 0, name: normalizeForMatch(matchUnit[2]), optional };

  const matchNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (matchNum) return { qty: 0, count: parseFloat(matchNum[1].replace(",", ".")), name: normalizeForMatch(matchNum[2]), optional };

  return { qty: 0, count: 0, name: normalizeForMatch(trimmed), optional };
}

/** Same as parseIngredientLine but preserves original name casing in rawName */
export function parseIngredientLineRaw(ing: string): ParsedIngredientRaw {
  let trimmed = ing.trim().replace(/\s+/g, " ");
  const optional = trimmed.startsWith("?");
  if (optional) trimmed = trimmed.slice(1).trim();
  const unitRegex = "(?:g|gr|grammes?|kg|ml|cl|l)";

  const matchFull = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i"));
  if (matchFull) return { qty: parseFloat(matchFull[1].replace(",", ".")), count: parseFloat(matchFull[2].replace(",", ".")), name: normalizeForMatch(matchFull[3]), rawName: matchFull[3].trim(), optional };

  const matchUnit = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(.+)$`, "i"));
  if (matchUnit) return { qty: parseFloat(matchUnit[1].replace(",", ".")), count: 0, name: normalizeForMatch(matchUnit[2]), rawName: matchUnit[2].trim(), optional };

  const matchNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (matchNum) return { qty: 0, count: parseFloat(matchNum[1].replace(",", ".")), name: normalizeForMatch(matchNum[2]), rawName: matchNum[2].trim(), optional };

  return { qty: 0, count: 0, name: normalizeForMatch(trimmed), rawName: trimmed, optional };
}

/**
 * Parse ingredient string into OR groups.
 * "100g poulet | 80g dinde, 50g salade" → [[{poulet}, {dinde}], [{salade}]]
 * Optional ingredients are prefixed with "?" e.g. "?50g parmesan"
 */
export function parseIngredientGroups(raw: string): ParsedIngredient[][] {
  if (!raw?.trim()) return [];
  return raw.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean)
    .map(group => group.split(/\|/).map(s => s.trim()).filter(Boolean).map(parseIngredientLine));
}

// ─── Ingredient Editing (String-based — for UI) ─────────────────────────────

export interface IngLine { qty: string; count: string; name: string; cal: string; isOr: boolean; isOptional: boolean; }

export function parseIngredientLineDisplay(raw: string): IngLine {
  let trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { qty: "", count: "", name: "", isOr: false, isOptional: false };
  const isOptional = trimmed.startsWith("?");
  if (isOptional) trimmed = trimmed.slice(1).trim();
  const unitRegex = "(?:g|gr|gramme?s?|kg|ml|cl|l)";

  const matchFull = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i"));
  if (matchFull) return { qty: matchFull[1], count: matchFull[2], name: matchFull[3].trim(), isOr: false, isOptional };

  const matchUnit = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(.+)$`, "i"));
  if (matchUnit) return { qty: matchUnit[1], count: "", name: matchUnit[2].trim(), isOr: false, isOptional };

  const matchNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (matchNum) return { qty: "", count: matchNum[1], name: matchNum[2].trim(), isOr: false, isOptional };

  return { qty: "", count: "", name: trimmed, isOr: false, isOptional };
}

export function formatQtyDisplay(qty: string): string {
  const trimmed = qty.trim();
  if (!trimmed) return "";
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return trimmed + "g";
  return trimmed;
}

export function parseIngredientsToLines(raw: string | null): IngLine[] {
  if (!raw) return [{ qty: "", count: "", name: "", isOr: false, isOptional: false }];
  const groups = raw.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
  const lines: IngLine[] = [];
  for (const group of groups) {
    const alts = group.split(/\|/).map(s => s.trim()).filter(Boolean);
    alts.forEach((alt, i) => {
      const parsed = parseIngredientLineDisplay(alt);
      parsed.isOr = i > 0;
      lines.push(parsed);
    });
  }
  if (lines.length < 2) lines.push({ qty: "", count: "", name: "", isOr: false, isOptional: false });
  return lines;
}

export function serializeIngredients(lines: IngLine[]): string | null {
  const result: string[] = [];
  let currentGroup: string[] = [];
  const flushGroup = () => { if (currentGroup.length > 0) { result.push(currentGroup.join(" | ")); currentGroup = []; } };
  for (const l of lines) {
    const qtyStr = formatQtyDisplay(l.qty);
    const countStr = l.count.trim();
    const nameStr = l.name.trim();
    if (!qtyStr && !countStr && !nameStr) continue;
    const token = [qtyStr, countStr, nameStr].filter(Boolean).join(" ");
    const finalToken = l.isOptional ? `?${token}` : token;
    if (l.isOr) { currentGroup.push(finalToken); } else { flushGroup(); currentGroup.push(finalToken); }
  }
  flushGroup();
  return result.length ? result.join(", ") : null;
}
