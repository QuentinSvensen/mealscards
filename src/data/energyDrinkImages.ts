/**
 * URLs d'images de canettes (priorité Carrefour.fr, repli Open Food Facts).
 * Source Carrefour : https://www.carrefour.fr/s?q=Monsters
 */
import type { EnergyDrinkBrand } from "@/lib/energyDrinkUtils";

export const ENERGY_DRINK_IMAGES_BY_FLAVOR_ID: Record<string, string> = {
  "celsius-explosion-fruitee": "https://media.carrefour.fr/media/referential/media/c9ddf1d7dbaf436ba80a1fba93d1df09/p_540x540/06430056289908_H1N1_s09.png",
  "celsius-fraise-et-passion": "https://media.carrefour.fr/media/referential/media/91b86037aecd4369ba18291d3c7ec091/p_540x540/06430056289885_H1N1_s11.png",
  "celsius-fraise-et-pasteque": "https://media.carrefour.fr/media/referential/media/acdfb3d24c4a4ad7852444d5c74ae762/p_540x540/06430056289953_H1N1_s07.png",
  "celsius-framboise-bleu": "https://media.carrefour.fr/media/referential/media/c9ddf1d7dbaf436ba80a1fba93d1df09/p_540x540/06430056289908_H1N1_s09.png",
  "celsius-framboise-et-peche": "https://media.carrefour.fr/media/referential/media/7f99328870e44ca9898e978a0c5acc16/p_540x540/06430056289779_H1N1_s13.png",
  "celsius-kiwi-et-goyave": "https://media.carrefour.fr/media/referential/media/b16c010a77db465b9a92e1dcc8bf6a63/p_540x540/06430056289960_H1N1_s09.png",
  "celsius-mangue-et-citron": "https://media.carrefour.fr/media/referential/media/1752b0281ed748b0b6db3356673f772f/p_540x540/06430056289892_H1N1_s11.png",
  "celsius-peche": "https://media.carrefour.fr/media/referential/media/37beb5c1bdfd450694c6444a8a417655/p_540x540/06430056289731_H1N1_s11.jpeg",
  "crazy-tiger-peche": "https://images.openfoodfacts.org/images/products/355/172/021/0042/front_fr.3.400.jpg",
  "monster-juice-bad-apple": "https://media.carrefour.fr/media/referential/media/65c7082c0edd45cbb5f72870e8208a61/p_540x540/05061013944779_H1N1_s01.png",
  "monster-juice-khaotic": "https://images.openfoodfacts.org/images/products/007/084/703/6944/front_en.8.400.jpg",
  "monster-juice-limonade": "https://images.openfoodfacts.org/images/products/506/075/121/7480/front_en.6.400.jpg",
  "monster-juice-mango-loco": "https://media.carrefour.fr/media/referential/media/7b1c643f22e244e8b55aaecfaef0a35a/p_540x540/05060517889852_H1N1_s01.png",
  "monster-juice-monarch-papillon-punch-orange": "https://media.carrefour.fr/media/referential/media/0e79fc86fc3046249b35c769f96c4184/p_540x540/05060751213727_H1N1_s01.png",
  "monster-juice-viking-berry": "https://media.carrefour.fr/media/referential/media/b0c0c9f42294462f8d42df258a48c89d/p_540x540/05056784911600_H1N1_s01.png",
  "monster-nitro": "https://images.openfoodfacts.org/images/products/505/678/490/0000/front_en.13.400.jpg",
  "monster-original": "https://media.carrefour.fr/media/referential/media/e10a684ee2bc496cabe06906edbb7354/p_540x540/05060335632302_H1N1_s01.png",
  "monster-original-zero-sucre": "https://media.carrefour.fr/media/referential/media/470a20c4528845d8ac023a45837b099f/p_540x540/05060947549753_H1N1_s01.png",
  "monster-punch-mixxd-violet": "https://media.carrefour.fr/media/referential/media/afd80210b533400787292a278a23388c/p_540x540/05060335635426_A1N1_s01.png",
  "monster-punch-pacific-beige": "https://media.carrefour.fr/media/referential/media/ead464b550424cf8afba570af2072811/p_540x540/05060639127108_H1N1_s01.png",
  "monster-punch-pacific-punch-beige": "https://media.carrefour.fr/media/referential/media/ead464b550424cf8afba570af2072811/p_540x540/05060639127108_H1N1_s01.png",
  "monster-punch-pipeline-rose": "https://media.carrefour.fr/media/referential/media/7de47cd396f04e19afc3507a10a2d57f/p_540x540/05060517885526_H1N1_s01.png",
  "monster-punch-pipeline-zero-sucre-rose": "https://media.carrefour.fr/media/referential/media/7de47cd396f04e19afc3507a10a2d57f/p_540x540/05060517885526_H1N1_s01.png",
  "monster-punch-rio": "https://media.carrefour.fr/media/referential/media/f44de11879fa4da98898271b513b474e/p_540x540/05056784902301_H1N1_s01.png",
  "monster-reserve-ananas-blanc": "https://images.openfoodfacts.org/images/products/506/089/662/8820/front_sv.20.400.jpg",
  "monster-reserve-melon-d-eau": "https://images.openfoodfacts.org/images/products/506/094/754/6110/front_fr.3.400.jpg",
  "monster-reserve-orange-dreamsicle": "https://images.openfoodfacts.org/images/products/506/094/754/8800/front_de.6.400.jpg",
  "monster-reserve-peche-et-creme": "https://images.openfoodfacts.org/images/products/506/089/662/8820/front_sv.20.400.jpg",
  "monster-ultra-blue": "https://images.openfoodfacts.org/images/products/007/084/789/8245/front_en.76.400.jpg",
  "monster-ultra-blue-hawaii-zero-sucre": "https://images.openfoodfacts.org/images/products/007/084/789/8887/front_en.3.400.jpg",
  "monster-ultra-fiesta-zero-sucre-verte-bizarre": "https://media.carrefour.fr/media/referential/media/21db87117ca0463ebdee9f434e78aa67/p_540x540/05056784908075_A1N1_s01.png",
  "monster-ultra-ginger-brew": "https://images.openfoodfacts.org/images/products/506/075/121/1631/front_de.18.400.jpg",
  "monster-ultra-gold-zero-sucre": "https://images.openfoodfacts.org/images/products/506/089/662/3863/front_fr.15.400.jpg",
  "monster-ultra-lando-norris-zero-sucre": "https://media.carrefour.fr/media/referential/media/21f1dd0040544d61937363b1b817c1a9/p_540x540/05056784906880_H1N1_s01.png",
  "monster-ultra-lewis-hamilton-top-speed-zero-sucre": "https://media.carrefour.fr/medias/6e9cc830444c4835bf631e99494e5a4f/p_540x540/05060896625379_H1N1_s01.png",
  "monster-ultra-paradise-zero-sucre-verte": "https://media.carrefour.fr/media/referential/media/71b6d94ff3e54cd0b7ccd8bd529f8d12/p_540x540/05060639127139_H1N1_s01.png",
  "monster-ultra-peche": "https://media.carrefour.fr/media/referential/media/fbe8dc5eea574ed28710a042d65099ed/p_540x540/05061013945363_H1N1_s01.png",
  "monster-ultra-peche-zero-sucre": "https://media.carrefour.fr/media/referential/media/fbe8dc5eea574ed28710a042d65099ed/p_540x540/05061013945363_H1N1_s01.png",
  "monster-ultra-red": "https://images.openfoodfacts.org/images/products/505/678/490/5623/front_pl.3.400.jpg",
  "monster-ultra-rosa-zero-sucre": "https://media.carrefour.fr/medias/b0c6d3184f5f498daebc28ac336a2a89/p_540x540/05060947541184_H1N1_s01.png",
  "monster-ultra-rudy-red-sans-sucre": "https://images.openfoodfacts.org/images/products/505/678/490/5623/front_pl.3.400.jpg",
  "monster-ultra-strawberry-dreams-zero-sucre": "https://media.carrefour.fr/media/referential/media/0d31734dfac943799aeb2996d82858cd/p_540x540/05056784900635_H1N1_s01.png",
  "monster-ultra-sunrise-orange": "https://media.carrefour.fr/media/referential/media/21db87117ca0463ebdee9f434e78aa67/p_540x540/05056784908075_A1N1_s01.png",
  "monster-ultra-valentino-rossi-zero-sucre": "https://media.carrefour.fr/media/referential/media/7d97eb701c534a6c8c368621590945b0/p_540x540/05056784908662_C1N1_s01.png",
  "monster-ultra-vice-goyave-bleue-clair": "https://images.openfoodfacts.org/images/products/007/084/789/8146/front_en.54.400.jpg",
  "monster-ultra-violet-zero-sucre": "https://images.openfoodfacts.org/images/products/506/063/912/5739/front_en.65.400.jpg",
  "monster-ultra-white-zero-sucre": "https://media.carrefour.fr/media/referential/media/d51e5f9b945c4c1f98f3ea77e7575906/p_540x540/05060517886844_H1L1_s01.png",
  "red-bull-abricot-fraise": "https://media.carrefour.fr/media/referential/media/591c039ee6014938903bfc941efac7bb/p_540x540/09002490255916_C1N1_s29.jpeg",
  "red-bull-acai-violet": "https://media.carrefour.fr/media/referential/media/f968146cc4814b3f8c65d4eead48e986/p_540x540/09002490278311_C1N1_s02.jpeg",
  "red-bull-agrumes": "https://media.carrefour.fr/media/referential/media/9c7fef31338d4f86b680745be9f677c8/p_540x540/09002490290276_C1N1_s01.png",
  "red-bull-asperule-pamplemousse-violet-mat": "https://images.openfoodfacts.org/images/products/000/009/047/4064/front_en.7.400.jpg",
  "red-bull-baies-sauvages": "https://images.openfoodfacts.org/images/products/900/249/026/3195/front_en.8.400.jpg",
  "red-bull-cerise-cannelle": "https://images.openfoodfacts.org/images/products/000/009/047/4088/front_en.16.400.jpg",
  "red-bull-cerise-sakura-blanc": "https://images.openfoodfacts.org/images/products/900/249/029/0306/front_fr.14.400.jpg",
  "red-bull-coco-acai": "https://media.carrefour.fr/media/referential/media/ab5e635f23b041cca6a6428c986eb6f3/p_540x540/09002490246624_C1N1_s26.jpeg",
  "red-bull-cranberry": "https://images.openfoodfacts.org/images/products/061/126/917/4526/front_fr.4.400.jpg",
  "red-bull-curaba-fleurs-de-sureau": "https://images.openfoodfacts.org/images/products/000/009/047/4064/front_en.7.400.jpg",
  "red-bull-figue-pomme": "https://images.openfoodfacts.org/images/products/061/126/900/1402/front_en.3.400.jpg",
  "red-bull-framboise-givree": "https://media.carrefour.fr/medias/efa7e76ee74a4081acd77483de9a2e47/p_540x540/09002490274641_C1N1_s03.jpeg",
  "red-bull-fruit-du-dragon": "https://images.openfoodfacts.org/images/products/900/249/025/5176/front_en.28.400.jpg",
  "red-bull-fruits-tropicaux": "https://images.openfoodfacts.org/images/products/061/126/911/3570/front_en.33.400.jpg",
  "red-bull-juneberry": "https://media.carrefour.fr/medias/d98f69fa592c46cd9e249c640662f6f3/p_540x540/09002490263195_C1N1_s21.jpeg",
  "red-bull-kiwi-pomme": "https://images.openfoodfacts.org/images/products/000/009/042/4175/front_sv.3.400.jpg",
  "red-bull-mure-givree-vanille": "https://media.carrefour.fr/medias/efa7e76ee74a4081acd77483de9a2e47/p_540x540/09002490274641_C1N1_s03.jpeg",
  "red-bull-myrtille": "https://media.carrefour.fr/media/referential/media/de2bed1dd155432e8d2b0872afbf5c18/p_540x540/09002490219567_C1N1_s20.jpeg",
  "red-bull-original": "https://media.carrefour.fr/medias/39025f14ab4f4f4bbd65772e2558e011/p_540x540/09002490233655_C1N1_s01.jpeg",
  "red-bull-pasteque": "https://media.carrefour.fr/medias/b0a60077649a3146a7b038fcb095156b/p_540x540/09002490246594-c1n1-s48.jpg",
  "red-bull-peche-blanche": "https://media.carrefour.fr/media/referential/media/2098ae4aebda454ca8954ac282073317/p_540x540/09002490278229_C1N1_s02.png",
  "red-bull-pomme-fuji-gingembre": "https://media.carrefour.fr/media/referential/media/ed77fcc2ce314fc4885e291b67ce947a/p_540x540/09002490278281_C1N1_s02.png",
  "red-bull-pomme-raisin": "https://images.openfoodfacts.org/images/products/885/022/800/8409/front_en.4.400.jpg",
  "red-bull-sans-sucre-zero-calorie": "https://media.carrefour.fr/media/referential/media/4205aee116ab42cf91e4bc758f63d1ab/p_540x540/09002490200381_A1N1_s20.jpeg",
  "red-bull-waldbeere": "https://images.openfoodfacts.org/images/products/018/085/400/0231/front_en.23.400.jpg",
};

/** Retourne l'URL d'image par défaut d'un goût, ou null si inconnue. */
export function getDefaultEnergyDrinkImage(flavorId: string): string | null {
  return ENERGY_DRINK_IMAGES_BY_FLAVOR_ID[flavorId] ?? null;
}

/**
 * Applique les images du catalogue aux goûts.
 * replaceExisting=true : remplace aussi les images déjà renseignées (migration Carrefour).
 */
export function applyDefaultEnergyDrinkImages(
  brands: EnergyDrinkBrand[],
  options?: { replaceExisting?: boolean },
) {
  let changed = false;
  const next = brands.map((brand) => ({
    ...brand,
    flavors: brand.flavors.map((flavor) => {
      const imageUrl = getDefaultEnergyDrinkImage(flavor.id);
      if (!imageUrl) return flavor;
      if (!options?.replaceExisting && flavor.imageUrl) return flavor;
      if (flavor.imageUrl === imageUrl) return flavor;
      changed = true;
      return { ...flavor, imageUrl };
    }),
  }));
  return { brands: next, changed };
}
