import { Flame, Loader2 } from "lucide-react";

export interface PlanningHeaderBackupTotals {
  archivedDailyGoal: number;
  archivedDailyGoalLow: number;
  archivedProteinGoal: number;
}

export interface PlanningHeaderProps {
  weekOffset: number;
  onWeekOffsetChange: (offset: number) => void;
  manualResetBusy: boolean;
  onManualReset: () => void;
  restoreBusy: boolean;
  onRestoreBackup: () => void;
  dailyGoal: number;
  dailyGoalLow: number;
  nextDailyGoal: number;
  nextDailyGoalLow: number;
  dailyProteinGoal: number;
  nextProteinGoal: number;
  dailyFiberGoal: number;
  nextFiberGoal: number;
  onGlobalCalBlur: (value: number) => void;
  onGlobalCalLowBlur: (value: number) => void;
  onGlobalProtBlur: (value: number) => void;
  onGlobalFiberBlur: (value: number) => void;
  backupTotals: PlanningHeaderBackupTotals | null;
}

/** Barre supérieure du planning : reset, restauration, objectifs globaux, navigation de semaine. */
export function PlanningHeader({
  weekOffset,
  onWeekOffsetChange,
  manualResetBusy,
  onManualReset,
  restoreBusy,
  onRestoreBackup,
  dailyGoal,
  dailyGoalLow,
  nextDailyGoal,
  nextDailyGoalLow,
  dailyProteinGoal,
  nextProteinGoal,
  dailyFiberGoal,
  nextFiberGoal,
  onGlobalCalBlur,
  onGlobalCalLowBlur,
  onGlobalProtBlur,
  onGlobalFiberBlur,
  backupTotals,
}: PlanningHeaderProps) {
  // Borne basse affichée selon la semaine (courante ou suivante).
  const displayedGoalLow = weekOffset === 1 ? nextDailyGoalLow : dailyGoalLow;
  return (
    <div className="rounded-2xl bg-card/80 backdrop-blur-sm p-3 flex items-center gap-3 flex-wrap">
      {weekOffset === 0 && (
        <>
          <button
            type="button"
            disabled={manualResetBusy}
            onClick={onManualReset}
            className="text-xs font-semibold bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            {manualResetBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            🔄 Reset
          </button>
          <button
            type="button"
            disabled={restoreBusy}
            onClick={onRestoreBackup}
            className="text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            {restoreBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            ↩ Restaurer
          </button>
        </>
      )}
      {(weekOffset === 0 || weekOffset === 1) && (
        <>
          <div className="flex items-center gap-1">
            <Flame className="h-3 w-3 text-orange-500" />
            <input
              type="number"
              inputMode="numeric"
              defaultValue={displayedGoalLow > 0 ? displayedGoalLow : ""}
              key={`global-cal-low-${displayedGoalLow}`}
              placeholder="min"
              title="Borne basse de la fourchette (optionnelle)"
              onBlur={e => {
                const raw = e.target.value.trim();
                onGlobalCalLowBlur(raw === "" ? 0 : parseInt(raw));
              }}
              onKeyDown={e => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-14 h-6 text-xs bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-500/80 placeholder:text-orange-300/30 focus:outline-none focus:border-orange-400/50 text-center"
            />
            <span className="text-[9px] text-orange-400/50">–</span>
            <input
              type="number"
              inputMode="numeric"
              defaultValue={weekOffset === 1 ? nextDailyGoal : dailyGoal}
              key={`global-cal-${weekOffset === 1 ? nextDailyGoal : dailyGoal}`}
              title="Borne haute de la fourchette (cible des calories restantes)"
              onBlur={e => {
                const val = parseInt(e.target.value);
                if (val && val > 0) onGlobalCalBlur(val);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-16 h-6 text-xs bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 focus:outline-none focus:border-orange-400/50 text-center"
            />
            <span className="text-[9px] text-muted-foreground">kcal/j</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs">🍗</span>
            <input
              type="number"
              inputMode="numeric"
              defaultValue={weekOffset === 1 ? nextProteinGoal : dailyProteinGoal}
              key={`global-prot-${weekOffset === 1 ? nextProteinGoal : dailyProteinGoal}`}
              onBlur={e => {
                const val = parseInt(e.target.value);
                if (val && val > 0) onGlobalProtBlur(val);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-14 h-6 text-xs bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 focus:outline-none focus:border-blue-400/50 text-center"
            />
            <span className="text-[9px] text-muted-foreground">prot/j</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs">🌾</span>
            <input
              type="number"
              inputMode="numeric"
              defaultValue={weekOffset === 1 ? nextFiberGoal : dailyFiberGoal}
              key={`global-fiber-${weekOffset === 1 ? nextFiberGoal : dailyFiberGoal}`}
              onBlur={e => {
                const val = parseInt(e.target.value);
                if (val && val > 0) onGlobalFiberBlur(val);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-14 h-6 text-xs bg-transparent border border-dashed border-emerald-400/20 rounded px-1 text-emerald-400 focus:outline-none focus:border-emerald-400/50 text-center"
            />
            <span className="text-[9px] text-muted-foreground">fib/j</span>
          </div>
        </>
      )}
      {weekOffset === -1 && backupTotals && (
        <>
          <div className="flex items-center gap-1">
            <Flame className="h-3 w-3 text-orange-500" />
            {backupTotals.archivedDailyGoalLow > 0 && (
              <>
                <div className="w-14 h-6 text-xs bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-500/80 flex items-center justify-center font-bold">
                  {Math.round(backupTotals.archivedDailyGoalLow)}
                </div>
                <span className="text-[9px] text-orange-400/50">–</span>
              </>
            )}
            <div className="w-16 h-6 text-xs bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 flex items-center justify-center font-bold">
              {Math.round(backupTotals.archivedDailyGoal)}
            </div>
            <span className="text-[9px] text-muted-foreground">kcal/j</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs">🍗</span>
            <div className="w-14 h-6 text-xs bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 flex items-center justify-center font-bold">
              {Math.round(backupTotals.archivedProteinGoal)}
            </div>
            <span className="text-[9px] text-muted-foreground">prot/j</span>
          </div>
        </>
      )}
      <div className="flex-1" />
      <div className="flex items-center bg-muted/50 rounded-full p-0.5 gap-0.5">
        <button
          type="button"
          onClick={() => onWeekOffsetChange(-1)}
          className={`h-7 px-2.5 flex items-center justify-center rounded-full text-[10px] font-bold transition-all ${weekOffset === -1 ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
        >
          ◀ Préc.
        </button>
        <button
          type="button"
          onClick={() => onWeekOffsetChange(0)}
          className={`h-7 px-3 flex items-center justify-center rounded-full text-[10px] font-bold transition-all ${weekOffset === 0 ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
        >
          Actuelle
        </button>
        <button
          type="button"
          onClick={() => onWeekOffsetChange(1)}
          className={`h-7 px-2.5 flex items-center justify-center rounded-full text-[10px] font-bold transition-all ${weekOffset === 1 ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
        >
          Suiv. ▶
        </button>
      </div>
    </div>
  );
}
