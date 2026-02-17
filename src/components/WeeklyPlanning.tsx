import { useState } from "react";
import { useMeals, DAYS, TIMES, type PossibleMeal } from "@/hooks/useMeals";

const DAY_LABELS: Record<string, string> = {
  lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi',
  vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche',
};

const TIME_LABELS: Record<string, string> = { midi: 'Midi', soir: 'Soir' };

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

export function WeeklyPlanning() {
  const { meals, possibleMeals, updatePlanning, moveToPossible } = useMeals();
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);

  const getMealsForSlot = (day: string, time: string): PossibleMeal[] =>
    possibleMeals.filter(pm => pm.day_of_week === day && pm.meal_time === time);

  // All possible meals (including already-planned ones) that can be dragged
  const allPossibleMeals = possibleMeals;

  // Unplanned: not yet assigned to any slot
  const unplanned = possibleMeals.filter(pm => !pm.day_of_week || !pm.meal_time);

  const handleDrop = async (e: React.DragEvent, day: string, time: string) => {
    e.preventDefault();
    setDragOverSlot(null);
    const pmId = e.dataTransfer.getData("pmId");
    const mealId = e.dataTransfer.getData("mealId");

    if (pmId) {
      // Already a possible_meal entry — just update its planning slot
      updatePlanning.mutate({ id: pmId, day_of_week: day, meal_time: time });
    } else if (mealId) {
      // It's a master meal being dragged — move to possible first, then update
      // We need to add it to possible_meals first then plan it
      // For simplicity, moveToPossible then re-fetch will handle it
      // But we need the new id — use a different approach: insert + update in sequence
      // handled by moveToPossible which fires an invalidate, next render will show it unplanned
      // Instead let's use supabase directly here
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await (supabase as any)
        .from("possible_meals")
        .insert({ meal_id: mealId, sort_order: possibleMeals.length, day_of_week: day, meal_time: time })
        .select()
        .single();
      if (!error && data) {
        // invalidate is done via moveToPossible's pattern — trigger a refetch
        updatePlanning.mutate({ id: data.id, day_of_week: day, meal_time: time });
      }
    }
  };

  const handleDragOver = (e: React.DragEvent, slotKey: string) => {
    e.preventDefault();
    setDragOverSlot(slotKey);
  };

  const handleDragLeave = () => setDragOverSlot(null);

  const handleRemoveFromSlot = (pm: PossibleMeal) => {
    updatePlanning.mutate({ id: pm.id, day_of_week: null, meal_time: null });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-3">
      {DAYS.map((day) => (
        <div key={day} className="bg-card/80 backdrop-blur-sm rounded-2xl p-3 sm:p-4">
          <h3 className="text-sm sm:text-base font-bold text-foreground mb-2">{DAY_LABELS[day]}</h3>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {TIMES.map((time) => {
              const slotKey = `${day}-${time}`;
              const slotMeals = getMealsForSlot(day, time);
              const isOver = dragOverSlot === slotKey;
              return (
                <div key={time}
                  onDragOver={(e) => handleDragOver(e, slotKey)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, day, time)}
                  className={`min-h-[44px] rounded-xl border border-dashed p-1.5 transition-colors ${isOver ? 'border-primary/60 bg-primary/5' : 'border-border/40 hover:border-primary/40'}`}
                >
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                  <div className="mt-0.5 space-y-1">
                    {slotMeals.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground/30 italic">—</p>
                    ) : slotMeals.map(pm => (
                      <div
                        key={pm.id}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("pmId", pm.id); e.dataTransfer.setData("mealId", pm.meal_id); }}
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-white text-xs font-medium cursor-grab active:cursor-grabbing"
                        style={{ backgroundColor: pm.meals?.color }}
                      >
                        <span className="text-[10px] opacity-70">{getCategoryEmoji(pm.meals?.category)}</span>
                        <span className="truncate flex-1">{pm.meals?.name}</span>
                        {pm.meals?.calories && <span className="text-[9px] opacity-60">🔥{pm.meals.calories}</span>}
                        <button
                          onClick={() => handleRemoveFromSlot(pm)}
                          className="text-white/60 hover:text-white text-[10px] leading-none ml-1"
                          title="Retirer du slot"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Unplanned — draggable to any slot */}
      <div className="bg-card/80 backdrop-blur-sm rounded-2xl p-3 sm:p-4">
        <h3 className="text-sm sm:text-base font-bold text-foreground mb-2">Hors planning</h3>
        {unplanned.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">Tous les repas sont planifiés ✨</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unplanned.map(pm => (
              <div key={pm.id} draggable
                onDragStart={(e) => { e.dataTransfer.setData("pmId", pm.id); e.dataTransfer.setData("mealId", pm.meal_id); }}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-white text-sm font-medium cursor-grab active:cursor-grabbing hover:scale-105 transition-transform"
                style={{ backgroundColor: pm.meals?.color }}>
                <span className="text-xs opacity-70">{getCategoryEmoji(pm.meals?.category)}</span>
                <span className="truncate">{pm.meals?.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* All possible meals palette for dragging into planning */}
      {allPossibleMeals.filter(pm => pm.day_of_week && pm.meal_time).length > 0 && (
        <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-3 sm:p-4 border border-dashed border-border/30">
          <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Repas planifiés · glisse pour réassigner</h3>
          <div className="flex flex-wrap gap-2">
            {allPossibleMeals.filter(pm => pm.day_of_week && pm.meal_time).map(pm => (
              <div key={pm.id} draggable
                onDragStart={(e) => { e.dataTransfer.setData("pmId", pm.id); e.dataTransfer.setData("mealId", pm.meal_id); }}
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-white text-xs font-medium cursor-grab active:cursor-grabbing hover:scale-105 transition-transform opacity-80"
                style={{ backgroundColor: pm.meals?.color }}>
                <span className="opacity-70">{getCategoryEmoji(pm.meals?.category)}</span>
                <span className="truncate">{pm.meals?.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
