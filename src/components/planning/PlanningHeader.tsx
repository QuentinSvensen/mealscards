import { Eye, EyeOff, Flame, Loader2 } from "lucide-react";

export interface PlanningHeaderBackupTotals {
  archivedDailyGoal: number;
  archivedDailyGoalLow: number;
  archivedProteinGoal: number;
  archivedFiberGoal: number;
}

export type PlanningViewMode = "week" | "google-agenda";

export interface PlanningHeaderProps {
  weekOffset: number;
  onWeekOffsetChange: (offset: number) => void;
  /** Mode d’affichage : grille semaine classique ou vue Google Agenda. */
  planningMode: PlanningViewMode;
  /** Bascule entre grille semaine et sous-onglet Google Agenda. */
  onPlanningModeChange: (mode: PlanningViewMode) => void;
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
  /** Masquer les cartes repas sur la vue agenda (checkbox). */
  hideMealCards?: boolean;
  onHideMealCardsChange?: (hide: boolean) => void;
  /** Statut connexion Google Agenda (lecture seule). */
  googleAgendaConnected?: boolean;
  googleAgendaStatusLoading?: boolean;
  googleAgendaEventsLoading?: boolean;
  googleAgendaConnecting?: boolean;
  googleAgendaDisconnecting?: boolean;
  onGoogleAgendaConnect?: () => void;
  onGoogleAgendaDisconnect?: () => void;
}

/** Barre supérieure du planning : reset, restauration, objectifs globaux, navigation de semaine. */
export function PlanningHeader({
  weekOffset,
  onWeekOffsetChange,
  planningMode,
  onPlanningModeChange,
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
  hideMealCards = false,
  onHideMealCardsChange,
  googleAgendaConnected = false,
  googleAgendaStatusLoading = false,
  googleAgendaEventsLoading = false,
  googleAgendaConnecting = false,
  googleAgendaDisconnecting = false,
  onGoogleAgendaConnect,
  onGoogleAgendaDisconnect,
}: PlanningHeaderProps) {
  // Borne basse affichée selon la semaine (courante ou suivante).
  const displayedGoalLow = weekOffset === 1 ? nextDailyGoalLow : dailyGoalLow;
  const weekTabActive = planningMode === "week";
  const agendaTabActive = planningMode === "google-agenda";
  /** Passe en grille semaine classique avec le décalage demandé. */
  const selectWeekOffset = (offset: number) => {
    onPlanningModeChange("week");
    onWeekOffsetChange(offset);
  };
  return (
    <div className="rounded-xl bg-card/80 backdrop-blur-sm px-2.5 py-1 flex items-center gap-2 flex-wrap">
      {weekOffset === 0 && weekTabActive && (
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
      {((weekOffset === 0 || weekOffset === 1) && weekTabActive) && (
        <>
          <div className="flex w-full sm:w-auto items-center gap-0.5 sm:gap-1 flex-nowrap justify-start">
            <Flame className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-orange-500 shrink-0" />
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
              className="w-12 sm:w-14 h-5 sm:h-6 text-[11px] sm:text-xs bg-transparent border border-dashed border-orange-300/20 rounded px-0.5 sm:px-1 text-orange-500/80 placeholder:text-orange-300/30 focus:outline-none focus:border-orange-400/50 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[8px] sm:text-[9px] text-orange-400/50 shrink-0">–</span>
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
              className="w-12 sm:w-16 h-5 sm:h-6 text-[11px] sm:text-xs bg-transparent border border-dashed border-orange-300/30 rounded px-0.5 sm:px-1 text-orange-500 focus:outline-none focus:border-orange-400/50 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[8px] sm:text-[9px] text-muted-foreground shrink-0 whitespace-nowrap">kcal/j</span>
            <span className="text-[10px] sm:text-xs shrink-0 ml-0.5">🍗</span>
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
              className="w-10 sm:w-14 h-5 sm:h-6 text-[11px] sm:text-xs bg-transparent border border-dashed border-blue-400/20 rounded px-0.5 sm:px-1 text-blue-400 focus:outline-none focus:border-blue-400/50 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[8px] sm:text-[9px] text-muted-foreground shrink-0 whitespace-nowrap">prot/j</span>
            <span className="text-[10px] sm:text-xs shrink-0 ml-0.5">🌾</span>
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
              className="w-9 sm:w-14 h-5 sm:h-6 text-[11px] sm:text-xs bg-transparent border border-dashed border-emerald-400/20 rounded px-0.5 sm:px-1 text-emerald-400 focus:outline-none focus:border-emerald-400/50 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[8px] sm:text-[9px] text-muted-foreground shrink-0 whitespace-nowrap">fib/j</span>
          </div>
        </>
      )}
      {weekOffset === -1 && weekTabActive && backupTotals && (
        <>
          <div className="flex w-full sm:w-auto items-center gap-0.5 sm:gap-1 flex-nowrap justify-start">
            <Flame className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-orange-500 shrink-0" />
            {backupTotals.archivedDailyGoalLow > 0 && (
              <>
                <div className="w-12 sm:w-14 h-5 sm:h-6 text-[11px] sm:text-xs bg-transparent border border-dashed border-orange-300/20 rounded px-0.5 sm:px-1 text-orange-500/80 flex items-center justify-center font-bold">
                  {Math.round(backupTotals.archivedDailyGoalLow)}
                </div>
                <span className="text-[8px] sm:text-[9px] text-orange-400/50 shrink-0">–</span>
              </>
            )}
            <div className="w-12 sm:w-16 h-5 sm:h-6 text-[11px] sm:text-xs bg-transparent border border-dashed border-orange-300/30 rounded px-0.5 sm:px-1 text-orange-500 flex items-center justify-center font-bold">
              {Math.round(backupTotals.archivedDailyGoal)}
            </div>
            <span className="text-[8px] sm:text-[9px] text-muted-foreground shrink-0 whitespace-nowrap">kcal/j</span>
            <span className="text-[10px] sm:text-xs shrink-0 ml-0.5">🍗</span>
            <div className="w-10 sm:w-14 h-5 sm:h-6 text-[11px] sm:text-xs bg-transparent border border-dashed border-blue-400/20 rounded px-0.5 sm:px-1 text-blue-400 flex items-center justify-center font-bold">
              {Math.round(backupTotals.archivedProteinGoal)}
            </div>
            <span className="text-[8px] sm:text-[9px] text-muted-foreground shrink-0 whitespace-nowrap">prot/j</span>
            <span className="text-[10px] sm:text-xs shrink-0 ml-0.5">🌾</span>
            <div className="w-9 sm:w-14 h-5 sm:h-6 text-[11px] sm:text-xs bg-transparent border border-dashed border-emerald-400/20 rounded px-0.5 sm:px-1 text-emerald-400 flex items-center justify-center font-bold">
              {Math.round(backupTotals.archivedFiberGoal)}
            </div>
            <span className="text-[8px] sm:text-[9px] text-muted-foreground shrink-0 whitespace-nowrap">fib/j</span>
          </div>
        </>
      )}
      {agendaTabActive && (
        <div className="flex items-center gap-2 flex-wrap">
          {googleAgendaStatusLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : googleAgendaConnected ? (
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-[10px] font-medium text-emerald-500">Connecté</span>
              {googleAgendaEventsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : null}
              <button
                type="button"
                disabled={googleAgendaDisconnecting}
                onClick={() => onGoogleAgendaDisconnect?.()}
                className="text-xs font-semibold bg-muted hover:bg-muted/80 text-foreground rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {googleAgendaDisconnecting ? "…" : "Déconnecter"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={googleAgendaConnecting}
              onClick={() => onGoogleAgendaConnect?.()}
              className="text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
            >
              {googleAgendaConnecting ? "Redirection…" : "Connecter Google"}
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5 ml-auto">
        {agendaTabActive && (
          <button
            type="button"
            role="switch"
            aria-checked={hideMealCards}
            onClick={() => onHideMealCardsChange?.(!hideMealCards)}
            title={hideMealCards ? "Afficher les repas" : "Masquer les repas"}
            className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-full text-[10px] font-bold transition-all border ${
              hideMealCards
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/80"
            }`}
          >
            {hideMealCards ? (
              <EyeOff className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
            ) : (
              <Eye className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            )}
            <span className="whitespace-nowrap">Masquer les repas</span>
          </button>
        )}
        <div className="flex items-center bg-muted/50 rounded-full p-0.5">
          <button
            type="button"
            onClick={() => selectWeekOffset(-1)}
            className={`h-7 px-2.5 flex items-center justify-center rounded-full text-[10px] font-bold transition-all ${weekTabActive && weekOffset === -1 ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
          >
            ◀ Préc.
          </button>
          <span className="mx-0.5 h-3.5 w-px shrink-0 bg-white/20" aria-hidden />
          <button
            type="button"
            onClick={() => selectWeekOffset(0)}
            className={`h-7 px-3 flex items-center justify-center rounded-full text-[10px] font-bold transition-all ${weekTabActive && weekOffset === 0 ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
          >
            Actuelle
          </button>
          <span className="mx-0.5 h-3.5 w-px shrink-0 bg-white/20" aria-hidden />
          <button
            type="button"
            onClick={() => selectWeekOffset(1)}
            className={`h-7 px-2.5 flex items-center justify-center rounded-full text-[10px] font-bold transition-all ${weekTabActive && weekOffset === 1 ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
          >
            Suiv. ▶
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            onPlanningModeChange("google-agenda");
            onWeekOffsetChange(0);
          }}
          className={`h-7 px-2.5 flex items-center justify-center rounded-full text-[10px] font-bold transition-all ${planningMode === "google-agenda" ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
        >
          Google Agenda
        </button>
      </div>
    </div>
  );
}
