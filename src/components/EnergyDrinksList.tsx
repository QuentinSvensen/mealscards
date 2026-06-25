/**
 * EnergyDrinksList — Liste des boissons énergisantes par marque et goût.
 *
 * L'utilisateur crée ses marques (catégories), y ajoute des goûts,
 * puis coche les goûts testés et leur attribue une note sur 10.
 */
import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { Search, Zap, Plus, ChevronDown, ChevronRight, ChevronUp, Trash2, ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useEnergyDrinks, type EnergyDrinkBrand, type EnergyDrinkFlavor } from "@/hooks/useEnergyDrinks";
import { sortFlavorsForDisplay, formatRatingDisplay, getEnergyDrinkRatingClasses } from "@/lib/energyDrinkUtils";
import type { EnergyDrinkImageCrop } from "@/lib/energyDrinkImageCrop";
import { isFullImageCrop } from "@/lib/energyDrinkImageCrop";
import { isLocalEnergyDrinkImageRef } from "@/lib/energyDrinkImageStorage";
import { EnergyDrinkCropView } from "@/components/EnergyDrinkCropView";
import { EnergyDrinkImageCropper, type EnergyDrinkImageCropperHandle } from "@/components/EnergyDrinkImageCropper";
import { toast } from "@/hooks/use-toast";

type FilterMode = "all" | "tested" | "untested";

/** Affiche une note sur 10 en grand, avec réglage rapide ±0,5. */
function RatingHighlight({
  value,
  onChange,
  tested,
}: {
  value: number | null;
  onChange: (rating: number) => void;
  tested: boolean;
}) {
  if (!tested) {
    return (
      <div className="shrink-0 w-12 h-10 rounded-lg border border-dashed border-border/50 flex items-center justify-center text-muted-foreground/40 text-sm font-medium">
        —
      </div>
    );
  }

  const display = value !== null ? formatRatingDisplay(value) : "?";
  const ratingStyle = getEnergyDrinkRatingClasses(value);

  /** Ajuste la note par pas de 0,5 dans les bornes 0–10. */
  const adjust = (delta: number) => {
    const base = value ?? 5;
    onChange(Math.min(10, Math.max(0, Math.round((base + delta) * 2) / 2)));
  };

  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <div
        className={`min-w-[3.25rem] px-2 py-1 rounded-lg border text-center shadow-sm ${ratingStyle.bg} ${ratingStyle.border}`}
      >
        <div className={`text-lg font-bold tabular-nums leading-none ${ratingStyle.text}`}>
          {display}
        </div>
        <div className={`text-[9px] font-semibold mt-0.5 ${ratingStyle.subtext}`}>
          /10
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => adjust(-0.5)}
          className="h-4 w-4 rounded text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Baisser la note"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => adjust(0.5)}
          className="h-4 w-4 rounded text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Augmenter la note"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Affiche une image centrée dans une vignette portrait (rognage optionnel). */
function CroppedDrinkImage({
  src,
  crop,
  className,
  onError,
}: {
  src: string;
  crop?: EnergyDrinkImageCrop | null;
  className?: string;
  onError?: () => void;
}) {
  return <EnergyDrinkCropView src={src} crop={crop} className={className} onError={onError} />;
}

/** Vignette cliquable pour ajouter ou modifier l'image d'un goût. */
function DrinkThumbnail({
  imageUrl,
  imageCrop,
  fallbackImageUrl,
  fallbackImageCrop,
  onEdit,
}: {
  imageUrl?: string | null;
  imageCrop?: EnergyDrinkImageCrop | null;
  fallbackImageUrl?: string | null;
  fallbackImageCrop?: EnergyDrinkImageCrop | null;
  onEdit?: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const resolved = imageUrl ?? fallbackImageUrl;
  const resolvedCrop = imageUrl ? imageCrop : fallbackImageCrop;
  const showImage = resolved && !imgError;

  useEffect(() => {
    setImgError(false);
  }, [resolved, resolvedCrop]);

  const inner = (
    <>
      {showImage ? (
        <div className="absolute inset-0">
          <CroppedDrinkImage
            src={resolved}
            crop={resolvedCrop}
            className="w-full h-full"
            onError={() => setImgError(true)}
          />
        </div>
      ) : (
        <Zap className="h-4 w-4 text-amber-500/80" />
      )}
      {onEdit && (
        <span className="absolute inset-0 flex items-center justify-center bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity">
          <ImageIcon className="h-3.5 w-3.5 text-foreground" />
        </span>
      )}
    </>
  );

  const className =
    "relative group h-11 w-7 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden border border-border/50";

  if (onEdit) {
    return (
      <button type="button" onClick={onEdit} className={`${className} cursor-pointer`} title="Image du goût">
        {inner}
      </button>
    );
  }

  return <div className={className}>{inner}</div>;
}

/** Dialogue pour définir l'URL et rogner l'image d'un goût. */
function FlavorImageDialog({
  open,
  onOpenChange,
  taste,
  imageRef,
  resolvedImageUrl,
  imageCrop,
  onSave,
  initialCropMode = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taste: string;
  imageRef?: string | null;
  resolvedImageUrl?: string | null;
  imageCrop?: EnergyDrinkImageCrop | null;
  onSave: (opts: {
    sourceUrl?: string | null;
    crop?: EnergyDrinkImageCrop | null;
    imageCropManual?: boolean;
  }) => void | Promise<void>;
  initialCropMode?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [crop, setCrop] = useState<EnergyDrinkImageCrop | null>(imageCrop ?? null);
  const [cropMode, setCropMode] = useState(false);
  const cropperRef = useRef<EnergyDrinkImageCropperHandle>(null);
  const hasLocalImage = Boolean(imageRef && isLocalEnergyDrinkImageRef(imageRef));

  useEffect(() => {
    if (open) {
      setUrl(imageRef && !isLocalEnergyDrinkImageRef(imageRef) ? imageRef : "");
      setCrop(imageCrop ?? null);
      setCropMode(initialCropMode && Boolean(resolvedImageUrl?.trim()));
    }
  }, [open, imageRef, resolvedImageUrl, imageCrop, initialCropMode]);

  const trimmedUrl = url.trim();
  const previewUrl = trimmedUrl || resolvedImageUrl || "";
  const hasPreview = Boolean(previewUrl);

  /** Ouvre le mode rognage lorsque l'utilisateur clique sur l'aperçu. */
  const openCropMode = () => {
    if (!hasPreview) return;
    setCropMode(true);
  };

  /** Enregistre l'image (import URL ou rognage) puis ferme le dialogue. */
  const handleSave = async () => {
    const latestCrop = cropMode ? cropperRef.current?.getCrop() ?? crop : crop;
    const nextCrop = latestCrop && !isFullImageCrop(latestCrop) ? latestCrop : null;
    const manualCrop = cropMode && Boolean(nextCrop);

    if (trimmedUrl) {
      await onSave({ sourceUrl: trimmedUrl, crop: nextCrop, imageCropManual: manualCrop });
    } else if (imageRef) {
      await onSave({ crop: nextCrop, imageCropManual: manualCrop });
    } else {
      await onSave({ sourceUrl: null, crop: null, imageCropManual: false });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {cropMode ? `Rogner — ${taste}` : `Image — ${taste}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 pt-1">
          {!cropMode ? (
            <>
              <Input
                placeholder={
                  hasLocalImage
                    ? "URL pour remplacer l'image locale"
                    : "URL de l'image"
                }
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (e.target.value.trim()) setCrop(null);
                }}
                autoFocus
              />
              {hasLocalImage && !trimmedUrl ? (
                <p className="text-[10px] text-muted-foreground">
                  Image enregistrée localement. Collez une URL pour la remplacer.
                </p>
              ) : null}
              {hasPreview ? (
                <button
                  type="button"
                  onClick={openCropMode}
                  className="w-full flex justify-center rounded-lg border border-border/60 bg-muted overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow"
                  title="Cliquer pour rogner"
                >
                  <CroppedDrinkImage
                    src={previewUrl}
                    crop={crop}
                    className="h-[220px] w-[140px] shrink-0"
                  />
                </button>
              ) : null}
              {hasPreview ? (
                <p className="text-[10px] text-center text-muted-foreground">
                  Cliquez sur l&apos;image pour la rogner
                </p>
              ) : null}
            </>
          ) : (
            <EnergyDrinkImageCropper
              ref={cropperRef}
              imageUrl={previewUrl}
              crop={crop}
              onCropChange={setCrop}
            />
          )}
          {cropMode && hasPreview ? (
            <div className="flex items-center justify-center gap-2 pt-1">
              <span className="text-[10px] text-muted-foreground">Aperçu vignette</span>
              <EnergyDrinkCropView
                src={previewUrl}
                crop={crop}
                className="h-11 w-7 rounded-md border border-border/60"
              />
            </div>
          ) : null}
          <div className="flex gap-2">
            {cropMode ? (
              <Button variant="outline" className="flex-1" onClick={() => setCropMode(false)}>
                Retour
              </Button>
            ) : (
              <Button
                variant="outline"
                className="flex-1"
                onClick={async () => {
                  await onSave({ sourceUrl: null, crop: null, imageCropManual: false });
                  onOpenChange(false);
                }}
              >
                Retirer
              </Button>
            )}
            <Button className="flex-1" onClick={handleSave} disabled={cropMode && !hasPreview}>
              Enregistrer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Texte cliquable modifiable inline (Entrée ou perte de focus pour valider). */
function InlineEditableText({
  value,
  onSave,
  className,
  inputClassName,
  placeholder,
  suffix,
}: {
  value: string;
  onSave: (next: string) => boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  /** Élément affiché juste après le texte (ex. badge 0 CAL). */
  suffix?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  /** Valide la saisie et quitte le mode édition si le texte est accepté. */
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    const ok = onSave(trimmed);
    if (ok) {
      setEditing(false);
      return;
    }
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1 max-w-full">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className={inputClassName}
          placeholder={placeholder}
        />
        {suffix ? (
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {suffix}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className={`inline text-left whitespace-normal max-w-full hover:underline decoration-dashed underline-offset-2 cursor-text ${className ?? ""}`}
      title="Cliquer pour modifier"
    >
      {value}
      {suffix ? (
        <span className="ml-1 align-middle" onClick={(e) => e.stopPropagation()}>
          {suffix}
        </span>
      ) : null}
    </button>
  );
}

/** Bouton compact 0 cal pour la colonne d'options (discret). */
function ZeroCalorieToggle({
  active,
  onChange,
}: {
  active: boolean;
  onChange: (active: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      className={`shrink-0 px-1 py-px rounded text-[8px] sm:px-1.5 sm:py-0.5 sm:rounded-md sm:text-[9px] font-semibold leading-tight transition-colors ${
        active
          ? "bg-muted text-muted-foreground"
          : "text-muted-foreground/45 hover:text-muted-foreground/80 hover:bg-muted/40"
      }`}
      aria-pressed={active}
      title={active ? "Sans calories" : "Marquer sans calories"}
    >
      0 cal
    </button>
  );
}

/** Ligne d'un goût : testé, note et suppression. */
function FlavorRow({
  flavor,
  brandImageUrl,
  tested,
  rating,
  resolveImageUrl,
  onToggleTested,
  onSetRating,
  onToggleZeroCalorie,
  onSaveImage,
  onRename,
  onDelete,
}: {
  flavor: EnergyDrinkFlavor;
  brandImageUrl?: string | null;
  tested: boolean;
  rating: number | null;
  resolveImageUrl: (ref: string | null | undefined) => string | null;
  onToggleTested: (tested: boolean) => void;
  onSetRating: (rating: number) => void;
  onToggleZeroCalorie: (zeroCalorie: boolean) => void;
  onSaveImage: (opts: {
    sourceUrl?: string | null;
    crop?: EnergyDrinkImageCrop | null;
    imageCropManual?: boolean;
  }) => void | Promise<void>;
  onRename: (taste: string) => boolean;
  onDelete: () => void;
}) {
  const [imageOpen, setImageOpen] = useState(false);
  const [openInCropMode, setOpenInCropMode] = useState(false);
  const resolvedFlavorImage = resolveImageUrl(flavor.imageUrl);
  const resolvedBrandImage = resolveImageUrl(brandImageUrl);
  const displayImageUrl = resolvedFlavorImage ?? resolvedBrandImage ?? null;

  return (
    <>
      <div className="group flex items-center gap-1.5 sm:gap-2 py-1.5 px-1.5 sm:px-2 rounded-xl border border-border/60 bg-card transition-colors">
        <DrinkThumbnail
          imageUrl={resolvedFlavorImage}
          imageCrop={flavor.imageCrop}
          fallbackImageUrl={resolvedBrandImage}
          onEdit={() => {
            setOpenInCropMode(Boolean(displayImageUrl));
            setImageOpen(true);
          }}
        />
        <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
          <RatingHighlight
            value={rating}
            tested={tested}
            onChange={(r) => {
              onSetRating(r);
            }}
          />
          <div className="flex-1 min-w-0">
            <InlineEditableText
              value={flavor.taste}
              onSave={onRename}
              className="text-xs sm:text-sm font-medium"
              inputClassName="h-7 text-xs sm:text-sm"
              placeholder="Nom du goût"
              suffix={
                flavor.zeroCalorie ? (
                  <span className="text-[9px] sm:text-[10px] font-black px-1 sm:px-1.5 py-0.5 rounded-md bg-foreground text-background leading-none">
                    0 CAL
                  </span>
                ) : undefined
              }
            />
            {flavor.volumeMl ? (
              <p className="text-[10px] text-muted-foreground mt-0.5">{flavor.volumeMl} ml</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-0 sm:gap-1 shrink-0 pl-1 sm:pl-1.5 border-l border-border/30 text-muted-foreground/40 opacity-50 group-hover:opacity-90 transition-opacity">
          <ZeroCalorieToggle
            active={flavor.zeroCalorie ?? false}
            onChange={onToggleZeroCalorie}
          />
          <label className="cursor-pointer select-none p-0 sm:p-0.5" title="Testé">
            <Checkbox
              checked={tested}
              onCheckedChange={(v) => onToggleTested(v === true)}
              className="h-3 w-3 sm:h-3.5 sm:w-3.5"
            />
          </label>
          <button
            type="button"
            onClick={onDelete}
            className="hidden sm:block p-0.5 rounded opacity-0 group-hover:opacity-70 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
            aria-label="Supprimer ce goût"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <FlavorImageDialog
        open={imageOpen}
        onOpenChange={setImageOpen}
        taste={flavor.taste}
        imageRef={flavor.imageUrl}
        resolvedImageUrl={displayImageUrl}
        imageCrop={flavor.imageCrop}
        onSave={onSaveImage}
        initialCropMode={openInCropMode}
      />
    </>
  );
}

/** Section d'une marque avec ses goûts et formulaire d'ajout. */
function BrandSection({
  brand,
  filter,
  search,
  collapsed,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onToggleCollapse,
  getReview,
  updateReview,
  addFlavor,
  updateFlavor,
  updateBrand,
  saveFlavorImage,
  resolveImageUrl,
  deleteBrand,
  deleteFlavor,
}: {
  brand: EnergyDrinkBrand;
  filter: FilterMode;
  search: string;
  collapsed: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleCollapse: () => void;
  getReview: ReturnType<typeof useEnergyDrinks>["getReview"];
  updateReview: ReturnType<typeof useEnergyDrinks>["updateReview"];
  addFlavor: ReturnType<typeof useEnergyDrinks>["addFlavor"];
  updateFlavor: ReturnType<typeof useEnergyDrinks>["updateFlavor"];
  updateBrand: ReturnType<typeof useEnergyDrinks>["updateBrand"];
  saveFlavorImage: ReturnType<typeof useEnergyDrinks>["saveFlavorImage"];
  resolveImageUrl: ReturnType<typeof useEnergyDrinks>["resolveImageUrl"];
  deleteBrand: (id: string) => void;
  deleteFlavor: (brandId: string, flavorId: string) => void;
}) {
  const [addFlavorOpen, setAddFlavorOpen] = useState(false);
  const [newTaste, setNewTaste] = useState("");
  const [newVolume, setNewVolume] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newZeroCalorie, setNewZeroCalorie] = useState(false);

  const q = search.trim().toLowerCase();
  const flavors = useMemo(() => {
    const filtered = brand.flavors.filter((f) => {
      const review = getReview(f.id);
      if (filter === "tested" && !review.tested) return false;
      if (filter === "untested" && review.tested) return false;
      if (!q) return true;
      return (
        brand.name.toLowerCase().includes(q) ||
        f.taste.toLowerCase().includes(q)
      );
    });
    return sortFlavorsForDisplay(filtered, getReview);
  }, [brand.flavors, brand.name, filter, search, getReview]);

  if (flavors.length === 0 && q) return null;
  if (flavors.length === 0 && filter !== "all") return null;

  const brandTested = brand.flavors.filter((f) => getReview(f.id).tested).length;

  /** Enregistre un nouveau goût dans cette marque. */
  const handleAddFlavor = () => {
    const volume = newVolume.trim() ? parseInt(newVolume, 10) : null;
    const ok = addFlavor(brand.id, newTaste, {
      volumeMl: Number.isFinite(volume) ? volume : null,
      imageUrl: newImageUrl.trim() || null,
      zeroCalorie: newZeroCalorie,
    });
    if (!ok) {
      toast({
        title: "Impossible d'ajouter",
        description: "Indiquez un goût ou cette variante existe déjà (même nom et même option 0 cal).",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Goût ajouté" });
    setNewTaste("");
    setNewVolume("");
    setNewImageUrl("");
    setNewZeroCalorie(false);
    setAddFlavorOpen(false);
  };

  return (
    <section className="rounded-xl border border-border/60 overflow-hidden shadow-sm">
      <div className="flex items-center gap-1.5 px-2 sm:px-3 py-3 bg-muted/70 border-b border-border/50">
        <div className="flex flex-col shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:pointer-events-none transition-colors"
            aria-label="Monter la marque"
            title="Monter"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:pointer-events-none transition-colors"
            aria-label="Descendre la marque"
            title="Descendre"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0 min-h-0">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label={collapsed ? "Déplier la marque" : "Replier la marque"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="shrink-0 rounded-lg hover:opacity-80 transition-opacity"
            aria-label={collapsed ? "Déplier la marque" : "Replier la marque"}
          >
            <DrinkThumbnail imageUrl={resolveImageUrl(brand.imageUrl)} />
          </button>
          <div className="flex-1 min-w-0">
            <InlineEditableText
              value={brand.name}
              onSave={(name) => {
                const ok = updateBrand(brand.id, { name });
                if (!ok) {
                  toast({
                    title: "Impossible de renommer",
                    description: "Nom vide ou marque déjà existante.",
                    variant: "destructive",
                  });
                }
                return ok;
              }}
              className="text-lg sm:text-xl font-bold tracking-tight block w-full leading-tight"
              inputClassName="h-8 text-lg sm:text-xl font-bold"
              placeholder="Nom de la marque"
            />
            <span className="block text-[10px] text-muted-foreground mt-0.5">
              {brandTested} testé{brandTested > 1 ? "s" : ""} · {brand.flavors.length} goût
              {brand.flavors.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <Dialog open={addFlavorOpen} onOpenChange={setAddFlavorOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" title="Ajouter un goût">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Goût — {brand.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 pt-1">
              <Input
                placeholder="Goût (ex. Ultra White, Mangue…)"
                value={newTaste}
                onChange={(e) => setNewTaste(e.target.value)}
                autoFocus
              />
              <Input
                placeholder="Volume en ml (optionnel)"
                inputMode="numeric"
                value={newVolume}
                onChange={(e) => setNewVolume(e.target.value)}
              />
              <Input
                placeholder="URL image (optionnel)"
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={newZeroCalorie}
                  onCheckedChange={(v) => setNewZeroCalorie(v === true)}
                />
                Sans calories (0 cal)
              </label>
              <Button className="w-full" onClick={handleAddFlavor}>
                Ajouter le goût
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <button
          type="button"
          onClick={() => deleteBrand(brand.id)}
          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
          aria-label="Supprimer la marque"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {!collapsed && (
        <div className="p-1 space-y-0.5">
          {flavors.length === 0 ? (
            <p className="text-center text-[11px] text-muted-foreground py-3">
              Aucun goût — cliquez sur + pour en ajouter.
            </p>
          ) : (
            flavors.map((flavor) => {
              const review = getReview(flavor.id);
              return (
                <FlavorRow
                  key={flavor.id}
                  flavor={flavor}
                  brandImageUrl={brand.imageUrl}
                  resolveImageUrl={resolveImageUrl}
                  tested={review.tested}
                  rating={review.rating}
                  onToggleTested={(tested) =>
                    updateReview(flavor.id, { tested, rating: tested ? review.rating : null })
                  }
                  onSetRating={(rating) => updateReview(flavor.id, { tested: true, rating })}
                  onToggleZeroCalorie={(zeroCalorie) => {
                    const ok = updateFlavor(brand.id, flavor.id, { zeroCalorie });
                    if (!ok) {
                      toast({
                        title: "Impossible de modifier",
                        description:
                          "Une autre ligne porte déjà ce nom avec la même option 0 cal.",
                        variant: "destructive",
                      });
                    }
                  }}
                  onSaveImage={async (opts) => {
                    const ok = await saveFlavorImage(brand.id, flavor.id, opts);
                    if (!ok) {
                      toast({
                        title: "Image non enregistrée",
                        description: "Impossible de télécharger ou d'enregistrer cette image.",
                        variant: "destructive",
                      });
                    }
                  }}
                  onRename={(taste) => {
                    const ok = updateFlavor(brand.id, flavor.id, { taste });
                    if (!ok) {
                      toast({
                        title: "Impossible de renommer",
                        description:
                          "Nom vide ou variante identique (même nom et même option 0 cal).",
                        variant: "destructive",
                      });
                    }
                    return ok;
                  }}
                  onDelete={() => deleteFlavor(brand.id, flavor.id)}
                />
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

export function EnergyDrinksList() {
  const {
    brands,
    getReview,
    updateReview,
    addBrand,
    addFlavor,
    updateFlavor,
    updateBrand,
    saveFlavorImage,
    resolveImageUrl,
    deleteBrand,
    deleteFlavor,
    moveBrand,
    stats,
  } = useEnergyDrinks();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [collapsedBrands, setCollapsedBrands] = useState<Set<string>>(new Set());
  const [addBrandOpen, setAddBrandOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [newBrandImageUrl, setNewBrandImageUrl] = useState("");

  const visibleBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && filter === "all") return brands;
    return brands.filter((brand) => {
      const hasMatchingFlavor = brand.flavors.some((f) => {
        const review = getReview(f.id);
        if (filter === "tested" && !review.tested) return false;
        if (filter === "untested" && review.tested) return false;
        if (!q) return true;
        return brand.name.toLowerCase().includes(q) || f.taste.toLowerCase().includes(q);
      });
      if (filter !== "all" || q) return hasMatchingFlavor;
      return true;
    });
  }, [brands, search, filter, getReview]);

  /** Bascule l'état replié d'une marque. */
  const toggleBrand = (brandId: string) => {
    setCollapsedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brandId)) next.delete(brandId);
      else next.add(brandId);
      return next;
    });
  };

  /** Crée une nouvelle marque (catégorie). */
  const handleAddBrand = () => {
    const ok = addBrand(newBrandName, newBrandImageUrl.trim() || null);
    if (!ok) {
      toast({
        title: "Impossible d'ajouter",
        description: "Indiquez un nom de marque ou cette marque existe déjà.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Marque créée" });
    setNewBrandName("");
    setNewBrandImageUrl("");
    setAddBrandOpen(false);
  };

  const filterBtn = (mode: FilterMode, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(mode)}
      className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
        filter === mode
          ? "bg-background shadow-sm text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-3xl mx-auto w-full space-y-3 pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
        <p className="text-[11px] text-muted-foreground text-center sm:text-left">
          {stats.brands} marque{stats.brands > 1 ? "s" : ""} · {stats.tested} testé
          {stats.tested > 1 ? "s" : ""} sur {stats.total}
        </p>
        <Dialog open={addBrandOpen} onOpenChange={setAddBrandOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 mx-auto sm:mx-0">
              <Plus className="h-3 w-3" />
              Nouvelle marque
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Créer une marque</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 pt-1">
              <Input
                placeholder="Marque (ex. Monster, Red Bull…)"
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                autoFocus
              />
              <Input
                placeholder="URL image de la marque (optionnel)"
                value={newBrandImageUrl}
                onChange={(e) => setNewBrandImageUrl(e.target.value)}
              />
              <Button className="w-full" onClick={handleAddBrand}>
                Créer la marque
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Rechercher marque ou goût…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      <div className="flex items-center gap-1 bg-muted rounded-full p-0.5 w-fit mx-auto">
        {filterBtn("all", "Tous")}
        {filterBtn("tested", "Testés")}
        {filterBtn("untested", "À tester")}
      </div>

      {brands.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          Commencez par créer une marque, puis ajoutez-y des goûts avec le bouton +.
        </p>
      ) : visibleBrands.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          Aucun résultat pour votre recherche ou filtre.
        </p>
      ) : (
        <div className="space-y-2">
          {visibleBrands.map((brand) => {
            const brandIndex = brands.findIndex((b) => b.id === brand.id);
            return (
              <BrandSection
                key={brand.id}
                brand={brand}
                filter={filter}
                search={search}
                collapsed={collapsedBrands.has(brand.id)}
                canMoveUp={brandIndex > 0}
                canMoveDown={brandIndex >= 0 && brandIndex < brands.length - 1}
                onMoveUp={() => moveBrand(brand.id, "up")}
                onMoveDown={() => moveBrand(brand.id, "down")}
                onToggleCollapse={() => toggleBrand(brand.id)}
                getReview={getReview}
                updateReview={updateReview}
                addFlavor={addFlavor}
                updateFlavor={updateFlavor}
                updateBrand={updateBrand}
                saveFlavorImage={saveFlavorImage}
                resolveImageUrl={resolveImageUrl}
                deleteBrand={deleteBrand}
                deleteFlavor={deleteFlavor}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
