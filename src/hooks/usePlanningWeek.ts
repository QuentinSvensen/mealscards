import { useMemo, useState } from "react";
import { format } from "date-fns";
import { buildWeekDates, type PlanningWeekDayInfo } from "@/lib/planningWeekUtils";

/**
 * État de navigation du planning : décalage de semaine, dates ISO par jour, date « aujourd’hui » figée au montage.
 * Offset -1 = vue sauvegarde, 0 = semaine courante, 1 = semaine suivante.
 */
export function usePlanningWeek() {
  const [weekOffset, setWeekOffset] = useState(0);

  const todayISO = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const weekDates: PlanningWeekDayInfo[] = useMemo(
    () => buildWeekDates(weekOffset, new Date()),
    [weekOffset]
  );

  return {
    weekOffset,
    setWeekOffset,
    weekDates,
    todayISO,
  };
}
