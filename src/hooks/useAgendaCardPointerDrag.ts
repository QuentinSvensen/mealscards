/**
 * Drag & drop pointeur pour les cartes repas/extras de la vue Google Agenda.
 * Déplacement par delta (doigt) depuis l’heure d’origine de la carte.
 * Fantôme en `absolute` dans la colonne jour (même repère que les cartes).
 * Sur mobile, long-press → scroll figé pour déplacer la carte sans faire défiler.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AGENDA_HOUR_END,
  AGENDA_HOUR_START,
  AGENDA_SNAP_MINUTES,
  snapMinutes,
} from "@/domain/planning/agendaTimeUtils";

export type AgendaCardDragPayload =
  | { kind: "meal"; pmId: string; startMinutes: number }
  | { kind: "extra"; occurrenceKey: string; startMinutes: number }
  | { kind: "gouter-extras"; occurrenceKeys: string[]; startMinutes: number };

export type AgendaDropTarget = {
  dayIso: string;
  dayKey: string;
  minutes: number;
};

type PendingPointer = {
  payload: AgendaCardDragPayload;
  card: HTMLElement;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  pointerId: number;
  pointerType: string;
};

type ActivePointerDrag = {
  payload: AgendaCardDragPayload;
  card: HTMLElement;
  ghost: HTMLElement;
  pointerId: number;
  /** Largeur / hauteur / left en px layout (comme les cartes agenda). */
  layoutWidth: number;
  layoutHeight: number;
  layoutLeft: number;
  /** Minutes d’origine (données carte). */
  originMinutes: number;
  /** clientY au démarrage du drag. */
  originClientY: number;
  /** scrollTop layout de la grille à l’origine. */
  originScrollTop: number;
  lastX: number;
  lastY: number;
  lastTarget: AgendaDropTarget | null;
};

export interface UseAgendaCardPointerDragOptions {
  weekDates: Array<{ iso: string; key: string }>;
  columnRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  /** Hauteur d’une heure (px layout) — même valeur que le positionnement des cartes. */
  hourHeightPx: number;
  disabled?: boolean;
  /** Applique le dépôt (repas / extra / goûter). */
  onDrop: (payload: AgendaCardDragPayload, target: AgendaDropTarget) => void;
}

/**
 * Facteur CSS zoom (getBoundingClientRect / offsetHeight).
 */
function cssZoomOf(el: HTMLElement): number {
  const layoutH = el.offsetHeight;
  if (layoutH <= 0) return 1;
  const visualH = el.getBoundingClientRect().height;
  if (visualH <= 0) return 1;
  const z = visualH / layoutH;
  return Number.isFinite(z) && z > 0.05 ? z : 1;
}

/**
 * Top layout (px) d’une carte à `minutes`, identique à `blockStyle` de la vue.
 */
function layoutTopForMinutes(minutes: number, hourHeightLayoutPx: number): number {
  return ((minutes - AGENDA_HOUR_START * 60) / 60) * hourHeightLayoutPx;
}

/**
 * Attache / positionne le fantôme dans la colonne (coords layout = cartes réelles).
 */
function placeGhostInColumn(
  ghost: HTMLElement,
  col: HTMLElement,
  minutes: number,
  hourHeightLayoutPx: number,
  layoutLeft: number,
  layoutWidth: number,
  layoutHeight: number,
): void {
  if (ghost.parentElement !== col) {
    col.appendChild(ghost);
  }
  ghost.style.position = "absolute";
  ghost.style.top = `${layoutTopForMinutes(minutes, hourHeightLayoutPx)}px`;
  ghost.style.left = `${layoutLeft}px`;
  ghost.style.width = `${layoutWidth}px`;
  ghost.style.height = `${layoutHeight}px`;
  ghost.style.right = "auto";
  ghost.style.margin = "0";
  ghost.style.zIndex = "9999";
  ghost.style.pointerEvents = "none";
  ghost.style.opacity = "0.95";
  ghost.style.boxShadow = "0 8px 24px rgba(0,0,0,0.45)";
  ghost.style.transform = "none";
  ghost.style.transition = "none";
}

/**
 * Hook de drag agenda : long-press (touch) ou petit mouvement (souris).
 */
export function useAgendaCardPointerDrag({
  weekDates,
  columnRefs,
  scrollRef,
  hourHeightPx,
  disabled = false,
  onDrop,
}: UseAgendaCardPointerDragOptions) {
  const pendingRef = useRef<PendingPointer | null>(null);
  const activeRef = useRef<ActivePointerDrag | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const hourHeightRef = useRef(hourHeightPx);
  const weekDatesRef = useRef(weekDates);
  const onDropRef = useRef(onDrop);
  /** Styles scroll à restaurer après le drag (fige la grille sur mobile). */
  const scrollLockRef = useRef<{
    overflow: string;
    touchAction: string;
    overscrollBehavior: string;
  } | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  hourHeightRef.current = hourHeightPx;
  weekDatesRef.current = weekDates;
  onDropRef.current = onDrop;

  /**
   * Fige le scroll de la grille agenda (évite que le doigt fasse défiler pendant le drag).
   */
  const lockAgendaScroll = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc || scrollLockRef.current) return;
    scrollLockRef.current = {
      overflow: sc.style.overflow,
      touchAction: sc.style.touchAction,
      overscrollBehavior: sc.style.overscrollBehavior,
    };
    sc.style.overflow = "hidden";
    sc.style.touchAction = "none";
    sc.style.overscrollBehavior = "none";
    document.body.style.touchAction = "none";
    document.body.style.userSelect = "none";
    document.body.style.overflow = "hidden";
  }, [scrollRef]);

  /**
   * Restaure le scroll de la grille après drop / annulation.
   */
  const unlockAgendaScroll = useCallback(() => {
    const sc = scrollRef.current;
    const prev = scrollLockRef.current;
    if (sc && prev) {
      sc.style.overflow = prev.overflow;
      sc.style.touchAction = prev.touchAction;
      sc.style.overscrollBehavior = prev.overscrollBehavior;
    }
    scrollLockRef.current = null;
    document.body.style.touchAction = "";
    document.body.style.userSelect = "";
    document.body.style.overflow = "";
  }, [scrollRef]);

  /**
   * Clé stable pour l’opacité de la carte source pendant le drag
   * (ignore startMinutes — non nécessaire pour l’identité).
   */
  const payloadKey = (
    p:
      | { kind: "meal"; pmId: string }
      | { kind: "extra"; occurrenceKey: string }
      | { kind: "gouter-extras"; occurrenceKeys: string[] },
  ): string => {
    if (p.kind === "meal") return `meal:${p.pmId}`;
    if (p.kind === "extra") return `extra:${p.occurrenceKey}`;
    return `gouter:${p.occurrenceKeys.join("|")}`;
  };

  /**
   * Trouve la colonne jour sous X (ignore Y pour rester robuste au scroll).
   */
  const findDayColumnAtX = useCallback(
    (clientX: number) => {
      const days = weekDatesRef.current;
      let best: {
        day: (typeof days)[number];
        col: HTMLDivElement;
        rect: DOMRect;
        dist: number;
      } | null = null;
      for (const day of days) {
        const col = columnRefs.current[day.iso];
        if (!col) continue;
        const rect = col.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) {
          return { day, col, rect };
        }
        const dist =
          clientX < rect.left ? rect.left - clientX : clientX - rect.right;
        if (!best || dist < best.dist) best = { day, col, rect, dist };
      }
      if (best && best.dist < 56) {
        return { day: best.day, col: best.col, rect: best.rect };
      }
      return null;
    },
    [columnRefs],
  );

  /**
   * Calcule le créneau snappé et aligne la surbrillance sur ce créneau (colonne).
   */
  const placeGhostByDelta = useCallback(
    (
      active: ActivePointerDrag,
      clientX: number,
      clientY: number,
    ): AgendaDropTarget | null => {
      const scrollTop = scrollRef.current?.scrollTop ?? active.originScrollTop;
      const scrollDeltaLayout = scrollTop - active.originScrollTop;
      const deltaYVisual = clientY - active.originClientY;
      const hourHLayout = Math.max(1, hourHeightRef.current);

      const hit = findDayColumnAtX(clientX);
      if (!hit) {
        return null;
      }

      const zoom = cssZoomOf(hit.col);
      // Delta doigt (viewport) → px layout ; + scroll layout
      const deltaYLayout = deltaYVisual / zoom;
      const deltaMin = ((deltaYLayout + scrollDeltaLayout) / hourHLayout) * 60;
      const raw = active.originMinutes + deltaMin;
      const minBound = AGENDA_HOUR_START * 60;
      const maxBound = AGENDA_HOUR_END * 60 - AGENDA_SNAP_MINUTES;
      const minutes = snapMinutes(Math.max(minBound, Math.min(maxBound, raw)));

      placeGhostInColumn(
        active.ghost,
        hit.col,
        minutes,
        hourHLayout,
        active.layoutLeft,
        active.layoutWidth,
        active.layoutHeight,
      );

      return { dayIso: hit.day.iso, dayKey: hit.day.key, minutes };
    },
    [findDayColumnAtX, scrollRef],
  );

  /**
   * Boucle rAF : recentre le fantôme (scroll volontairement figé pendant le drag).
   */
  const tickDragFrame = useCallback(() => {
    const active = activeRef.current;
    if (!active) {
      rafRef.current = null;
      return;
    }
    const target = placeGhostByDelta(active, active.lastX, active.lastY);
    active.lastTarget = target;
    setDragOverDay(target?.dayIso ?? null);
    rafRef.current = requestAnimationFrame(tickDragFrame);
  }, [placeGhostByDelta]);

  /** Démarre la boucle rAF (scroll + fantôme). */
  const ensureDragLoop = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(tickDragFrame);
  }, [tickDragFrame]);

  /** Stoppe la boucle rAF. */
  const stopDragLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /** Annule pending / active sans drop. */
  const cancelPointerDrag = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    stopDragLoop();
    const active = activeRef.current;
    if (active) {
      active.ghost.remove();
      active.card.style.opacity = "";
      active.card.style.touchAction = "";
      try {
        active.card.releasePointerCapture(active.pointerId);
      } catch {
        /* ignore */
      }
      activeRef.current = null;
    }
    pendingRef.current = null;
    setDragOverDay(null);
    setDraggingKey(null);
    unlockAgendaScroll();
  }, [stopDragLoop, unlockAgendaScroll]);

  /**
   * Active le drag : fantôme cloné dans la colonne, calé sur l’heure d’origine.
   */
  const activateDrag = useCallback(
    (pending: PendingPointer) => {
      if (activeRef.current) return;
      longPressTimerRef.current = null;
      const originMinutes = snapMinutes(pending.payload.startMinutes);
      const originHit = findDayColumnAtX(pending.lastX);
      const hourHLayout = Math.max(1, hourHeightRef.current);

      const ghost = pending.card.cloneNode(true) as HTMLElement;
      // Retire le top/height inline de la carte source — on les repose via placeGhostInColumn
      ghost.style.top = "";
      ghost.style.height = "";
      ghost.style.left = "";
      ghost.style.width = "";
      ghost.style.right = "";

      const layoutLeft = pending.card.offsetLeft;
      const layoutWidth = pending.card.offsetWidth;
      const layoutHeight = pending.card.offsetHeight;

      const hostCol = originHit?.col ?? pending.card.offsetParent;
      if (hostCol instanceof HTMLElement) {
        placeGhostInColumn(
          ghost,
          hostCol,
          originMinutes,
          hourHLayout,
          layoutLeft,
          layoutWidth,
          layoutHeight,
        );
      } else {
        document.body.appendChild(ghost);
      }

      pending.card.style.opacity = "0.3";
      try {
        pending.card.setPointerCapture(pending.pointerId);
      } catch {
        /* ignore */
      }
      // Fige la grille : le doigt déplace la carte, pas le scroll
      lockAgendaScroll();
      if (navigator.vibrate) navigator.vibrate(28);

      const active: ActivePointerDrag = {
        payload: pending.payload,
        card: pending.card,
        ghost,
        pointerId: pending.pointerId,
        layoutWidth,
        layoutHeight,
        layoutLeft,
        originMinutes,
        originClientY: pending.lastY,
        originScrollTop: scrollRef.current?.scrollTop ?? 0,
        lastX: pending.lastX,
        lastY: pending.lastY,
        lastTarget: originHit
          ? {
              dayIso: originHit.day.iso,
              dayKey: originHit.day.key,
              minutes: originMinutes,
            }
          : null,
      };
      activeRef.current = active;
      pendingRef.current = null;
      setDraggingKey(payloadKey(pending.payload));
      if (originHit) setDragOverDay(originHit.day.iso);
      active.lastTarget = placeGhostByDelta(active, pending.lastX, pending.lastY);
      ensureDragLoop();
    },
    [ensureDragLoop, findDayColumnAtX, lockAgendaScroll, placeGhostByDelta, scrollRef],
  );

  /**
   * Démarre un éventuel drag (long-press touch / suivi souris).
   */
  const onCardPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, payload: AgendaCardDragPayload) => {
      if (disabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const card = e.currentTarget;
      pendingRef.current = {
        payload,
        card,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
      };

      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      const isCoarse = e.pointerType === "touch" || e.pointerType === "pen";
      if (isCoarse) {
        // Empêche le navigateur de démarrer un scroll pendant l’appui
        card.style.touchAction = "none";
        longPressTimerRef.current = setTimeout(() => {
          const p = pendingRef.current;
          if (p && p.pointerId === e.pointerId) activateDrag(p);
        }, 260);
      }
    },
    [disabled, activateDrag],
  );

  // Écoute globale move / up pendant pending ou active
  useEffect(() => {
    /**
     * Bloque le scroll natif tant qu’un drag agenda est actif (surtout iOS).
     */
    const onTouchMoveBlock = (e: TouchEvent) => {
      if (activeRef.current || scrollLockRef.current) {
        e.preventDefault();
      }
    };

    /**
     * Suit le doigt : active le drag souris, mémorise la position pour le fantôme.
     */
    const onMove = (e: PointerEvent) => {
      const pending = pendingRef.current;
      const active = activeRef.current;

      if (pending && pending.pointerId === e.pointerId) {
        pending.lastX = e.clientX;
        pending.lastY = e.clientY;
        if (!active) {
          const dx = e.clientX - pending.startX;
          const dy = e.clientY - pending.startY;
          const dist = Math.hypot(dx, dy);
          if (dist > 14) {
            if (pending.pointerType === "touch" || pending.pointerType === "pen") {
              if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
              pending.card.style.touchAction = "";
              pendingRef.current = null;
              return;
            }
            activateDrag(pending);
          }
        }
      }

      if (!active || active.pointerId !== e.pointerId) return;
      e.preventDefault();
      active.lastX = e.clientX;
      active.lastY = e.clientY;
      active.lastTarget = placeGhostByDelta(active, e.clientX, e.clientY);
      setDragOverDay(active.lastTarget?.dayIso ?? null);
      ensureDragLoop();
    };

    /**
     * Relâche : dépose sur le dernier créneau snappé sous le doigt.
     */
    const onUp = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending && pending.pointerId === e.pointerId) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        pending.card.style.touchAction = "";
        pendingRef.current = null;
      }

      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;

      const target =
        placeGhostByDelta(active, active.lastX, active.lastY) ?? active.lastTarget;
      const payload = active.payload;
      cancelPointerDrag();
      if (target) onDropRef.current(payload, target);
    };

    const onCancel = (e: PointerEvent) => {
      const active = activeRef.current;
      const pending = pendingRef.current;
      if (
        (active && active.pointerId === e.pointerId) ||
        (pending && pending.pointerId === e.pointerId)
      ) {
        if (pending) pending.card.style.touchAction = "";
        cancelPointerDrag();
      }
    };

    window.addEventListener("touchmove", onTouchMoveBlock, { passive: false });
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("touchmove", onTouchMoveBlock);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [
    activateDrag,
    cancelPointerDrag,
    ensureDragLoop,
    placeGhostByDelta,
  ]);

  useEffect(() => () => cancelPointerDrag(), [cancelPointerDrag]);

  return {
    dragOverDay,
    draggingKey,
    onCardPointerDown,
    payloadKey,
    cancelPointerDrag,
  };
}
