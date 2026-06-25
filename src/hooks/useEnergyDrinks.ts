/**
 * useEnergyDrinks — Gestion des marques, goûts et avis sur les boissons énergisantes.
 *
 * Marques (energy_drinks_brands_v3) contenant des goûts ; pour chaque goût :
 * testé + note sur 10 (energy_drinks_reviews_v2). Seed initial via energy_drinks_seed_version.
 */
import { useMemo, useCallback, useEffect, useRef } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import {
  ENERGY_DRINKS_SEED_BRANDS,
  ENERGY_DRINKS_SEED_REVIEWS,
  ENERGY_DRINKS_SEED_VERSION,
} from "@/data/energyDrinksSeed";
import { applyDefaultEnergyDrinkImages, getDefaultEnergyDrinkImage } from "@/data/energyDrinkImages";
import { autoDetectEnergyDrinkCrop, AUTO_CROP_BATCH_SIZE, isLooseAutoCrop } from "@/lib/energyDrinkAutoCrop";
import type {
  EnergyDrinkBrand,
  EnergyDrinkFlavor,
  EnergyDrinkReview,
  EnergyDrinksReviewsMap,
} from "@/lib/energyDrinkUtils";
import type { EnergyDrinkImageCrop } from "@/lib/energyDrinkImageCrop";
import { energyDrinkFlavorsConflict, slugifyEnergyDrinkId } from "@/lib/energyDrinkUtils";

export type {
  EnergyDrinkBrand,
  EnergyDrinkFlavor,
  EnergyDrinkReview,
  EnergyDrinksReviewsMap,
} from "@/lib/energyDrinkUtils";
export { slugifyEnergyDrinkId } from "@/lib/energyDrinkUtils";

const PREF_BRANDS = "energy_drinks_brands_v3";
const PREF_REVIEWS = "energy_drinks_reviews_v2";
const PREF_SEED_VERSION = "energy_drinks_seed_version";
const PREF_IMAGES_VERSION = "energy_drinks_images_version";
const PREF_CROP_VERSION = "energy_drinks_crop_version";

/** Version du remplissage automatique des images de canettes. */
const ENERGY_DRINKS_IMAGES_VERSION = 2;

/** Réinitialise les rognages obsolètes puis active l'auto-rognage portrait. */
const ENERGY_DRINKS_CROP_VERSION = 4;

/** Aplatit marques + goûts en entrées pour filtrage et statistiques. */
function flattenFlavors(brands: EnergyDrinkBrand[]) {
  return brands.flatMap((brand) =>
    brand.flavors.map((flavor) => ({
      brandId: brand.id,
      brandName: brand.name,
      brandImageUrl: brand.imageUrl,
      flavor,
    })),
  );
}

export function useEnergyDrinks() {
  const { getPreference, setPreference, isLoading } = usePreferences();
  const seedAppliedRef = useRef(false);
  const imagesAppliedRef = useRef(false);
  const cropResetRef = useRef(false);
  const autoCropInFlightRef = useRef<Set<string>>(new Set());

  const brands = getPreference<EnergyDrinkBrand[]>(PREF_BRANDS, ENERGY_DRINKS_SEED_BRANDS);
  const reviews = getPreference<EnergyDrinksReviewsMap>(PREF_REVIEWS, ENERGY_DRINKS_SEED_REVIEWS);

  /** Applique le seed catalogue une fois (ou après bump de version). */
  useEffect(() => {
    if (isLoading || seedAppliedRef.current) return;
    const appliedVersion = getPreference<number>(PREF_SEED_VERSION, 0);
    if (appliedVersion >= ENERGY_DRINKS_SEED_VERSION) return;

    seedAppliedRef.current = true;
    setPreference.mutate({ key: PREF_BRANDS, value: ENERGY_DRINKS_SEED_BRANDS });
    setPreference.mutate({ key: PREF_REVIEWS, value: ENERGY_DRINKS_SEED_REVIEWS });
    setPreference.mutate({ key: PREF_SEED_VERSION, value: ENERGY_DRINKS_SEED_VERSION });
  }, [isLoading, getPreference, setPreference]);

  /** Complète les images manquantes sans écraser celles modifiées par l'utilisateur. */
  useEffect(() => {
    if (isLoading || imagesAppliedRef.current) return;
    const appliedImagesVersion = getPreference<number>(PREF_IMAGES_VERSION, 0);
    if (appliedImagesVersion >= ENERGY_DRINKS_IMAGES_VERSION) return;

    const currentBrands = getPreference<EnergyDrinkBrand[]>(PREF_BRANDS, ENERGY_DRINKS_SEED_BRANDS);
    const replaceExisting = appliedImagesVersion >= 1;
    const { brands: withImages, changed } = applyDefaultEnergyDrinkImages(currentBrands, {
      replaceExisting,
    });

    imagesAppliedRef.current = true;
    if (changed) {
      setPreference.mutate({ key: PREF_BRANDS, value: withImages });
    }
    setPreference.mutate({ key: PREF_IMAGES_VERSION, value: ENERGY_DRINKS_IMAGES_VERSION });
  }, [isLoading, getPreference, setPreference]);

  /** Efface les rognages obsolètes pour relancer l'auto-rognage centré. */
  useEffect(() => {
    if (isLoading || cropResetRef.current) return;
    const appliedCropVersion = getPreference<number>(PREF_CROP_VERSION, 0);
    if (appliedCropVersion >= ENERGY_DRINKS_CROP_VERSION) return;

    const currentBrands = getPreference<EnergyDrinkBrand[]>(PREF_BRANDS, ENERGY_DRINKS_SEED_BRANDS);
    const withoutCrops = currentBrands.map((brand) => ({
      ...brand,
      flavors: brand.flavors.map((flavor) =>
        flavor.imageCropManual
          ? flavor
          : { ...flavor, imageCrop: null, imageCropManual: false },
      ),
    }));

    cropResetRef.current = true;
    setPreference.mutate({ key: PREF_BRANDS, value: withoutCrops });
    setPreference.mutate({ key: PREF_CROP_VERSION, value: ENERGY_DRINKS_CROP_VERSION });
  }, [isLoading, getPreference, setPreference]);

  /** Applique un rognage auto (sans bandes blanches/grises) sur les images non réglées à la main. */
  useEffect(() => {
    if (isLoading) return;

    const pending = brands
      .flatMap((brand) =>
        brand.flavors.filter(
          (flavor) =>
            flavor.imageUrl &&
            !flavor.imageCropManual &&
            (!flavor.imageCrop || isLooseAutoCrop(flavor.imageCrop)) &&
            !autoCropInFlightRef.current.has(flavor.id),
        ),
      )
      .slice(0, AUTO_CROP_BATCH_SIZE);

    if (pending.length === 0) return;

    let cancelled = false;

    (async () => {
      const detected = new Map<string, EnergyDrinkImageCrop>();

      for (const flavor of pending) {
        if (cancelled || !flavor.imageUrl) break;
        autoCropInFlightRef.current.add(flavor.id);
        const crop = await autoDetectEnergyDrinkCrop(flavor.imageUrl);
        autoCropInFlightRef.current.delete(flavor.id);
        if (crop) detected.set(flavor.id, crop);
      }

      if (cancelled || detected.size === 0) return;

      const currentBrands = getPreference<EnergyDrinkBrand[]>(PREF_BRANDS, ENERGY_DRINKS_SEED_BRANDS);
      setPreference.mutate({
        key: PREF_BRANDS,
        value: currentBrands.map((brand) => ({
          ...brand,
          flavors: brand.flavors.map((flavor) => {
            const crop = detected.get(flavor.id);
            if (!crop) return flavor;
            return { ...flavor, imageCrop: crop, imageCropManual: false };
          }),
        })),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [brands, isLoading, getPreference, setPreference]);

  const orderedBrands = useMemo(
    () => brands.map((b) => ({ ...b, flavors: [...b.flavors] })),
    [brands],
  );

  const allFlavors = useMemo(() => flattenFlavors(orderedBrands), [orderedBrands]);

  /** Retourne l'état utilisateur d'un goût (non testé par défaut). */
  const getReview = useCallback(
    (flavorId: string): EnergyDrinkReview => reviews[flavorId] ?? { tested: false, rating: null },
    [reviews],
  );

  /** Met à jour l'état testé / note d'un goût et persiste en préférences. */
  const updateReview = useCallback(
    (flavorId: string, patch: Partial<EnergyDrinkReview>) => {
      const current = reviews[flavorId] ?? { tested: false, rating: null };
      const next: EnergyDrinkReview = { ...current, ...patch };
      if (!next.tested) next.rating = null;
      setPreference.mutate({
        key: PREF_REVIEWS,
        value: { ...reviews, [flavorId]: next },
      });
    },
    [reviews, setPreference],
  );

  /** Crée une nouvelle marque vide (catégorie). */
  const addBrand = useCallback(
    (name: string, imageUrl?: string | null) => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      const id = slugifyEnergyDrinkId(trimmed);
      if (brands.some((b) => b.id === id || b.name.toLowerCase() === trimmed.toLowerCase())) {
        return false;
      }
      const entry: EnergyDrinkBrand = {
        id,
        name: trimmed,
        imageUrl: imageUrl ?? null,
        flavors: [],
      };
      setPreference.mutate({
        key: PREF_BRANDS,
        value: [...brands, entry],
      });
      return true;
    },
    [brands, setPreference],
  );

  /** Ajoute un goût dans une marque existante. */
  const addFlavor = useCallback(
    (
      brandId: string,
      taste: string,
      opts?: { imageUrl?: string | null; volumeMl?: number | null; zeroCalorie?: boolean },
    ) => {
      const trimmed = taste.trim();
      if (!trimmed) return false;
      const brand = brands.find((b) => b.id === brandId);
      if (!brand) return false;
      const zeroCalorie = opts?.zeroCalorie ?? false;
      if (brand.flavors.some((f) => energyDrinkFlavorsConflict(f, { taste: trimmed, zeroCalorie }))) {
        return false;
      }

      const idLabel = zeroCalorie ? `${brand.name}-${trimmed}-0cal` : `${brand.name}-${trimmed}`;
      const id = slugifyEnergyDrinkId(idLabel);
      if (brand.flavors.some((f) => f.id === id)) return false;

      const flavor: EnergyDrinkFlavor = {
        id,
        taste: trimmed,
        imageUrl: opts?.imageUrl ?? getDefaultEnergyDrinkImage(id) ?? null,
        volumeMl: opts?.volumeMl ?? null,
        zeroCalorie,
      };

      setPreference.mutate({
        key: PREF_BRANDS,
        value: brands.map((b) =>
          b.id === brandId ? { ...b, flavors: [...b.flavors, flavor] } : b,
        ),
      });
      return true;
    },
    [brands, setPreference],
  );

  /** Supprime une marque et les avis associés à ses goûts. */
  const deleteBrand = useCallback(
    (brandId: string) => {
      const brand = brands.find((b) => b.id === brandId);
      if (!brand) return;
      const nextReviews = { ...reviews };
      for (const f of brand.flavors) delete nextReviews[f.id];
      setPreference.mutate({ key: PREF_BRANDS, value: brands.filter((b) => b.id !== brandId) });
      setPreference.mutate({ key: PREF_REVIEWS, value: nextReviews });
    },
    [brands, reviews, setPreference],
  );

  /** Supprime un goût d'une marque. */
  const deleteFlavor = useCallback(
    (brandId: string, flavorId: string) => {
      const nextReviews = { ...reviews };
      delete nextReviews[flavorId];
      setPreference.mutate({
        key: PREF_BRANDS,
        value: brands.map((b) =>
          b.id === brandId
            ? { ...b, flavors: b.flavors.filter((f) => f.id !== flavorId) }
            : b,
        ),
      });
      setPreference.mutate({ key: PREF_REVIEWS, value: nextReviews });
    },
    [brands, reviews, setPreference],
  );

  /** Met à jour les propriétés d'un goût (image, sans calories, etc.). */
  const updateFlavor = useCallback(
    (
      brandId: string,
      flavorId: string,
      patch: Partial<
        Pick<
          EnergyDrinkFlavor,
          "imageUrl" | "imageCrop" | "imageCropManual" | "zeroCalorie" | "taste" | "volumeMl"
        >
      >,
    ) => {
      const brand = brands.find((b) => b.id === brandId);
      const current = brand?.flavors.find((f) => f.id === flavorId);
      if (!brand || !current) return false;

      const nextPatch = { ...patch };
      if (nextPatch.taste !== undefined) {
        const trimmed = nextPatch.taste.trim();
        if (!trimmed) return false;
        nextPatch.taste = trimmed;
      }

      const merged: EnergyDrinkFlavor = { ...current, ...nextPatch };
      if (
        brand.flavors.some(
          (f) => f.id !== flavorId && energyDrinkFlavorsConflict(f, merged),
        )
      ) {
        return false;
      }

      setPreference.mutate({
        key: PREF_BRANDS,
        value: brands.map((b) =>
          b.id === brandId
            ? {
                ...b,
                flavors: b.flavors.map((f) => (f.id === flavorId ? { ...f, ...nextPatch } : f)),
              }
            : b,
        ),
      });
      return true;
    },
    [brands, setPreference],
  );

  /** Met à jour le nom ou l'image d'une marque. */
  const updateBrand = useCallback(
    (brandId: string, patch: Partial<Pick<EnergyDrinkBrand, "name" | "imageUrl">>) => {
      const brand = brands.find((b) => b.id === brandId);
      if (!brand) return false;

      const nextPatch = { ...patch };
      if (nextPatch.name !== undefined) {
        const trimmed = nextPatch.name.trim();
        if (!trimmed) return false;
        if (
          brands.some((b) => b.id !== brandId && b.name.toLowerCase() === trimmed.toLowerCase())
        ) {
          return false;
        }
        nextPatch.name = trimmed;
      }

      setPreference.mutate({
        key: PREF_BRANDS,
        value: brands.map((b) => (b.id === brandId ? { ...b, ...nextPatch } : b)),
      });
      return true;
    },
    [brands, setPreference],
  );

  /** Déplace une marque vers le haut ou le bas dans la liste. */
  const moveBrand = useCallback(
    (brandId: string, direction: "up" | "down") => {
      const index = brands.findIndex((b) => b.id === brandId);
      if (index < 0) return;
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= brands.length) return;
      const next = [...brands];
      [next[index], next[target]] = [next[target], next[index]];
      setPreference.mutate({ key: PREF_BRANDS, value: next });
    },
    [brands, setPreference],
  );

  const stats = useMemo(() => {
    const testedCount = allFlavors.filter((f) => getReview(f.flavor.id).tested).length;
    return {
      brands: orderedBrands.length,
      total: allFlavors.length,
      tested: testedCount,
      untested: allFlavors.length - testedCount,
    };
  }, [allFlavors, orderedBrands.length, getReview]);

  return {
    brands: orderedBrands,
    allFlavors,
    reviews,
    getReview,
    updateReview,
    addBrand,
    addFlavor,
    deleteBrand,
    deleteFlavor,
    updateFlavor,
    updateBrand,
    moveBrand,
    stats,
  };
}
