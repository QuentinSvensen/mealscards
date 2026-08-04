/**
 * Zone de saisie « Description » qui grandit avec le contenu,
 * dans la limite de la hauteur d’écran disponible.
 */
import { useLayoutEffect, useRef } from "react";

export interface AutoGrowDescriptionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Hauteur mini (px). Défaut ~6 lignes. */
  minHeightPx?: number;
  /** Fraction max de la hauteur viewport (0–1). Défaut 0.6. */
  maxViewportRatio?: number;
}

/**
 * Ajuste la hauteur du textarea au contenu, plafonnée par l’écran.
 */
function syncTextareaHeight(
  el: HTMLTextAreaElement,
  minHeightPx: number,
  maxViewportRatio: number,
) {
  el.style.height = "0px";
  const maxH = Math.max(minHeightPx, Math.floor(window.innerHeight * maxViewportRatio));
  el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeightPx), maxH)}px`;
}

/**
 * Textarea description auto-hauteur (plus de texte → plus haut, si l’écran le permet).
 */
export function AutoGrowDescriptionTextarea({
  value,
  onChange,
  placeholder = "Consignes de préparation…",
  minHeightPx = 120,
  maxViewportRatio = 0.6,
}: AutoGrowDescriptionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    syncTextareaHeight(el, minHeightPx, maxViewportRatio);

    /** Recalcule si la fenêtre change de taille. */
    const onResize = () => syncTextareaHeight(el, minHeightPx, maxViewportRatio);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [value, minHeightPx, maxViewportRatio]);

  return (
    <textarea
      ref={ref}
      autoFocus
      lang="fr"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
      placeholder={placeholder}
      rows={6}
      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[120px] max-h-[60vh] overflow-y-auto"
    />
  );
}
