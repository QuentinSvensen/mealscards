import { describe, expect, it } from "vitest";
import {
  buildClientPrefsBackupPayload,
  parseClientPrefsBackupPayload,
  CLIENT_PREFS_BACKUP_KEYS,
} from "./clientPrefsBackup";
import { PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY } from "@/lib/planningDisplayPrefs";
import { POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY } from "@/lib/stockUtils";

describe("clientPrefsBackup", () => {
  it("exporte les clés récentes (masquer calories, compteur figé, fourchette)", () => {
    const payload = buildClientPrefsBackupPayload((key) => {
      if (key === PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY) return true;
      if (key === POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY) return { "pm-1": 2 };
      if (key === "planning_daily_goal_low") return 2000;
      return undefined;
    });
    expect(payload.kind).toBe("mealscards_client_prefs");
    expect(payload.prefs[PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY]).toBe(true);
    expect(payload.prefs[POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY]).toEqual({ "pm-1": 2 });
    expect(payload.prefs.planning_daily_goal_low).toBe(2000);
    expect(CLIENT_PREFS_BACKUP_KEYS).toContain("planning_fiber_goal");
  });

  it("parse un JSON d’import et ignore un format inconnu", () => {
    const entries = parseClientPrefsBackupPayload({
      kind: "mealscards_client_prefs",
      prefs: {
        planning_hide_day_calorie_totals: false,
        planning_fiber_goal: 28,
      },
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        { key: PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY, value: false },
        { key: "planning_fiber_goal", value: 28 },
      ]),
    );
    expect(parseClientPrefsBackupPayload({ foo: 1 })).toBeNull();
  });
});
