/**
 * Types et utilitaires partagés pour les boissons énergisantes.
 */

import type { EnergyDrinkImageCrop } from "@/lib/energyDrinkImageCrop";

export type { EnergyDrinkImageCrop } from "@/lib/energyDrinkImageCrop";

export type EnergyDrinkFlavor = {
  id: string;
  /** Nom du goût / variante (ex. Ultra White, Mangue). */
  taste: string;
  /** Référence locale (`local:…`), data URL ou URL externe en cours d'import. */
  imageUrl?: string | null;
  /** Zone de rognage en % de l'image source (vignette portrait). */
  imageCrop?: EnergyDrinkImageCrop | null;
  /** true = rognage défini à la main, ne pas écraser par l'auto-rognage. */
  imageCropManual?: boolean;
  volumeMl?: number | null;
  /** true = sans calories, false = avec calories. */
  zeroCalorie?: boolean;
};

export type EnergyDrinkBrand = {
  id: string;
  name: string;
  imageUrl?: string | null;
  flavors: EnergyDrinkFlavor[];
};

export type EnergyDrinkReview = {
  tested: boolean;
  /** Note sur 10 (demi-points possibles) ; null si non notée. */
  rating: number | null;
};

export type EnergyDrinksReviewsMap = Record<string, EnergyDrinkReview>;

/** Indique si deux goûts ont le même nom et la même variante calorique (conflit). */
export function energyDrinkFlavorsConflict(
  a: Pick<EnergyDrinkFlavor, "taste" | "zeroCalorie">,
  b: Pick<EnergyDrinkFlavor, "taste" | "zeroCalorie">,
): boolean {
  return (
    a.taste.trim().toLowerCase() === b.taste.trim().toLowerCase() &&
    Boolean(a.zeroCalorie) === Boolean(b.zeroCalorie)
  );
}

/** Génère un identifiant stable à partir d'un libellé. */
export function slugifyEnergyDrinkId(label: string): string {
  const raw = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return raw || `item-${Date.now()}`;
}

/** Trie les goûts : testés par note décroissante, puis non testés dans l'ordre d'origine. */
export function sortFlavorsForDisplay(
  flavors: EnergyDrinkFlavor[],
  getReview: (id: string) => EnergyDrinkReview,
): EnergyDrinkFlavor[] {
  const originalOrder = new Map(flavors.map((f, index) => [f.id, index]));
  return [...flavors].sort((a, b) => {
    const reviewA = getReview(a.id);
    const reviewB = getReview(b.id);
    if (reviewA.tested !== reviewB.tested) return reviewA.tested ? -1 : 1;
    if (!reviewA.tested && !reviewB.tested) {
      return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
    }
    const ratingA = reviewA.rating ?? -Infinity;
    const ratingB = reviewB.rating ?? -Infinity;
    if (ratingB !== ratingA) return ratingB - ratingA;
    return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
  });
}

/** Formate une note pour l'affichage (virgule décimale française). */
export function formatRatingDisplay(rating: number): string {
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1).replace(".", ",");
}

/** Indique si la note reçoit l'accent bleu ciel (≥ 6,5/10). */
export function isHighEnergyDrinkRating(rating: number | null): boolean {
  return rating !== null && rating >= 6.5;
}

/** Indique si la note reçoit l'accent orange (≤ 4,5/10). */
export function isLowEnergyDrinkRating(rating: number | null): boolean {
  return rating !== null && rating <= 4.5;
}

/** Retourne les classes Tailwind de la pastille de note selon le score. */
export function getEnergyDrinkRatingClasses(rating: number | null): {
  bg: string;
  text: string;
  border: string;
  subtext: string;
} {
  if (isHighEnergyDrinkRating(rating)) {
    return {
      bg: "bg-sky-500/15",
      text: "text-sky-400",
      border: "border-sky-500/35",
      subtext: "text-sky-400/80",
    };
  }
  if (isLowEnergyDrinkRating(rating)) {
    return {
      bg: "bg-orange-500/15",
      text: "text-orange-400",
      border: "border-orange-500/35",
      subtext: "text-orange-400/80",
    };
  }
  return {
    bg: "bg-muted/50",
    text: "text-foreground",
    border: "border-border/60",
    subtext: "text-muted-foreground",
  };
}
