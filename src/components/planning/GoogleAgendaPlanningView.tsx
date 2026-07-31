/**
 * Vue Planning « Google Agenda » : grille horaire hebdo style Google Calendar
 * en légère transparence, avec cartes repas/extras déplaçables synchronisées.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format, parseISO, isToday } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PossibleMeal } from "@/hooks/useMeals";
import type { PlanningWeekDayInfo } from "@/lib/planningWeekUtils";
import type { GoogleCalendarEvent } from "@/hooks/useGoogleCalendar";
import { getMealColor } from "@/lib/ingredientUtils";
import { getCategoryEmoji } from "@/components/planning/PlanningMiniCard";
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
  offsetYToAgendaMinutes,
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
import type { ExtraDaySlot } from "@/domain/planning/extraSlotOps";

/** Alpha du fond des cartes repas hors « Manger » (laisse lire les events dessous). */
const MEAL_CARD_BG_ALPHA = 0.48;
/** z-index de base des repas (au-dessus des events Google ≈ 20+). */
const MEAL_CARD_Z_INDEX = 30;
/** Couleur de fond de la carte synthétique « Goûter ». */
const GOUTER_CARD_COLOR = "#c2783f";

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

/** Hauteur (px) sous laquelle titre + heure ne tiennent plus empilés → heure à droite. */
const MEAL_CARD_STACK_MIN_HEIGHT_PX = 28;

/** Tailles de pastilles extras (du plus grand au plus petit). */
const CHIP_TIER_CLASS = [
  "text-[6px] px-0.5 py-0 leading-[1.2]",
  "text-[8px] px-1 py-0 leading-tight",
  "text-[9px] sm:text-[10px] px-1 py-px leading-tight",
] as const;

/**
 * Contenu d’une carte repas / goûter agenda.
 * Les bords de la carte sont des « murs » : titres complets (wrap), extras plus gros,
 * et réduction progressive des pastilles seulement s’il n’y a plus assez de place.
 */
function AgendaMealCardBody({
  title,
  timeLabel,
  chips = [],
  mealPast,
  cardHeightPx,
}: {
  title: string;
  timeLabel: string;
  chips?: MealCardChip[];
  mealPast: boolean;
  /** Hauteur utile de la carte (px) pour choisir le layout. */
  cardHeightPx?: number;
}) {
  const hasChips = chips.length > 0;
  const rootRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [chipTier, setChipTier] = useState(2); // 2 = grand, 0 = mini
  const [chipsFit, setChipsFit] = useState(true);

  const titleCls = `text-[9px] sm:text-[10px] font-bold leading-tight drop-shadow-sm break-words ${
    mealPast ? "text-white/80" : "text-white"
  }`;
  const timeCls = `text-[8px] sm:text-[9px] font-semibold leading-tight drop-shadow-sm shrink-0 ${
    mealPast ? "text-white/70" : "text-white"
  }`;
  const tooShortToStack =
    typeof cardHeightPx === "number" && cardHeightPx < MEAL_CARD_STACK_MIN_HEIGHT_PX;

  const chipsKey = chips.map((c) => `${c.id}:${c.count}:${c.label}`).join("|");

  // Remet le palier max quand le contenu change, puis re-mesure
  useLayoutEffect(() => {
    setChipTier(2);
    setChipsFit(true);
  }, [title, timeLabel, chipsKey, cardHeightPx]);

  /**
   * Hauteur naturelle du contenu extras (indépendante du justify-center / overflow).
   */
  const measureChipsContentHeight = (chipsEl: HTMLElement): number => {
    let h = 0;
    const children = chipsEl.children;
    for (let i = 0; i < children.length; i++) {
      h += (children[i] as HTMLElement).offsetHeight;
    }
    // gap-px ≈ 1px entre pastilles
    if (children.length > 1) h += children.length - 1;
    return h;
  };

  /**
   * Vérifie que les extras tiennent dans leur colonne (murs) ;
   * sinon baisse d’un palier de taille.
   */
  useLayoutEffect(() => {
    if (!hasChips) return;
    const chipsEl = chipsRef.current;
    const root = rootRef.current;
    if (!chipsEl || !root) return;

    const chipsOverflow =
      measureChipsContentHeight(chipsEl) > chipsEl.clientHeight + 1 ||
      chipsEl.scrollWidth > chipsEl.clientWidth + 1;
    const rootOverflow =
      root.scrollHeight > root.clientHeight + 1 ||
      root.scrollWidth > root.clientWidth + 1;

    if ((chipsOverflow || rootOverflow) && chipTier > 0) {
      setChipTier((t) => Math.max(0, t - 1));
      return;
    }
    setChipsFit(!chipsOverflow && !rootOverflow);
  }, [hasChips, chipTier, title, timeLabel, chipsKey, cardHeightPx]);

  useLayoutEffect(() => {
    if (!hasChips) return;
    const chipsEl = chipsRef.current;
    const root = rootRef.current;
    if (!chipsEl || !root) return;

    const check = () => {
      const chipsOverflow =
        measureChipsContentHeight(chipsEl) > chipsEl.clientHeight + 1 ||
        chipsEl.scrollWidth > chipsEl.clientWidth + 1;
      const rootOverflow =
        root.scrollHeight > root.clientHeight + 1 ||
        root.scrollWidth > root.clientWidth + 1;
      if ((chipsOverflow || rootOverflow) && chipTier > 0) {
        setChipTier((t) => Math.max(0, t - 1));
      } else {
        setChipsFit(!chipsOverflow && !rootOverflow);
      }
    };

    const ro = new ResizeObserver(check);
    ro.observe(root);
    ro.observe(chipsEl);
    return () => ro.disconnect();
  }, [hasChips, chipTier]);

  const chipEls = chips.map((chip) => {
    const label = chip.count > 1 ? `${chip.label} ×${chip.count}` : chip.label;
    return (
      <span
        key={chip.id}
        className={`inline-flex max-w-full rounded font-semibold bg-black/45 text-amber-100 border border-amber-200/35 drop-shadow-sm text-right ${CHIP_TIER_CLASS[chipTier]} ${
          chipTier === 0 ? "truncate" : "whitespace-normal break-words"
        }`}
        title={label}
      >
        {label}
      </span>
    );
  });

  if (hasChips) {
    return (
      <div ref={rootRef} className="flex h-full min-h-0 w-full gap-0.5 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col justify-start gap-px overflow-hidden">
          <div className={`min-w-0 ${titleCls}`}>{title}</div>
          <div className={timeCls}>{timeLabel}</div>
        </div>
        <div
          ref={chipsRef}
          className={`flex max-w-[58%] min-h-0 h-full shrink-0 flex-col items-end gap-px overflow-hidden ${
            chipsFit ? "justify-center" : "justify-start"
          }`}
        >
          {chipEls}
        </div>
      </div>
    );
  }

  if (tooShortToStack) {
    return (
      <div className="flex h-full min-h-0 w-full items-center gap-0.5 overflow-hidden">
        <div className={`min-w-0 flex-1 ${titleCls}`}>{title}</div>
        <div className={`max-w-[45%] shrink-0 text-right ${timeCls}`}>{timeLabel}</div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col justify-start gap-px overflow-hidden">
      <div className={`min-w-0 ${titleCls}`}>{title}</div>
      <div className={timeCls}>{timeLabel}</div>
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
  hideMealCards: boolean;
  onMoveMeal: (pmId: string, dayIso: string, dayKey: string, minutes: number) => void;
  onMoveExtra: (
    occurrence: AgendaExtraOccurrence,
    dayIso: string,
    dayKey: string,
    minutes: number,
  ) => void;
  /** Décalage de semaine (0 = semaine calendaire courante). */
  weekOffset?: number;
  /** Change la semaine affichée (offset relatif à la semaine courante). */
  onWeekOffsetChange?: (offset: number) => void;
}

type DragPayload =
  | { kind: "meal"; pmId: string }
  | { kind: "extra"; occurrenceKey: string };

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
    // Fin repositionnée (bande étroite sous invité) → début en bas, fin absolute
    const splitEndClock = showEventTimes && endClockRepositioned;

    return (
      <div className="relative flex h-full min-w-0 flex-col overflow-hidden">
        <div
          className={`min-w-0 font-semibold leading-[1.05] ${
            lines <= 1
              ? "truncate"
              : "break-words [overflow-wrap:anywhere] [word-break:break-word]"
          }`}
          style={{
            ...(titleClampStyle ?? {}),
            ...(lines > 1
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: showEventTimes ? Math.max(1, lines - 1) : lines,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }
              : {}),
            flex: "1 1 auto",
            minHeight: 0,
          }}
        >
          {summary}
        </div>
        {showEventTimes ? (
          splitEndClock ? (
            <>
              <div className={`mt-auto shrink-0 truncate ${clockClass}`}>{startClock}</div>
              <span className={endClockAbsClass} style={{ top: `${endClockTopPx}px` }}>
                {endClock}
              </span>
            </>
          ) : (
            <div className={`mt-auto shrink-0 truncate ${clockClass}`}>
              {startClock}
              <span className="opacity-50 mx-px">|</span>
              {endClock}
            </div>
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
  hideMealCards,
  onMoveMeal,
  onMoveExtra,
  weekOffset = 0,
  onWeekOffsetChange,
}: GoogleAgendaPlanningViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const dragPayloadRef = useRef<DragPayload | null>(null);
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

  /** Calcule le drop (jour + minutes) depuis la position Y dans la colonne. */
  const resolveDropTarget = (dayIso: string, clientY: number) => {
    const col = columnRefs.current[dayIso];
    if (!col) return null;
    const rect = col.getBoundingClientRect();
    const offsetY = clientY - rect.top;
    const minutes = offsetYToAgendaMinutes(offsetY, gridHeightPx);
    const day = weekDates.find((d) => d.iso === dayIso);
    if (!day) return null;
    return { dayIso, dayKey: day.key, minutes };
  };

  /** Gère le dépôt d’une carte repas ou d’un extra sur une colonne jour. */
  const handleColumnDrop = (e: React.DragEvent, dayIso: string) => {
    e.preventDefault();
    setDragOverDay(null);
    if (hideMealCards) return;
    const target = resolveDropTarget(dayIso, e.clientY);
    if (!target) return;

    const payload = dragPayloadRef.current;
    const pmId =
      e.dataTransfer.getData("pmId") ||
      e.dataTransfer.getData("application/x-planning-pmid") ||
      (payload?.kind === "meal" ? payload.pmId : "");
    if (pmId) {
      onMoveMeal(pmId, target.dayIso, target.dayKey, target.minutes);
      dragPayloadRef.current = null;
      return;
    }

    const occurrenceKey =
      e.dataTransfer.getData("application/x-agenda-extra") ||
      (payload?.kind === "extra" ? payload.occurrenceKey : "");
    if (occurrenceKey) {
      const occurrence = extras.find((x) => x.occurrenceKey === occurrenceKey);
      if (occurrence) {
        onMoveExtra(occurrence, target.dayIso, target.dayKey, target.minutes);
      }
    }
    dragPayloadRef.current = null;
  };

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
                    draggable={!hideMealCards}
                    onDragStart={(e) => {
                      if (hideMealCards) return;
                      dragPayloadRef.current = {
                        kind: "extra",
                        occurrenceKey: ex.occurrenceKey,
                      };
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData(
                        "application/x-agenda-extra",
                        ex.occurrenceKey,
                      );
                      e.dataTransfer.setData("text/plain", ex.extraId);
                    }}
                    onDragEnd={() => {
                      dragPayloadRef.current = null;
                      setDragOverDay(null);
                    }}
                    className={`absolute flex items-center overflow-hidden font-semibold truncate border ${textCls} ${
                      hideMealCards
                        ? "pointer-events-none"
                        : "cursor-grab active:cursor-grabbing pointer-events-auto"
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
                onDragOver={(e) => {
                  if (hideMealCards) return;
                  e.preventDefault();
                  setDragOverDay(day.iso);
                }}
                onDragLeave={() => setDragOverDay((cur) => (cur === day.iso ? null : cur))}
                onDrop={(e) => handleColumnDrop(e, day.iso)}
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

                    /** Rend une carte repas classique (hors goûter combiné). */
                    const renderMealCard = (pm: PossibleMeal) => {
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
                      // Extras du créneau (sans heure perso) → pastilles sur la 1re carte du créneau
                      const slotKey = pm.meal_time;
                      const mealsOfSlot = slotKey
                        ? nonGouterMeals
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
                      const chips = groupExtrasAsChips(slotExtrasForChips);
                      const colorIngredients = pm.meals?.ingredients?.trim()
                        ? pm.meals.ingredients
                        : pm.ingredients_override;
                      const color = getMealColor(
                        colorIngredients ?? null,
                        pm.meals?.name || "Repas",
                      );
                      const mealPast = isAgendaEventPast(
                        day.iso,
                        todayIsoStr,
                        minutes + durationMin,
                        nowMinutes,
                      );
                      const mealBg = mealPast
                        ? mixCssColorTowardCanvas(color, 0.7)
                        : color;
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
                      return (
                        <div
                          key={`meal-${pm.id}`}
                          draggable
                          onDragStart={(e) => {
                            dragPayloadRef.current = { kind: "meal", pmId: pm.id };
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("pmId", pm.id);
                            e.dataTransfer.setData("application/x-planning-pmid", pm.id);
                            e.dataTransfer.setData("mealId", pm.meal_id);
                          }}
                          onDragEnd={() => {
                            dragPayloadRef.current = null;
                            setDragOverDay(null);
                          }}
                          className={
                            onManger
                              ? "absolute flex flex-col rounded-md px-0.5 py-px cursor-grab active:cursor-grabbing border border-white/20 overflow-hidden"
                              : "absolute left-px right-px flex flex-col rounded-md px-0.5 py-px cursor-grab active:cursor-grabbing border border-white/20 overflow-hidden"
                          }
                          style={{
                            top: pos.top,
                            height: pos.height,
                            zIndex,
                            ...(onManger && leftStyle != null
                              ? { left: leftStyle, width: widthStyle }
                              : {}),
                            backgroundColor: onManger
                              ? mealBg
                              : withCssAlpha(mealBg, MEAL_CARD_BG_ALPHA),
                          }}
                          title={
                            onManger
                              ? `${pm.meals?.name || "Repas"} · ${formatAgendaClock(minutes)} (${durationMin} min, sur Manger)`
                              : `${pm.meals?.name || "Repas"} · ${formatAgendaClock(minutes)}`
                          }
                        >
                          <AgendaMealCardBody
                            title={`${getCategoryEmoji(pm.meals?.category)} ${pm.meals?.name || "Repas"}`}
                            timeLabel={formatAgendaClock(minutes)}
                            chips={chips}
                            mealPast={mealPast}
                            cardHeightPx={Math.max(
                              0,
                              agendaBlockHeightPx(durationMin, hourHeightPx) - 2,
                            )}
                          />
                        </div>
                      );
                    };

                    /** Carte synthétique « Goûter » (extras seuls ou repas + extras). */
                    const renderGouterCompositeCard = () => {
                      const anchorMeal = gouterMeals[0];
                      const minutes = anchorMeal
                        ? resolveAgendaMinutesForMeal(
                            anchorMeal.id,
                            "gouter",
                            agendaTimes,
                          )
                        : resolveAgendaMinutesForExtra(
                            gouterExtras[0]?.occurrenceKey ?? "gouter",
                            "gouter",
                            extraAgendaTimes,
                          );
                      const mealChips: MealCardChip[] =
                        gouterMode === "combined"
                          ? gouterMeals.map((pm) => ({
                              id: `meal-${pm.id}`,
                              label: pm.meals?.name || "Repas",
                              count: 1,
                            }))
                          : [];
                      const extraChips = groupExtrasAsChips(gouterExtras);
                      const chips = [...mealChips, ...extraChips];
                      // Goûter hors Manger : hauteur fixe 1 h
                      const durationMin = AGENDA_EVENT_DURATION_MIN;
                      const mealPast = isAgendaEventPast(
                        day.iso,
                        todayIsoStr,
                        minutes + durationMin,
                        nowMinutes,
                      );
                      const color = anchorMeal
                        ? getMealColor(
                            (anchorMeal.meals?.ingredients?.trim()
                              ? anchorMeal.meals.ingredients
                              : anchorMeal.ingredients_override) ?? null,
                            anchorMeal.meals?.name || "Goûter",
                          )
                        : GOUTER_CARD_COLOR;
                      const mealBg = mealPast
                        ? mixCssColorTowardCanvas(color, 0.7)
                        : color;
                      const pos = blockStyle(minutes, durationMin, hourHeightPx);

                      return (
                        <div
                          key={`gouter-composite-${day.iso}`}
                          draggable={Boolean(anchorMeal)}
                          onDragStart={
                            anchorMeal
                              ? (e) => {
                                  dragPayloadRef.current = {
                                    kind: "meal",
                                    pmId: anchorMeal.id,
                                  };
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("pmId", anchorMeal.id);
                                  e.dataTransfer.setData(
                                    "application/x-planning-pmid",
                                    anchorMeal.id,
                                  );
                                  e.dataTransfer.setData("mealId", anchorMeal.meal_id);
                                }
                              : undefined
                          }
                          onDragEnd={() => {
                            dragPayloadRef.current = null;
                            setDragOverDay(null);
                          }}
                          className={`absolute left-px right-px flex flex-col rounded-md px-0.5 py-px border border-white/25 overflow-hidden ${
                            anchorMeal
                              ? "cursor-grab active:cursor-grabbing"
                              : "cursor-default"
                          }`}
                          style={{
                            top: pos.top,
                            height: pos.height,
                            zIndex: MEAL_CARD_Z_INDEX,
                            backgroundColor: withCssAlpha(mealBg, MEAL_CARD_BG_ALPHA),
                          }}
                          title={`Goûter · ${formatAgendaClock(minutes)}`}
                        >
                          <AgendaMealCardBody
                            title="Goûter"
                            timeLabel={formatAgendaClock(minutes)}
                            chips={chips}
                            mealPast={mealPast}
                            cardHeightPx={Math.max(
                              0,
                              agendaBlockHeightPx(durationMin, hourHeightPx) - 2,
                            )}
                          />
                        </div>
                      );
                    };

                    const nodes: ReactNode[] = [];

                    if (gouterMode === "extras-only" || gouterMode === "combined") {
                      nodes.push(renderGouterCompositeCard());
                    }
                    if (gouterMode === "meals-only") {
                      for (const pm of gouterMeals) nodes.push(renderMealCard(pm));
                    }
                    for (const pm of nonGouterMeals) nodes.push(renderMealCard(pm));

                    return nodes;
                  })()}

                {!hideMealCards &&
                  (extrasByDay[day.iso] || [])
                    .filter((ex) => {
                      // Goûter : déjà sur la carte « Goûter »
                      if (ex.slot === "gouter") return false;
                      // matin/midi/soir sans heure perso : déjà pastille sur la carte repas
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
                        draggable
                        onDragStart={(e) => {
                          dragPayloadRef.current = { kind: "extra", occurrenceKey: ex.occurrenceKey };
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("application/x-agenda-extra", ex.occurrenceKey);
                          e.dataTransfer.setData("text/plain", ex.extraId);
                        }}
                        onDragEnd={() => {
                          dragPayloadRef.current = null;
                          setDragOverDay(null);
                        }}
                        className="absolute left-0.5 right-0.5 z-10 rounded-md px-1 sm:px-1.5 py-1 cursor-grab active:cursor-grabbing border border-amber-300/40 bg-amber-500/85 overflow-hidden shadow-md"
                        style={{
                          ...blockStyle(minutes, 30, hourHeightPx),
                          opacity: 0.92,
                          ...(extraPast
                            ? { backgroundColor: mixCssColorTowardCanvas("#f59e0b", 0.62) }
                            : {}),
                        }}
                        title={`${ex.label} · ${formatAgendaClock(minutes)}`}
                      >
                        <div className="text-[9px] sm:text-[10px] font-bold text-white leading-tight truncate">
                          ⭐ {ex.label}
                        </div>
                        <div className="text-[8px] sm:text-[9px] text-white/80">
                          {formatAgendaClock(minutes)} · {ex.slot}
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>

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
