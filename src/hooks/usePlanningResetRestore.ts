/**
 * usePlanningResetRestore — reset manuel du planning + restauration de la sauvegarde.
 * Extrait de WeeklyPlanning pour alléger le composant (comportement inchangé).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { PossibleMeal } from "@/hooks/useMeals";
import { resolveCurrentUserId } from "@/lib/authUserId";
import { fetchSnapshotsAndPrefsParallel } from "@/data/planning/planningResetRepository";
import { buildFullBackupPayload } from "@/domain/planning/buildBackupPayload";
import {
  buildUpdatedDailyCalorieHistory,
  captureLiveWeekTotalsForHistory,
  PLANNING_DAILY_CALORIE_HISTORY_KEY,
  withExplicitBackupWeekRange,
} from "@/domain/planning/dailyCalorieHistory";
import { asNumberRecord } from "@/domain/planning/jsonCoerce";
import type { PossibleMealsFullBackup } from "@/domain/planning/types";
import { getPossibleMealIdsToDeleteOnManualReset } from "@/domain/planning/mealsToClear";
import { mergeSnapshotsIntoLivePrefMap } from "@/domain/planning/mergePlanningSnapshots";
import { resolvePostResetGoals } from "@/domain/planning/postResetGoals";
import { upsertPossibleMealsFullBackup, deletePossibleMealsByIds } from "@/services/planning/weeklyResetPersistence";
import { pushWeeklyResetClientPreferences } from "@/services/planning/pushWeeklyResetClientPreferences";
import { buildWeekDates } from "@/lib/planningWeekUtils";
import { parseBackupCalorieContext } from "@/domain/planning/rollingCalorieAverage";
import { pruneStaleIsoSnapshotsForTargetWeek } from "@/domain/planning/weekdaySnapshotUtils";

export interface UsePlanningResetRestoreOptions {
  qc: QueryClient;
  possibleMeals: PossibleMeal[];
  weekDates: { key: string; iso: string }[];
  calOverrides: Record<string, string>;
  proOverrides: Record<string, string>;
  /** Totaux kcal journaliers pour l'historique capturé au reset. */
  getDayCalories: (iso: string, key: string) => number;
  getPreference: <T>(key: string, fallback: T) => T;
  setPreference: { mutate: (args: { key: string; value: unknown }) => void };
  setPreferencesBatch: { mutate: (entries: { key: string; value: unknown }[]) => void };
}

/**
 * Fournit les handlers Reset / Restaurer et le patch one-shot de plage ISO backup.
 */
export function usePlanningResetRestore({
  qc,
  possibleMeals,
  weekDates,
  calOverrides,
  proOverrides,
  getDayCalories,
  getPreference,
  setPreference,
  setPreferencesBatch,
}: UsePlanningResetRestoreOptions) {
  const manualResetLockRef = useRef(false);
  const [manualResetBusy, setManualResetBusy] = useState(false);
  const restoreLockRef = useRef(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const backupRangePatchedRef = useRef(false);

  /** Corrige la plage ISO de la sauvegarde si elle ne couvre pas toute la semaine précédente. */
  useEffect(() => {
    if (backupRangePatchedRef.current) return;
    const backupRaw = getPreference<unknown>("possible_meals_backup", null);
    const backupFull =
      backupRaw && typeof backupRaw === "object" && !Array.isArray(backupRaw)
        ? (backupRaw as PossibleMealsFullBackup)
        : null;
    if (!backupFull) return;
    const previousWeekDates = buildWeekDates(-1, new Date());
    const startISO = previousWeekDates[0]?.iso ?? "";
    const endISO = previousWeekDates[previousWeekDates.length - 1]?.iso ?? "";
    if (!startISO || !endISO) return;
    const patched = withExplicitBackupWeekRange(backupFull, startISO, endISO);
    if (patched === backupFull) {
      backupRangePatchedRef.current = true;
      return;
    }
    backupRangePatchedRef.current = true;
    setPreference.mutate({ key: "possible_meals_backup", value: patched });
  }, [getPreference, setPreference]);

  /** Restaure les cartes Possible (et prefs associées) depuis `possible_meals_backup`. */
  const handleRestoreBackup = useCallback(async () => {
    if (restoreLockRef.current) return;
    let userId: string;
    try {
      userId = await resolveCurrentUserId();
    } catch {
      toast({ title: "Non connecté", description: "Utilisateur non connecté.", variant: "destructive" });
      return;
    }

    let raw: any;
    try {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("value")
        .eq("key", "possible_meals_backup")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      raw = data?.value;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Lecture sauvegarde impossible", description: msg, variant: "destructive" });
      return;
    }

    const isNewFormat = raw && !Array.isArray(raw) && raw.cards;
    const backup: any[] = isNewFormat ? raw.cards : (Array.isArray(raw) ? raw : []);
    if (backup.length === 0) {
      toast({ title: "Aucune sauvegarde", description: "Aucune donnée à restaurer.", variant: "destructive" });
      return;
    }
    if (!confirm(`Restaurer ${backup.length} carte(s) possible(s) ?`)) return;

    restoreLockRef.current = true;
    setRestoreBusy(true);
    try {
      const inserts = backup.map((pm: any) =>
        (supabase as any).from("possible_meals").insert({
          meal_id: pm.meal_id,
          quantity: pm.quantity,
          expiration_date: pm.expiration_date,
          day_of_week: pm.day_of_week,
          meal_time: pm.meal_time,
          counter_start_date: pm.counter_start_date,
          sort_order: pm.sort_order,
          ingredients_override: pm.ingredients_override,
        })
      );
      const results = await Promise.all(inserts);
      for (const r of results) {
        if (r.error) throw new Error(r.error.message);
      }

      if (isNewFormat) {
        const prefEntries: { key: string; value: unknown }[] = [];
        if (raw.manualCalories) prefEntries.push({ key: "planning_manual_calories", value: raw.manualCalories });
        if (raw.manualProteins) prefEntries.push({ key: "planning_manual_proteins", value: raw.manualProteins });
        if (raw.manualFibers) prefEntries.push({ key: "planning_manual_fibers", value: raw.manualFibers });
        if (raw.extraCalories) prefEntries.push({ key: "planning_extra_calories", value: raw.extraCalories });
        if (raw.extraProteins) prefEntries.push({ key: "planning_extra_proteins", value: raw.extraProteins });
        if (raw.extraFibers) prefEntries.push({ key: "planning_extra_fibers", value: raw.extraFibers });
        if (raw.extraSelections) prefEntries.push({ key: "planning_extra_selections", value: raw.extraSelections });
        if (raw.extraSlotAssignments) prefEntries.push({ key: "planning_extra_slot_assignments", value: raw.extraSlotAssignments });
        if (raw.breakfastManualCalories) prefEntries.push({ key: "planning_breakfast_manual_calories", value: raw.breakfastManualCalories });
        if (raw.breakfastManualProteins) prefEntries.push({ key: "planning_breakfast_manual_proteins", value: raw.breakfastManualProteins });
        if (raw.breakfastSelections) prefEntries.push({ key: "planning_breakfast", value: raw.breakfastSelections });
        if (raw.drinkChecks) prefEntries.push({ key: "planning_drink_checks", value: raw.drinkChecks });
        if (raw.calOverrides) prefEntries.push({ key: "planning_cal_overrides", value: raw.calOverrides });
        if (raw.proOverrides) prefEntries.push({ key: "planning_pro_overrides", value: raw.proOverrides });
        if (raw.daily_goal) {
          prefEntries.push({ key: "planning_daily_goal", value: raw.daily_goal });
          prefEntries.push({ key: "next_week_daily_goal", value: raw.daily_goal });
        }
        if (raw.daily_goal_low != null) {
          prefEntries.push({ key: "planning_daily_goal_low", value: raw.daily_goal_low });
          prefEntries.push({ key: "next_week_daily_goal_low", value: raw.daily_goal_low });
        }
        if (raw.protein_goal) {
          prefEntries.push({ key: "planning_protein_goal", value: raw.protein_goal });
          prefEntries.push({ key: "next_week_protein_goal", value: raw.protein_goal });
        }
        if (raw.fiber_goal) {
          prefEntries.push({ key: "planning_fiber_goal", value: raw.fiber_goal });
          prefEntries.push({ key: "next_week_fiber_goal", value: raw.fiber_goal });
        }
        if (prefEntries.length > 0) setPreferencesBatch.mutate(prefEntries);
      }

      await qc.invalidateQueries({ queryKey: ["possible_meals"] });
      await qc.invalidateQueries({ queryKey: ["user_preferences"] });
      toast({ title: "Sauvegarde restaurée", description: `${backup.length} carte(s) réimportée(s).` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Restauration échouée", description: msg, variant: "destructive" });
    } finally {
      restoreLockRef.current = false;
      setRestoreBusy(false);
    }
  }, [qc, setPreference, setPreferencesBatch]);

  /** Reset manuel : backup, purge des cartes, réapplication de l'état 💾. */
  const handleManualReset = useCallback(async () => {
    if (!confirm('Réinitialiser le planning ? Les cartes seront supprimées et les valeurs sauvegardées (💾) seront restaurées.')) return;
    if (manualResetLockRef.current) return;
    manualResetLockRef.current = true;
    setManualResetBusy(true);
    try {
      let userId: string;
      try {
        userId = await resolveCurrentUserId();
      } catch {
        toast({ title: "Non connecté", description: "Session invalide.", variant: "destructive" });
        return;
      }

      const { snapshots, prefMap } = await fetchSnapshotsAndPrefsParallel(userId);

      await qc.refetchQueries({ queryKey: ["possible_meals"] });
      const freshPM =
        (qc.getQueryData<PossibleMeal[]>(["possible_meals"]) as PossibleMeal[] | undefined) ?? possibleMeals;

      const previousWeekDates = buildWeekDates(-1, new Date());
      const preservedPreviousWeek = {
        startISO: previousWeekDates[0]?.iso ?? "",
        endISO: previousWeekDates[previousWeekDates.length - 1]?.iso ?? "",
      };

      const fullBackup = buildFullBackupPayload(freshPM, prefMap, {
        startISO: preservedPreviousWeek.startISO,
        endISO: preservedPreviousWeek.endISO,
      });
      await upsertPossibleMealsFullBackup(userId, fullBackup);

      const backupCtx = parseBackupCalorieContext(fullBackup, calOverrides, proOverrides);
      if (backupCtx) {
        const liveDayTotals = captureLiveWeekTotalsForHistory(previousWeekDates, getDayCalories);
        const nextHistory = buildUpdatedDailyCalorieHistory(
          asNumberRecord(prefMap[PLANNING_DAILY_CALORIE_HISTORY_KEY]),
          liveDayTotals,
        );
        setPreference.mutate({ key: PLANNING_DAILY_CALORIE_HISTORY_KEY, value: nextHistory });
      }

      const ids = getPossibleMealIdsToDeleteOnManualReset(freshPM, preservedPreviousWeek);
      await deletePossibleMealsByIds(ids);

      const prunedSnapshots = pruneStaleIsoSnapshotsForTargetWeek(snapshots, weekDates);
      setPreference.mutate({ key: "planning_saved_snapshots", value: prunedSnapshots });

      const merged = mergeSnapshotsIntoLivePrefMap(prefMap, prunedSnapshots, weekDates);
      const goals = resolvePostResetGoals(prefMap);
      pushWeeklyResetClientPreferences(
        setPreference,
        merged,
        goals,
        new Date().toISOString(),
        "manual_button"
      );

      await qc.invalidateQueries({ queryKey: ["possible_meals"] });
      await qc.invalidateQueries({ queryKey: ["user_preferences"] });
      toast({ title: "Planning réinitialisé", description: "Les cartes ont été supprimées ; l’état 💾 a été réappliqué." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Échec du reset", description: msg, variant: "destructive" });
    } finally {
      manualResetLockRef.current = false;
      setManualResetBusy(false);
    }
  }, [qc, possibleMeals, weekDates, calOverrides, proOverrides, getDayCalories, setPreference]);

  return {
    manualResetBusy,
    restoreBusy,
    handleManualReset,
    handleRestoreBackup,
  };
}
