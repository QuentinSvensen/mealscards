/**
 * Détection automatique du rognage pour masquer les fonds blancs/gris autour des canettes.
 */
import {
  CROP_CONTAINER_HEIGHT,
  CROP_CONTAINER_WIDTH,
  type EnergyDrinkImageCrop,
} from "@/lib/energyDrinkImageCrop";

const THUMB_ASPECT = CROP_CONTAINER_WIDTH / CROP_CONTAINER_HEIGHT;
const AUTO_CROP_BATCH_SIZE = 8;

/** Hauteur minimale du rognage (% de l'image) — limite le zoom excessif. */
const MIN_CROP_HEIGHT_PCT = 58;
/** Au-delà, on resserre légèrement pour retirer le fond blanc. */
const LOOSE_CROP_HEIGHT_PCT = 78;

/** Indique si un rognage auto doit être recalculé (trop de fond ou trop zoomé). */
export function isLooseAutoCrop(crop: EnergyDrinkImageCrop | null | undefined): boolean {
  if (!crop) return true;
  const tooMuchBackground = crop.width > LOOSE_CROP_HEIGHT_PCT && crop.height > LOOSE_CROP_HEIGHT_PCT;
  const tooZoomed = crop.height < MIN_CROP_HEIGHT_PCT - 4 || crop.width < 32;
  return tooMuchBackground || tooZoomed;
}

/** Indique si un pixel ressemble à un fond blanc ou gris clair de packshot. */
function isBackgroundPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 12) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max - min;
  const avg = (r + g + b) / 3;
  if (avg > 168 && saturation < 42) return true;
  if (max > 215 && saturation < 38) return true;
  if (avg > 145 && saturation < 22) return true;
  return false;
}

/** Convertit une zone en pixels vers des pourcentages de l'image source. */
function bboxToCrop(
  imgW: number,
  imgH: number,
  x: number,
  y: number,
  w: number,
  h: number,
): EnergyDrinkImageCrop {
  return {
    x: (x / imgW) * 100,
    y: (y / imgH) * 100,
    width: (w / imgW) * 100,
    height: (h / imgH) * 100,
  };
}

/** Place un rognage centré sur un point focal donné. */
function placeCenteredCrop(
  imgW: number,
  imgH: number,
  centerX: number,
  centerY: number,
  cropW: number,
  cropH: number,
): EnergyDrinkImageCrop {
  let x = centerX - cropW / 2;
  let y = centerY - cropH / 2;
  x = Math.max(0, Math.min(x, imgW - cropW));
  y = Math.max(0, Math.min(y, imgH - cropH));
  return bboxToCrop(imgW, imgH, x, y, cropW, cropH);
}

/** Équilibre le rognage : pas trop de fond, pas trop zoomé sur le logo seul. */
function finalizeAutoCrop(
  imgW: number,
  imgH: number,
  crop: EnergyDrinkImageCrop,
): EnergyDrinkImageCrop {
  const centerX = ((crop.x + crop.width / 2) / 100) * imgW;
  const centerY = ((crop.y + crop.height / 2) / 100) * imgH;

  if (crop.height < MIN_CROP_HEIGHT_PCT) {
    let cropH = imgH * (MIN_CROP_HEIGHT_PCT / 100);
    let cropW = cropH * THUMB_ASPECT;
    if (cropW > imgW * 0.9) {
      cropW = imgW * 0.88;
      cropH = cropW / THUMB_ASPECT;
    }
    return placeCenteredCrop(imgW, imgH, centerX, centerY, cropW, cropH);
  }

  if (crop.width > LOOSE_CROP_HEIGHT_PCT && crop.height > LOOSE_CROP_HEIGHT_PCT) {
    let cropH = imgH * 0.66;
    let cropW = cropH * THUMB_ASPECT;
    if (cropW > imgW * 0.9) {
      cropW = imgW * 0.88;
      cropH = cropW / THUMB_ASPECT;
    }
    return placeCenteredCrop(imgW, imgH, centerX, centerY, cropW, cropH);
  }

  return crop;
}

/** Agrandit une zone pour respecter le ratio portrait des vignettes tout en gardant le sujet. */
function expandToPortraitAspect(
  imgW: number,
  imgH: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  paddingRatio = 0.035,
): EnergyDrinkImageCrop {
  const minContentH = imgH * 0.4;
  let contentH = maxY - minY;
  if (contentH < minContentH) {
    const cy = (minY + maxY) / 2;
    minY = Math.max(0, cy - minContentH / 2);
    maxY = Math.min(imgH, cy + minContentH / 2);
  }

  let w = maxX - minX;
  let h = maxY - minY;
  const padX = imgW * paddingRatio;
  const padY = imgH * paddingRatio;

  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(imgW, maxX + padX);
  maxY = Math.min(imgH, maxY + padY);
  w = maxX - minX;
  h = maxY - minY;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  if (w / h < THUMB_ASPECT) {
    w = h * THUMB_ASPECT;
  } else {
    h = w / THUMB_ASPECT;
  }

  let x = cx - w / 2;
  let y = cy - h / 2;

  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + w > imgW) x = imgW - w;
  if (y + h > imgH) y = imgH - h;

  w = Math.min(w, imgW);
  h = Math.min(h, imgH);
  x = Math.max(0, Math.min(x, imgW - w));
  y = Math.max(0, Math.min(y, imgH - h));

  return finalizeAutoCrop(imgW, imgH, bboxToCrop(imgW, imgH, x, y, w, h));
}

/** Trouve les bords du produit via projection lignes/colonnes (ignore les bandes blanches). */
function detectBoundsByProjection(
  imgW: number,
  imgH: number,
  data: Uint8ClampedArray,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const rowContent = new Uint32Array(imgH);
  const colContent = new Uint32Array(imgW);
  const step = 2;

  for (let y = 0; y < imgH; y += step) {
    for (let x = 0; x < imgW; x += step) {
      const i = (y * imgW + x) * 4;
      if (isBackgroundPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      rowContent[y]++;
      colContent[x]++;
    }
  }

  const minRowPixels = Math.max(2, Math.floor(imgW / step / 24));
  const minColPixels = Math.max(2, Math.floor(imgH / step / 24));

  let minY = 0;
  let maxY = imgH - 1;
  while (minY < imgH && rowContent[minY] < minRowPixels) minY += step;
  while (maxY > minY && rowContent[maxY] < minRowPixels) maxY -= step;

  let minX = 0;
  let maxX = imgW - 1;
  while (minX < imgW && colContent[minX] < minColPixels) minX += step;
  while (maxX > minX && colContent[maxX] < minColPixels) maxX -= step;

  if (minY >= maxY || minX >= maxX) return null;
  return { minX, minY, maxX, maxY };
}

/** Analyse les pixels pour trouver la boîte englobante du produit (hors fond clair). */
function detectCropFromImageData(
  imgW: number,
  imgH: number,
  data: Uint8ClampedArray,
): EnergyDrinkImageCrop | null {
  const bounds = detectBoundsByProjection(imgW, imgH, data);
  if (!bounds) return null;
  return expandToPortraitAspect(imgW, imgH, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
}

/** Rognage heuristique centré quand l'analyse pixel n'est pas possible (CORS). */
function heuristicPortraitCrop(imgW: number, imgH: number): EnergyDrinkImageCrop {
  let cropH = imgH * 0.64;
  let cropW = cropH * THUMB_ASPECT;

  if (cropW > imgW * 0.9) {
    cropW = imgW * 0.88;
    cropH = cropW / THUMB_ASPECT;
  }

  const x = (imgW - cropW) / 2;
  const y = (imgH - cropH) / 2;
  return bboxToCrop(imgW, imgH, x, y, cropW, cropH);
}

/** Charge une image distante pour analyse (avec repli si CORS bloque le canvas). */
function loadImageForAnalysis(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      const fallback = new Image();
      fallback.onload = () => resolve(fallback);
      fallback.onerror = () => reject(new Error("Image introuvable"));
      fallback.src = url;
    };
    img.src = url;
  });
}

/** Dessine l'image sur un canvas réduit pour accélérer l'analyse des pixels. */
function drawScaledForAnalysis(
  img: HTMLImageElement,
  maxSide: number,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(imgW, imgH));
  const w = Math.max(8, Math.round(imgW * scale));
  const h = Math.max(8, Math.round(imgH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, w, h);
  try {
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
  } catch {
    return null;
  }
}

/**
 * Détecte automatiquement un rognage portrait centré sur la canette,
 * en rognant les bandes blanches/grises au-dessus et en dessous.
 */
export async function autoDetectEnergyDrinkCrop(
  imageUrl: string,
): Promise<EnergyDrinkImageCrop | null> {
  try {
    const img = await loadImageForAnalysis(imageUrl);
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    if (imgW < 8 || imgH < 8) return null;

    const sampled = drawScaledForAnalysis(img, 320);
    if (sampled) {
      const detected = detectCropFromImageData(sampled.width, sampled.height, sampled.data);
      if (detected) return finalizeAutoCrop(imgW, imgH, detected);
    }

    return heuristicPortraitCrop(imgW, imgH);
  } catch {
    return null;
  }
}

export { AUTO_CROP_BATCH_SIZE };
