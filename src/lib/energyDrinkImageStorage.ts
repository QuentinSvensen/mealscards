/**
 * Stockage local des images de boissons énergisantes (data URL en préférences).
 * Les références `local:…` remplacent les URLs externes une fois importées.
 */

export type EnergyDrinkImageBlobs = Record<string, string>;

export const ENERGY_DRINK_LOCAL_IMAGE_PREFIX = "local:";

const IMPORT_BATCH_SIZE = 5;

/** Indique si une valeur est une référence d'image locale (clé dans les blobs). */
export function isLocalEnergyDrinkImageRef(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(ENERGY_DRINK_LOCAL_IMAGE_PREFIX));
}

/** Indique si l'URL pointe encore vers une ressource externe importable. */
export function isExternalEnergyDrinkImageUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith("http://") || value.startsWith("https://");
}

/** Construit la clé de stockage pour l'image d'une marque. */
export function energyDrinkBrandImageKey(brandId: string): string {
  return `brand:${brandId}`;
}

/** Construit une référence locale persistée à partir d'une clé de blob. */
export function makeLocalEnergyDrinkImageRef(storageKey: string): string {
  return `${ENERGY_DRINK_LOCAL_IMAGE_PREFIX}${storageKey}`;
}

/** Extrait la clé de blob depuis une référence locale. */
export function parseLocalEnergyDrinkImageKey(ref: string): string {
  return ref.slice(ENERGY_DRINK_LOCAL_IMAGE_PREFIX.length);
}

/** Résout une référence (locale, data URL ou URL externe) vers une URL affichable. */
export function resolveEnergyDrinkImageUrl(
  ref: string | null | undefined,
  blobs: EnergyDrinkImageBlobs,
): string | null {
  if (!ref) return null;
  if (ref.startsWith("data:")) return ref;
  if (isLocalEnergyDrinkImageRef(ref)) {
    return blobs[parseLocalEnergyDrinkImageKey(ref)] ?? null;
  }
  return ref;
}

/** Convertit un Blob en data URL base64. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Charge une image distante dans un élément img (sans forcer CORS). */
function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image inaccessible"));
    img.src = url;
  });
}

/** Tente d'exporter une image chargée en data URL via canvas. */
function imageElementToDataUrl(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Télécharge une image distante et la convertit en data URL (copie non rognée). */
export async function fetchEnergyDrinkImageAsDataUrl(
  sourceUrl: string,
): Promise<string | null> {
  const trimmed = sourceUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return trimmed;

  try {
    const response = await fetch(trimmed, { mode: "cors", credentials: "omit" });
    if (response.ok) {
      const blob = await response.blob();
      if (blob.size > 0) return blobToDataUrl(blob);
    }
  } catch {
    // Repli canvas ci-dessous si fetch bloqué (CORS).
  }

  try {
    const img = await loadImageElement(trimmed);
    return imageElementToDataUrl(img);
  } catch {
    return null;
  }
}

/** Importe une image externe dans le catalogue local et retourne la référence locale. */
export async function importEnergyDrinkImageToBlobs(
  blobs: EnergyDrinkImageBlobs,
  storageKey: string,
  sourceUrl: string,
): Promise<{ blobs: EnergyDrinkImageBlobs; localRef: string } | null> {
  const dataUrl = await fetchEnergyDrinkImageAsDataUrl(sourceUrl);
  if (!dataUrl) return null;
  return {
    blobs: { ...blobs, [storageKey]: dataUrl },
    localRef: makeLocalEnergyDrinkImageRef(storageKey),
  };
}

export { IMPORT_BATCH_SIZE as ENERGY_DRINK_IMAGE_IMPORT_BATCH_SIZE };
