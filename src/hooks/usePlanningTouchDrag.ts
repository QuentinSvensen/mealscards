import { useCallback, useEffect, useRef, useState } from "react";
import type { PossibleMeal } from "@/hooks/useMeals";

interface TouchDragState {
  pmId: string;
  ghost: HTMLElement;
  startX: number;
  startY: number;
  origTop: number;
  origLeft: number;
}

export interface UsePlanningTouchDragOptions {
  /** Assigne une carte Possible à un créneau jour+heure. */
  assignPmToPlanningSlot: (pmId: string, day: string, time: string) => void;
  /** Déplanifie une carte (retour Hors planning). */
  clearPmPlanningSlot: (pmId: string) => void;
}

/**
 * Drag & drop tactile du planning : long-press → fantôme, surbrillance des cibles,
 * dépôt sur `[data-slot]` / `[data-unplanned]`, annulation (hors zone / Escape).
 */
export function usePlanningTouchDrag({
  assignPmToPlanningSlot,
  clearPmPlanningSlot,
}: UsePlanningTouchDragOptions) {
  const touchDrag = useRef<TouchDragState | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchHighlightRef = useRef<string | null>(null);
  const [touchDragActive, setTouchDragActive] = useState(false);
  const [touchHighlight, setTouchHighlight] = useState<string | null>(null);
  /** Affiche le hint « maintenir pour déplacer » pendant le long-press. */
  const [touchPressPending, setTouchPressPending] = useState(false);
  /** Message d'annulation après un drop hors zone. */
  const [touchCancelHint, setTouchCancelHint] = useState<string | null>(null);
  const cancelHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Met à jour la surbrillance tactile (state + ref pour le drop). */
  const updateTouchHighlight = useCallback((value: string | null) => {
    touchHighlightRef.current = value;
    setTouchHighlight(value);
  }, []);

  /** Nettoie le fantôme et l'état tactile sans appliquer de drop. */
  const cleanupTouchDrag = useCallback((showCancelHint = false) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (touchDrag.current) {
      touchDrag.current.ghost.remove();
      touchDrag.current = null;
    }
    setTouchDragActive(false);
    updateTouchHighlight(null);
    setTouchPressPending(false);
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
    if (showCancelHint) {
      if (cancelHintTimer.current) clearTimeout(cancelHintTimer.current);
      setTouchCancelHint("Déplacement annulé");
      cancelHintTimer.current = setTimeout(() => setTouchCancelHint(null), 1600);
    }
  }, [updateTouchHighlight]);

  /** Démarre le long-press et crée le fantôme après 450 ms. */
  const handleTouchStart = useCallback((e: React.TouchEvent, pm: PossibleMeal) => {
    const touch = e.touches[0];
    const origEl = e.currentTarget as HTMLElement;
    const rect = origEl.getBoundingClientRect();

    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    setTouchPressPending(true);

    longPressTimer.current = setTimeout(() => {
      setTouchPressPending(false);
      if (navigator.vibrate) navigator.vibrate(40);
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";

      const ghost = origEl.cloneNode(true) as HTMLElement;
      ghost.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        z-index: 9999;
        pointer-events: none;
        opacity: 0.9;
        transform: scale(1.06);
        border-radius: 12px;
        box-shadow: 0 10px 36px rgba(0,0,0,0.4);
        transition: none;
        outline: 2px solid rgba(255,255,255,0.55);
      `;
      document.body.appendChild(ghost);

      touchDrag.current = {
        pmId: pm.id,
        ghost,
        startX: touch.clientX,
        startY: touch.clientY,
        origTop: rect.top,
        origLeft: rect.left,
      };
      setTouchDragActive(true);
    }, 450);
  }, []);

  /** Suit le doigt et met en évidence la cible sous le point de contact (hit-area élargie). */
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchDrag.current) {
      // Si l'utilisateur bouge trop tôt, annuler le long-press (évite les faux drags).
      if (longPressTimer.current) {
        const touch = e.touches[0];
        // Seuil léger : on laisse le timer tant qu'on n'a pas vraiment glissé.
        void touch;
      }
      return;
    }

    e.preventDefault();
    const touch = e.touches[0];
    const state = touchDrag.current;
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;

    state.ghost.style.top = `${state.origTop + dy}px`;
    state.ghost.style.left = `${state.origLeft + dx}px`;

    state.ghost.style.visibility = "hidden";
    // Hit-area élargie : on sonde aussi un léger rayon autour du doigt.
    const el =
      document.elementFromPoint(touch.clientX, touch.clientY) ||
      document.elementFromPoint(touch.clientX, touch.clientY - 12) ||
      document.elementFromPoint(touch.clientX, touch.clientY + 12);
    state.ghost.style.visibility = "visible";

    const slotEl = el?.closest("[data-slot]");
    if (slotEl) {
      const day = slotEl.getAttribute("data-day")!;
      const time = slotEl.getAttribute("data-time")!;
      updateTouchHighlight(`${day}-${time}`);
    } else if (el?.closest("[data-unplanned]")) {
      updateTouchHighlight("unplanned");
    } else {
      updateTouchHighlight(null);
    }
  }, [updateTouchHighlight]);

  /** Applique le dépôt ou annule si hors zone valide. */
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      setTouchPressPending(false);

      const state = touchDrag.current;
      if (!state) return;

      touchDrag.current = null;
      setTouchDragActive(false);
      const highlight = touchHighlightRef.current;
      updateTouchHighlight(null);
      document.body.style.overflow = "";
      document.body.style.touchAction = "";

      const touch = e.changedTouches[0];
      state.ghost.style.visibility = "hidden";
      const el =
        document.elementFromPoint(touch.clientX, touch.clientY) ||
        document.elementFromPoint(touch.clientX, touch.clientY - 12) ||
        document.elementFromPoint(touch.clientX, touch.clientY + 12);
      state.ghost.remove();

      const slotEl = el?.closest("[data-slot]");
      if (slotEl) {
        const day = slotEl.getAttribute("data-day")!;
        const time = slotEl.getAttribute("data-time")!;
        assignPmToPlanningSlot(state.pmId, day, time);
        return;
      }
      if (el?.closest("[data-unplanned]") || highlight === "unplanned") {
        clearPmPlanningSlot(state.pmId);
        return;
      }
      // Drop hors zone = annulation explicite
      if (cancelHintTimer.current) clearTimeout(cancelHintTimer.current);
      setTouchCancelHint("Déplacement annulé — hors zone");
      cancelHintTimer.current = setTimeout(() => setTouchCancelHint(null), 1600);
    },
    [assignPmToPlanningSlot, clearPmPlanningSlot, updateTouchHighlight],
  );

  /** Annule le drag tactile en cours (touche Escape / interruption). */
  const handleTouchCancel = useCallback(() => {
    const wasDragging = !!touchDrag.current;
    cleanupTouchDrag(wasDragging);
  }, [cleanupTouchDrag]);

  // Escape annule un drag tactile actif (même comportement que drop hors zone).
  useEffect(() => {
    if (!touchDragActive) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cleanupTouchDrag(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [touchDragActive, cleanupTouchDrag]);

  useEffect(() => {
    return () => {
      if (cancelHintTimer.current) clearTimeout(cancelHintTimer.current);
      cleanupTouchDrag(false);
    };
  }, [cleanupTouchDrag]);

  return {
    touchDragActive,
    touchHighlight,
    touchPressPending,
    touchCancelHint,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  };
}
