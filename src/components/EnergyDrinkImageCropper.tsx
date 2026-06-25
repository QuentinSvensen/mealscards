/**
 * Éditeur interactif pour rogner une image de canette (glisser + zoom).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  CROP_CONTAINER_HEIGHT,
  CROP_CONTAINER_WIDTH,
  cropFromTransform,
  getMinCoverScale,
  transformFromCrop,
  type EnergyDrinkImageCrop,
} from "@/lib/energyDrinkImageCrop";

type EnergyDrinkImageCropperProps = {
  imageUrl: string;
  crop?: EnergyDrinkImageCrop | null;
  onCropChange: (crop: EnergyDrinkImageCrop | null) => void;
};

export type EnergyDrinkImageCropperHandle = {
  /** Retourne le recadrage courant tel qu'affiché dans l'éditeur. */
  getCrop: () => EnergyDrinkImageCrop | null;
  /** Indique si l'utilisateur a modifié le cadrage manuellement. */
  wasAdjusted: () => boolean;
};

/** Grille de recadrage (tiers + croix centrale) pour faciliter le centrage. */
function CropGuideGrid() {
  const line = "absolute bg-black/80";
  const third = "33.3333%";

  return (
    <div className="absolute inset-0 z-10 pointer-events-none" aria-hidden>
      <div className={`${line} top-0 bottom-0 w-[1.5px]`} style={{ left: third }} />
      <div className={`${line} top-0 bottom-0 w-[1.5px]`} style={{ left: `calc(100% - ${third})` }} />
      <div className={`${line} left-0 right-0 h-[1.5px]`} style={{ top: third }} />
      <div className={`${line} left-0 right-0 h-[1.5px]`} style={{ top: `calc(100% - ${third})` }} />
      <div className={`${line} top-1/2 left-0 right-0 h-[2px] -translate-y-1/2 bg-black`} />
      <div className={`${line} left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-black`} />
    </div>
  );
}

export const EnergyDrinkImageCropper = forwardRef<
  EnergyDrinkImageCropperHandle,
  EnergyDrinkImageCropperProps
>(function EnergyDrinkImageCropper({ imageUrl, crop, onCropChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const initialCropRef = useRef(crop);
  const userAdjustedRef = useRef(false);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);

  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loadError, setLoadError] = useState(false);

  const containerWidth = CROP_CONTAINER_WIDTH;
  const containerHeight = CROP_CONTAINER_HEIGHT;

  scaleRef.current = scale;
  offsetRef.current = offset;
  naturalSizeRef.current = naturalSize;

  /** Réinitialise l'état quand l'URL change. */
  useEffect(() => {
    initialCropRef.current = crop;
    userAdjustedRef.current = false;
    setNaturalSize(null);
    setLoadError(false);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [imageUrl]);

  /** Pousse la zone de recadrage calculée vers le parent. */
  const emitCrop = useCallback(
    (
      nextScale: number,
      nextOffset: { x: number; y: number },
      size = naturalSizeRef.current,
    ) => {
      if (!size) return;
      onCropChange(
        cropFromTransform(
          size.width,
          size.height,
          containerWidth,
          containerHeight,
          nextScale,
          nextOffset.x,
          nextOffset.y,
        ),
      );
    },
    [containerWidth, containerHeight, onCropChange],
  );

  /** Initialise pan/zoom à partir des dimensions naturelles de l'image affichée. */
  const initFromNaturalSize = useCallback(
    (width: number, height: number) => {
      const size = { width, height };
      setNaturalSize(size);
      naturalSizeRef.current = size;
      setLoadError(false);

      const minScale = getMinCoverScale(width, height, containerWidth, containerHeight);
      const initialCrop = initialCropRef.current;
      let nextScale = minScale;
      let nextOffset = { x: 0, y: 0 };

      if (initialCrop) {
        const t = transformFromCrop(width, height, containerWidth, containerHeight, initialCrop);
        nextScale = t.scale;
        nextOffset = { x: t.offsetX, y: t.offsetY };
      }

      setScale(nextScale);
      setOffset(nextOffset);
      scaleRef.current = nextScale;
      offsetRef.current = nextOffset;
      emitCrop(nextScale, nextOffset, size);
    },
    [containerWidth, containerHeight, emitCrop],
  );

  useImperativeHandle(ref, () => ({
    /** Retourne le rognage tel qu'affiché dans l'éditeur (WYSIWYG à l'enregistrement). */
    getCrop: () => {
      const size = naturalSizeRef.current;
      if (!size) return null;
      return cropFromTransform(
        size.width,
        size.height,
        containerWidth,
        containerHeight,
        scaleRef.current,
        offsetRef.current.x,
        offsetRef.current.y,
      );
    },
    /** Indique si l'utilisateur a déplacé ou zoomé l'image. */
    wasAdjusted: () => userAdjustedRef.current,
  }));

  /** Démarre le glisser-déposer pour repositionner l'image. */
  const onPointerDown = (e: React.PointerEvent) => {
    if (!naturalSize) return;
    userAdjustedRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  /** Met à jour la position pendant le glisser-déposer. */
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = {
      x: drag.originX + (e.clientX - drag.startX),
      y: drag.originY + (e.clientY - drag.startY),
    };
    setOffset(next);
    emitCrop(scale, next);
  };

  /** Termine le glisser-déposer. */
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  /** Ajuste le zoom et recalcule le recadrage. */
  const onZoomChange = (value: number) => {
    if (!naturalSize) return;
    userAdjustedRef.current = true;
    const minScale = getMinCoverScale(
      naturalSize.width,
      naturalSize.height,
      containerWidth,
      containerHeight,
    );
    const nextScale = minScale + (value / 100) * minScale * 2;
    setScale(nextScale);
    emitCrop(nextScale, offset);
  };

  const minScale = naturalSize
    ? getMinCoverScale(naturalSize.width, naturalSize.height, containerWidth, containerHeight)
    : 1;
  const zoomPercent = naturalSize ? Math.round(((scale - minScale) / (minScale * 2)) * 100) : 0;

  const displayW = naturalSize ? naturalSize.width * scale : containerWidth;
  const displayH = naturalSize ? naturalSize.height * scale : containerHeight;
  const imgLeft = naturalSize ? containerWidth / 2 + offset.x - displayW / 2 : 0;
  const imgTop = naturalSize ? containerHeight / 2 + offset.y - displayH / 2 : 0;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground text-center">
        Glissez l&apos;image pour rogner · molette ou curseur pour zoomer
      </p>
      <div
        ref={containerRef}
        className="relative mx-auto rounded-lg border-2 border-primary/40 bg-muted overflow-hidden touch-none select-none"
        style={{ width: containerWidth, height: containerHeight }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => {
          e.preventDefault();
          if (!naturalSize) return;
          const delta = e.deltaY > 0 ? -5 : 5;
          const nextPercent = Math.min(100, Math.max(0, zoomPercent + delta));
          onZoomChange(nextPercent);
        }}
      >
        {loadError ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
            Impossible de charger l&apos;image pour le rognage
          </div>
        ) : (
          <>
            {!naturalSize ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                Chargement…
              </div>
            ) : null}
            <img
              key={imageUrl}
              src={imageUrl}
              alt=""
              draggable={false}
              className="absolute max-w-none pointer-events-none"
              style={{
                width: naturalSize ? displayW : "100%",
                height: naturalSize ? displayH : "100%",
                left: imgLeft,
                top: imgTop,
                objectFit: naturalSize ? undefined : "contain",
              }}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  initFromNaturalSize(img.naturalWidth, img.naturalHeight);
                }
              }}
              onError={() => setLoadError(true)}
            />
          </>
        )}
        {!loadError && naturalSize ? <CropGuideGrid /> : null}
        <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-foreground/10 z-20" />
      </div>
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] text-muted-foreground shrink-0 w-10">Zoom</span>
        <input
          type="range"
          min={0}
          max={100}
          value={zoomPercent}
          disabled={!naturalSize || loadError}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          className="flex-1 h-1.5 accent-primary"
        />
      </div>
    </div>
  );
});
