/**
 * Utilitaires de recadrage d'images pour les vignettes de boissons énergisantes.
 */
import type { CSSProperties } from "react";

/** Zone de recadrage en pourcentage de l'image source (0–100). */
export type EnergyDrinkImageCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Viewport portrait de l'éditeur (même ratio que les vignettes). */
export const CROP_CONTAINER_WIDTH = 140;
export const CROP_CONTAINER_HEIGHT = 220;

/** Ratio largeur / hauteur des vignettes canette (portrait). */
export const DRINK_THUMB_ASPECT = CROP_CONTAINER_WIDTH / CROP_CONTAINER_HEIGHT;

/** Calcule l'échelle minimale pour que l'image couvre entièrement la zone de recadrage. */
export function getMinCoverScale(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
): number {
  return Math.max(containerWidth / naturalWidth, containerHeight / naturalHeight);
}

/** Convertit pan/zoom en zone de recadrage (% de l'image naturelle). */
export function cropFromTransform(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): EnergyDrinkImageCrop {
  const displayW = naturalWidth * scale;
  const displayH = naturalHeight * scale;
  const imgLeft = containerWidth / 2 + offsetX - displayW / 2;
  const imgTop = containerHeight / 2 + offsetY - displayH / 2;

  const viewLeft = Math.max(imgLeft, 0);
  const viewTop = Math.max(imgTop, 0);
  const viewRight = Math.min(imgLeft + displayW, containerWidth);
  const viewBottom = Math.min(imgTop + displayH, containerHeight);

  const cropLeft = (viewLeft - imgLeft) / scale;
  const cropTop = (viewTop - imgTop) / scale;
  const cropRight = (viewRight - imgLeft) / scale;
  const cropBottom = (viewBottom - imgTop) / scale;

  return {
    x: (cropLeft / naturalWidth) * 100,
    y: (cropTop / naturalHeight) * 100,
    width: ((cropRight - cropLeft) / naturalWidth) * 100,
    height: ((cropBottom - cropTop) / naturalHeight) * 100,
  };
}

/** Restaure pan/zoom à partir d'une zone de recadrage existante. */
export function transformFromCrop(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
  crop: EnergyDrinkImageCrop,
): { scale: number; offsetX: number; offsetY: number } {
  const cropLeft = (crop.x / 100) * naturalWidth;
  const cropTop = (crop.y / 100) * naturalHeight;
  const cropW = (crop.width / 100) * naturalWidth;
  const cropH = (crop.height / 100) * naturalHeight;

  const scale = Math.max(containerWidth / cropW, containerHeight / cropH);
  const displayW = naturalWidth * scale;
  const displayH = naturalHeight * scale;
  const imgLeft = -cropLeft * scale;
  const imgTop = -cropTop * scale;

  return {
    scale,
    offsetX: imgLeft + displayW / 2 - containerWidth / 2,
    offsetY: imgTop + displayH / 2 - containerHeight / 2,
  };
}

/** Calcule la position affichée de l'image pour reproduire fidèlement un recadrage. */
export function getCropPreviewLayout(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
  crop: EnergyDrinkImageCrop,
): { width: number; height: number; left: number; top: number } {
  const { scale, offsetX, offsetY } = transformFromCrop(
    naturalWidth,
    naturalHeight,
    containerWidth,
    containerHeight,
    crop,
  );
  const displayW = naturalWidth * scale;
  const displayH = naturalHeight * scale;

  return {
    width: displayW,
    height: displayH,
    left: containerWidth / 2 + offsetX - displayW / 2,
    top: containerHeight / 2 + offsetY - displayH / 2,
  };
}

/** Retourne les styles CSS en % du conteneur (indépendant de la taille en pixels). */
export function getCroppedImageStyleFromPercent(crop: EnergyDrinkImageCrop): CSSProperties {
  return {
    position: "absolute",
    maxWidth: "none",
    width: `${10000 / crop.width}%`,
    height: `${10000 / crop.height}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
  };
}

/** Indique si une zone de recadrage est valide et exploitable. */
export function isValidImageCrop(crop: EnergyDrinkImageCrop | null | undefined): boolean {
  if (!crop) return false;
  return crop.width > 0 && crop.height > 0 && crop.x >= 0 && crop.y >= 0;
}

/** Indique si une zone de recadrage couvre quasiment toute l'image (pas de rognage utile). */
export function isFullImageCrop(crop: EnergyDrinkImageCrop | null | undefined): boolean {
  if (!crop) return true;
  const eps = 0.5;
  return (
    crop.x <= eps &&
    crop.y <= eps &&
    crop.width >= 100 - eps &&
    crop.height >= 100 - eps
  );
}
