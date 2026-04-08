import type { MergedPlanningLiveState, PostResetGoalValues } from "@/domain/planning/types";

type SetPreferenceMutate = (args: { key: string; value: unknown }) => void;

export type WeeklyResetPushVariant = "auto_sunday" | "manual_button";

/**
 * Applique en local (React Query / mutation) l’état issu du domaine après reset.
 * `manual_button` vide aussi les brouillons « semaine suivante » comme avant.
 */
export function pushWeeklyResetClientPreferences(
  setPreference: { mutate: SetPreferenceMutate },
  merged: MergedPlanningLiveState,
  goals: PostResetGoalValues,
  lastResetIso: string,
  variant: WeeklyResetPushVariant
): void {
  const { mutate } = setPreference;

  mutate({ key: "planning_manual_calories", value: merged.planning_manual_calories });
  mutate({ key: "planning_manual_proteins", value: merged.planning_manual_proteins });
  mutate({ key: "planning_extra_calories", value: merged.planning_extra_calories });
  mutate({ key: "planning_extra_proteins", value: merged.planning_extra_proteins });
  mutate({ key: "planning_extra_selections", value: merged.planning_extra_selections });
  mutate({ key: "planning_breakfast_manual_calories", value: merged.planning_breakfast_manual_calories });
  mutate({ key: "planning_breakfast_manual_proteins", value: merged.planning_breakfast_manual_proteins });
  mutate({ key: "planning_breakfast", value: merged.planning_breakfast });
  mutate({ key: "planning_drink_checks", value: merged.planning_drink_checks });

  if (goals.planning_daily_goal && goals.next_week_daily_goal) {
    mutate({ key: "planning_daily_goal", value: goals.planning_daily_goal });
    mutate({ key: "next_week_daily_goal", value: goals.next_week_daily_goal });
  }
  if (goals.planning_protein_goal && goals.next_week_protein_goal) {
    mutate({ key: "planning_protein_goal", value: goals.planning_protein_goal });
    mutate({ key: "next_week_protein_goal", value: goals.next_week_protein_goal });
  }

  mutate({ key: "last_weekly_reset", value: lastResetIso });

  if (variant === "manual_button") {
    mutate({ key: "planning_cal_overrides", value: {} });
    mutate({ key: "planning_auto_consumed_days", value: {} });
    mutate({ key: "next_week_breakfast", value: {} });
    mutate({ key: "next_week_manual_calories", value: {} });
    mutate({ key: "next_week_manual_proteins", value: {} });
    mutate({ key: "next_week_extra_calories", value: {} });
    mutate({ key: "next_week_extra_proteins", value: {} });
    mutate({ key: "next_week_extra_selections", value: {} });
    mutate({ key: "next_week_breakfast_manual_calories", value: {} });
    mutate({ key: "next_week_breakfast_manual_proteins", value: {} });
    mutate({ key: "next_week_drink_checks", value: {} });
  }
}
