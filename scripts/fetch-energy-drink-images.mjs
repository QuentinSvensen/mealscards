/**
 * Script ponctuel : interroge Open Food Facts pour récupérer les URLs d'images de canettes.
 * Génère src/data/energyDrinkImages.generated.ts
 */
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Requêtes OFF par identifiant de goût (slug). */
const SEARCH_BY_FLAVOR_ID = {
  "monster-ultra-peche-zero-sucre": "monster ultra peachy keen",
  "monster-punch-pipeline-rose": "monster pipeline punch",
  "monster-ultra-paradise-zero-sucre-verte": "monster ultra paradise",
  "monster-punch-pacific-punch-beige": "monster pacific punch",
  "monster-punch-pacific-beige": "monster pacific punch",
  "monster-ultra-white-zero-sucre": "monster ultra white",
  "monster-ultra-gold-zero-sucre": "monster ultra gold",
  "monster-ultra-strawberry-dreams-zero-sucre": "monster ultra strawberry dreams",
  "monster-ultra-lewis-hamilton-top-speed-zero-sucre": "monster ultra lewis hamilton",
  "monster-ultra-violet-zero-sucre": "monster ultra violet",
  "monster-nitro": "monster nitro super dry",
  "monster-original-zero-sucre": "monster zero sugar",
  "monster-punch-mixxd-violet": "monster mixxd punch",
  "monster-ultra-rosa-zero-sucre": "monster ultra rosa",
  "monster-ultra-blue-hawaii-zero-sucre": "monster ultra blue hawaii",
  "monster-ultra-lando-norris-zero-sucre": "monster ultra lando norris",
  "monster-juice-monarch-papillon-punch-orange": "monster monarch juice",
  "monster-juice-limonade": "monster juice limonade",
  "monster-juice-viking-berry": "monster viking berry",
  "monster-punch-rio": "monster rio punch",
  "monster-juice-mango-loco": "monster mango loco",
  "monster-ultra-rudy-red-sans-sucre": "monster ultra rudy red",
  "monster-original": "monster energy original",
  "monster-juice-khaotic": "monster khaotic juice",
  "monster-ultra-valentino-rossi-zero-sucre": "monster ultra valentino rossi",
  "monster-juice-bad-apple": "monster bad apple",
  "monster-ultra-ginger-brew": "monster ultra ginger brew",
  "monster-ultra-fiesta-zero-sucre-verte-bizarre": "monster ultra fiesta mango",
  "monster-ultra-sunrise-orange": "monster ultra sunrise",
  "monster-ultra-blue": "monster ultra blue",
  "monster-ultra-peche": "monster ultra peachy keen",
  "monster-ultra-vice-goyave-bleue-clair": "monster ultra vice guava",
  "monster-ultra-red": "monster ultra red",
  "monster-punch-pipeline-zero-sucre-rose": "monster pipeline punch zero",
  "monster-reserve-ananas-blanc": "monster reserve white pineapple",
  "monster-reserve-melon-d-eau": "monster reserve watermelon",
  "monster-reserve-orange-dreamsicle": "monster reserve orange dreamsicle",
  "monster-reserve-peche-et-creme": "monster reserve peaches cream",
  "red-bull-sans-sucre-zero-calorie": "red bull sugarfree",
  "red-bull-original": "red bull energy drink",
  "red-bull-abricot-fraise": "red bull apricot strawberry",
  "red-bull-cerise-sakura-blanc": "red bull sakura",
  "red-bull-acai-violet": "red bull acai berry",
  "red-bull-myrtille": "red bull blueberry",
  "red-bull-coco-acai": "red bull coconut acai",
  "red-bull-mure-givree-vanille": "red bull frosted berry vanilla",
  "red-bull-fruits-tropicaux": "red bull tropical",
  "red-bull-juneberry": "red bull juneberry",
  "red-bull-asperule-pamplemousse-violet-mat": "red bull woodruff grapefruit",
  "red-bull-agrumes": "red bull citrus",
  "red-bull-pomme-fuji-gingembre": "red bull fuji apple ginger",
  "red-bull-pomme-raisin": "red bull apple grape",
  "red-bull-peche-blanche": "red bull white peach",
  "red-bull-pasteque": "red bull watermelon",
  "red-bull-curaba-fleurs-de-sureau": "red bull curuba elderflower",
  "red-bull-fruit-du-dragon": "red bull dragon fruit",
  "red-bull-waldbeere": "red bull waldbeere",
  "red-bull-baies-sauvages": "red bull wild berries",
  "red-bull-figue-pomme": "red bull fig apple",
  "red-bull-kiwi-pomme": "red bull kiwi apple",
  "red-bull-framboise-givree": "red bull iced vanilla berry",
  "red-bull-cerise-cannelle": "red bull spiced pear cinnamon",
  "red-bull-cranberry": "red bull cranberry",
  "celsius-fraise-et-pasteque": "celsius strawberry watermelon",
  "celsius-peche": "celsius peach vibe",
  "celsius-framboise-et-peche": "celsius raspberry peach",
  "celsius-fraise-et-passion": "celsius strawberry passionfruit",
  "celsius-framboise-bleu": "celsius blue raspberry peach",
  "celsius-mangue-et-citron": "celsius mango lemonade",
  "celsius-kiwi-et-goyave": "celsius kiwi guava",
  "celsius-explosion-fruitee": "celsius fruit burst",
  "crazy-tiger-peche": "crazy tiger peach",
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "MealsCards/1.0 (personal catalog)" } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

/** Transforme une URL OFF 200px en version 400px pour une meilleure netteté. */
function upscaleOffUrl(url) {
  if (!url) return null;
  return url.replace(/\.(\d+)\.jpg$/, ".400.jpg");
}

async function searchImage(query) {
  const url =
    "https://world.openfoodfacts.org/cgi/search.pl?" +
    new URLSearchParams({
      search_terms: query,
      search_simple: "1",
      action: "process",
      json: "1",
      page_size: "5",
      fields: "code,product_name,brands,image_front_small_url,image_front_url",
    });
  const data = await fetchJson(url);
  const products = data.products ?? [];
  for (const p of products) {
    const img = upscaleOffUrl(p.image_front_small_url || p.image_front_url);
    if (img) return { img, name: p.product_name };
  }
  return null;
}

async function main() {
  const results = {};
  const ids = Object.keys(SEARCH_BY_FLAVOR_ID);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const q = SEARCH_BY_FLAVOR_ID[id];
    process.stdout.write(`[${i + 1}/${ids.length}] ${id}... `);
    try {
      const hit = await searchImage(q);
      if (hit) {
        results[id] = hit.img;
        console.log(hit.name);
      } else {
        console.log("AUCUNE");
      }
    } catch (e) {
      console.log("ERREUR", e.message);
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  const outPath = path.join(__dirname, "../src/data/energyDrinkImages.ts");
  const lines = [
    "/**",
    " * URLs d'images de canettes (Open Food Facts, licence CC BY-SA).",
    " * Clé = identifiant slug du goût. Généré via scripts/fetch-energy-drink-images.mjs",
    " */",
    "export const ENERGY_DRINK_IMAGES_BY_FLAVOR_ID: Record<string, string> = {",
  ];
  for (const [id, url] of Object.entries(results)) {
    lines.push(`  "${id}": ${JSON.stringify(url)},`);
  }
  lines.push("};", "");
  lines.push("/** Retourne l'URL d'image par défaut d'un goût, ou null si inconnue. */");
  lines.push("export function getDefaultEnergyDrinkImage(flavorId: string): string | null {");
  lines.push("  return ENERGY_DRINK_IMAGES_BY_FLAVOR_ID[flavorId] ?? null;");
  lines.push("}", "");

  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\nÉcrit ${Object.keys(results).length}/${ids.length} images → ${outPath}`);
}

main();
