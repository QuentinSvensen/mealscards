/**
 * Placement des événements Google Agenda sur les jours de la semaine vue
 * (all-day multi-jours, fin exclusive Google, horaires qui traversent minuit).
 */

export type GoogleEventPlacement = {
  dayIso: string;
  startMin: number;
  durationMin: number;
  isAllDay: boolean;
};

/** Ajoute N jours à une date ISO (yyyy-MM-dd), midi local pour éviter les décalages DST. */
export function addDaysToIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Liste les jours [startIso, endExclusiveIso[ (fin exclusive, convention Google all-day).
 */
export function eachIsoDayUntilExclusive(startIso: string, endExclusiveIso: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso)) return [];
  let endEx = endExclusiveIso;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endEx) || endEx <= startIso) {
    endEx = addDaysToIsoDate(startIso, 1);
  }
  const out: string[] = [];
  for (let cur = startIso; cur < endEx; cur = addDaysToIsoDate(cur, 1)) {
    out.push(cur);
    if (out.length > 400) break;
  }
  return out;
}

/** Formate une Date locale en yyyy-MM-dd. */
function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Étale un événement Google sur tous les jours de la semaine affichés qu’il chevauche.
 * All-day : end est exclusif (8→11 août = 8, 9, 10).
 * Horaire multi-jours : une barre par jour (début/fin coupés à minuit).
 */
export function expandGoogleEventPlacements(
  start: string,
  end: string,
  allDay: boolean,
  weekIsoSet: Set<string>,
  defaultTimedDurationMin: number = 60,
): GoogleEventPlacement[] {
  if (!start) return [];

  if (allDay) {
    const startIso = start.slice(0, 10);
    const endExclusive = (end || "").slice(0, 10);
    return eachIsoDayUntilExclusive(startIso, endExclusive)
      .filter((iso) => weekIsoSet.has(iso))
      .map((dayIso) => ({
        dayIso,
        startMin: 0,
        durationMin: 0,
        isAllDay: true,
      }));
  }

  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return [];
  const endDate = new Date(end || start);
  const endValid = !Number.isNaN(endDate.getTime());
  const rangeEnd = endValid ? endDate : new Date(startDate.getTime() + defaultTimedDurationMin * 60_000);

  // Si fin ≤ début, durée minimale 1 min
  if (rangeEnd.getTime() <= startDate.getTime()) {
    rangeEnd.setTime(startDate.getTime() + 60_000);
  }

  const firstIso = toLocalIsoDate(startDate);
  const lastIso = toLocalIsoDate(
    // Si finit pile à minuit, le dernier jour « actif » est la veille
    rangeEnd.getHours() === 0 && rangeEnd.getMinutes() === 0 && rangeEnd.getSeconds() === 0
      ? new Date(rangeEnd.getTime() - 1)
      : rangeEnd,
  );

  const dayIsos = eachIsoDayUntilExclusive(firstIso, addDaysToIsoDate(lastIso, 1));
  const placements: GoogleEventPlacement[] = [];

  for (const dayIso of dayIsos) {
    if (!weekIsoSet.has(dayIso)) continue;

    const dayStart = new Date(`${dayIso}T00:00:00`);
    const dayEnd = addDaysToIsoDate(dayIso, 1);
    const dayEndDate = new Date(`${dayEnd}T00:00:00`);

    const segStart = new Date(Math.max(startDate.getTime(), dayStart.getTime()));
    const segEnd = new Date(Math.min(rangeEnd.getTime(), dayEndDate.getTime()));
    if (segEnd.getTime() <= segStart.getTime()) continue;

    const startMin = segStart.getHours() * 60 + segStart.getMinutes();
    const durationMin = Math.max(1, Math.round((segEnd.getTime() - segStart.getTime()) / 60_000));
    placements.push({
      dayIso,
      startMin,
      durationMin,
      isAllDay: false,
    });
  }

  return placements;
}

export type AllDaySpanLayout<T = unknown> = {
  eventId: string;
  summary: string;
  /** Index colonne début (0 = 1er jour de la semaine vue). */
  startCol: number;
  /** Index colonne fin inclus. */
  endCol: number;
  /** Rangée dans le bandeau all-day. */
  row: number;
  /** L’événement continue avant le 1er jour affiché. */
  continuesBefore: boolean;
  /** L’événement continue après le dernier jour affiché. */
  continuesAfter: boolean;
  event: T;
};

/**
 * Dispose les all-day en barres continues (style Google Agenda) :
 * une seule bande qui traverse plusieurs colonnes, empilée sur des rangées.
 */
export function layoutAllDaySpans<
  T extends { id: string; summary: string; start: string; end: string; allDay: boolean },
>(
  events: T[],
  weekIsos: string[],
  shouldSkipSummary?: (summary: string) => boolean,
): { spans: AllDaySpanLayout<T>[]; rowCount: number } {
  if (weekIsos.length === 0) return { spans: [], rowCount: 0 };
  const weekSet = new Set(weekIsos);
  const weekStart = weekIsos[0];
  const weekEndExclusive = addDaysToIsoDate(weekIsos[weekIsos.length - 1], 1);

  type Candidate = {
    event: T;
    startCol: number;
    endCol: number;
    continuesBefore: boolean;
    continuesAfter: boolean;
  };

  const candidates: Candidate[] = [];
  for (const ev of events) {
    if (!ev.allDay) continue;
    if (shouldSkipSummary?.(ev.summary ?? "")) continue;
    const days = expandGoogleEventPlacements(ev.start, ev.end, true, weekSet);
    if (days.length === 0) continue;
    const cols = days
      .map((d) => weekIsos.indexOf(d.dayIso))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (cols.length === 0) continue;

    const startIso = ev.start.slice(0, 10);
    let endExclusive = (ev.end || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endExclusive) || endExclusive <= startIso) {
      endExclusive = addDaysToIsoDate(startIso, 1);
    }

    candidates.push({
      event: ev,
      startCol: cols[0],
      endCol: cols[cols.length - 1],
      continuesBefore: startIso < weekStart,
      continuesAfter: endExclusive > weekEndExclusive,
    });
  }

  // Début tôt d’abord, puis les plus longs (comme Agenda)
  candidates.sort(
    (a, b) =>
      a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol),
  );

  const rowOccupancy: Array<Array<{ startCol: number; endCol: number }>> = [];
  const spans: AllDaySpanLayout<T>[] = [];

  for (const c of candidates) {
    let row = 0;
    for (; row < rowOccupancy.length; row++) {
      const conflict = rowOccupancy[row].some(
        (o) => !(c.endCol < o.startCol || c.startCol > o.endCol),
      );
      if (!conflict) break;
    }
    if (row === rowOccupancy.length) rowOccupancy.push([]);
    rowOccupancy[row].push({ startCol: c.startCol, endCol: c.endCol });
    spans.push({
      eventId: c.event.id,
      summary: c.event.summary,
      startCol: c.startCol,
      endCol: c.endCol,
      row,
      continuesBefore: c.continuesBefore,
      continuesAfter: c.continuesAfter,
      event: c.event,
    });
  }

  return { spans, rowCount: rowOccupancy.length };
}
