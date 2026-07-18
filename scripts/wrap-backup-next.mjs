/**
 * Enveloppe backup + next-week snippets en composants.
 * Les free vars restent des props destructurées (mêmes noms).
 */
import fs from "fs";

/** Lit un snippet. */
function read(name) {
  return fs.readFileSync(`scripts/${name}`, "utf8");
}

/** Écrit un fichier. */
function write(path, content) {
  fs.writeFileSync(path, content);
  console.log("OK", path, content.split(/\r?\n/).length, "L");
}

// ── Backup view ──
let backup = read("_backup_view_snippet.txt").trim();
// snippet: (() => { ... })()
if (backup.startsWith("(() => {")) backup = backup.slice("(() => {".length);
if (backup.endsWith("})()")) backup = backup.slice(0, -"})()".length);
backup = backup.trim();

const backupFile = `import { Flame, Wheat } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BreakfastBreakdownList } from "@/components/planning/BreakfastBreakdownList";
import { PlanningWeekTotalsFooter } from "@/components/planning/PlanningWeekTotalsFooter";
import { DRINK_CALORIES, TIME_LABELS, MAIN_GRID_TIMES } from "@/components/planning/planningSlotStyles";
import {
  buildBackupBreakfastBreakdownItems,
  isBackupBreakfastPmAlreadyInMatinSlot,
} from "@/domain/planning/breakfastBreakdown";
import { mergeBackupCardOverrides } from "@/domain/planning/mergeBackupOverrides";
import { getCalorieRangeTotalColorClass } from "@/domain/planning/calorieGoalRange";
import {
  getCardDisplayCalories,
  getCardDisplayProtein,
} from "@/hooks/useCalorieBalance";
import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import { getMealColor } from "@/lib/ingredientUtils";
import { getCategoryEmoji } from "@/components/planning/PlanningMiniCard";
import {
  groupAssignedExtraIds,
  resolveAssignedExtraForDisplay,
  getAssignedExtraLabel,
  getUnassignedExtraSelectionIds,
  parseFoodDessertExtraId as _unusedParse,
  scaleExtraDisplayMacrosByCount,
  resolvePlanningExtraFoodMacros,
} from "@/domain/planning/extraDisplay";
import { parseFoodDessertExtraId } from "@/lib/foodDessertUtils";
import { scaleExtraDisplayMacrosByCount as scaleMacros } from "@/lib/planningExtraMacros";

// Re-export helpers used in body under expected names
const scaleExtraDisplayMacrosByCount = scaleMacros;

export interface PlanningBackupWeekViewProps {
  weekDates: Array<{ key: string; iso: string; display: string }>;
  getPreference: <T>(key: string, fallback: T) => T;
  calOverrides: Record<string, string | number>;
  proOverrides: Record<string, string | number>;
  allMealsById: Map<string, Meal>;
  openBackupPlanningCardPopup: (card: any, calOverride?: any, proOverride?: any) => void;
  handleBackupCardOpen: (cardKey: string, open: () => void) => void;
  resolveBackupCardMeal: (card: any) => Meal | null;
  setPopupBreakfast: (v: { meal: any; day: string } | null) => void;
  foodItems: FoodItem[];
  foodMacroIndex: any;
  isAvailableCb: (name: string) => boolean;
  singleIngredientDessertById: Map<string, { mealPayload: Meal; name?: string; cal?: number; prot?: number; fiber?: number }>;
  ingredientMacroLibrary: IngredientMacroLibraryItem[] | null | undefined;
  sumDayExtras: (ids: string[]) => { cal: number; pro: number; fiber: number };
  hideDayCalorieTotals: boolean;
  backupTotals: { archivedDailyGoal: number; archivedProteinGoal: number } | null;
  openExtrasDay: string | null;
  setOpenExtrasDay: React.Dispatch<React.SetStateAction<string | null>>;
  parseCalories: (cal: string | null | undefined) => number;
  parseProtein: (prot: string | null | undefined) => number;
}

/**
 * Vue lecture seule de la dernière sauvegarde (weekOffset <= -1).
 */
export function PlanningBackupWeekView({
  weekDates,
  getPreference,
  calOverrides,
  proOverrides,
  allMealsById,
  openBackupPlanningCardPopup,
  handleBackupCardOpen,
  resolveBackupCardMeal,
  setPopupBreakfast,
  foodItems,
  foodMacroIndex,
  isAvailableCb,
  singleIngredientDessertById,
  ingredientMacroLibrary,
  sumDayExtras,
  hideDayCalorieTotals,
  backupTotals,
  openExtrasDay,
  setOpenExtrasDay,
  parseCalories,
  parseProtein,
}: PlanningBackupWeekViewProps) {
  if (!backupTotals) {
    return (
      <div className="rounded-2xl bg-card/80 backdrop-blur-sm p-6 text-center">
        <p className="text-sm text-muted-foreground italic">Aucune sauvegarde disponible</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Une sauvegarde est créée automatiquement lors du reset</p>
      </div>
    );
  }

${backup
  // Remplacer le footer IIFE total par PlanningWeekTotalsFooter pour factoriser
  .replace(
    /\{\/\* Total calorique de la semaine \(Backup\) \*\/\}[\s\S]*?\}\)\(\)\}/,
    `{/* Total calorique de la semaine (Backup) */}
              {(() => {
                const weekTotalCals = dailyTotals.reduce((a, b) => a + b, 0);
                const processedDays = dailyTotals.length;
                const avgCal = processedDays > 0 ? Math.round(weekTotalCals / processedDays) : 0;
                const weekGoalHigh = backupTotals.archivedDailyGoal * 7;
                const dayGoal = backupTotals.archivedDailyGoal;
                return (
                  <PlanningWeekTotalsFooter
                    title="Total semaine"
                    weekTotal={weekTotalCals}
                    avgCal={avgCal}
                    avgDaysLabel={\`\${processedDays}j\`}
                    goalLow={0}
                    goalHigh={weekGoalHigh}
                    hideDayCalorieTotals={hideDayCalorieTotals}
                    weekDayScale={7}
                    goalAsSingleHigh
                  />
                );
              })()}`
  )}
}
`;

// Fix broken imports in backupFile - I made a mess with scaleExtraDisplayMacrosByCount
// Rewrite backup more carefully without the broken import block
`;

write("src/components/planning/_PlanningBackupWeekView.raw.txt", backup);
console.log("Backup body extracted, length", backup.length);
console.log("Has early return no backup:", backup.includes("Aucune sauvegarde"));
`;

fs.writeFileSync(
  "scripts/wrap-backup-next.mjs",
  fs.readFileSync("scripts/wrap-backup-next.mjs", "utf8").split("`;\n\n// Fix broken")[0] +
    `\`;\nwrite("scripts/_backup_body_clean.txt", backup);\nconsole.log("backup body ready", backup.split(/\\n/).length);\n`
);
console.log("needs rewrite");
