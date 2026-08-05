/**
 * Vue Planning « Google Agenda » : grille horaire hebdo style Google Calendar
 * en légère transparence, avec cartes repas/extras déplaçables synchronisées.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { format, parseISO, isToday } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PossibleMeal } from "@/hooks/useMeals";
import type { PlanningWeekDayInfo } from "@/lib/planningWeekUtils";
import type { GoogleCalendarEvent } from "@/hooks/useGoogleCalendar";
import { getCategoryEmoji } from "@/components/planning/PlanningMiniCard";
import {
  useAgendaCardPointerDrag,
  type AgendaCardDragPayload,
} from "@/hooks/useAgendaCardPointerDrag";
import {
  AGENDA_EVENT_DURATION_MIN,
  AGENDA_HOUR_END,
  AGENDA_HOUR_START,
  AGENDA_INITIAL_SCROLL_HOUR,
  AGENDA_DEFAULT_VISIBLE_HOURS,
  buildExtraAgendaOccurrenceKey,
  formatAgendaClock,
  hasExtraAgendaCustomTime,
  isCompactAgendaColumn,
  resolveAgendaMinutesForExtra,
  resolveAgendaMinutesForMeal,
} from "@/domain/planning/agendaTimeUtils";
import {
  addDaysToIsoDate,
  expandGoogleEventPlacements,
  layoutAllDaySpans,
} from "@/domain/planning/googleEventPlacement";
import { GCAL_AGENDA_CANVAS, googleAgendaEventStyle, googleAgendaPastEventStyle, mixCssColorTowardCanvas, withCssAlpha } from "@/domain/planning/googleAgendaColors";
import {
  layoutOverlappingBlocks,
  agendaOverlapGeometryForBlock,
  hostEndClockTopPx,
  hostTitleTextMaxWidthPct,
  HOST_END_CLOCK_BOTTOM_PAD_PX,
  hostShouldWrapTitleForGuest,
  guestCardShowsTimes,
  agendaCardHasRoomForTimes,
  guestHidesTimesForThinHostTitle,
} from "@/domain/planning/agendaOverlapLayout";
import { assignMealsToMangerEvents, resolveReminderMinutesBefore } from "@/domain/planning/mangerEventAlignment";
import { resolveGouterAgendaMode } from "@/domain/planning/gouterAgendaCard";
import {
  formatGroupedMealAgendaTitle,
  sortMealsForAgendaTitle,
} from "@/domain/planning/groupedMealAgendaTitle";
import type { ExtraDaySlot } from "@/domain/planning/extraSlotOps";

/** Alpha du fond des cartes repas hors « Manger » (laisse lire les events dessous). */
const MEAL_CARD_BG_ALPHA = 0.36;
/**
 * Couleur unique des cartes repas agenda (matin / midi / goûter / soir).
 * Note test ultérieur : le marron « matin passé » observé était `#5f432d`
 * (mix canvas 0.62 sur cette teinte) — à réessayer sur toutes les cartes si demandé.
 */
const AGENDA_MEAL_CARD_COLOR = "#c2783f";
/** z-index de base des repas (au-dessus des events Google ≈ 20+). */
const MEAL_CARD_Z_INDEX = 30;

/**
 * Marron opaque équivalent au rendu transparent sur le fond agenda
 * (même aspect que les cartes matin hors « Manger »).
 */
function opaqueMealColorMatchingTransparency(
  mealCss: string,
  alpha: number = MEAL_CARD_BG_ALPHA,
): string {
  // alpha*couleur + (1-alpha)*canvas ≡ mix vers canvas avec t = 1 - alpha
  return mixCssColorTowardCanvas(mealCss, 1 - Math.max(0, Math.min(1, alpha)));
}

type MealCardChip = { id: string; label: string; count: number };

/**
 * Regroupe les extras d’un créneau (label + occurrences) pour les pastilles.
 */
function groupExtrasAsChips(
  extras: AgendaExtraOccurrence[],
): MealCardChip[] {
  const groups: MealCardChip[] = [];
  for (const ex of extras) {
    const existing = groups.find((g) => g.id === ex.extraId);
    if (existing) existing.count += 1;
    else groups.push({ id: ex.extraId, label: ex.label, count: 1 });
  }
  return groups;
}

/**
 * Affiche le titre repas avec l’emoji collé au 1er mot (même ligne au wrap).
 * Ex. « 🍽️ Cookie maison » → « 🍽️ Cookie » ensemble, « maison » peut passer en dessous.
 */
function MealCardTitleLabel({ title }: { title: string }) {
  const trimmed = title.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return <>{trimmed}</>;
  const [emojiOrFirst, firstWord, ...rest] = parts;
  const glued = `${emojiOrFirst}\u00A0${firstWord}`;
  const tail = rest.length > 0 ? ` ${rest.join(" ")}` : "";
  return (
    <>
      <span className="whitespace-nowrap">{glued}</span>
      {tail}
    </>
  );
}

/** Hauteur (px) sous laquelle titre + heure ne tiennent plus empilés → heure à droite. */
const MEAL_CARD_STACK_MIN_HEIGHT_PX = 28;
/** Taille min / max (px) du texte des pastilles extras. */
const CHIP_FONT_MIN_PX = 6;
const CHIP_FONT_MAX_PX = 9;
/** Plafond pastilles en colonne agenda étroite (mobile). */
const CHIP_FONT_MAX_COMPACT_PX = 11;
/** Hauteur max (px) d’une pastille extra (évite qu’une seule pastille mange toute la carte). */
const CHIP_ROW_MAX_PX = 18;
const CHIP_ROW_MAX_COMPACT_PX = 16;
/** Police min du titre repas (mobile, fit dans la carte). */
const MEAL_TITLE_FONT_MIN_PX = 5;
/**
 * Plafond titre repas mobile.
 * Évite que les cartes hautes (ex. « Pain », « Avant grimpe ») paraissent
 * beaucoup plus grosses que les cartes plus basses / titres longs.
 */
const MEAL_TITLE_FONT_MAX_COMPACT_PX = 9;
/**
 * Opacité du contenu (texte + emoji) des repas passés.
 * Plus basse que 0.58 : les events passés mélangent le texte vers le canvas (0.42)
 * + horaires en opacity-80 — les repas paraissaient encore trop « brillants ».
 */
const MEAL_PAST_CONTENT_OPACITY = 0.42;
/**
 * Assombrit le fond des repas passés (évite le marron trop orange).
 * Les à venir gardent `AGENDA_MEAL_CARD_COLOR` intact.
 */
const MEAL_PAST_BG_TOWARD_CANVAS = 0.5;
/** Encadré repas passé (discret) vs à venir (un peu plus visible). */
const MEAL_CARD_BORDER_PAST = "border border-white/[0.08]";
const MEAL_CARD_BORDER_UPCOMING = "border border-white/20";

/**
 * Trouve la plus grande police (px) pour laquelle le contenu tient
 * entièrement dans maxWidth × maxHeight (les bords de la carte = murs).
 */
function fitTextFontPx(
  el: HTMLElement,
  minPx: number,
  maxPx: number,
  maxWidth: number,
  maxHeight: number,
  singleLine: boolean,
): number {
  if (maxWidth <= 1 || maxHeight <= 1) return minPx;
  const prev = {
    fontSize: el.style.fontSize,
    lineHeight: el.style.lineHeight,
    whiteSpace: el.style.whiteSpace,
    width: el.style.width,
    maxWidth: el.style.maxWidth,
    height: el.style.height,
    maxHeight: el.style.maxHeight,
    overflow: el.style.overflow,
    wordBreak: el.style.wordBreak,
  };
  el.style.width = `${Math.floor(maxWidth)}px`;
  el.style.maxWidth = `${Math.floor(maxWidth)}px`;
  el.style.height = "auto";
  el.style.maxHeight = "none";
  el.style.overflow = "visible";
  el.style.whiteSpace = singleLine ? "nowrap" : "pre-wrap";
  el.style.wordBreak = singleLine ? "normal" : "break-word";
  let lo = minPx;
  let hi = maxPx;
  let best = minPx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = `${mid}px`;
    el.style.lineHeight = singleLine ? "1.05" : "1.15";
    const fits =
      el.scrollWidth <= maxWidth + 1 && el.scrollHeight <= maxHeight + 1;
    if (fits) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  el.style.fontSize = prev.fontSize;
  el.style.lineHeight = prev.lineHeight;
  el.style.whiteSpace = prev.whiteSpace;
  el.style.width = prev.width;
  el.style.maxWidth = prev.maxWidth;
  el.style.height = prev.height;
  el.style.maxHeight = prev.maxHeight;
  el.style.overflow = prev.overflow;
  el.style.wordBreak = prev.wordBreak;
  return best;
}

/**
 * Contenu d’une carte repas / goûter agenda.
 * Desktop : titre à gauche, extras en pastilles à droite.
 * Mobile : texte le plus grand possible sans dépasser ; avec extras =
 * titre (wrap si besoin) puis pastilles en dessous.
 */
function AgendaMealCardBody({
  title,
  timeLabel,
  chips = [],
  mealPast,
  cardHeightPx,
  compact = false,
}: {
  title: string;
  timeLabel: string;
  chips?: MealCardChip[];
  mealPast: boolean;
  /** Hauteur utile de la carte (px) pour choisir le layout. */
  cardHeightPx?: number;
  /** Colonnes étroites (mobile) : fit texte + pas d’heure. */
  compact?: boolean;
}) {
  const hasChips = chips.length > 0;
  const chipsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const chipFontMax = compact ? CHIP_FONT_MAX_COMPACT_PX : CHIP_FONT_MAX_PX;
  const chipRowMax = compact ? CHIP_ROW_MAX_COMPACT_PX : CHIP_ROW_MAX_PX;
  const [chipFontPx, setChipFontPx] = useState(chipFontMax);
  const [chipRowPx, setChipRowPx] = useState(chipRowMax);
  const [titleFontPx, setTitleFontPx] = useState(
    compact ? MEAL_TITLE_FONT_MIN_PX : 10,
  );

  const titleClsDesktop = `text-[9px] sm:text-[10px] font-bold leading-tight break-words text-white ${
    mealPast ? "" : "drop-shadow-sm"
  }`;
  const timeCls = `text-[8px] sm:text-[9px] font-semibold leading-tight shrink-0 text-white ${
    mealPast ? "opacity-80" : "drop-shadow-sm"
  }`;
  const tooShortToStack =
    typeof cardHeightPx === "number" && cardHeightPx < MEAL_CARD_STACK_MIN_HEIGHT_PX;
  /** Assombrit texte + emoji comme les events Google passés (sans ombre « brillante »). */
  const pastContentStyle = mealPast
    ? { opacity: MEAL_PAST_CONTENT_OPACITY }
    : undefined;

  const chipsKey = chips.map((c) => `${c.id}:${c.count}:${c.label}`).join("|");

  /**
   * Mobile : calcule la plus grande police pour titre (+ extras) dans les murs de la carte.
   */
  useLayoutEffect(() => {
    if (!compact) return;
    const body = bodyRef.current;
    const titleEl = titleRef.current;
    if (!body || !titleEl) return;

    const update = () => {
      const w = body.clientWidth;
      const h =
        typeof cardHeightPx === "number" && cardHeightPx > 0
          ? cardHeightPx
          : body.clientHeight;
      if (w <= 0 || h <= 0) return;

      if (hasChips) {
        // Titre peut wrap ; extras sur la bande du bas (~42 % de la hauteur)
        const gap = 1;
        const extraBand = Math.max(9, Math.min(chipRowMax, Math.floor(h * 0.42)));
        const titleBand = Math.max(8, h - extraBand - gap);
        const titlePx = fitTextFontPx(
          titleEl,
          MEAL_TITLE_FONT_MIN_PX,
          MEAL_TITLE_FONT_MAX_COMPACT_PX,
          w,
          titleBand,
          false,
        );
        setTitleFontPx(titlePx);
        const chipPx = Math.max(
          CHIP_FONT_MIN_PX,
          Math.min(chipFontMax, Math.floor(extraBand * 0.62), titlePx),
        );
        setChipRowPx(extraBand);
        setChipFontPx(chipPx);
      } else {
        const titlePx = fitTextFontPx(
          titleEl,
          MEAL_TITLE_FONT_MIN_PX,
          MEAL_TITLE_FONT_MAX_COMPACT_PX,
          w,
          h,
          false,
        );
        setTitleFontPx(titlePx);
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(body);
    return () => ro.disconnect();
  }, [
    compact,
    hasChips,
    chipsKey,
    cardHeightPx,
    title,
    chipFontMax,
    chipRowMax,
  ]);

  /**
   * Desktop : calcule police + hauteur des pastilles extras (plafonnées).
   */
  useLayoutEffect(() => {
    if (compact || !hasChips) return;
    const el = chipsRef.current;
    if (!el) return;

    const update = () => {
      const avail = el.clientHeight;
      const n = chips.length;
      if (n <= 0 || avail <= 0) return;
      const gapPx = 2;
      const shareH = (avail - gapPx * (n - 1)) / n;
      const rowH = Math.max(8, Math.min(chipRowMax, Math.floor(shareH)));
      const font = Math.max(
        CHIP_FONT_MIN_PX,
        Math.min(chipFontMax, Math.floor(rowH * 0.55)),
      );
      setChipRowPx(rowH);
      setChipFontPx(font);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact, hasChips, chipsKey, cardHeightPx, chips.length, chipFontMax, chipRowMax]);

  /** Rendu d’une pastille extra. */
  const renderChip = (chip: MealCardChip, opts?: { fullWidth?: boolean }) => {
    const label = chip.count > 1 ? `${chip.label} ×${chip.count}` : chip.label;
    const padY = Math.max(0, Math.round(chipFontPx * 0.1));
    const padX = Math.max(2, Math.round(chipFontPx * 0.3));
    return (
      <span
        key={chip.id}
        className={`flex shrink-0 items-center justify-start overflow-hidden rounded font-semibold bg-black/45 text-amber-100 border border-amber-200/35 drop-shadow-sm ${
          opts?.fullWidth ? "max-w-full" : ""
        }`}
        style={{
          fontSize: chipFontPx,
          lineHeight: 1.1,
          height: chipRowPx,
          maxHeight: chipRowMax,
          padding: `${padY}px ${padX}px`,
          maxWidth: opts?.fullWidth ? "100%" : undefined,
        }}
        title={label}
      >
        <span className="max-w-full truncate text-left">{label}</span>
      </span>
    );
  };

  // —— Mobile compact ——
  if (compact) {
    const titleStyle: CSSProperties = {
      fontSize: titleFontPx,
      lineHeight: 1.15,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      overflow: "hidden",
    };
    return (
      <div
        ref={bodyRef}
        className="flex h-full min-h-0 w-full flex-col overflow-hidden gap-px"
        style={pastContentStyle}
      >
        <div
          ref={titleRef}
          className={`min-w-0 min-h-0 flex-1 font-bold text-white ${
            mealPast ? "" : "drop-shadow-sm"
          }`}
          style={titleStyle}
        >
          <MealCardTitleLabel title={title} />
        </div>
        {hasChips && (
          <div
            ref={chipsRef}
            className="flex min-h-0 w-full shrink-0 items-center gap-px overflow-hidden"
            style={{ height: chipRowPx, maxHeight: chipRowMax }}
          >
            {chips.map((chip) => renderChip(chip, { fullWidth: chips.length === 1 }))}
          </div>
        )}
      </div>
    );
  }

  // —— Desktop / large : titre | pastilles ——
  if (hasChips) {
    return (
      <div
        className="flex h-full min-h-0 w-full overflow-hidden gap-0.5"
        style={pastContentStyle}
      >
        <div className="flex min-w-0 flex-1 flex-col justify-start gap-px overflow-hidden">
          <div className={`min-w-0 ${titleClsDesktop}`}>
            <MealCardTitleLabel title={title} />
          </div>
          <div className={timeCls} data-agenda-drag-time>
            {timeLabel}
          </div>
        </div>
        <div
          ref={chipsRef}
          className="flex min-h-0 h-full w-auto max-w-[62%] shrink-0 flex-col justify-center gap-0.5 overflow-hidden"
        >
          {chips.map((chip) => renderChip(chip))}
        </div>
      </div>
    );
  }

  if (tooShortToStack) {
    return (
      <div
        className="flex h-full min-h-0 w-full items-center overflow-hidden gap-0.5"
        style={pastContentStyle}
      >
        <div className={`min-w-0 flex-1 ${titleClsDesktop}`}>
          <MealCardTitleLabel title={title} />
        </div>
        <div className={`max-w-[45%] shrink-0 text-right ${timeCls}`} data-agenda-drag-time>
          {timeLabel}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col justify-start gap-px overflow-hidden"
      style={pastContentStyle}
    >
      <div className={`min-w-0 ${titleClsDesktop}`}>
        <MealCardTitleLabel title={title} />
      </div>
      <div className={timeCls} data-agenda-drag-time>
        {timeLabel}
      </div>
    </div>
  );
}

/** Hauteur pixel d’un bloc agenda à partir de sa durée. */
function agendaBlockHeightPx(durationMin: number, hourHeightPx: number): number {
  return Math.max(4, (Math.max(5, durationMin) / 60) * hourHeightPx - 1);
}

const TOTAL_HOURS = AGENDA_HOUR_END - AGENDA_HOUR_START;
/** Largeur colonne horaires (desktop). */
const TIME_COL_PX = 44;
/** Largeur colonne horaires (mobile compact). */
const TIME_COL_COMPACT_PX = 32;
/**
 * Plancher absolu si le bandeau journée mange beaucoup de viewport :
 * on compresse pour garder 7h→23h59 visible.
 */
const ABSOLUTE_MIN_HOUR_HEIGHT_PX = 12;
/** Hauteur sticky jours (sans all-day) — chip + paddings réels. */
const DAY_HEADER_BASE_PX = 58;
/** Hauteur sticky jours compacte. */
const DAY_HEADER_BASE_COMPACT_PX = 48;
/** Hauteur d’une ligne all-day. */
const ALL_DAY_ROW_PX = 18;
/** Sous ce seuil (px), carte trop basse pour un vrai wrap multi-lignes. */
const THIN_LAYOUT_MAX_HEIGHT_PX = 26;
/** Durée max (min) pour le texte ultra-compact (inclut les créneaux de 15 min). */
const SHORT_EVENT_MAX_MIN = 15;
/** Marge px pour que 7h→23h59 tienne vraiment (bordures / scrollbar). */
const VISIBLE_RANGE_FUDGE_PX = 8;

export interface AgendaExtraOccurrence {
  occurrenceKey: string;
  extraId: string;
  label: string;
  dayIso: string;
  dayKey: string;
  /** Créneau repas, ou `"extra"` si encore dans la colonne EXTRA (journée). */
  slot: ExtraDaySlot | "extra";
  occurrenceIndex: number;
}

export interface GoogleAgendaPlanningViewProps {
  weekDates: PlanningWeekDayInfo[];
  meals: PossibleMeal[];
  agendaTimes: Record<string, number>;
  extraAgendaTimes: Record<string, number>;
  extras: AgendaExtraOccurrence[];
  googleEvents: GoogleCalendarEvent[];
  connected: boolean;
  /** Erreur de chargement des events Google (ex. token expiré). */
  eventsError?: string | null;
  /** True si une nouvelle autorisation OAuth est nécessaire. */
  needsReauth?: boolean;
  /** Relance Déconnecter + OAuth Google. */
  onReconnectGoogle?: () => void;
  hideMealCards: boolean;
  onMoveMeal: (pmId: string, dayIso: string, dayKey: string, minutes: number) => void;
  onMoveExtra: (
    occurrence: AgendaExtraOccurrence,
    dayIso: string,
    dayKey: string,
    minutes: number,
  ) => void;
  /**
   * Déplace d’un coup tous les extras d’une carte « Goûter » (mode extras seuls).
   */
  onMoveGouterExtras: (
    occurrences: AgendaExtraOccurrence[],
    dayIso: string,
    dayKey: string,
    minutes: number,
  ) => void;
  /** Décalage de semaine (0 = semaine calendaire courante). */
  weekOffset?: number;
  /** Change la semaine affichée (offset relatif à la semaine courante). */
  onWeekOffsetChange?: (offset: number) => void;
}

/** Positionne un bloc dans la colonne jour selon minutes depuis minuit.
 * Hauteur = durée réelle (pas de min 20px) pour éviter de chevaucher l’événement suivant.
 */
function blockStyle(
  startMinutes: number,
  durationMin: number = AGENDA_EVENT_DURATION_MIN,
  hourHeightPx: number,
) {
  const top = ((startMinutes - AGENDA_HOUR_START * 60) / 60) * hourHeightPx;
  // 1 px de marge bas pour séparer deux blocs qui se touchent (ex. 22h45 / 23h00).
  const rawHeight = (Math.max(5, durationMin) / 60) * hourHeightPx - 1;
  const height = Math.max(4, rawHeight);
  return {
    top: `${Math.max(0, top)}px`,
    height: `${height}px`,
  };
}

/**
 * Détecte les marqueurs « Semaine 31 de 2026 » / « Week 31 » (souvent absents de l’UI Google).
 */
function isGoogleWeekNumberLabel(summary: string | null | undefined): boolean {
  const t = (summary || "").trim();
  if (!t) return false;
  return (
    /^semaine\s+\d+(\s+de\s+\d{4})?$/i.test(t) ||
    /^week\s+\d+(\s+of\s+\d{4})?$/i.test(t)
  );
}

/** Résout le jour ISO d’un repas planifié (clé FR ou ISO). */
function resolveMealDayIso(
  dayOfWeek: string | null | undefined,
  weekDates: PlanningWeekDayInfo[],
): string | null {
  if (!dayOfWeek) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayOfWeek)) {
    return weekDates.some((d) => d.iso === dayOfWeek) ? dayOfWeek : null;
  }
  return weekDates.find((d) => d.key === dayOfWeek)?.iso ?? null;
}

/** Libellé compact type Google mobile : « lun 27 ». */
function formatDayChip(iso: string): { weekday: string; dayNum: string } {
  try {
    const d = parseISO(iso);
    return {
      weekday: format(d, "EEE", { locale: fr }).replace(".", ""),
      dayNum: format(d, "d"),
    };
  } catch {
    return { weekday: "", dayNum: iso.slice(8) };
  }
}

/** Mode d’affichage des horaires selon la hauteur réelle du bloc. */
type AgendaTimeLayout = "tall" | "thin";

/**
 * Choisit le layout : une ligne si le bloc est trop bas pour titre + horaires
 * sans écraser le texte (indépendamment de la durée seule).
 */
function agendaTimeLayout(durationMin: number, hourHeightPx: number): AgendaTimeLayout {
  const heightPx = (Math.max(5, durationMin) / 60) * hourHeightPx - 1;
  if (heightPx < THIN_LAYOUT_MAX_HEIGHT_PX) return "thin";
  return "tall";
}

/** Séparateur serré entre horaires début/fin (maximise la place pour le titre). */
function AgendaInlineTimeSep() {
  return (
    <span className="shrink-0 opacity-50 mx-px" aria-hidden>
      -
    </span>
  );
}

/**
 * Ligne titre + horaires dans une carte fine :
 * `inset-0` + flex centre le contenu dans toute la hauteur de la carte.
 */
function AgendaThinInlineRow({
  summary,
  startClock,
  endClock,
  showEventTimes,
  endClockRepositioned,
  endClockTopPx,
  endClockAbsClass,
  clockClassName,
}: {
  summary: string;
  startClock: string;
  endClock: string;
  showEventTimes: boolean;
  endClockRepositioned: boolean;
  endClockTopPx: number | null;
  endClockAbsClass: string;
  clockClassName: string;
}) {
  return (
    <div className="relative h-full w-full min-w-0 overflow-hidden">
      <div className="absolute inset-0 flex min-w-0 items-center gap-0.5 overflow-hidden">
        <span className="min-w-0 flex-1 truncate font-semibold leading-none">{summary}</span>
        {showEventTimes ? (
          <span
            className={`inline-flex shrink-0 items-center whitespace-nowrap leading-none ${clockClassName}`}
            // Glyphes chiffres un peu hauts dans l’em-box → 1px vers le bas
            style={{ paddingTop: 1 }}
          >
            {startClock}
            {!endClockRepositioned ? (
              <>
                <AgendaInlineTimeSep />
                {endClock}
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      {endClockRepositioned && showEventTimes ? (
        <span className={endClockAbsClass} style={{ top: `${endClockTopPx}px` }}>
          {endClock}
        </span>
      ) : null}
    </div>
  );
}

type AgendaEventCardContentProps = {
  summary: string;
  startClock: string;
  endClock: string;
  timeLayout: AgendaTimeLayout;
  isShortEvent: boolean;
  showEventTimes: boolean;
  endClockTopPx: number | null;
  endClockRepositioned: boolean;
  titleMaxLines: number;
  titleClampStyle?: { maxWidth: string };
  thinTitleWrap: boolean;
  thinTitleLines: number;
  googleStackLeft: boolean;
  isCompact: boolean;
};

/**
 * Contenu interne d’une carte événement Google :
 * mode compact (mobile) = densite Agenda ; desktop = début sous le titre.
 */
function AgendaEventCardContent({
  summary,
  startClock,
  endClock,
  timeLayout,
  isShortEvent,
  showEventTimes,
  endClockTopPx,
  endClockRepositioned,
  titleMaxLines,
  titleClampStyle,
  thinTitleWrap,
  thinTitleLines,
  googleStackLeft,
  isCompact,
}: AgendaEventCardContentProps) {
  const clockClass = isCompact
    ? "text-[7px] opacity-80 tabular-nums leading-none"
    : "text-[8px] sm:text-[9px] opacity-80 tabular-nums leading-none";
  const endClockAbsClass = isCompact
    ? "absolute right-0 text-[7px] opacity-80 tabular-nums pointer-events-none leading-none"
    : "absolute right-0 text-[8px] sm:text-[9px] opacity-80 tabular-nums pointer-events-none leading-[1.15]";
  const endClockBottomClass = isCompact
    ? "absolute right-0 text-[7px] opacity-80 tabular-nums leading-none"
    : "absolute right-0 text-[8px] sm:text-[9px] opacity-80 tabular-nums leading-[1.15]";

  // Compact + carte assez haute
  if (isCompact && (timeLayout === "tall" || thinTitleWrap || googleStackLeft)) {
    const lines = Math.max(1, Math.max(thinTitleLines, titleMaxLines));
    // Fin repositionnée (bande étroite sous invité) → fin en absolute
    const splitEndClock = showEventTimes && endClockRepositioned;

    return (
      <div className="relative flex h-full min-w-0 flex-col overflow-hidden">
        <div
          className={`min-w-0 shrink-0 font-semibold leading-[1.05] ${
            lines <= 1
              ? "truncate"
              : "break-words [overflow-wrap:anywhere] [word-break:break-word]"
          }`}
          style={{
            ...(titleClampStyle ?? {}),
            ...(lines > 1
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: lines,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }
              : {}),
          }}
        >
          {summary}
        </div>
        {/* Heure de début : haut à gauche, sous le titre (espace vide). */}
        {showEventTimes ? (
          <div
            className={`shrink-0 truncate ${clockClass}`}
            style={titleClampStyle}
          >
            {startClock}
          </div>
        ) : null}
        <div className="min-h-0 flex-1" aria-hidden />
        {showEventTimes ? (
          splitEndClock ? (
            <span className={endClockAbsClass} style={{ top: `${endClockTopPx}px` }}>
              {endClock}
            </span>
          ) : (
            <span
              className={endClockBottomClass}
              style={{ bottom: HOST_END_CLOCK_BOTTOM_PAD_PX }}
            >
              {endClock}
            </span>
          )
        ) : null}
      </div>
    );
  }

  // Compact + carte fine : une ligne titre (+ plage si assez large)
  if (isCompact && timeLayout === "thin") {
    return (
      <AgendaThinInlineRow
        summary={summary}
        startClock={startClock}
        endClock={endClock}
        showEventTimes={showEventTimes}
        endClockRepositioned={endClockRepositioned}
        endClockTopPx={endClockTopPx}
        endClockAbsClass={endClockAbsClass}
        clockClassName={clockClass}
      />
    );
  }

  // Desktop : layouts existants
  if (googleStackLeft) {
    return (
      <div className="relative h-full overflow-hidden">
        <div
          className={`font-semibold truncate ${
            isShortEvent ? "leading-none" : "leading-[1.15]"
          }`}
          style={titleClampStyle}
        >
          {summary}
        </div>
        {showEventTimes ? (
          <div
            className={`opacity-80 tabular-nums truncate ${
              isShortEvent ? "leading-none" : "text-[8px] sm:text-[9px] leading-none"
            }`}
            style={titleClampStyle}
          >
            {startClock}
          </div>
        ) : null}
        {showEventTimes ? (
          endClockRepositioned ? (
            <span className={endClockAbsClass} style={{ top: `${endClockTopPx}px` }}>
              {endClock}
            </span>
          ) : (
            <span
              className={endClockBottomClass}
              style={{ bottom: HOST_END_CLOCK_BOTTOM_PAD_PX }}
            >
              {endClock}
            </span>
          )
        ) : null}
      </div>
    );
  }

  if (timeLayout === "thin") {
    if (thinTitleWrap) {
      return (
        <div className="relative flex h-full min-w-0 flex-col justify-start overflow-hidden">
          <div
            className="min-w-0 font-semibold leading-[1.15] break-words [overflow-wrap:anywhere]"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: thinTitleLines,
              WebkitBoxOrient: "vertical" as const,
              overflow: "hidden",
            }}
          >
            {summary}
          </div>
          {showEventTimes ? (
            <div className="mt-px text-[8px] sm:text-[9px] opacity-80 tabular-nums leading-none truncate">
              {startClock}
            </div>
          ) : null}
          {showEventTimes ? (
            endClockRepositioned ? (
              <span className={endClockAbsClass} style={{ top: `${endClockTopPx}px` }}>
                {endClock}
              </span>
            ) : (
              <span
                className="absolute right-0 text-[8px] sm:text-[9px] opacity-80 tabular-nums leading-none"
                style={{ bottom: HOST_END_CLOCK_BOTTOM_PAD_PX }}
              >
                {endClock}
              </span>
            )
          ) : null}
        </div>
      );
    }
    return (
      <AgendaThinInlineRow
        summary={summary}
        startClock={startClock}
        endClock={endClock}
        showEventTimes={showEventTimes}
        endClockRepositioned={endClockRepositioned}
        endClockTopPx={endClockTopPx}
        endClockAbsClass={endClockAbsClass}
        clockClassName="opacity-80 tabular-nums text-[inherit]"
      />
    );
  }

  return (
    <div className="relative h-full overflow-hidden">
      <div
        className={`font-semibold leading-[1.15] ${
          titleMaxLines <= 1 ? "truncate" : "break-words [overflow-wrap:anywhere]"
        }`}
        style={{
          ...(titleClampStyle ?? {}),
          ...(titleMaxLines > 1
            ? {
                display: "-webkit-box",
                WebkitLineClamp: titleMaxLines,
                WebkitBoxOrient: "vertical" as const,
                overflow: "hidden",
              }
            : {}),
        }}
      >
        {summary}
      </div>
      {showEventTimes ? (
        <>
          <div
            className="text-[8px] sm:text-[9px] opacity-80 tabular-nums truncate leading-none"
            style={titleClampStyle}
          >
            {startClock}
          </div>
          {endClockTopPx != null ? (
            <span className={endClockAbsClass} style={{ top: `${endClockTopPx}px` }}>
              {endClock}
            </span>
          ) : (
            <span
              className={endClockBottomClass}
              style={{ bottom: HOST_END_CLOCK_BOTTOM_PAD_PX }}
            >
              {endClock}
            </span>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * Nombre de lignes de titre affichables sur une carte haute
 * (priorise le wrap du titre ; horaires de fin en absolute).
 */
function agendaTitleMaxLines(durationMin: number, hourHeightPx: number): number {
  const heightPx = (Math.max(5, durationMin) / 60) * hourHeightPx - 1;
  // Début sous le titre (~10 px) ; fin en absolute → peu de réserve
  const reservedForClocks = 12;
  const lineHeightPx = 10;
  const available = Math.max(0, heightPx - reservedForClocks);
  let lines = Math.floor(available / lineHeightPx);
  // Place visible au centre : au moins 2 lignes dès ~36 px de hauteur
  if (heightPx >= 36 && lines < 2) lines = 2;
  return Math.max(1, Math.min(8, lines));
}

/** Formate l’intervalle de dates pour la navigation de semaine (ex. « 27 juil – 2 aoû »). */
function formatAgendaWeekRangeLabel(weekDates: PlanningWeekDayInfo[]): string {
  if (weekDates.length === 0) return "";
  const start = parseISO(weekDates[0].iso);
  const end = parseISO(weekDates[weekDates.length - 1].iso);
  return `${format(start, "d MMM", { locale: fr })} – ${format(end, "d MMM", { locale: fr })}`;
}

/**
 * Indique si un créneau horaire est déjà passé (jour passé, ou terminé aujourd’hui).
 */
function isAgendaEventPast(
  dayIso: string,
  todayIso: string,
  eventEndMin: number,
  nowMin: number,
): boolean {
  if (dayIso < todayIso) return true;
  if (dayIso === todayIso && eventEndMin <= nowMin) return true;
  return false;
}

/**
 * Indique si une barre all-day est entièrement dans le passé
 * (dernier jour de la barre &lt; aujourd’hui).
 */
function isAgendaAllDaySpanPast(
  weekIsos: string[],
  startCol: number,
  endCol: number,
  todayIso: string,
): boolean {
  const lastDay = weekIsos[endCol];
  if (!lastDay) return false;
  return lastDay < todayIso;
}

/**
 * Affiche la grille agenda hebdo (fond Google style Calendar + repas/extras déplaçables).
 */
export function GoogleAgendaPlanningView({
  weekDates,
  meals,
  agendaTimes,
  extraAgendaTimes,
  extras,
  googleEvents,
  connected,
  eventsError = null,
  needsReauth = false,
  onReconnectGoogle,
  hideMealCards,
  onMoveMeal,
  onMoveExtra,
  onMoveGouterExtras,
  weekOffset = 0,
  onWeekOffsetChange,
}: GoogleAgendaPlanningViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [dayColumnWidthPx, setDayColumnWidthPx] = useState(() => {
    if (typeof window === "undefined") return 160;
    // Estimation initiale : (viewport − colonne heures − chrome) / 7 jours
    return Math.max(40, Math.round((window.innerWidth - 80) / 7));
  });
  const [agendaViewportHeightPx, setAgendaViewportHeightPx] = useState(560);
  const [hourHeightPx, setHourHeightPx] = useState(40);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  const weekIsoSet = useMemo(() => new Set(weekDates.map((d) => d.iso)), [weekDates]);
  const hours = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => AGENDA_HOUR_START + i),
    [],
  );
  const isCompactAgenda = isCompactAgendaColumn(dayColumnWidthPx);
  const timeColPx = isCompactAgenda ? TIME_COL_COMPACT_PX : TIME_COL_PX;
  const dayHeaderBasePx = isCompactAgenda ? DAY_HEADER_BASE_COMPACT_PX : DAY_HEADER_BASE_PX;
  const gridHeightPx = TOTAL_HOURS * hourHeightPx;

  // Remplit la hauteur restante sous les onglets / header planning.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    /** Calcule la hauteur viewport dispo pour la grille agenda (presque plein écran). */
    const updateHeight = () => {
      const topDoc = el.getBoundingClientRect().top + window.scrollY;
      const bottomPad = 12;
      const next = Math.max(320, Math.round(window.innerHeight - topDoc - bottomPad));
      setAgendaViewportHeightPx(next);
    };

    updateHeight();
    // Recalcule après paint (header peut encore s’ajuster)
    const raf = requestAnimationFrame(updateHeight);
    window.addEventListener("resize", updateHeight);
    const ro = new ResizeObserver(updateHeight);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateHeight);
      ro.disconnect();
    };
  }, [connected, hideMealCards, weekDates.length]);

  // Mesure la largeur d’une colonne jour pour caler l’invité juste après le titre.
  useEffect(() => {
    const firstIso = weekDates[0]?.iso;
    if (!firstIso) return;
    const el = columnRefs.current[firstIso];
    if (!el) return;

    /** Met à jour la largeur colonne utilisée pour le layout des chevauchements. */
    const updateWidth = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setDayColumnWidthPx(w);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weekDates]);

  // Met à jour la ligne « maintenant » chaque minute.
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    };
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const mealsByDay = useMemo(() => {
    const map: Record<string, PossibleMeal[]> = {};
    for (const day of weekDates) map[day.iso] = [];
    for (const pm of meals) {
      const iso = resolveMealDayIso(pm.day_of_week, weekDates);
      if (!iso || !pm.meal_time) continue;
      map[iso]?.push(pm);
    }
    return map;
  }, [meals, weekDates]);

  const extrasByDay = useMemo(() => {
    const map: Record<string, AgendaExtraOccurrence[]> = {};
    for (const day of weekDates) map[day.iso] = [];
    for (const ex of extras) {
      if (map[ex.dayIso]) map[ex.dayIso].push(ex);
    }
    return map;
  }, [extras, weekDates]);

  const todayIsoStr = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const googleByDay = useMemo(() => {
    const map: Record<
      string,
      Array<
        GoogleCalendarEvent & {
          startMin: number;
          endMin: number;
          durationMin: number;
          isAllDay: boolean;
        }
      >
    > = {};
    for (const day of weekDates) map[day.iso] = [];
    for (const ev of googleEvents) {
      if (ev.allDay && isGoogleWeekNumberLabel(ev.summary)) continue;
      const placements = expandGoogleEventPlacements(
        ev.start,
        ev.end,
        ev.allDay,
        weekIsoSet,
        AGENDA_EVENT_DURATION_MIN,
      );
      for (const placement of placements) {
        // All-day multi-jours → barre continue (layoutAllDaySpans), pas une puce / jour
        if (placement.isAllDay) continue;
        map[placement.dayIso]?.push({
          ...ev,
          id: `${ev.id}__${placement.dayIso}`,
          startMin: placement.startMin,
          endMin: placement.startMin + placement.durationMin,
          durationMin: placement.durationMin,
          isAllDay: false,
        });
      }
    }
    return map;
  }, [googleEvents, weekDates, weekIsoSet]);

  /** Barres all-day : events Google + extras non déplacés (événement journée). */
  const allDaySpanLayout = useMemo(() => {
    type AllDaySource =
      | {
          id: string;
          summary: string;
          start: string;
          end: string;
          allDay: true;
          kind: "google";
          google: GoogleCalendarEvent;
        }
      | {
          id: string;
          summary: string;
          start: string;
          end: string;
          allDay: true;
          kind: "extra";
          occurrence: AgendaExtraOccurrence;
        };

    const weekIsos = weekDates.map((d) => d.iso);
    const sources: AllDaySource[] = [];

    for (const ev of googleEvents) {
      if (!ev.allDay) continue;
      if (isGoogleWeekNumberLabel(ev.summary)) continue;
      sources.push({
        id: `g-${ev.id}`,
        summary: ev.summary,
        start: ev.start,
        end: ev.end,
        allDay: true,
        kind: "google",
        google: ev,
      });
    }

    for (const ex of extras) {
      // Goûter : absorbé par la carte « Goûter »
      if (ex.slot === "gouter") continue;
      if (hasExtraAgendaCustomTime(ex.occurrenceKey, extraAgendaTimes)) continue;
      // matin/midi/soir avec une carte repas du créneau → pastilles sur la carte (pas journée)
      if (ex.slot === "matin" || ex.slot === "midi" || ex.slot === "soir") {
        const hasMealForSlot = meals.some((pm) => {
          if (pm.meal_time !== ex.slot) return false;
          return resolveMealDayIso(pm.day_of_week, weekDates) === ex.dayIso;
        });
        if (hasMealForSlot) continue;
      }
      sources.push({
        id: `extra-${ex.occurrenceKey}`,
        summary: ex.label,
        start: ex.dayIso,
        end: addDaysToIsoDate(ex.dayIso, 1),
        allDay: true,
        kind: "extra",
        occurrence: ex,
      });
    }

    return layoutAllDaySpans(sources, weekIsos);
  }, [googleEvents, weekDates, extras, extraAgendaTimes, meals]);

  /** Événements horaires disposés (colonnes si vrai chevauchement). */
  const laidOutGoogleByDay = useMemo(() => {
    const map: Record<
      string,
      Array<
        GoogleCalendarEvent & {
          startMin: number;
          endMin: number;
          durationMin: number;
          col: number;
          colCount: number;
          clusterId: number;
        }
      >
    > = {};
    for (const day of weekDates) {
      const timed = (googleByDay[day.iso] || [])
        .filter((ev) => !ev.isAllDay)
        .map((ev) => ({
          ...ev,
          id: `${ev.id}-${ev.start}`,
          startMin: ev.startMin,
          endMin: ev.endMin,
          summary: ev.summary,
          durationMin: ev.durationMin,
        }));
      map[day.iso] = layoutOverlappingBlocks(timed);
    }
    return map;
  }, [googleByDay, weekDates]);

  const maxAllDayRows = allDaySpanLayout.rowCount;
  const allDayLaneHeightPx = Math.max(2, maxAllDayRows * ALL_DAY_ROW_PX);
  const stickyHeaderHeightPx = dayHeaderBasePx + allDayLaneHeightPx;

  // Hauteur d’heure : 7h→23h59 tient toujours sous le bandeau (jours + extras journée).
  // Plus le bandeau grandit, plus on compresse — plus de plancher « confort » qui forçait le scroll.
  useEffect(() => {
    const available =
      agendaViewportHeightPx - stickyHeaderHeightPx - VISIBLE_RANGE_FUDGE_PX;
    if (available <= 0) {
      setHourHeightPx(ABSOLUTE_MIN_HOUR_HEIGHT_PX);
      return;
    }
    const fitted = available / AGENDA_DEFAULT_VISIBLE_HOURS;
    setHourHeightPx(Math.max(ABSOLUTE_MIN_HOUR_HEIGHT_PX, fitted));
  }, [agendaViewportHeightPx, stickyHeaderHeightPx]);

  // Positionne le scroll sur 7h (les heures avant restent accessibles en scrollant).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = (AGENDA_INITIAL_SCROLL_HOUR - AGENDA_HOUR_START) * hourHeightPx;
    requestAnimationFrame(() => {
      el.scrollTop = Math.max(0, target);
    });
  }, [hourHeightPx]);

  /**
   * Applique un dépôt agenda (repas / extra / goûter) au créneau snappé.
   */
  const applyAgendaPointerDrop = (
    payload: AgendaCardDragPayload,
    target: { dayIso: string; dayKey: string; minutes: number },
  ) => {
    if (hideMealCards) return;
    if (payload.kind === "meal") {
      onMoveMeal(payload.pmId, target.dayIso, target.dayKey, target.minutes);
      return;
    }
    if (payload.kind === "gouter-extras") {
      const occurrences = payload.occurrenceKeys
        .map((k) => extras.find((x) => x.occurrenceKey === k))
        .filter((x): x is AgendaExtraOccurrence => Boolean(x));
      if (occurrences.length > 0) {
        onMoveGouterExtras(occurrences, target.dayIso, target.dayKey, target.minutes);
      }
      return;
    }
    const occurrence = extras.find((x) => x.occurrenceKey === payload.occurrenceKey);
    if (occurrence) {
      onMoveExtra(occurrence, target.dayIso, target.dayKey, target.minutes);
    }
  };

  const { dragOverDay, draggingKey, onCardPointerDown, payloadKey } = useAgendaCardPointerDrag({
    weekDates,
    columnRefs,
    scrollRef,
    hourHeightPx,
    disabled: hideMealCards,
    onDrop: applyAgendaPointerDrop,
  });

  const nowTop = ((nowMinutes - AGENDA_HOUR_START * 60) / 60) * hourHeightPx;
  const weekRangeLabel = formatAgendaWeekRangeLabel(weekDates);
  const showWeekNav = typeof onWeekOffsetChange === "function";

  return (
    <div className="w-full min-h-0">
      <div
        ref={scrollRef}
        className="rounded-2xl border border-white/[0.08] shadow-inner overflow-auto overscroll-contain"
        style={{
          backgroundColor: GCAL_AGENDA_CANVAS,
          height: `${agendaViewportHeightPx}px`,
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div
          className="grid w-full min-w-0"
          style={{
            gridTemplateColumns: `${timeColPx}px repeat(${weekDates.length}, minmax(0, 1fr))`,
          }}
        >
          {/* Coin sticky : navigation semaine agenda (au-dessus des horaires, à gauche des jours) */}
          <div
            className="sticky top-0 z-30 border-b border-r border-white/[0.08] flex flex-col items-center justify-center gap-0.5 px-0.5"
            style={{
              backgroundColor: GCAL_AGENDA_CANVAS,
              minHeight: dayHeaderBasePx,
            }}
            aria-label="Navigation semaine agenda"
          >
            {showWeekNav ? (
              <>
                <button
                  type="button"
                  onClick={() => onWeekOffsetChange!(weekOffset - 1)}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  title="Semaine précédente"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onWeekOffsetChange!(0)}
                  disabled={weekOffset === 0}
                  className="max-w-full px-0.5 text-[6px] sm:text-[7px] leading-tight font-semibold text-white/40 hover:text-white/75 disabled:opacity-35 disabled:pointer-events-none text-center"
                  title={`Semaine actuelle · ${weekRangeLabel}`}
                >
                  {weekOffset === 0 ? "Auj." : weekRangeLabel}
                </button>
                <button
                  type="button"
                  onClick={() => onWeekOffsetChange!(weekOffset + 1)}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  title="Semaine suivante"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
          </div>
          {weekDates.map((day) => {
            const chip = formatDayChip(day.iso);
            const today = isToday(parseISO(day.iso));
            const isPastDay = day.iso < todayIsoStr;
            return (
              <div
                key={`head-${day.iso}`}
                className={`sticky top-0 z-30 border-b border-white/[0.08] ${
                  isCompactAgenda ? "px-0 pt-1 pb-0.5" : "px-0.5 sm:px-1 pt-1.5 pb-1"
                }`}
                style={{
                  minHeight: dayHeaderBasePx,
                  opacity: isPastDay ? 0.75 : 1,
                  backgroundColor: GCAL_AGENDA_CANVAS,
                }}
              >
                <div className={`flex flex-col items-center ${isCompactAgenda ? "gap-0" : "gap-0.5"}`}>
                  <span
                    className={`font-medium uppercase text-white/50 tracking-wide ${
                      isCompactAgenda ? "text-[8px]" : "text-[9px] sm:text-[10px]"
                    }`}
                  >
                    {chip.weekday}
                  </span>
                  <span
                    className={`font-semibold leading-none flex items-center justify-center ${
                      isCompactAgenda ? "text-xs" : "text-sm sm:text-base"
                    } ${
                      today
                        ? isCompactAgenda
                          ? "h-5 w-5 rounded-full bg-[#8ab4f8] text-[#202124]"
                          : "h-7 w-7 rounded-full bg-[#8ab4f8] text-[#202124]"
                        : "text-white/85"
                    }`}
                  >
                    {chip.dayNum}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Bandeau all-day : barres continues type Google (ex. Vacance Annecy) */}
          <div
            className="sticky z-30 border-b border-r border-white/[0.08]"
            style={{
              top: dayHeaderBasePx,
              height: allDayLaneHeightPx,
              backgroundColor: GCAL_AGENDA_CANVAS,
            }}
            aria-hidden={maxAllDayRows === 0}
          />
          <div
            className="sticky z-30 border-b border-white/[0.08] relative"
            style={{
              gridColumn: `2 / span ${weekDates.length}`,
              top: dayHeaderBasePx,
              height: allDayLaneHeightPx,
              backgroundColor: GCAL_AGENDA_CANVAS,
            }}
          >
            {allDaySpanLayout.spans.map((span) => {
              const n = weekDates.length;
              const leftPct = (span.startCol / n) * 100;
              const widthPct = ((span.endCol - span.startCol + 1) / n) * 100;
              const radiusLeft = span.continuesBefore ? 0 : 4;
              const radiusRight = span.continuesAfter ? 0 : 4;
              const isAllDayPast = isAgendaAllDaySpanPast(
                weekDates.map((d) => d.iso),
                span.startCol,
                span.endCol,
                todayIsoStr,
              );
              const barStyle = {
                left: `calc(${leftPct}% + 1px)`,
                width: `calc(${widthPct}% - 2px)`,
                top: span.row * ALL_DAY_ROW_PX + 1,
                height: ALL_DAY_ROW_PX - 2,
                borderTopLeftRadius: radiusLeft,
                borderBottomLeftRadius: radiusLeft,
                borderTopRightRadius: radiusRight,
                borderBottomRightRadius: radiusRight,
              } as const;
              const textCls = isCompactAgenda
                ? "text-[8px] px-0.5"
                : "text-[9px] sm:text-[10px] px-1";

              if (span.event.kind === "extra") {
                const ex = span.event.occurrence;
                const extraPalette = isAllDayPast
                  ? googleAgendaPastEventStyle(
                      {
                        bg: "#f59e0b",
                        border: "#f59e0b",
                        text: "#ffffff",
                      },
                      0.68,
                    )
                  : {
                      bg: "rgba(245, 158, 11, 0.88)",
                      border: "rgba(253, 230, 138, 0.35)",
                      text: "#ffffff",
                    };
                return (
                  <div
                    key={`allday-span-${span.eventId}`}
                    onPointerDown={(e) => {
                      if (hideMealCards) return;
                      onCardPointerDown(e, {
                        kind: "extra",
                        occurrenceKey: ex.occurrenceKey,
                        startMinutes: resolveAgendaMinutesForExtra(
                          ex.occurrenceKey,
                          ex.slot,
                          extraAgendaTimes,
                        ),
                      });
                    }}
                    className={`absolute flex items-center overflow-hidden font-semibold truncate border ${textCls} ${
                      hideMealCards
                        ? "pointer-events-none"
                        : "cursor-grab active:cursor-grabbing pointer-events-auto"
                    } ${
                      draggingKey ===
                      payloadKey({ kind: "extra", occurrenceKey: ex.occurrenceKey })
                        ? "opacity-35"
                        : ""
                    }`}
                    style={{
                      ...barStyle,
                      backgroundColor: extraPalette.bg,
                      borderColor: extraPalette.border,
                      color: extraPalette.text,
                      zIndex: 2,
                    }}
                    title={
                      ex.slot === "extra"
                        ? `⭐ ${ex.label} (journée — glisse pour horodater)`
                        : `⭐ ${ex.label} · ${ex.slot} (journée — glisse pour horodater)`
                    }
                  >
                    <span
                      className={isAllDayPast ? "opacity-40 grayscale" : undefined}
                      aria-hidden
                    >
                      ⭐
                    </span>{" "}
                    {span.summary}
                  </div>
                );
              }

              const ev = span.event.google;
              const palette = googleAgendaEventStyle(
                ev.backgroundColor,
                ev.foregroundColor,
                ev.colorId,
                ev.calendarColorId,
                ev.colorSource,
              );
              const displayPalette = isAllDayPast
                ? googleAgendaPastEventStyle(palette)
                : palette;
              return (
                <div
                  key={`allday-span-${span.eventId}`}
                  className={`absolute flex items-center overflow-hidden font-semibold truncate pointer-events-none ${textCls}`}
                  style={{
                    ...barStyle,
                    backgroundColor: displayPalette.bg,
                    color: displayPalette.text,
                  }}
                  title={span.summary}
                >
                  {span.summary}
                </div>
              );
            })}
          </div>

          {/* Colonne heures */}
          <div className="relative border-r border-white/[0.08]" style={{ height: gridHeightPx }}>
            {hours.map((h) =>
              h === 0 ? null : (
                <div
                  key={h}
                  className={`absolute left-0 right-0 text-white/40 pr-1 text-right ${
                    isCompactAgenda ? "text-[8px]" : "text-[9px] sm:text-[10px] pr-1.5"
                  }`}
                  style={{ top: (h - AGENDA_HOUR_START) * hourHeightPx - 7 }}
                >
                  {isCompactAgenda ? `${h}` : `${String(h).padStart(2, "0")}:00`}
                </div>
              ),
            )}
          </div>

          {weekDates.map((day) => {
            const today = isToday(parseISO(day.iso));
            const isPastDay = day.iso < todayIsoStr;
            return (
              <div
                key={`col-${day.iso}`}
                ref={(el) => {
                  columnRefs.current[day.iso] = el;
                }}
                data-agenda-day={day.iso}
                className={`relative border-r border-white/[0.06] last:border-r-0 overflow-hidden ${
                  dragOverDay === day.iso && !hideMealCards ? "bg-white/[0.03]" : ""
                } ${isPastDay ? "opacity-90" : ""}`}
                style={{ height: gridHeightPx }}
              >
                {hours.map((h) => (
                  <div
                    key={`${day.iso}-line-${h}`}
                    className="absolute left-0 right-0 border-t border-white/[0.06] pointer-events-none"
                    style={{ top: (h - AGENDA_HOUR_START) * hourHeightPx }}
                  />
                ))}

                {today && nowMinutes >= AGENDA_HOUR_START * 60 && nowMinutes < AGENDA_HOUR_END * 60 ? (
                  <div
                    className="absolute left-0 right-0 z-[40] pointer-events-none flex items-center"
                    style={{ top: nowTop }}
                  >
                    <div className="h-2.5 w-2.5 -ml-1 rounded-full bg-[#f28b82] shrink-0" />
                    <div className="h-[2px] flex-1 bg-[#f28b82]" />
                  </div>
                ) : null}

                {(laidOutGoogleByDay[day.iso] || []).map((ev) => {
                  const dayEvents = laidOutGoogleByDay[day.iso] || [];
                  const clusterBlocks = dayEvents.filter((e) => e.clusterId === ev.clusterId);
                    const palette = googleAgendaEventStyle(
                      ev.backgroundColor,
                      ev.foregroundColor,
                      ev.colorId,
                      ev.calendarColorId,
                      ev.colorSource,
                    );
                  const startClock = formatAgendaClock(ev.startMin);
                  const endClock = formatAgendaClock(ev.startMin + ev.durationMin);
                  const eventPast = isAgendaEventPast(
                    day.iso,
                    todayIsoStr,
                    ev.endMin,
                    nowMinutes,
                  );
                  const displayPalette = eventPast
                    ? googleAgendaPastEventStyle(palette)
                    : palette;
                  const timeLayout = agendaTimeLayout(ev.durationMin, hourHeightPx);
                  const endClockTopPx = hostEndClockTopPx(ev, clusterBlocks, hourHeightPx);
                  const pos = blockStyle(ev.startMin, ev.durationMin, hourHeightPx);
                  const geom = agendaOverlapGeometryForBlock(
                    ev,
                    clusterBlocks,
                    hourHeightPx,
                    dayColumnWidthPx,
                  );
                  const isShortEvent = ev.durationMin <= SHORT_EVENT_MAX_MIN;
                  /** Invité < 15 min avant la fin → heure repositionnée (marge réduite / au-dessus). */
                  const endClockRepositioned = endClockTopPx != null;
                  /** Style Google : titre + début à gauche quand une carte chevauche à droite. */
                  const googleStackLeft =
                    timeLayout === "thin" &&
                    ev.col === 0 &&
                    ev.colCount > 1 &&
                    !isShortEvent;
                  const guestContentWidthPx = (dayColumnWidthPx * geom.widthPct) / 100;
                  const eventBlockHeightPxEarly = Math.max(
                    4,
                    (Math.max(5, ev.durationMin) / 60) * hourHeightPx - 1,
                  );
                  const thinTitleWrapEarly =
                    timeLayout === "thin" &&
                    !isShortEvent &&
                    eventBlockHeightPxEarly >= (isCompactAgenda ? 14 : 22);
                  /** Peu de place → titre seul ; sinon horaires même si le titre est tronqué. */
                  const hasRoomForTimes = agendaCardHasRoomForTimes(
                    eventBlockHeightPxEarly,
                    guestContentWidthPx,
                    ev.durationMin,
                    isCompactAgenda,
                    ev.summary ?? "",
                  );
                  const edgePx = isCompactAgenda ? 1 : 2;
                  /** Borne le titre hôte pour qu’il ne passe pas sous l’invité. */
                  const titleMaxWidthPct = hostTitleTextMaxWidthPct(
                    ev,
                    clusterBlocks,
                    geom,
                    hourHeightPx,
                    dayColumnWidthPx,
                  );
                  // Hôte fin en débord : pas d’horaires ; invité : selon largeur (≥ 50 %)
                  // sauf overflow sur hôte fin (Pain + fuet) → titre gauche prioritaire
                  const hideTimesForHalfOverflow =
                    titleMaxWidthPct != null &&
                    ev.col === 0 &&
                    (timeLayout === "thin" || isShortEvent);
                  const hideTimesForNarrowGuest = ev.col > 0 && geom.widthPct < 50;
                  const hideTimesForThinHostGuest = guestHidesTimesForThinHostTitle(
                    ev,
                    clusterBlocks,
                    hourHeightPx,
                  );
                  const showEventTimes =
                    hasRoomForTimes &&
                    !hideTimesForHalfOverflow &&
                    !hideTimesForNarrowGuest &&
                    !hideTimesForThinHostGuest;
                  const titleClampStyle =
                    titleMaxWidthPct != null
                      ? { maxWidth: `${titleMaxWidthPct}%` }
                      : undefined;
                  /** Wrap titre hôte selon largeur colonne / besoin de l’invité. */
                  const sideGuest = clusterBlocks.find(
                    (g) => g.id !== ev.id && g.col > ev.col && g.clusterId === ev.clusterId,
                  );
                  const sideGuestGeom =
                    sideGuest != null
                      ? agendaOverlapGeometryForBlock(
                          sideGuest,
                          clusterBlocks,
                          hourHeightPx,
                          dayColumnWidthPx,
                        )
                      : null;
                  const sideGuestShowsTimes =
                    sideGuest != null &&
                    sideGuestGeom != null &&
                    !guestHidesTimesForThinHostTitle(sideGuest, clusterBlocks, hourHeightPx) &&
                    guestCardShowsTimes(
                      sideGuest.summary ?? "",
                      (dayColumnWidthPx * sideGuestGeom.widthPct) / 100,
                    );
                  const wrapHostTitleForGuest =
                    ev.col === 0 &&
                    titleMaxWidthPct != null &&
                    sideGuest != null &&
                    hostShouldWrapTitleForGuest(
                      ev.summary ?? "",
                      sideGuest.summary ?? "",
                      dayColumnWidthPx,
                      sideGuestShowsTimes,
                    );
                  // Jamais forcer 1 ligne si la hauteur permet le wrap (évite « Balade Ana… »)
                  const titleMaxLines =
                    timeLayout === "tall"
                      ? agendaTitleMaxLines(ev.durationMin, hourHeightPx)
                      : 1;
                  /** Invité à droite : wrap du titre hôte dans la zone gauche (pas truncate). */
                  const hostTitleLines =
                    titleMaxWidthPct != null && sideGuest != null
                      ? Math.max(2, titleMaxLines)
                      : titleMaxLines;
                  const eventBlockHeightPx = eventBlockHeightPxEarly;
                  /** Cartes fines assez hautes : wrap du titre + horaires en dessous. */
                  const thinTitleWrap = thinTitleWrapEarly;
                  const thinTitleLines = thinTitleWrap
                    ? titleMaxWidthPct != null && !wrapHostTitleForGuest
                      ? 1
                      : Math.min(3, Math.max(2, Math.floor(eventBlockHeightPx / 11)))
                    : 1;
                  /** Compact : wrap aussi pour 50/50 (googleStackLeft) style Agenda mobile. */
                  const compactTitleLines =
                    timeLayout === "tall"
                      ? hostTitleLines
                      : thinTitleWrap || googleStackLeft
                        ? Math.min(3, Math.max(2, Math.floor(eventBlockHeightPx / 11)))
                        : titleMaxWidthPct != null && sideGuest != null
                          ? 2
                          : 1;
                  return (
                    <div
                      key={`gcal-${ev.id}`}
                      className={`absolute overflow-hidden pointer-events-none ${
                        timeLayout === "thin" && !thinTitleWrap && !googleStackLeft
                          ? "flex items-center"
                          : ""
                      } ${
                        isCompactAgenda
                          ? isShortEvent
                            ? "rounded-[3px] px-px py-0 text-[7px] leading-none"
                            : timeLayout === "thin" && !thinTitleWrap
                              ? "rounded-[3px] px-px py-0 text-[8px] leading-none"
                              : "rounded-[4px] px-0.5 py-px text-[8px]"
                          : isShortEvent
                            ? "rounded-[4px] px-0.5 py-0 text-[7px] sm:text-[8px] leading-none"
                            : timeLayout === "thin" && !thinTitleWrap
                              ? // >15 min fine : titre +1 px vs créneaux ≤15 min
                                "rounded-[4px] px-0.5 py-0 text-[8px] sm:text-[9px] leading-none"
                              : "rounded-[4px] px-0.5 sm:px-1 py-px text-[9px] sm:text-[10px]"
                      }`}
                      style={{
                        top: pos.top,
                        height: pos.height,
                        left: `calc(${geom.leftPct}% + ${ev.col > 0 ? 0 : 0}px)`,
                        width: `calc(${geom.widthPct}% - ${edgePx}px)`,
                        backgroundColor: displayPalette.bg,
                        color: displayPalette.text,
                        // Sous les repas (z-30+) ; pointer-events-none laisse le drag repas
                        zIndex: 20 + geom.zIndex,
                        boxShadow: ev.col > 0 ? "-2px 0 6px rgba(0,0,0,0.18)" : undefined,
                      }}
                      title={`${ev.summary} · ${startClock} – ${endClock}`}
                    >
                      <AgendaEventCardContent
                        summary={ev.summary}
                        startClock={startClock}
                        endClock={endClock}
                        timeLayout={timeLayout}
                        isShortEvent={isShortEvent}
                        showEventTimes={showEventTimes}
                        endClockTopPx={endClockTopPx}
                        endClockRepositioned={endClockRepositioned}
                        titleMaxLines={isCompactAgenda ? compactTitleLines : hostTitleLines}
                        titleClampStyle={titleClampStyle}
                        thinTitleWrap={thinTitleWrap}
                        thinTitleLines={isCompactAgenda ? compactTitleLines : thinTitleLines}
                        googleStackLeft={googleStackLeft}
                        isCompact={isCompactAgenda}
                      />
                    </div>
                  );
                })}

                {!hideMealCards &&
                  (() => {
                    const dayLaidOut = laidOutGoogleByDay[day.iso] || [];
                    const dayMeals = mealsByDay[day.iso] || [];
                    const dayExtras = extrasByDay[day.iso] || [];
                    const gouterMeals = dayMeals.filter((pm) => pm.meal_time === "gouter");
                    const gouterExtras = dayExtras.filter((ex) => ex.slot === "gouter");
                    const gouterMode = resolveGouterAgendaMode(
                      gouterMeals.length,
                      gouterExtras.length,
                    );
                    const nonGouterMeals = dayMeals.filter((pm) => pm.meal_time !== "gouter");
                    const mangerAlignments = assignMealsToMangerEvents(
                      nonGouterMeals,
                      dayLaidOut.map((ev) => ({
                        id: ev.id,
                        summary: ev.summary ?? "",
                        startMin: ev.startMin,
                        durationMin: ev.durationMin,
                        reminderMinutesBefore:
                          ev.reminderMinutesBefore ??
                          resolveReminderMinutesBefore(ev.reminders) ??
                          null,
                        col: ev.col,
                        colCount: ev.colCount,
                        clusterId: ev.clusterId,
                      })),
                    );

                    /**
                     * Rend une carte repas (une seule). Extras du créneau → pastilles
                     * uniquement sur la 1re carte du créneau.
                     */
                    const renderMealCard = (pm: PossibleMeal, opts?: { chips?: MealCardChip[] }) => {
                      const alignment = mangerAlignments.get(pm.id);
                      const minutes =
                        alignment?.startMin ??
                        resolveAgendaMinutesForMeal(pm.id, pm.meal_time, agendaTimes);
                      let durationMin =
                        alignment?.durationMin ?? AGENDA_EVENT_DURATION_MIN;
                      const onManger = alignment != null;
                      // Hors « Manger » : toujours 1 h (pas d’agrandissement selon les extras)
                      if (!onManger) {
                        durationMin = AGENDA_EVENT_DURATION_MIN;
                      }
                      const slotKey = pm.meal_time;
                      let chips = opts?.chips;
                      if (chips == null) {
                        const mealsOfSlot = slotKey
                          ? dayMeals
                              .filter((m) => m.meal_time === slotKey)
                              .sort((a, b) => a.id.localeCompare(b.id))
                          : [];
                        const isPrimaryOfSlot = mealsOfSlot[0]?.id === pm.id;
                        const slotExtrasForChips =
                          isPrimaryOfSlot && slotKey
                            ? dayExtras.filter(
                                (ex) =>
                                  ex.slot === slotKey &&
                                  !hasExtraAgendaCustomTime(
                                    ex.occurrenceKey,
                                    extraAgendaTimes,
                                  ),
                              )
                            : [];
                        chips = groupExtrasAsChips(slotExtrasForChips);
                      }
                      const mealPast = isAgendaEventPast(
                        day.iso,
                        todayIsoStr,
                        minutes + durationMin,
                        nowMinutes,
                      );
                      // Passé : marron un peu plus sombre ; à venir : teinte pleine
                      const mealBg = mealPast
                        ? mixCssColorTowardCanvas(
                            AGENDA_MEAL_CARD_COLOR,
                            MEAL_PAST_BG_TOWARD_CANVAS,
                          )
                        : AGENDA_MEAL_CARD_COLOR;
                      const pos = blockStyle(minutes, durationMin, hourHeightPx);
                      let leftStyle: string | undefined;
                      let widthStyle: string | undefined;
                      let zIndex = MEAL_CARD_Z_INDEX;
                      if (onManger && alignment) {
                        const clusterBlocks = dayLaidOut.filter(
                          (e) => e.clusterId === alignment.clusterId,
                        );
                        const hostEv = dayLaidOut.find((e) => e.id === alignment.eventId);
                        if (hostEv) {
                          const geom = agendaOverlapGeometryForBlock(
                            hostEv,
                            clusterBlocks,
                            hourHeightPx,
                            dayColumnWidthPx,
                          );
                          const edgePx = isCompactAgenda ? 1 : 2;
                          leftStyle = `calc(${geom.leftPct}% + 0px)`;
                          widthStyle = `calc(${geom.widthPct}% - ${edgePx}px)`;
                          zIndex = MEAL_CARD_Z_INDEX + geom.zIndex;
                        }
                      }
                      const cardTitle = `${getCategoryEmoji(pm.meals?.category)} ${pm.meals?.name || "Repas"}`;
                      return (
                        <div
                          key={`meal-${pm.id}`}
                          onPointerDown={(e) =>
                            onCardPointerDown(e, {
                              kind: "meal",
                              pmId: pm.id,
                              startMinutes: minutes,
                            })
                          }
                          className={`absolute flex flex-col rounded-md cursor-grab active:cursor-grabbing overflow-hidden select-none ${
                            isCompactAgenda ? "px-px py-px" : "px-0.5 py-px"
                          } ${mealPast ? MEAL_CARD_BORDER_PAST : MEAL_CARD_BORDER_UPCOMING} ${
                            onManger ? "" : "left-px right-px"
                          } ${
                            draggingKey === payloadKey({ kind: "meal", pmId: pm.id })
                              ? "opacity-35"
                              : ""
                          }`}
                          style={{
                            top: pos.top,
                            height: pos.height,
                            zIndex,
                            ...(onManger && leftStyle != null
                              ? { left: leftStyle, width: widthStyle }
                              : {}),
                            backgroundColor: onManger
                              ? opaqueMealColorMatchingTransparency(mealBg)
                              : withCssAlpha(mealBg, MEAL_CARD_BG_ALPHA),
                          }}
                          title={
                            onManger
                              ? `${pm.meals?.name || "Repas"} · ${formatAgendaClock(minutes)} (${durationMin} min, sur Manger)`
                              : `${pm.meals?.name || "Repas"} · ${formatAgendaClock(minutes)}`
                          }
                        >
                          <AgendaMealCardBody
                            title={cardTitle}
                            timeLabel={formatAgendaClock(minutes)}
                            chips={chips}
                            mealPast={mealPast}
                            compact={isCompactAgenda}
                            cardHeightPx={Math.max(
                              0,
                              agendaBlockHeightPx(durationMin, hourHeightPx) - 2,
                            )}
                          />
                        </div>
                      );
                    };

                    /**
                     * Carte unique pour plusieurs repas au même créneau / même heure :
                     * titre « Hachis parmentier, Pot #4 ».
                     */
                    const renderGroupedMealCard = (group: PossibleMeal[]) => {
                      const ordered = sortMealsForAgendaTitle(group);
                      const firstPm = ordered[0];
                      if (!firstPm) return null;
                      if (ordered.length === 1) return renderMealCard(firstPm);

                      const alignment = mangerAlignments.get(firstPm.id);
                      const minutes =
                        alignment?.startMin ??
                        resolveAgendaMinutesForMeal(firstPm.id, firstPm.meal_time, agendaTimes);
                      let durationMin =
                        alignment?.durationMin ?? AGENDA_EVENT_DURATION_MIN;
                      const onManger = alignment != null;
                      if (!onManger) durationMin = AGENDA_EVENT_DURATION_MIN;

                      const slotKey = firstPm.meal_time;
                      const mealsOfSlot = slotKey
                        ? dayMeals
                            .filter((m) => m.meal_time === slotKey)
                            .sort((a, b) => a.id.localeCompare(b.id))
                        : [];
                      const primaryId = mealsOfSlot[0]?.id;
                      const showChips = Boolean(primaryId && group.some((m) => m.id === primaryId));
                      const chips = showChips && slotKey
                        ? groupExtrasAsChips(
                            dayExtras.filter(
                              (ex) =>
                                ex.slot === slotKey &&
                                !hasExtraAgendaCustomTime(ex.occurrenceKey, extraAgendaTimes),
                            ),
                          )
                        : [];

                      const mealPast = isAgendaEventPast(
                        day.iso,
                        todayIsoStr,
                        minutes + durationMin,
                        nowMinutes,
                      );
                      const mealBg = mealPast
                        ? mixCssColorTowardCanvas(
                            AGENDA_MEAL_CARD_COLOR,
                            MEAL_PAST_BG_TOWARD_CANVAS,
                          )
                        : AGENDA_MEAL_CARD_COLOR;
                      const pos = blockStyle(minutes, durationMin, hourHeightPx);
                      let leftStyle: string | undefined;
                      let widthStyle: string | undefined;
                      let zIndex = MEAL_CARD_Z_INDEX;
                      if (onManger && alignment) {
                        const clusterBlocks = dayLaidOut.filter(
                          (e) => e.clusterId === alignment.clusterId,
                        );
                        const hostEv = dayLaidOut.find((e) => e.id === alignment.eventId);
                        if (hostEv) {
                          const geom = agendaOverlapGeometryForBlock(
                            hostEv,
                            clusterBlocks,
                            hourHeightPx,
                            dayColumnWidthPx,
                          );
                          const edgePx = isCompactAgenda ? 1 : 2;
                          leftStyle = `calc(${geom.leftPct}% + 0px)`;
                          widthStyle = `calc(${geom.widthPct}% - ${edgePx}px)`;
                          zIndex = MEAL_CARD_Z_INDEX + geom.zIndex;
                        }
                      }

                      const combinedTitle = formatGroupedMealAgendaTitle(ordered);
                      const groupKey = ordered.map((m) => m.id).join("+");

                      return (
                        <div
                          key={`meal-group-${groupKey}`}
                          onPointerDown={(e) =>
                            onCardPointerDown(e, {
                              kind: "meal",
                              pmId: firstPm.id,
                              startMinutes: minutes,
                            })
                          }
                          className={`absolute flex flex-col rounded-md cursor-grab active:cursor-grabbing overflow-hidden select-none ${
                            isCompactAgenda ? "px-px py-px" : "px-0.5 py-px"
                          } ${mealPast ? MEAL_CARD_BORDER_PAST : MEAL_CARD_BORDER_UPCOMING} ${
                            onManger ? "" : "left-px right-px"
                          } ${
                            draggingKey === payloadKey({ kind: "meal", pmId: firstPm.id })
                              ? "opacity-35"
                              : ""
                          }`}
                          style={{
                            top: pos.top,
                            height: pos.height,
                            zIndex,
                            ...(onManger && leftStyle != null
                              ? { left: leftStyle, width: widthStyle }
                              : {}),
                            backgroundColor: onManger
                              ? opaqueMealColorMatchingTransparency(mealBg)
                              : withCssAlpha(mealBg, MEAL_CARD_BG_ALPHA),
                          }}
                          title={`${combinedTitle} · ${formatAgendaClock(minutes)}`}
                        >
                          <AgendaMealCardBody
                            title={combinedTitle}
                            timeLabel={formatAgendaClock(minutes)}
                            chips={chips}
                            mealPast={mealPast}
                            compact={isCompactAgenda}
                            cardHeightPx={Math.max(
                              0,
                              agendaBlockHeightPx(durationMin, hourHeightPx) - 2,
                            )}
                          />
                        </div>
                      );
                    };

                    /**
                     * Regroupe les repas par créneau Planning (matin/midi/soir/goûter) :
                     * plusieurs cartes du même slot → une seule carte agenda combinée,
                     * même si les heures individuelles diffèrent (évite le chevauchement).
                     */
                    const renderMealsGrouped = (meals: PossibleMeal[]) => {
                      const buckets = new Map<string, PossibleMeal[]>();
                      for (const pm of meals) {
                        const key = pm.meal_time || "_";
                        const list = buckets.get(key) ?? [];
                        list.push(pm);
                        buckets.set(key, list);
                      }
                      const out: ReactNode[] = [];
                      for (const group of buckets.values()) {
                        out.push(renderGroupedMealCard(group));
                      }
                      return out;
                    };

                    /** Carte synthétique « Goûter » (extras seuls, sans repas). */
                    const renderGouterExtrasOnlyCard = () => {
                      const minutes = resolveAgendaMinutesForExtra(
                        gouterExtras[0]?.occurrenceKey ?? "gouter",
                        "gouter",
                        extraAgendaTimes,
                      );
                      const chips = groupExtrasAsChips(gouterExtras);
                      const durationMin = AGENDA_EVENT_DURATION_MIN;
                      const mealPast = isAgendaEventPast(
                        day.iso,
                        todayIsoStr,
                        minutes + durationMin,
                        nowMinutes,
                      );
                      const mealBg = mealPast
                        ? mixCssColorTowardCanvas(
                            AGENDA_MEAL_CARD_COLOR,
                            MEAL_PAST_BG_TOWARD_CANVAS,
                          )
                        : AGENDA_MEAL_CARD_COLOR;
                      const pos = blockStyle(minutes, durationMin, hourHeightPx);
                      const occurrenceKeys = gouterExtras.map((ex) => ex.occurrenceKey);

                      return (
                        <div
                          key={`gouter-extras-${day.iso}`}
                          onPointerDown={(e) =>
                            onCardPointerDown(e, {
                              kind: "gouter-extras",
                              occurrenceKeys,
                              startMinutes: minutes,
                            })
                          }
                          className={`absolute left-px right-px flex flex-col rounded-md cursor-grab active:cursor-grabbing overflow-hidden select-none ${
                            isCompactAgenda ? "px-px py-px" : "px-0.5 py-px"
                          } ${mealPast ? MEAL_CARD_BORDER_PAST : MEAL_CARD_BORDER_UPCOMING} ${
                            draggingKey ===
                            payloadKey({ kind: "gouter-extras", occurrenceKeys })
                              ? "opacity-35"
                              : ""
                          }`}
                          style={{
                            top: pos.top,
                            height: pos.height,
                            zIndex: MEAL_CARD_Z_INDEX,
                            backgroundColor: withCssAlpha(mealBg, MEAL_CARD_BG_ALPHA),
                          }}
                          title={`⭐ Goûter · ${formatAgendaClock(minutes)}`}
                        >
                          <AgendaMealCardBody
                            title="⭐ Goûter"
                            timeLabel={formatAgendaClock(minutes)}
                            chips={chips}
                            mealPast={mealPast}
                            compact={isCompactAgenda}
                            cardHeightPx={Math.max(
                              0,
                              agendaBlockHeightPx(durationMin, hourHeightPx) - 2,
                            )}
                          />
                        </div>
                      );
                    };

                    const nodes: ReactNode[] = [];

                    // Repas goûter : cartes groupées si plusieurs au même horaire
                    if (gouterMode === "meals-only" || gouterMode === "combined") {
                      nodes.push(...renderMealsGrouped(gouterMeals));
                    }
                    // Extras goûter seuls → carte « Goûter » déplaçable
                    if (gouterMode === "extras-only") {
                      nodes.push(renderGouterExtrasOnlyCard());
                    }
                    nodes.push(...renderMealsGrouped(nonGouterMeals));

                    return nodes;
                  })()}

                {!hideMealCards &&
                  (extrasByDay[day.iso] || [])
                    .filter((ex) => {
                      // Goûter sans repas → carte « Goûter » ; avec repas → pastilles (sauf heure perso)
                      if (ex.slot === "gouter") {
                        const hasGouterMeal = (mealsByDay[day.iso] || []).some(
                          (pm) => pm.meal_time === "gouter",
                        );
                        if (!hasGouterMeal) return false;
                        if (!hasExtraAgendaCustomTime(ex.occurrenceKey, extraAgendaTimes)) {
                          return false;
                        }
                        return true;
                      }
                      // matin/midi/soir sans heure perso : pastille sur la carte repas
                      if (
                        (ex.slot === "matin" ||
                          ex.slot === "midi" ||
                          ex.slot === "soir") &&
                        !hasExtraAgendaCustomTime(ex.occurrenceKey, extraAgendaTimes)
                      ) {
                        return !(mealsByDay[day.iso] || []).some(
                          (pm) => pm.meal_time === ex.slot,
                        );
                      }
                      return hasExtraAgendaCustomTime(ex.occurrenceKey, extraAgendaTimes);
                    })
                    .map((ex) => {
                    const minutes = resolveAgendaMinutesForExtra(
                      ex.occurrenceKey,
                      ex.slot,
                      extraAgendaTimes,
                    );
                    const extraPast = isAgendaEventPast(
                      day.iso,
                      todayIsoStr,
                      minutes + 30,
                      nowMinutes,
                    );
                    return (
                      <div
                        key={ex.occurrenceKey}
                        onPointerDown={(e) =>
                          onCardPointerDown(e, {
                            kind: "extra",
                            occurrenceKey: ex.occurrenceKey,
                            startMinutes: minutes,
                          })
                        }
                        className={`absolute left-0.5 right-0.5 z-10 rounded-md px-1 sm:px-1.5 py-1 cursor-grab active:cursor-grabbing border border-amber-300/40 bg-amber-500/85 overflow-hidden shadow-md select-none ${
                          draggingKey ===
                          payloadKey({ kind: "extra", occurrenceKey: ex.occurrenceKey })
                            ? "opacity-35"
                            : ""
                        }`}
                        style={{
                          ...blockStyle(minutes, 30, hourHeightPx),
                          opacity:
                            draggingKey ===
                            payloadKey({ kind: "extra", occurrenceKey: ex.occurrenceKey })
                              ? 0.35
                              : 0.92,
                          ...(extraPast
                            ? { backgroundColor: mixCssColorTowardCanvas("#f59e0b", 0.62) }
                            : {}),
                        }}
                        title={`${ex.label} · ${formatAgendaClock(minutes)}`}
                      >
                        <div
                          className={cn(
                            "font-bold text-white leading-tight truncate",
                            isCompactAgenda ? "text-[7px]" : "text-[9px] sm:text-[10px]",
                          )}
                        >
                          ⭐ {ex.label}
                        </div>
                        <div
                          className={cn(
                            "text-white/80 truncate",
                            isCompactAgenda ? "text-[6px]" : "text-[8px] sm:text-[9px]",
                          )}
                        >
                          <span data-agenda-drag-time>{formatAgendaClock(minutes)}</span>
                          {" · "}
                          {ex.slot}
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>

      {(needsReauth || eventsError) && connected && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
          <p className="text-[11px] text-amber-200 flex-1 min-w-0">
            {needsReauth
              ? "Le token Google a expiré — reconnecte Google Agenda pour afficher tes événements."
              : `Impossible de charger Google Agenda : ${eventsError}`}
          </p>
          {onReconnectGoogle && (
            <button
              type="button"
              onClick={onReconnectGoogle}
              className="shrink-0 text-[11px] font-semibold rounded-md bg-amber-500/90 hover:bg-amber-400 text-black px-2.5 py-1"
            >
              Reconnecter Google
            </button>
          )}
        </div>
      )}

      {!connected && (
        <p className="text-[11px] text-muted-foreground px-1 mt-2">
          Sans connexion Google, tu peux déjà déplacer tes repas et extras ; le fond d’agenda
          apparaîtra après connexion (lecture seule).
        </p>
      )}
    </div>
  );
}

/** Réexporte le helper de clé pour les callers WeeklyPlanning. */
export { buildExtraAgendaOccurrenceKey };
