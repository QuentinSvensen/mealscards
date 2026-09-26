/**
 * Données initiales des boissons énergisantes (liste personnelle).
 * Appliquées une fois via energy_drinks_seed_version dans useEnergyDrinks.
 */
import type { EnergyDrinkBrand, EnergyDrinksReviewsMap } from "@/lib/energyDrinkUtils";
import { slugifyEnergyDrinkId } from "@/lib/energyDrinkUtils";
import { getDefaultEnergyDrinkImage } from "@/data/energyDrinkImages";

type SeedFlavor = {
  taste: string;
  tested: boolean;
  /** Note sur 10 (demi-points) ; uniquement si testé. */
  rating?: number | null;
};

/** Déduit si un goût est sans calories à partir de son libellé seed. */
function inferZeroCalorie(taste: string): boolean {
  const t = taste.toLowerCase();
  return (
    t.includes("zéro sucre") ||
    t.includes("zero sucre") ||
    t.includes("sans sucre") ||
    t.includes("zéro calorie") ||
    t.includes("zero calorie") ||
    t.includes("sans calorie") ||
    t.includes("zéro cal") ||
    t.includes("zero cal")
  );
}

/** Construit une marque et les avis associés à partir d'entrées seed. */
function buildBrand(name: string, flavors: SeedFlavor[]): {
  brand: EnergyDrinkBrand;
  reviews: EnergyDrinksReviewsMap;
} {
  const brandId = slugifyEnergyDrinkId(name);
  const reviews: EnergyDrinksReviewsMap = {};
  const flavorItems = flavors.map((f) => {
    const id = slugifyEnergyDrinkId(`${name}-${f.taste}`);
    reviews[id] = {
      tested: f.tested,
      rating: f.tested ? (f.rating ?? null) : null,
    };
    return {
      id,
      taste: f.taste,
      imageUrl: getDefaultEnergyDrinkImage(id),
      volumeMl: null,
      zeroCalorie: inferZeroCalorie(f.taste),
    };
  });
  return {
    brand: { id: brandId, name, imageUrl: null, flavors: flavorItems },
    reviews,
  };
}

const monster = buildBrand("Monster", [
  { taste: "Ultra: Pêche zéro sucre", tested: true, rating: 8.5 },
  { taste: "Punch: Pipeline (rose)", tested: true, rating: 8 },
  { taste: "Ultra: Paradise zéro sucre (verte)", tested: true, rating: 7.5 },
  { taste: "Punch: Pacific (beige)", tested: true, rating: 7.5 },
  { taste: "Ultra: White zéro sucre", tested: true, rating: 7 },
  { taste: "Ultra: Gold zéro sucre", tested: true, rating: 7 },
  { taste: "Ultra: Strawberry dreams zéro sucre", tested: true, rating: 7 },
  { taste: "Ultra: Lewis Hamilton / Top speed zéro sucre", tested: true, rating: 6.5 },
  { taste: "Ultra: Violet zéro sucre", tested: true, rating: 6.5 },
  { taste: "Nitro", tested: true, rating: 6.5 },
  { taste: "Original zéro sucre", tested: true, rating: 6 },
  { taste: "Punch: Mixxd (violet)", tested: true, rating: 6 },
  { taste: "Ultra: Rosa zéro sucre", tested: true, rating: 6 },
  { taste: "Ultra: Blue Hawaii zéro sucre", tested: true, rating: 6 },
  { taste: "Ultra: Lando Norris zéro sucre", tested: true, rating: 6 },
  { taste: "Juice: Monarch / Papillon punch (orange)", tested: true, rating: 5.5 },
  { taste: "Juice: Limonade", tested: true, rating: 5 },
  { taste: "Juice: Viking Berry", tested: true, rating: 6 },
  { taste: "Punch: Rio", tested: true, rating: 4.5 },
  { taste: "Juice: Mango loco", tested: true, rating: 4 },
  { taste: "Ultra: Rudy Red sans sucre", tested: true, rating: 3.5 },
  { taste: "Original", tested: true, rating: 3 },
  { taste: "Juice: Khaotic", tested: true, rating: 3 },
  { taste: "Ultra: Valentino Rossi zéro sucre", tested: true, rating: 3 },
  { taste: "Juice: Bad apple", tested: true, rating: 3 },
  { taste: "Ultra: Ginger brew", tested: true, rating: 1 },
  { taste: "Ultra: Fiesta zéro sucre (verte bizarre)", tested: false },
  { taste: "Ultra: Sunrise (orange)", tested: false },
  { taste: "Ultra: Blue", tested: false },
  { taste: "Ultra: Pêche", tested: false },
  { taste: "Ultra: Vice goyave (bleue clair)", tested: false },
  { taste: "Ultra: Red", tested: false },
  { taste: "Punch: Pipeline zéro sucre (rose)", tested: false },
  { taste: "Reserve: Ananas blanc", tested: false },
  { taste: "Reserve: Melon d'eau", tested: false },
  { taste: "Reserve: Orange dreamsicle", tested: false },
  { taste: "Reserve: Pêche et crème", tested: false },
  { taste: "Strawberry Shot (shot 150 ml)", tested: false },
]);

const redBull = buildBrand("Red Bull", [
  { taste: "Sans sucre / Zéro calorie", tested: true, rating: 8.5 },
  { taste: "Original", tested: true, rating: 8 },
  { taste: "Abricot fraise", tested: true, rating: 7 },
  { taste: "Cerise sakura (blanc)", tested: true, rating: 7 },
  { taste: "Acai (violet)", tested: true, rating: 7 },
  { taste: "Myrtille", tested: true, rating: 7 },
  { taste: "Coco acai", tested: true, rating: 7 },
  { taste: "Mûre givrée & vanille", tested: true, rating: 7 },
  { taste: "Fruits tropicaux", tested: true, rating: 6.5 },
  { taste: "Juneberry", tested: true, rating: 6 },
  { taste: "Aspérule & Pamplemousse (violet mat)", tested: true, rating: 6 },
  { taste: "Agrumes", tested: true, rating: 6 },
  { taste: "Pomme fuji & gingembre", tested: true, rating: 6 },
  { taste: "Pomme & Raisin", tested: true, rating: 5 },
  { taste: "Peche blanche", tested: true, rating: 4 },
  { taste: "Pastèque", tested: true, rating: 3 },
  { taste: "Curaba fleurs de sureau", tested: false },
  { taste: "Fruit du dragon", tested: false },
  { taste: "Waldbeere", tested: false },
  { taste: "Baies sauvages", tested: false },
  { taste: "Figue pomme", tested: false },
  { taste: "Kiwi pomme", tested: false },
  { taste: "Framboise givrée", tested: false },
  { taste: "Cerise cannelle", tested: false },
  { taste: "Cranberry", tested: false },
]);

const celsius = buildBrand("Celsius", [
  { taste: "Fraise et pastèque", tested: true, rating: 7.5 },
  { taste: "Pêche", tested: true, rating: 7 },
  { taste: "Framboise et pêche", tested: true, rating: 6.5 },
  { taste: "Fraise et passion", tested: true, rating: 6 },
  { taste: "Framboise bleu", tested: true, rating: 6 },
  { taste: "Mangue et citron", tested: false },
  { taste: "Kiwi et goyave", tested: false },
  { taste: "Explosion fruitée", tested: false },
]);

const crazyTiger = buildBrand("Crazy Tiger", [
  { taste: "Pêche", tested: false },
]);

const parts = [monster, redBull, celsius, crazyTiger];

export const ENERGY_DRINKS_SEED_BRANDS: EnergyDrinkBrand[] = parts.map((p) => p.brand);

export const ENERGY_DRINKS_SEED_REVIEWS: EnergyDrinksReviewsMap = parts.reduce(
  (acc, p) => ({ ...acc, ...p.reviews }),
  {} as EnergyDrinksReviewsMap,
);

/** Version du seed : incrémenter pour réappliquer une mise à jour du catalogue. */
export const ENERGY_DRINKS_SEED_VERSION = 3;
