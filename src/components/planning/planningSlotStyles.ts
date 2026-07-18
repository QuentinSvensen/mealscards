/** Libellés d’affichage des créneaux du planning. */
export const TIME_LABELS: Record<string, string> = {
  matin: "Matin",
  midi: "Midi",
  gouter: "Goûter",
  soir: "Soir",
};

/** Style compact du total kcal/prot/fib d’un créneau — réduit sur mobile pour éviter le débordement. */
export const SLOT_MEAL_TOTAL_CLASS =
  "flex items-center gap-0.5 sm:gap-1 shrink min-w-0 max-w-[58%] sm:max-w-none text-[7px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-1 sm:px-2 py-px sm:py-0.5 rounded-full border border-border/40 shadow-sm";

/** Séparateur « • » entre macros d’un badge créneau (masqué sur très petit écran). */
export const SLOT_MEAL_TOTAL_SEP_CLASS = "opacity-30 hidden sm:inline";

/** Calories ajoutées par la case « boisson sucrée » d’un créneau. */
export const DRINK_CALORIES = 150;
