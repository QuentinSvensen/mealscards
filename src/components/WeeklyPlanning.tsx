import { useMeals, DAYS, TIMES, type PossibleMeal } from "@/hooks/useMeals";

const DAY_LABELS: Record<string, string> = {
  lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi',
  vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche',
};

const TIME_LABELS: Record<string, string> = { midi: 'Midi', soir: 'Soir' };

export function WeeklyPlanning() {
  const { possibleMeals } = useMeals();

  const getMealsForSlot = (day: string, time: string): PossibleMeal[] =>
    possibleMeals.filter(pm => pm.day_of_week === day && pm.meal_time === time);

  const unplanned = possibleMeals.filter(pm => !pm.day_of_week && !pm.meal_time);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {DAYS.map((day) => {
        const dayMeals = TIMES.map(time => ({ time, meals: getMealsForSlot(day, time) }));
        const hasAny = dayMeals.some(s => s.meals.length > 0);
        if (!hasAny) return null;

        return (
          <div key={day} className="bg-card/80 backdrop-blur-sm rounded-2xl p-4">
            <h3 className="text-base font-bold text-foreground mb-3">{DAY_LABELS[day]}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {dayMeals.map(({ time, meals: slotMeals }) => (
                <div key={time}>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                  <div className="mt-1 space-y-1">
                    {slotMeals.length === 0 ? (
                      <p className="text-xs text-muted-foreground/50 italic">—</p>
                    ) : slotMeals.map(pm => (
                      <div key={pm.id} className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-white text-sm font-medium" style={{ backgroundColor: pm.meals?.color }}>
                        <span className="text-xs opacity-70">{getCategoryEmoji(pm.meals?.category)}</span>
                        <span className="truncate">{pm.meals?.name}</span>
                        {pm.meals?.grams && <span className="text-[10px] opacity-60">{pm.meals.grams}</span>}
                        {pm.meals?.calories && <span className="text-[10px] opacity-60">🔥{pm.meals.calories}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Unplanned */}
      {unplanned.length > 0 && (
        <div className="bg-card/80 backdrop-blur-sm rounded-2xl p-4">
          <h3 className="text-base font-bold text-foreground mb-3">Hors planning</h3>
          <div className="flex flex-wrap gap-2">
            {unplanned.map(pm => (
              <div key={pm.id} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-white text-sm font-medium" style={{ backgroundColor: pm.meals?.color }}>
                <span className="text-xs opacity-70">{getCategoryEmoji(pm.meals?.category)}</span>
                <span className="truncate">{pm.meals?.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {possibleMeals.length === 0 && (
        <div className="bg-card/80 backdrop-blur-sm rounded-2xl p-8 text-center">
          <p className="text-muted-foreground italic">Aucun repas programmé</p>
        </div>
      )}
    </div>
  );
}

function getCategoryEmoji(cat?: string) {
  switch (cat) {
    case 'petit_dejeuner': return '🥐';
    case 'entree': return '🥗';
    case 'plat': return '🍽️';
    case 'dessert': return '🍰';
    case 'bonus': return '⭐';
    default: return '🍴';
  }
}
