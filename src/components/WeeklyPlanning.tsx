import { useState } from "react";
import { useMeals, DAYS, TIMES, type PossibleMeal } from "@/hooks/useMeals";

const DAY_LABELS: Record<string, string> = {
  lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi',
  vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche',
};

const TIME_LABELS: Record<string, string> = { midi: 'Midi', soir: 'Soir' };

export function WeeklyPlanning() {
  const { possibleMeals, updatePlanning } = useMeals();

  const getMealsForSlot = (day: string, time: string): PossibleMeal[] =>
    possibleMeals.filter(pm => pm.day_of_week === day && pm.meal_time === time);

  const unplanned = possibleMeals.filter(pm => !pm.day_of_week || !pm.meal_time);

  const handleDrop = (e: React.DragEvent, day: string, time: string) => {
    e.preventDefault();
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) {
      updatePlanning.mutate({ id: pmId, day_of_week: day, meal_time: time });
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  return (
    <div className="max-w-4xl mx-auto space-y-3">
      {DAYS.map((day) => (
        <div key={day} className="bg-card/80 backdrop-blur-sm rounded-2xl p-3 sm:p-4">
          <h3 className="text-sm sm:text-base font-bold text-foreground mb-2">{DAY_LABELS[day]}</h3>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {TIMES.map((time) => {
              const slotMeals = getMealsForSlot(day, time);
              return (
                <div key={time}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, day, time)}
                  className="min-h-[40px] rounded-xl border border-dashed border-border/40 p-1.5 transition-colors hover:border-primary/40"
                >
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                  <div className="mt-0.5 space-y-1">
                    {slotMeals.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground/30 italic">—</p>
                    ) : slotMeals.map(pm => (
                      <div key={pm.id} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-white text-xs font-medium" style={{ backgroundColor: pm.meals?.color }}>
                        <span className="text-[10px] opacity-70">{getCategoryEmoji(pm.meals?.category)}</span>
                        <span className="truncate">{pm.meals?.name}</span>
                        {pm.meals?.calories && <span className="text-[9px] opacity-60 ml-auto">🔥{pm.meals.calories}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Unplanned */}
      <div className="bg-card/80 backdrop-blur-sm rounded-2xl p-3 sm:p-4">
        <h3 className="text-sm sm:text-base font-bold text-foreground mb-2">Hors planning</h3>
        {unplanned.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">Tous les repas sont planifiés ✨</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unplanned.map(pm => (
              <div key={pm.id} draggable
                onDragStart={(e) => { e.dataTransfer.setData("pmId", pm.id); }}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-white text-sm font-medium cursor-grab active:cursor-grabbing hover:scale-105 transition-transform"
                style={{ backgroundColor: pm.meals?.color }}>
                <span className="text-xs opacity-70">{getCategoryEmoji(pm.meals?.category)}</span>
                <span className="truncate">{pm.meals?.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
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
