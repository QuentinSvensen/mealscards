/**
 * Vue Planning « Google Agenda » : grille horaire hebdo style Google Calendar
 * en légère transparence, avec cartes repas/extras déplaçables synchronisées.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
  isCompactAgendaColumn,
  offsetYToAgendaMinutes,
  resolveAgendaMinutesForExtra,
  resolveAgendaMinutesForMeal,
} from "@/domain/planning/agendaTimeUtils";
import { expandGoogleEventPlacements, layoutAllDaySpans } from "@/domain/planning/googleEventPlacement";
import { GCAL_AGENDA_CANVAS, googleAgendaEventStyle } from "@/domain/planning/googleAgendaColors";
import {
  layoutOverlappingBlocks,
  agendaOverlapGeometryForBlock,
  hostEndClockTopPx,
  hostTitleTextMaxWidthPct,
  HOST_END_CLOCK_BOTTOM_PAD_PX,
  hostShouldWrapTitleForGuest,
  guestCardShowsTimes,
  agendaCardHasRoomForTimes,
} from "@/domain/planning/agendaOverlapLayout";
import type { ExtraDaySlot } from "@/domain/planning/extraSlotOps";

const TOTAL_HOURS = AGENDA_HOUR_END - AGENDA_HOUR_START;
/** Largeur colonne horaires (desktop). */
const TIME_COL_PX = 44;
/** Largeur colonne horaires (mobile compact). */
const TIME_COL_COMPACT_PX = 32;
/** Hauteur minimale d’une heure (px) pour garder les titres lisibles. */
const MIN_HOUR_HEIGHT_PX = 40;
/** Hauteur minimale d’heure en mode compact (densité Agenda mobile). */
const MIN_HOUR_HEIGHT_COMPACT_PX = 32;
/** Hauteur sticky jours (sans all-day) — chip + paddings réels. */
const DAY_HEADER_BASE_PX = 58;
/** Hauteur sticky jours compacte. */
const DAY_HEADER_BASE_COMPACT_PX = 48;
/** Hauteur d’une ligne all-day. */
const ALL_DAY_ROW_PX = 18;
/** Opacité des events passés (jours précédents ou déjà finis aujourd’hui). */
const PAST_EVENT_OPACITY = 0.4;
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
  slot: ExtraDaySlot;
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
 * Facteur d’opacité : jours passés, ou créneaux déjà terminés aujourd’hui (au-dessus du trait rouge).
 */
function agendaPastEventFade(
  dayIso: string,
  todayIso: string,
  eventEndMin: number,
  nowMin: number,
): number {
  if (dayIso < todayIso) return PAST_EVENT_OPACITY;
  if (dayIso === todayIso && eventEndMin <= nowMin) return PAST_EVENT_OPACITY;
  return 1;
}

/**
 * Opacité des barres all-day : jours passés, ou événement « journée » uniquement aujourd’hui.
 * Les plages multi-jours encore en cours (Vacance…) restent normales.
 */
function agendaAllDaySpanFade(
  weekIsos: string[],
  startCol: number,
  endCol: number,
  todayIso: string,
): number {
  const firstDay = weekIsos[startCol];
  const lastDay = weekIsos[endCol];
  if (!firstDay || !lastDay) return 1;
  if (lastDay < todayIso) return PAST_EVENT_OPACITY;
  if (firstDay === todayIso && lastDay === todayIso) return PAST_EVENT_OPACITY;
  return 1;
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
  const minHourHeightPx = isCompactAgenda ? MIN_HOUR_HEIGHT_COMPACT_PX : MIN_HOUR_HEIGHT_PX;
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

  /** Barres all-day continues (style Google : un trait sur plusieurs jours). */
  const allDaySpanLayout = useMemo(
    () =>
      layoutAllDaySpans(
        googleEvents,
        weekDates.map((d) => d.iso),
        isGoogleWeekNumberLabel,
      ),
    [googleEvents, weekDates],
  );

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

  // Hauteur d’heure : 7h→23h59 tient pile dans le viewport (scroll haut = avant 7h).
  useEffect(() => {
    const available =
      agendaViewportHeightPx - stickyHeaderHeightPx - VISIBLE_RANGE_FUDGE_PX;
    const next = Math.max(
      minHourHeightPx,
      available / AGENDA_DEFAULT_VISIBLE_HOURS,
    );
    setHourHeightPx(next);
  }, [agendaViewportHeightPx, stickyHeaderHeightPx, minHourHeightPx]);

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

  const googleOpacity = 1;
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
              const ev = span.event;
              const palette = googleAgendaEventStyle(
                ev.backgroundColor,
                ev.foregroundColor,
                ev.colorId,
                ev.calendarColorId,
                ev.colorSource,
              );
              const n = weekDates.length;
              const leftPct = (span.startCol / n) * 100;
              const widthPct = ((span.endCol - span.startCol + 1) / n) * 100;
              const radiusLeft = span.continuesBefore ? 0 : 4;
              const radiusRight = span.continuesAfter ? 0 : 4;
              const allDayFade = agendaAllDaySpanFade(
                weekDates.map((d) => d.iso),
                span.startCol,
                span.endCol,
                todayIsoStr,
              );
              return (
                <div
                  key={`allday-span-${span.eventId}`}
                  className={`absolute flex items-center overflow-hidden font-semibold truncate pointer-events-none ${
                    isCompactAgenda ? "text-[8px] px-0.5" : "text-[9px] sm:text-[10px] px-1"
                  }`}
                  style={{
                    left: `calc(${leftPct}% + 1px)`,
                    width: `calc(${widthPct}% - 2px)`,
                    top: span.row * ALL_DAY_ROW_PX + 1,
                    height: ALL_DAY_ROW_PX - 2,
                    backgroundColor: palette.bg,
                    color: palette.text,
                    opacity: googleOpacity * allDayFade,
                    borderTopLeftRadius: radiusLeft,
                    borderBottomLeftRadius: radiusLeft,
                    borderTopRightRadius: radiusRight,
                    borderBottomRightRadius: radiusRight,
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
                    className="absolute left-0 right-0 z-[5] pointer-events-none flex items-center"
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
                  const eventFade = agendaPastEventFade(
                    day.iso,
                    todayIsoStr,
                    ev.endMin,
                    nowMinutes,
                  );
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
                  // Hôte « déborde à moitié » (invité à droite) → pas d’horaires, place au titre
                  const showEventTimes = hasRoomForTimes && titleMaxWidthPct == null;
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
                        backgroundColor: palette.bg,
                        color: palette.text,
                        opacity: googleOpacity * eventFade,
                        // Au-dessus des repas/extras (z-10) ; pointer-events-none laisse le drag repas
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
                  (mealsByDay[day.iso] || []).map((pm) => {
                    const minutes = resolveAgendaMinutesForMeal(pm.id, pm.meal_time, agendaTimes);
                    const colorIngredients = pm.meals?.ingredients?.trim()
                      ? pm.meals.ingredients
                      : pm.ingredients_override;
                    const color = getMealColor(colorIngredients ?? null, pm.meals?.name || "Repas");
                    const mealFade = agendaPastEventFade(
                      day.iso,
                      todayIsoStr,
                      minutes + AGENDA_EVENT_DURATION_MIN,
                      nowMinutes,
                    );
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
                        className="absolute left-0.5 right-0.5 z-10 rounded-md px-1 sm:px-1.5 py-1 cursor-grab active:cursor-grabbing shadow-md border border-white/25 overflow-hidden"
                        style={{
                          ...blockStyle(minutes, AGENDA_EVENT_DURATION_MIN, hourHeightPx),
                          backgroundColor: color,
                          opacity: 0.92 * mealFade,
                        }}
                        title={`${pm.meals?.name || "Repas"} · ${formatAgendaClock(minutes)}`}
                      >
                        <div className="text-[9px] sm:text-[10px] font-bold text-white/95 leading-tight truncate">
                          {getCategoryEmoji(pm.meals?.category)} {pm.meals?.name || "Repas"}
                        </div>
                        <div className="text-[8px] sm:text-[9px] text-white/75">
                          {formatAgendaClock(minutes)} · {pm.meal_time}
                        </div>
                      </div>
                    );
                  })}

                {!hideMealCards &&
                  (extrasByDay[day.iso] || []).map((ex) => {
                    const minutes = resolveAgendaMinutesForExtra(
                      ex.occurrenceKey,
                      ex.slot,
                      extraAgendaTimes,
                    );
                    const extraFade = agendaPastEventFade(
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
                        style={{ ...blockStyle(minutes, 30, hourHeightPx), opacity: 0.92 * extraFade }}
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
