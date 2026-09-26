/**
 * useEnergyDrinks — Gestion des marques, goûts et avis sur les boissons énergisantes.
 *
 * Marques (energy_drinks_brands_v3) contenant des goûts ; pour chaque goût :
 * testé + note sur 10 (energy_drinks_reviews_v2). Seed initial via energy_drinks_seed_version.
 */
import { useMemo, useCallback, useEffect, useRef, useState } from "react";
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
import {
  type EnergyDrinkImageBlobs,
  storeEnergyDrinkImageDataUrl,
  importEnergyDrinkImageToBlobs,
  isExternalEnergyDrinkImageUrl,
  isLocalEnergyDrinkImageRef,
  parseLocalEnergyDrinkImageKey,
  resolveEnergyDrinkImageUrl,
} from "@/lib/energyDrinkImageStorage";
import {
  loadEnergyDrinkImageBlobsLocal,
  saveEnergyDrinkImageBlobsLocal,
} from "@/lib/energyDrinkImageLocalStore";

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
const PREF_IMAGE_BLOBS = "energy_drinks_image_blobs_v1";

/** Version du remplissage automatique des images de canettes. */
const ENERGY_DRINKS_IMAGES_VERSION = 2;

/** Réinitialise les rognages obsolètes puis active l'auto-rognage portrait. */
const ENERGY_DRINKS_CROP_VERSION = 4;

/** Clé localStorage pour le backup local des boissons (protection contre écrasement Supabase). */
const LOCAL_BACKUP_KEY = "mealcards_energy_drinks_local_backup";

/**
 * Sauvegarde une copie locale des marques dans localStorage.
 * Appelée après chaque écriture utilisateur — protège contre les écrasements Supabase accidentels.
 */
function saveEnergyDrinksLocalBackup(brands: EnergyDrinkBrand[]): void {
  try {
    if (!brands || brands.length === 0) return;
    localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify({ brands, savedAt: new Date().toISOString() }));
  } catch { /* ignore (quota ou indisponible) */ }
}

/** Lit le backup local des marques (null si absent ou invalide). */
function loadEnergyDrinksLocalBackup(): { brands: EnergyDrinkBrand[]; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.brands)) return null;
    return parsed as { brands: EnergyDrinkBrand[]; savedAt: string };
  } catch { return null; }
}

/**
 * Fusionne le seed dans la liste courante de façon NON-DESTRUCTIVE :
 * - Les marques existantes (même id) sont conservées telles quelles.
 * - Les marques du seed absentes sont ajoutées en fin de liste.
 * - Pour chaque marque existante, les goûts du seed absents sont ajoutés.
 * - Les avis existants sont conservés ; les avis du seed pour les nouveaux goûts sont ajoutés.
 * Aucun goût ni aucune marque déjà présents ne sont modifiés ou supprimés.
 */
function mergeSeedNonDestructive(
  currentBrands: EnergyDrinkBrand[],
  currentReviews: EnergyDrinksReviewsMap,
  seedBrands: EnergyDrinkBrand[],
  seedReviews: EnergyDrinksReviewsMap,
): { brands: EnergyDrinkBrand[]; reviews: EnergyDrinksReviewsMap; changed: boolean } {
  let changed = false;
  const brandMap = new Map(currentBrands.map((b) => [b.id, b]));
  const nextBrands = [...currentBrands];
  const nextReviews = { ...currentReviews };

  for (const seedBrand of seedBrands) {
    const existing = brandMap.get(seedBrand.id);
    if (!existing) {
      // Marque entièrement nouvelle → on l'ajoute
      nextBrands.push(seedBrand);
      brandMap.set(seedBrand.id, seedBrand);
      for (const f of seedBrand.flavors) {
        if (!(f.id in nextReviews) && seedReviews[f.id]) {
          nextReviews[f.id] = seedReviews[f.id];
        }
      }
      changed = true;
    } else {
      // Marque existante → on complète uniquement les goûts manquants
      const existingFlavorIds = new Set(existing.flavors.map((f) => f.id));
      const newFlavors: EnergyDrinkFlavor[] = [];
      for (const sf of seedBrand.flavors) {
        if (!existingFlavorIds.has(sf.id)) {
          newFlavors.push(sf);
          if (!(sf.id in nextReviews) && seedReviews[sf.id]) {
            nextReviews[sf.id] = seedReviews[sf.id];
          }
          changed = true;
        }
      }
      if (newFlavors.length > 0) {
        const idx = nextBrands.findIndex((b) => b.id === existing.id);
        const updated = { ...existing, flavors: [...existing.flavors, ...newFlavors] };
        nextBrands[idx] = updated;
        brandMap.set(existing.id, updated);
      }
    }
  }

  return { brands: nextBrands, reviews: nextReviews, changed };
}

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
  const { getPreference, setPreference, setPreferencesBatch, isLoading } = usePreferences();
  const seedAppliedRef = useRef(false);
  const imagesAppliedRef = useRef(false);
  const cropResetRef = useRef(false);
  const autoCropInFlightRef = useRef<Set<string>>(new Set());
  const blobsMigratedRef = useRef(false);

  const [imageBlobs, setImageBlobs] = useState<EnergyDrinkImageBlobs>({});
  const [blobsReady, setBlobsReady] = useState(false);

  const brands = getPreference<EnergyDrinkBrand[]>(PREF_BRANDS, ENERGY_DRINKS_SEED_BRANDS);
  const reviews = getPreference<EnergyDrinksReviewsMap>(PREF_REVIEWS, ENERGY_DRINKS_SEED_REVIEWS);

  /**
   * Persiste les blobs d’images en IndexedDB uniquement (jamais dans user_preferences).
   */
  const persistImageBlobs = useCallback(async (next: EnergyDrinkImageBlobs) => {
    setImageBlobs(next);
    await saveEnergyDrinkImageBlobsLocal(next);
  }, []);

  /**
   * Charge IndexedDB, migre l’ancienne clé prefs Supabase si besoin, puis purge le serveur.
   */
  useEffect(() => {
    if (isLoading || blobsMigratedRef.current) return;
    let cancelled = false;

    (async () => {
      let local = await loadEnergyDrinkImageBlobsLocal();
      const remote = getPreference<EnergyDrinkImageBlobs>(PREF_IMAGE_BLOBS, {});
      const remoteEntries = Object.entries(remote).filter(
        ([, value]) => typeof value === "string" && value.length > 0,
      );

      if (remoteEntries.length > 0) {
        local = { ...Object.fromEntries(remoteEntries), ...local };
        await saveEnergyDrinkImageBlobsLocal(local);
        // Vide la clé Supabase pour couper l’egress (payloads multi-Mo).
        setPreference.mutate({ key: PREF_IMAGE_BLOBS, value: {} });
      }

      if (cancelled) return;
      blobsMigratedRef.current = true;
      setImageBlobs(local);
      setBlobsReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, getPreference, setPreference]);

  /** Résout une référence d'image (locale ou URL) vers une URL affichable. */
  const resolveImageUrl = useCallback(
    (ref: string | null | undefined) => resolveEnergyDrinkImageUrl(ref, imageBlobs),
    [imageBlobs],
  );

  /**
   * Applique le seed de façon NON-DESTRUCTIVE : fusionne uniquement les marques/goûts
   * absents de la liste courante. Ne supprime et n'écrase jamais les données utilisateur.
   */
  useEffect(() => {
    if (isLoading || seedAppliedRef.current) return;
    const appliedVersion = getPreference<number>(PREF_SEED_VERSION, 0);
    if (appliedVersion >= ENERGY_DRINKS_SEED_VERSION) return;

    seedAppliedRef.current = true;

    const currentBrands = getPreference<EnergyDrinkBrand[]>(PREF_BRANDS, []);
    const currentReviews = getPreference<EnergyDrinksReviewsMap>(PREF_REVIEWS, {});

    // Premier lancement (liste vide) → injection directe du seed complet
    if (!currentBrands || currentBrands.length === 0) {
      setPreferencesBatch.mutate([
        { key: PREF_BRANDS, value: ENERGY_DRINKS_SEED_BRANDS },
        { key: PREF_REVIEWS, value: ENERGY_DRINKS_SEED_REVIEWS },
        { key: PREF_SEED_VERSION, value: ENERGY_DRINKS_SEED_VERSION },
      ]);
      return;
    }

    // Liste existante → fusion non-destructive
    const { brands: merged, reviews: mergedReviews, changed } = mergeSeedNonDestructive(
      currentBrands,
      currentReviews,
      ENERGY_DRINKS_SEED_BRANDS,
      ENERGY_DRINKS_SEED_REVIEWS,
    );

    if (changed) {
      setPreferencesBatch.mutate([
        { key: PREF_BRANDS, value: merged },
        { key: PREF_REVIEWS, value: mergedReviews },
        { key: PREF_SEED_VERSION, value: ENERGY_DRINKS_SEED_VERSION },
      ]);
    } else {
      setPreferencesBatch.mutate([
        { key: PREF_SEED_VERSION, value: ENERGY_DRINKS_SEED_VERSION },
      ]);
    }
  }, [isLoading, getPreference, setPreferencesBatch]);

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
      setPreferencesBatch.mutate([
        { key: PREF_BRANDS, value: withImages },
        { key: PREF_IMAGES_VERSION, value: ENERGY_DRINKS_IMAGES_VERSION },
      ]);
    } else {
      setPreference.mutate({ key: PREF_IMAGES_VERSION, value: ENERGY_DRINKS_IMAGES_VERSION });
    }
  }, [isLoading, getPreference, setPreference, setPreferencesBatch]);

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
    setPreferencesBatch.mutate([
      { key: PREF_BRANDS, value: withoutCrops },
      { key: PREF_CROP_VERSION, value: ENERGY_DRINKS_CROP_VERSION },
    ]);
  }, [isLoading, getPreference, setPreferencesBatch]);

  // Pas d'import auto des URLs externes (Carrefour etc.) : CORS bloque le fetch et spam la console.
  // Les images s'affichent toujours via leur URL ; une copie locale n'est créée qu'au coller/upload manuel.

  /** Applique un rognage auto (sans bandes blanches/grises) sur les images non réglées à la main.
   * Uniquement pour images locales / data URL — les URLs Carrefour etc. bloquent CORS.
   */
  useEffect(() => {
    if (isLoading || !blobsReady) return;

    const pending = brands
      .flatMap((brand) =>
        brand.flavors.filter(
          (flavor) =>
            flavor.imageUrl &&
            !isExternalEnergyDrinkImageUrl(flavor.imageUrl) &&
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
        const resolvedUrl = resolveEnergyDrinkImageUrl(flavor.imageUrl, imageBlobs);
        const crop = resolvedUrl ? await autoDetectEnergyDrinkCrop(resolvedUrl) : null;
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
  }, [brands, blobsReady, imageBlobs, isLoading, getPreference, setPreference]);

  const orderedBrands = useMemo(
    () => brands.map((b) => ({ ...b, flavors: [...b.flavors] })),
    [brands],
  );

  // Backup local automatique après chaque changement de liste
  useEffect(() => {
    if (!isLoading && brands && brands.length > 0) {
      saveEnergyDrinksLocalBackup(brands);
    }
  }, [brands, isLoading]);

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
      setPreferencesBatch.mutate([
        { key: PREF_BRANDS, value: brands.filter((b) => b.id !== brandId) },
        { key: PREF_REVIEWS, value: nextReviews },
      ]);
    },
    [brands, reviews, setPreferencesBatch],
  );

  /** Supprime un goût d'une marque. */
  const deleteFlavor = useCallback(
    (brandId: string, flavorId: string) => {
      const nextReviews = { ...reviews };
      delete nextReviews[flavorId];
      setPreferencesBatch.mutate([
        {
          key: PREF_BRANDS,
          value: brands.map((b) =>
            b.id === brandId
              ? { ...b, flavors: b.flavors.filter((f) => f.id !== flavorId) }
              : b,
          ),
        },
        { key: PREF_REVIEWS, value: nextReviews },
      ]);
    },
    [brands, reviews, setPreferencesBatch],
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

  /** Enregistre l'image d'un goût : importe une URL externe en local ou met à jour le rognage. */
  const saveFlavorImage = useCallback(
    async (
      brandId: string,
      flavorId: string,
      opts: {
        sourceUrl?: string | null;
        crop?: EnergyDrinkImageCrop | null;
        imageCropManual?: boolean;
      },
    ): Promise<boolean> => {
      const brand = brands.find((b) => b.id === brandId);
      const flavor = brand?.flavors.find((f) => f.id === flavorId);
      if (!brand || !flavor) return false;

      let nextBlobs = { ...imageBlobs };
      let nextImageUrl = flavor.imageUrl ?? null;
      let blobsChanged = false;
      const { sourceUrl, crop, imageCropManual } = opts;

      if (sourceUrl === null) {
        if (nextImageUrl && isLocalEnergyDrinkImageRef(nextImageUrl)) {
          const key = parseLocalEnergyDrinkImageKey(nextImageUrl);
          const { [key]: _removed, ...rest } = nextBlobs;
          nextBlobs = rest;
          blobsChanged = true;
        }
        nextImageUrl = null;
      } else if (sourceUrl && sourceUrl.startsWith("data:")) {
        const stored = storeEnergyDrinkImageDataUrl(nextBlobs, flavorId, sourceUrl);
        nextBlobs = stored.blobs;
        nextImageUrl = stored.localRef;
        blobsChanged = true;
      } else if (
        sourceUrl &&
        isExternalEnergyDrinkImageUrl(sourceUrl) &&
        sourceUrl !== flavor.imageUrl
      ) {
        const imported = await importEnergyDrinkImageToBlobs(nextBlobs, flavorId, sourceUrl);
        if (imported) {
          nextBlobs = imported.blobs;
          nextImageUrl = imported.localRef;
          blobsChanged = true;
        } else {
          nextImageUrl = sourceUrl;
        }
      }

      const patch: Partial<
        Pick<EnergyDrinkFlavor, "imageUrl" | "imageCrop" | "imageCropManual">
      > = {};
      if (sourceUrl !== undefined) patch.imageUrl = nextImageUrl;
      if (crop !== undefined) patch.imageCrop = crop;
      if (imageCropManual !== undefined) patch.imageCropManual = imageCropManual;

      if (Object.keys(patch).length === 0) return true;

      if (blobsChanged) {
        await persistImageBlobs(nextBlobs);
      }

      setPreference.mutate({
        key: PREF_BRANDS,
        value: brands.map((b) =>
          b.id === brandId
            ? {
                ...b,
                flavors: b.flavors.map((f) => (f.id === flavorId ? { ...f, ...patch } : f)),
              }
            : b,
        ),
      });
      return true;
    },
    [brands, imageBlobs, setPreference, persistImageBlobs],
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

  /**
   * Exporte la liste complète des marques + avis en JSON téléchargeable.
   */
  const exportBrands = useCallback(() => {
    const payload = { brands: orderedBrands, reviews, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `boissons_${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [orderedBrands, reviews]);

  /**
   * Importe une liste depuis un fichier JSON exporté précédemment.
   * Mode « fusion » : ne supprime aucune donnée existante, ajoute uniquement ce qui manque.
   */
  const importBrands = useCallback(
    async (file: File): Promise<{ added: number; error?: string }> => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as {
          brands?: EnergyDrinkBrand[];
          reviews?: EnergyDrinksReviewsMap;
        };
        if (!Array.isArray(parsed?.brands)) {
          return { added: 0, error: "Fichier invalide (brands manquant)" };
        }
        const importedBrands: EnergyDrinkBrand[] = parsed.brands;
        const importedReviews: EnergyDrinksReviewsMap = parsed.reviews ?? {};
        const currentBrands = getPreference<EnergyDrinkBrand[]>(PREF_BRANDS, []);
        const currentReviews = getPreference<EnergyDrinksReviewsMap>(PREF_REVIEWS, {});
        const { brands: merged, reviews: mergedReviews, changed } = mergeSeedNonDestructive(
          currentBrands,
          currentReviews,
          importedBrands,
          importedReviews,
        );
        const added = merged.flatMap((b) => b.flavors).length -
          currentBrands.flatMap((b) => b.flavors).length;
        if (changed) {
          setPreferencesBatch.mutate([
            { key: PREF_BRANDS, value: merged },
            { key: PREF_REVIEWS, value: mergedReviews },
          ]);
        }
        return { added };
      } catch (e) {
        return { added: 0, error: `Erreur lecture fichier : ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    [getPreference, setPreferencesBatch],
  );

  /**
   * Restaure depuis le backup local (localStorage) si Supabase a écrasé la liste.
   */
  const restoreFromLocalBackup = useCallback((): boolean => {
    const backup = loadEnergyDrinksLocalBackup();
    if (!backup || backup.brands.length === 0) return false;
    setPreference.mutate({ key: PREF_BRANDS, value: backup.brands });
    return true;
  }, [setPreference]);

  const localBackup = useMemo(() => loadEnergyDrinksLocalBackup(), []);

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
    saveFlavorImage,
    resolveImageUrl,
    moveBrand,
    stats,
    exportBrands,
    importBrands,
    restoreFromLocalBackup,
    localBackup,
  };
}
