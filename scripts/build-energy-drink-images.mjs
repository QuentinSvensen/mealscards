/**
 * Génère src/data/energyDrinkImages.ts à partir des URLs Carrefour + repli Open Food Facts.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const carrefour = JSON.parse(
  fs.readFileSync(path.join(__dirname, "carrefour-urls.json"), "utf8"),
);

/** Repli Open Food Facts pour les goûts absents du catalogue Carrefour. */
const offFallback = {
  "monster-juice-khaotic":
    "https://images.openfoodfacts.org/images/products/007/084/703/6944/front_en.8.400.jpg",
  "monster-juice-limonade":
    "https://images.openfoodfacts.org/images/products/506/075/121/7480/front_en.6.400.jpg",
  "monster-nitro":
    "https://images.openfoodfacts.org/images/products/505/678/490/0000/front_en.13.400.jpg",
  "monster-reserve-ananas-blanc":
    "https://images.openfoodfacts.org/images/products/506/089/662/8820/front_sv.20.400.jpg",
  "monster-reserve-melon-d-eau":
    "https://images.openfoodfacts.org/images/products/506/094/754/6110/front_fr.3.400.jpg",
  "monster-reserve-orange-dreamsicle":
    "https://images.openfoodfacts.org/images/products/506/094/754/8800/front_de.6.400.jpg",
  "monster-reserve-peche-et-creme":
    "https://images.openfoodfacts.org/images/products/506/089/662/8820/front_sv.20.400.jpg",
  "monster-ultra-blue":
    "https://images.openfoodfacts.org/images/products/007/084/789/8245/front_en.76.400.jpg",
  "monster-ultra-blue-hawaii-zero-sucre":
    "https://images.openfoodfacts.org/images/products/007/084/789/8887/front_en.3.400.jpg",
  "monster-ultra-ginger-brew":
    "https://images.openfoodfacts.org/images/products/506/075/121/1631/front_de.18.400.jpg",
  "monster-ultra-gold-zero-sucre":
    "https://images.openfoodfacts.org/images/products/506/089/662/3863/front_fr.15.400.jpg",
  "monster-ultra-red":
    "https://images.openfoodfacts.org/images/products/505/678/490/5623/front_pl.3.400.jpg",
  "monster-ultra-rudy-red-sans-sucre":
    "https://images.openfoodfacts.org/images/products/505/678/490/5623/front_pl.3.400.jpg",
  "monster-ultra-vice-goyave-bleue-clair":
    "https://images.openfoodfacts.org/images/products/007/084/789/8146/front_en.54.400.jpg",
  "monster-ultra-violet-zero-sucre":
    "https://images.openfoodfacts.org/images/products/506/063/912/5739/front_en.65.400.jpg",
  "red-bull-asperule-pamplemousse-violet-mat":
    "https://images.openfoodfacts.org/images/products/000/009/047/4064/front_en.7.400.jpg",
  "red-bull-baies-sauvages":
    "https://images.openfoodfacts.org/images/products/900/249/026/3195/front_en.8.400.jpg",
  "red-bull-cerise-cannelle":
    "https://images.openfoodfacts.org/images/products/000/009/047/4088/front_en.16.400.jpg",
  "red-bull-cerise-sakura-blanc":
    "https://images.openfoodfacts.org/images/products/900/249/029/0306/front_fr.14.400.jpg",
  "red-bull-cranberry":
    "https://images.openfoodfacts.org/images/products/061/126/917/4526/front_fr.4.400.jpg",
  "red-bull-curaba-fleurs-de-sureau":
    "https://images.openfoodfacts.org/images/products/000/009/047/4064/front_en.7.400.jpg",
  "red-bull-figue-pomme":
    "https://images.openfoodfacts.org/images/products/061/126/900/1402/front_en.3.400.jpg",
  "red-bull-fruit-du-dragon":
    "https://images.openfoodfacts.org/images/products/900/249/025/5176/front_en.28.400.jpg",
  "red-bull-fruits-tropicaux":
    "https://images.openfoodfacts.org/images/products/061/126/911/3570/front_en.33.400.jpg",
  "red-bull-kiwi-pomme":
    "https://images.openfoodfacts.org/images/products/000/009/042/4175/front_sv.3.400.jpg",
  "red-bull-pomme-raisin":
    "https://images.openfoodfacts.org/images/products/885/022/800/8409/front_en.4.400.jpg",
  "red-bull-waldbeere":
    "https://images.openfoodfacts.org/images/products/018/085/400/0231/front_en.23.400.jpg",
  "crazy-tiger-peche":
    "https://images.openfoodfacts.org/images/products/355/172/021/0042/front_fr.3.400.jpg",
};

const merged = { ...offFallback, ...carrefour };
const ids = Object.keys(merged).sort();

const lines = [
  "/**",
  " * URLs d'images de canettes (priorité Carrefour.fr, repli Open Food Facts).",
  " * Source Carrefour : https://www.carrefour.fr/s?q=Monsters",
  " */",
  'import type { EnergyDrinkBrand } from "@/lib/energyDrinkUtils";',
  "",
  "export const ENERGY_DRINK_IMAGES_BY_FLAVOR_ID: Record<string, string> = {",
];

for (const id of ids) {
  lines.push(`  "${id}": ${JSON.stringify(merged[id])},`);
}

lines.push(
  "};",
  "",
  "/** Retourne l'URL d'image par défaut d'un goût, ou null si inconnue. */",
  "export function getDefaultEnergyDrinkImage(flavorId: string): string | null {",
  "  return ENERGY_DRINK_IMAGES_BY_FLAVOR_ID[flavorId] ?? null;",
  "}",
  "",
  "/**",
  " * Applique les images du catalogue aux goûts.",
  " * replaceExisting=true : remplace aussi les images déjà renseignées (migration Carrefour).",
  " */",
  "export function applyDefaultEnergyDrinkImages(",
  "  brands: EnergyDrinkBrand[],",
  "  options?: { replaceExisting?: boolean },",
  ") {",
  "  let changed = false;",
  "  const next = brands.map((brand) => ({",
  "    ...brand,",
  "    flavors: brand.flavors.map((flavor) => {",
  "      const imageUrl = getDefaultEnergyDrinkImage(flavor.id);",
  "      if (!imageUrl) return flavor;",
  "      if (!options?.replaceExisting && flavor.imageUrl) return flavor;",
  "      if (flavor.imageUrl === imageUrl) return flavor;",
  "      changed = true;",
  "      return { ...flavor, imageUrl };",
  "    }),",
  "  }));",
  "  return { brands: next, changed };",
  "}",
  "",
);

fs.writeFileSync(path.join(root, "src/data/energyDrinkImages.ts"), lines.join("\n"), "utf8");
console.log(`Généré ${ids.length} entrées (${Object.keys(carrefour).length} Carrefour)`);
