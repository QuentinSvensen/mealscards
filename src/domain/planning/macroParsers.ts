/**
 * Extrait un nombre de kcal depuis une chaîne potentiellement bruitée (symboles, virgules).
 */
export function parseCalories(cal: string | null | undefined): number {
  if (!cal) return 0;
  const n = parseFloat(cal.replace(",", ".").replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Extrait les grammes de protéines depuis une chaîne affichée ou saisie.
 */
export function parseProtein(prot: string | null | undefined): number {
  if (!prot) return 0;
  const n = parseFloat(prot.replace(",", ".").replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Extrait les grammes de fibres (même format que les protéines).
 */
export function parseFiber(fiber: string | null | undefined): number {
  return parseProtein(fiber);
}

/**
 * Convertit une surcharge manuelle en nombre utile, ou l’ignore si elle vaut 0/vide.
 */
export function parsePositiveMacroOverride(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const n =
    typeof value === "number"
      ? value
      : parseFloat(value.replace(",", ".").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
