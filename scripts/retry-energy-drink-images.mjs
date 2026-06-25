/**
 * Script ponctuel : complète les images manquantes via Open Food Facts.
 */
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RETRY_SEARCH = {
  "monster-punch-pacific-beige": "monster pacific punch",
  "monster-ultra-violet-zero-sucre": "monster ultra violet",
  "monster-punch-mixxd-violet": "monster mixxd punch",
  "monster-juice-limonade": "monster limonade juice",
  "monster-punch-rio": "monster rio punch",
  "monster-ultra-valentino-rossi-zero-sucre": "monster valentino rossi",
  "monster-ultra-ginger-brew": "monster ginger brew",
  "monster-ultra-peche": "monster ultra peachy keen",
  "monster-reserve-ananas-blanc": "monster reserve white pineapple",
  "monster-reserve-orange-dreamsicle": "monster reserve orange dreamsicle",
  "monster-reserve-peche-et-creme": "monster reserve peaches cream",
  "red-bull-sans-sucre-zero-calorie": "red bull sugarfree",
  "red-bull-abricot-fraise": "red bull apricot strawberry",
  "red-bull-myrtille": "red bull blueberry",
  "red-bull-juneberry": "red bull juneberry",
  "red-bull-asperule-pamplemousse-violet-mat": "red bull woodruff grapefruit",
  "red-bull-pasteque": "red bull watermelon",
  "red-bull-fruit-du-dragon": "red bull dragon fruit",
  "red-bull-kiwi-pomme": "red bull kiwi apple",
  "red-bull-cranberry": "red bull cranberry",
  "celsius-framboise-et-peche": "celsius raspberry peach",
  "celsius-kiwi-et-goyave": "celsius kiwi guava",
  "celsius-explosion-fruitee": "celsius fruit burst",
  "monster-ultra-lewis-hamilton-top-speed-zero-sucre": "monster ultra lewis hamilton",
  "monster-ultra-lando-norris-zero-sucre": "monster lando norris",
  "monster-ultra-rudy-red-sans-sucre": "monster ultra ruby red",
  "monster-punch-pipeline-zero-sucre-rose": "monster pipeline punch zero",
  "red-bull-coco-acai": "red bull coconut berry",
  "red-bull-mure-givree-vanille": "red bull frosted berry",
  "red-bull-waldbeere": "red bull forest fruit",
  "red-bull-baies-sauvages": "red bull wild berries",
  "red-bull-cerise-cannelle": "red bull spiced pear",
  "celsius-framboise-bleu": "celsius blue raspberry peach",
  "crazy-tiger-peche": "crazy tiger energy drink peach",
};

function fetchJson(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      https
        .get(url, { headers: { "User-Agent": "MealsCards/1.0 (personal catalog)" } }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            if (data.startsWith("<!DOCTYPE") || data.startsWith("<html")) {
              if (n > 0) return setTimeout(() => attempt(n - 1), 2000);
              return reject(new Error("HTML rate limit"));
            }
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", (e) => {
          if (n > 0) return setTimeout(() => attempt(n - 1), 2000);
          reject(e);
        });
    };
    attempt(retries);
  });
}

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
      fields: "code,product_name,image_front_small_url,image_front_url",
    });
  const data = await fetchJson(url);
  for (const p of data.products ?? []) {
    const img = upscaleOffUrl(p.image_front_small_url || p.image_front_url);
    if (img) return { img, name: p.product_name };
  }
  return null;
}

async function main() {
  const existingPath = path.join(__dirname, "../src/data/energyDrinkImages.ts");
  const existing = fs.readFileSync(existingPath, "utf8");
  const results = {};
  const re = /"([^"]+)":\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(existing))) results[m[1]] = m[2];

  const ids = Object.keys(RETRY_SEARCH);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (results[id]) continue;
    process.stdout.write(`[${i + 1}/${ids.length}] ${id}... `);
    try {
      const hit = await searchImage(RETRY_SEARCH[id]);
      if (hit) {
        results[id] = hit.img;
        console.log(hit.name);
      } else {
        console.log("AUCUNE");
      }
    } catch (e) {
      console.log("ERREUR", e.message);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  const lines = [
    "/**",
    " * URLs d'images de canettes (Open Food Facts, licence CC BY-SA).",
    " * Clé = identifiant slug du goût.",
    " */",
    "export const ENERGY_DRINK_IMAGES_BY_FLAVOR_ID: Record<string, string> = {",
  ];
  for (const [id, url] of Object.entries(results).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  "${id}": ${JSON.stringify(url)},`);
  }
  lines.push("};", "");
  lines.push("/** Retourne l'URL d'image par défaut d'un goût, ou null si inconnue. */");
  lines.push("export function getDefaultEnergyDrinkImage(flavorId: string): string | null {");
  lines.push("  return ENERGY_DRINK_IMAGES_BY_FLAVOR_ID[flavorId] ?? null;");
  lines.push("}", "");
  fs.writeFileSync(existingPath, lines.join("\n"), "utf8");
  console.log(`\nTotal: ${Object.keys(results).length} images`);
}

main();
