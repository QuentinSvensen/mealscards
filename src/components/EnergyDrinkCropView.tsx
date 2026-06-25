/**
 * Affichage partagé d'une image recadrée (identique dans l'éditeur et les vignettes).
 */
import type { EnergyDrinkImageCrop } from "@/lib/energyDrinkImageCrop";
import {
  getCroppedImageStyleFromPercent,
  isFullImageCrop,
  isValidImageCrop,
} from "@/lib/energyDrinkImageCrop";

type EnergyDrinkCropViewProps = {
  src: string;
  crop?: EnergyDrinkImageCrop | null;
  className?: string;
  style?: React.CSSProperties;
  onError?: () => void;
};

/** Affiche une image avec le même rendu de rognage partout dans l'app. */
export function EnergyDrinkCropView({
  src,
  crop,
  className,
  style,
  onError,
}: EnergyDrinkCropViewProps) {
  const hasCrop = isValidImageCrop(crop) && !isFullImageCrop(crop);

  return (
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      style={style}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className={
          hasCrop
            ? "absolute max-w-none"
            : "absolute inset-0 h-full w-full object-cover object-center"
        }
        style={hasCrop && crop ? getCroppedImageStyleFromPercent(crop) : undefined}
        onError={onError}
      />
    </div>
  );
}
