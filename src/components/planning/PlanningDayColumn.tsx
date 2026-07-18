import type { ReactNode, Ref } from "react";

export interface PlanningDayColumnProps {
  dayIso: string;
  display: string;
  isToday: boolean;
  columnRef?: Ref<HTMLDivElement>;
  /** Bloc gauche du header (sélecteur petit-déj, manuels, 💾…). */
  breakfastBlock: ReactNode;
  /** Bandeau objectifs kcal / prot / fibres. */
  goalsBar: ReactNode;
  /** Grille midi/soir + colonne Extra. */
  mainGrid: ReactNode;
  /** Bande goûter sous la grille. */
  gouterBand: ReactNode;
}

/**
 * Coquille visuelle d’une journée de la semaine courante :
 * header (petit-déj + objectifs), grille principale, bande goûter.
 * Les handlers restent injectés via les enfants (anti-closures).
 */
export function PlanningDayColumn({
  dayIso,
  display,
  isToday,
  columnRef,
  breakfastBlock,
  goalsBar,
  mainGrid,
  gouterBand,
}: PlanningDayColumnProps) {
  return (
    <div
      ref={columnRef}
      data-day-iso={dayIso}
      className={`rounded-2xl p-2 sm:p-4 transition-all ${isToday ? "bg-primary/10 ring-2 ring-primary/40" : "bg-card/80 backdrop-blur-sm"}`}
    >
      <div className="flex items-start gap-2 mb-2 flex-wrap">
        <h3
          className={`text-sm sm:text-base font-bold flex items-center gap-2 ${isToday ? "text-primary" : "text-foreground"}`}
        >
          {display}
          {isToday && (
            <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-semibold">
              Aujourd'hui
            </span>
          )}
        </h3>
        {breakfastBlock}
        <div className="flex-1" />
        {goalsBar}
      </div>
      {mainGrid}
      {gouterBand}
    </div>
  );
}
