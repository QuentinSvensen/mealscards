/**
 * Titre combiné des cartes repas d’un même créneau dans la vue Google Agenda
 * (ex. « 🍽️ Hachis parmentier, Pot #4 ») — ordre = carte du haut → bas du Planning.
 */

/** Emoji de catégorie pour le titre agenda (aligné sur PlanningMiniCard). */
function categoryEmoji(cat?: string | null): string {
  switch (cat) {
    case "entree":
      return "🥗";
    case "plat":
      return "🍽️";
    case "dessert":
      return "🍰";
    case "bonus":
      return "⭐";
    default:
      return "🍴";
  }
}

export type MealAgendaTitleSource = {
  id: string;
  sort_order?: number | null;
  meals?: { name?: string | null; category?: string | null } | null;
};

/**
 * Trie les repas comme dans le Planning (sort_order croissant = carte du haut en premier).
 */
export function sortMealsForAgendaTitle<T extends MealAgendaTitleSource>(meals: T[]): T[] {
  return [...meals].sort((a, b) => {
    const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (so !== 0) return so;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Construit le titre agenda d’un groupe de cartes :
 * emoji de la 1re carte + noms séparés par « , » (ordre haut → bas Planning).
 */
export function formatGroupedMealAgendaTitle(
  meals: MealAgendaTitleSource[],
): string {
  const ordered = sortMealsForAgendaTitle(meals);
  if (ordered.length === 0) return "🍴 Repas";
  const first = ordered[0];
  const emoji = categoryEmoji(first.meals?.category);
  const names = ordered.map((pm) => pm.meals?.name?.trim() || "Repas").join(", ");
  return `${emoji} ${names}`;
}
