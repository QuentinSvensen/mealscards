import {
  normalizeKey,
  parseIngredientLine,
  formatNumeric,
  extractIngredientMacros,
  extractMetrics,
  parseIngredientLineRaw,
  type ParsedIngredient,
} from "@/lib/ingredientUtils";

/**
 * Retourne les noms d’ingrédients (déjà normalisés comme dans `ParsedIngredient.name`) à comparer au stock
 * pour une ligne de recette qui peut contenir des choix « A ou B ou C », souvent entre parenthèses.
 * Sans cela, `updateFoodItemCountersForPlanning` ne trouve jamais le « Jambon blanc » d'un croque, etc.
 */
export function expandOrGroupIngredientNames(item: ParsedIngredient): string[] {
  const out = new Set<string>();
  const push = (n: string | null | undefined) => {
    const t = (n ?? "").trim();
    if (t) out.add(t);
  };
  push(item.name);
  const raw = item.name.replace(/^\(+/, "").replace(/\)+$/, "").trim();
  if (/\bou\b/i.test(raw)) {
    for (const chunk of raw.split(/\s+ou\s+/i)) {
      const parsed = parseIngredientLine(chunk.trim());
      if (parsed.name) push(parsed.name);
    }
  }
  return [...out];
}

/**
 * Construit une chaîne d'ingrédients basée uniquement sur les alternatives réellement consommées.
 * Sert à afficher sur la carte "Possible" uniquement les choix "ou" effectivement déduits du stock.
 * Reprend les suffixes {cal} / [pro] / <fibres> depuis la recette maître pour l’éditeur et les calculs.
 * Les quantités unitaires utilisent « 4 Pain » (pas « x4 Pain ») pour rester parsables en colonnes.
 */
export function buildConsumedIngredientsOverride(pickedAlternatives: ParsedIngredient[][], mealIngredients: string): string | null {
  /** Remet une majuscule initiale pour un affichage propre côté carte Possible. */
  const withLeadingUppercase = (value: string): string => {
    const trimmed = (value || "").trim();
    if (!trimmed) return "";
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  };

  const macroMap = extractIngredientMacros(mealIngredients);

  /** Associe chaque nom normalisé au nom original de la recette pour préserver apostrophes et accents. */
  const buildOriginalDisplayNameMap = (ingredients: string): Map<string, string> => {
    const out = new Map<string, string>();
    ingredients
      .split(/(?:\n|,(?!\d))/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((group) => {
        group
          .split(/\|/)
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((alt) => {
            alt
              .split(/\+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((rawItem) => {
                const cleanItem = rawItem.startsWith("?") ? rawItem.slice(1).trim() : rawItem;
                const { text: withoutMetrics } = extractMetrics(cleanItem);
                const parsed = parseIngredientLineRaw(withoutMetrics);
                if (parsed.rawName?.trim()) out.set(normalizeKey(parsed.name), withLeadingUppercase(parsed.rawName));
              });
          });
      });
    return out;
  };
  const originalDisplayNameByKey = buildOriginalDisplayNameMap(mealIngredients);

  /** Réinjecte les macros par nom (clé normalisée), comme serializeIngredients ({cal}, [pro], <fibres>). */
  const macroSuffixForDisplayName = (displayName: string): string => {
    const m = macroMap.get(normalizeKey(displayName));
    if (!m) return "";
    let s = "";
    if (m.cal) s += `{${m.cal}}`;
    if (m.pro) s += ` [${m.pro}]`;
    if (m.fiber) s += ` <${m.fiber}>`;
    return s;
  };

  const lines: string[] = [];
  for (const altBundle of pickedAlternatives) {
    const parts = altBundle
      .filter((item) => !item.optional)
      .map((item) => {
        const displayName = originalDisplayNameByKey.get(normalizeKey(item.name)) ?? withLeadingUppercase(item.name || "");
        if (!displayName) return "";
        const macros = macroSuffixForDisplayName(displayName);
        if (item.qty > 0) return `${formatNumeric(item.qty)}g ${displayName}${macros}`.trim();
        if (item.count > 0) return `${formatNumeric(item.count)} ${displayName}${macros}`.trim();
        return `${displayName}${macros}`;
      })
      .filter(Boolean);
    if (parts.length > 0) lines.push(parts.join(" + "));
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
