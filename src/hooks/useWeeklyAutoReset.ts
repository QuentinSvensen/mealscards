import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { fetchSnapshotsAndPrefsParallel } from "@/data/planning/planningResetRepository";
import { buildFullBackupPayload } from "@/domain/planning/buildBackupPayload";
import { enrichPrefMapForArchive } from "@/domain/planning/enrichPrefMapForArchive";
import { filterPossibleMealsForArchiveWeek } from "@/domain/planning/filterArchiveWeekMeals";
import { embedPlanningSnapshotsInBackup } from "@/domain/planning/embedPlanningSnapshotsInBackup";
import {
  buildUpdatedDailyCalorieHistory,
  PLANNING_DAILY_CALORIE_HISTORY_KEY,
} from "@/domain/planning/dailyCalorieHistory";
import { captureLiveWeekTotalsFromPrefMap } from "@/domain/planning/planningDayCalories";
import { asNumberRecord, asPlanningOverrideRecord, asStringArrayRecord } from "@/domain/planning/jsonCoerce";
import { parseBackupCalorieContext } from "@/domain/planning/rollingCalorieAverage";
import { filterPossibleMealsToDeleteForWeeklyClear } from "@/domain/planning/mealsToClear";
import { applyNextWeekPromotionOnTop } from "@/domain/planning/applyNextWeekPromotion";
import { remapPlanningRecordToTargetWeek } from "@/domain/planning/remapPlanningKeys";
import { mergeSnapshotsIntoLivePrefMap } from "@/domain/planning/mergePlanningSnapshots";
import { resolvePostResetGoals } from "@/domain/planning/postResetGoals";
import { shouldReplaceBackup } from "@/domain/planning/backupSafety";
import {
  assertResetCanProceed,
  buildPlanningResetReport,
  PLANNING_LAST_RESET_REPORT_KEY,
} from "@/domain/planning/resetReport";
import type { PossibleMealsFullBackup } from "@/domain/planning/types";
import { upsertPossibleMealsFullBackup, deletePossibleMealsByIds } from "@/services/planning/weeklyResetPersistence";
import { pushWeeklyResetClientPreferences } from "@/services/planning/pushWeeklyResetClientPreferences";
import { buildWeekDates } from "@/lib/planningWeekUtils";
import { pruneStaleIsoSnapshotsForTargetWeek } from "@/domain/planning/weekdaySnapshotUtils";
import { resolveCurrentUserId } from "@/lib/authUserId";

export interface UseWeeklyAutoResetOptions {
  unlocked: boolean;
  isLoading: boolean;
  isPreferencesLoading: boolean;
  lastWeeklyReset: string;
  possibleMeals: PossibleMeal[];
  meals: Meal[];
  foodItems: FoodItem[];
  qc: QueryClient;
  setPreference: {
    mutate: (args: { key: string; value: unknown }) => void;
  };
}

/**
 * Reset automatique du dimanche (23h59) : backup, purge des cartes échues,
 * promotion semaine suivante et préférences client — une fois par semaine.
 */
export function useWeeklyAutoReset({
  unlocked,
  isLoading,
  isPreferencesLoading,
  lastWeeklyReset,
  possibleMeals,
  meals,
  foodItems,
  qc,
  setPreference,
}: UseWeeklyAutoResetOptions) {
  const sundayClearDone = useRef(false);
  const autoSundayResetInFlightRef = useRef(false);

  useEffect(() => {
    if (!unlocked || sundayClearDone.current || isPreferencesLoading || isLoading) return;
    sundayClearDone.current = true;

    const now = new Date();
    // Trouver le dimanche 23h59 le plus récent
    const mostRecentSunday = new Date(now);
    const day = mostRecentSunday.getDay(); // 0=Dimanche
    // Revenir au dimanche dernier (ou aujourd'hui si on est dimanche)
    mostRecentSunday.setDate(mostRecentSunday.getDate() - day);
    mostRecentSunday.setHours(23, 59, 0, 0);

    // Si nous n'avons pas encore atteint dimanche 23h59 cette semaine, utiliser le dimanche de la semaine DERNIÈRE
    if (now.getTime() < mostRecentSunday.getTime()) {
      mostRecentSunday.setDate(mostRecentSunday.getDate() - 7);
    }

    if (!lastWeeklyReset) {
      // Initialisation de la première fois, on définit juste la valeur sans nettoyer
      setPreference.mutate({ key: "last_weekly_reset", value: mostRecentSunday.toISOString() });
      return;
    }

    const lastResetDate = new Date(lastWeeklyReset);
    if (lastResetDate.getTime() >= mostRecentSunday.getTime()) {
      // Déjà réinitialisé pour cette semaine
      return;
    }

    /** Exécute le reset hebdo auto (backup + purge + promotion). */
    const clearAll = async () => {
      if (autoSundayResetInFlightRef.current) return;
      autoSundayResetInFlightRef.current = true;
      try {
        const userId = await resolveCurrentUserId().catch(() => null);
        if (!userId) return;

        const { data: freshResetPref } = await supabase
          .from("user_preferences")
          .select("value")
          .eq("key", "last_weekly_reset")
          .eq("user_id", userId)
          .maybeSingle();
        if (freshResetPref?.value) {
          const freshResetDate = new Date(String(freshResetPref.value));
          if (freshResetDate.getTime() >= mostRecentSunday.getTime()) return;
        }

        const { snapshots, prefMap } = await fetchSnapshotsAndPrefsParallel(userId);

        await qc.refetchQueries({ queryKey: ["possible_meals"] });
        const freshPossible =
          (qc.getQueryData<PossibleMeal[]>(["possible_meals"]) as PossibleMeal[] | undefined) ??
          possibleMeals;

        const previousWeekStart = new Date(mostRecentSunday);
        previousWeekStart.setDate(previousWeekStart.getDate() - 6);
        const preservedPreviousWeek = {
          startISO: previousWeekStart.toISOString().split("T")[0],
          endISO: mostRecentSunday.toISOString().split("T")[0],
        };
        const archivedWeekDates = buildWeekDates(0, previousWeekStart);
        const mealsForArchive = filterPossibleMealsForArchiveWeek(freshPossible, archivedWeekDates);
        const enrichedPrefMap = enrichPrefMapForArchive(prefMap, snapshots, archivedWeekDates);
        const fullBackup = embedPlanningSnapshotsInBackup(
          buildFullBackupPayload(mealsForArchive, enrichedPrefMap, {
            startISO: archivedWeekDates[0]?.iso ?? preservedPreviousWeek.startISO,
            endISO:
              archivedWeekDates[archivedWeekDates.length - 1]?.iso ?? preservedPreviousWeek.endISO,
          }),
          snapshots,
          archivedWeekDates,
        );
        const { data: existingBackupRow } = await supabase
          .from("user_preferences")
          .select("value")
          .eq("key", "possible_meals_backup")
          .eq("user_id", userId)
          .maybeSingle();
        const existingBackup =
          existingBackupRow?.value &&
          typeof existingBackupRow.value === "object" &&
          !Array.isArray(existingBackupRow.value)
            ? (existingBackupRow.value as unknown as PossibleMealsFullBackup)
            : null;
        assertResetCanProceed(existingBackup, fullBackup);
        const replaceBackup = shouldReplaceBackup(existingBackup, fullBackup);
        if (replaceBackup) {
          await upsertPossibleMealsFullBackup(userId, fullBackup);
        }
        setPreference.mutate({
          key: PLANNING_LAST_RESET_REPORT_KEY,
          value: buildPlanningResetReport(fullBackup, "auto_sunday", replaceBackup),
        });
        const effectiveBackup = replaceBackup ? fullBackup : (existingBackup ?? fullBackup);

        const backupCtx = parseBackupCalorieContext(
          effectiveBackup,
          asPlanningOverrideRecord(prefMap["planning_cal_overrides"]),
          asPlanningOverrideRecord(prefMap["planning_pro_overrides"]),
        );
        if (backupCtx) {
          const liveDayTotals = captureLiveWeekTotalsFromPrefMap(
            prefMap,
            freshPossible,
            meals,
            foodItems,
            archivedWeekDates,
          );
          const nextHistory = buildUpdatedDailyCalorieHistory(
            asNumberRecord(prefMap[PLANNING_DAILY_CALORIE_HISTORY_KEY]),
            liveDayTotals,
          );
          setPreference.mutate({ key: PLANNING_DAILY_CALORIE_HISTORY_KEY, value: nextHistory });
        }

        const cutoffISO = mostRecentSunday.toISOString().split("T")[0];
        const mealsToDelete = filterPossibleMealsToDeleteForWeeklyClear(
          freshPossible,
          cutoffISO,
          preservedPreviousWeek,
        );
        await deletePossibleMealsByIds(mealsToDelete.map((pm) => pm.id));

        const targetWeek = buildWeekDates(0, now);
        const prunedSnapshots = pruneStaleIsoSnapshotsForTargetWeek(snapshots, targetWeek);
        const merged = mergeSnapshotsIntoLivePrefMap(prefMap, prunedSnapshots, targetWeek);
        const promoted = applyNextWeekPromotionOnTop(merged, prefMap, snapshots, targetWeek);
        const goals = resolvePostResetGoals(prefMap);
        pushWeeklyResetClientPreferences(setPreference, promoted, goals, now.toISOString(), "auto_sunday");
        const promotedExtraSlots = remapPlanningRecordToTargetWeek(
          asStringArrayRecord(prefMap["next_week_extra_slot_assignments"]),
          targetWeek,
        );
        setPreference.mutate({ key: "planning_extra_slot_assignments", value: promotedExtraSlots });
        setPreference.mutate({ key: "planning_saved_snapshots", value: prunedSnapshots });

        await qc.invalidateQueries({ queryKey: ["possible_meals"] });
        await qc.invalidateQueries({ queryKey: ["user_preferences"] });
        toast({
          title: "🔄 Reset hebdomadaire effectué",
          description: "Utilisez ↩ Restaurer dans le planning pour récupérer les cartes.",
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast({
          title: "Reset hebdomadaire interrompu",
          description: msg,
          variant: "destructive",
        });
      } finally {
        autoSundayResetInFlightRef.current = false;
      }
    };
    clearAll();
  }, [
    unlocked,
    possibleMeals,
    lastWeeklyReset,
    isPreferencesLoading,
    isLoading,
    meals,
    foodItems,
    qc,
    setPreference,
  ]);
}
