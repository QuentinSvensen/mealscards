import { describe, expect, it } from "vitest";
import {
  clearWeekdayScopedSnapshots,
  isSnapshotSourceEligibleForTargetWeek,
  pruneStaleIsoSnapshotsForTargetWeek,
} from "./weekdaySnapshotUtils";

const JS_DAY_TO_KEY: Record<number, string> = {
  1: "lundi",
  2: "mardi",
  3: "mercredi",
  4: "jeudi",
  5: "vendredi",
  6: "samedi",
  0: "dimanche",
};

describe("weekdaySnapshotUtils", () => {
  it("conserve les snapshots ISO de la semaine cible et les clés jour", () => {
    const targetWeekIsos = new Set(["2026-06-16", "2026-06-21"]);
    expect(isSnapshotSourceEligibleForTargetWeek("2026-06-16-midi", targetWeekIsos)).toBe(true);
    expect(isSnapshotSourceEligibleForTargetWeek("mardi-midi", targetWeekIsos)).toBe(true);
    expect(isSnapshotSourceEligibleForTargetWeek("2026-06-09-midi", targetWeekIsos)).toBe(false);
  });

  it("supprime les snapshots manuels historiques du même jour de semaine", () => {
    const snapshots = {
      "manual-2026-06-16-midi": { cal: 1500, prot: 35 },
      "manual-2026-06-09-midi": { cal: 1000, prot: 30 },
      "manual-mardi-midi": { cal: 800, prot: 25 },
      "manual-2026-06-17-midi": { cal: 900, prot: 28 },
    };
    const out = clearWeekdayScopedSnapshots(snapshots, "manual", "2026-06-16", "mardi", JS_DAY_TO_KEY, "midi");
    expect(out["manual-2026-06-16-midi"]).toBeUndefined();
    expect(out["manual-2026-06-09-midi"]).toBeUndefined();
    expect(out["manual-mardi-midi"]).toBeUndefined();
    expect(out["manual-2026-06-17-midi"]).toEqual({ cal: 900, prot: 28 });
  });

  it("purge les snapshots ISO hors semaine cible", () => {
    const snapshots = {
      "manual-2026-06-16-midi": { cal: 1500 },
      "manual-2026-06-09-midi": { cal: 1000 },
      "manual-mardi-midi": { cal: 800 },
      "extra-2026-06-09": { cal: 50 },
      "breakfast-dimanche": { cal: 120 },
    };
    const out = pruneStaleIsoSnapshotsForTargetWeek(snapshots, [{ iso: "2026-06-16" }, { iso: "2026-06-21" }]);
    expect(out["manual-2026-06-16-midi"]).toEqual({ cal: 1500 });
    expect(out["manual-2026-06-09-midi"]).toBeUndefined();
    expect(out["manual-mardi-midi"]).toEqual({ cal: 800 });
    expect(out["extra-2026-06-09"]).toBeUndefined();
    expect(out["breakfast-dimanche"]).toEqual({ cal: 120 });
  });
});
