import { useState } from "react";
import { useMeals, DAYS, TIMES, type PossibleMeal } from "@/hooks/useMeals";
import { Timer, Flame, Weight, Calendar } from "lucide-react";
import { format, parseISO, isToday } from "date-fns";
import { fr } from "date-fns/locale";

const DAY_LABELS: Record<string, string> = {
  lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi',
  vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche',
};

const TIME_LABELS: Record<string, string> = { midi: 'Midi', soir: 'Soir' };

// Map JS getDay() (0=Sunday) to our day names
const JS_DAY_TO_KEY: Record<number, string> = {
  1: 'lundi', 2: 'mardi', 3: 'mercredi', 4: 'jeudi', 5: 'vendredi', 6: 'samedi', 0: 'dimanche',
};

function getCategoryEmoji(cat?: string) {
  switch (cat) {
    case 'entree': return '🥗';
    case 'plat': return '🍽️';
    case 'dessert': return '🍰';
    case 'bonus': return '⭐';
    default: return '🍴';
  }
}

function getCounterDays(startDate: string | null): number | null {
  if (!startDate) return null;
  return Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000);
}

function isExpiredDate(d: string | null) {
  if (!d) return false;
  return new Date(d) < new Date(new Date().toDateString());
}

export function WeeklyPlanning() {
  const { possibleMeals, updatePlanning } = useMeals();
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const [dragOverUnplanned, setDragOverUnplanned] = useState(false);

  const todayKey = JS_DAY_TO_KEY[new Date().getDay()];

  // Exclude petit_dejeuner
  const planningMeals = possibleMeals.filter(pm => pm.meals?.category !== 'petit_dejeuner');

  const getMealsForSlot = (day: string, time: string): PossibleMeal[] =>
    planningMeals.filter(pm => pm.day_of_week === day && pm.meal_time === time);

  const unplanned = planningMeals.filter(pm => !pm.day_of_week || !pm.meal_time);

  const handleDrop = async (e: React.DragEvent, day: string, time: string) => {
    e.preventDefault();
    setDragOverSlot(null);
    const pmId = e.dataTransfer.getData("pmId");
    const mealId = e.dataTransfer.getData("mealId");

    if (pmId) {
      updatePlanning.mutate({ id: pmId, day_of_week: day, meal_time: time });
    } else if (mealId) {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await (supabase as any)
        .from("possible_meals")
        .insert({ meal_id: mealId, sort_order: possibleMeals.length, day_of_week: day, meal_time: time })
        .select()
        .single();
      if (!error && data) {
        updatePlanning.mutate({ id: data.id, day_of_week: day, meal_time: time });
      }
    }
  };

  const handleDropUnplanned = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverUnplanned(false);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) {
      updatePlanning.mutate({ id: pmId, day_of_week: null, meal_time: null });
    }
  };

  const handleDragOver = (e: React.DragEvent, slotKey: string) => {
    e.preventDefault();
    setDragOverSlot(slotKey);
  };

  const handleRemoveFromSlot = (pm: PossibleMeal) => {
    updatePlanning.mutate({ id: pm.id, day_of_week: null, meal_time: null });
  };

  const renderMiniCard = (pm: PossibleMeal, compact = false) => {
    const meal = pm.meals;
    if (!meal) return null;
    const expired = isExpiredDate(pm.expiration_date);
    const counterDays = getCounterDays(pm.counter_start_date);
    const counterUrgent = counterDays !== null && counterDays >= 3;

    return (
      <div
        key={pm.id}
        draggable
        onDragStart={(e) => { e.dataTransfer.setData("pmId", pm.id); e.dataTransfer.setData("mealId", pm.meal_id); }}
        className={`rounded-xl text-white cursor-grab active:cursor-grabbing transition-transform hover:scale-[1.02] ${expired ? 'ring-2 ring-red-500' : ''} ${compact ? 'px-2 py-1' : 'px-2 py-1.5'}`}
        style={{ backgroundColor: meal.color }}
      >
        {/* Row 1: emoji + name + counter + remove */}
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[10px] opacity-70 shrink-0">{getCategoryEmoji(meal.category)}</span>
          <span className="truncate font-semibold text-xs flex-1">{meal.name}</span>
          {counterDays !== null && (
            <span className={`text-[9px] font-bold px-1 rounded-full shrink-0 flex items-center gap-0.5 ${counterUrgent ? 'bg-red-500/80 animate-pulse' : 'bg-white/25'}`}>
              <Timer className="h-2 w-2" />{counterDays}j
            </span>
          )}
          {!compact && (
            <button onClick={() => handleRemoveFromSlot(pm)} className="text-white/60 hover:text-white text-[10px] shrink-0 ml-0.5" title="Retirer">✕</button>
          )}
        </div>
        {/* Row 2: details */}
        {!compact && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {pm.expiration_date && (
              <span className={`text-[9px] flex items-center gap-0.5 ${expired ? 'text-red-200 font-bold' : 'text-white/60'}`}>
                <Calendar className="h-2 w-2" />
                {format(parseISO(pm.expiration_date), 'd MMM', { locale: fr })}
              </span>
            )}
            {meal.calories && (
              <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                <Flame className="h-2 w-2" />{meal.calories}
              </span>
            )}
            {meal.grams && (
              <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                <Weight className="h-2 w-2" />{meal.grams}
              </span>
            )}
          </div>
        )}
        {!compact && meal.ingredients && (
          <div className="mt-0.5 text-[9px] text-white/50 truncate">
            {meal.ingredients.split(/[,\n]+/).filter(Boolean).map(s => s.trim()).join(' • ')}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-3">
      {DAYS.map((day) => {
        const isToday_ = day === todayKey;
        return (
          <div key={day} className={`rounded-2xl p-3 sm:p-4 transition-all ${isToday_ ? 'bg-primary/10 ring-2 ring-primary/40' : 'bg-card/80 backdrop-blur-sm'}`}>
            <h3 className={`text-sm sm:text-base font-bold mb-2 flex items-center gap-2 ${isToday_ ? 'text-primary' : 'text-foreground'}`}>
              {DAY_LABELS[day]}
              {isToday_ && <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-semibold">Aujourd'hui</span>}
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {TIMES.map((time) => {
                const slotKey = `${day}-${time}`;
                const slotMeals = getMealsForSlot(day, time);
                const isOver = dragOverSlot === slotKey;
                return (
                  <div key={time}
                    onDragOver={(e) => handleDragOver(e, slotKey)}
                    onDragLeave={() => setDragOverSlot(null)}
                    onDrop={(e) => handleDrop(e, day, time)}
                    className={`min-h-[44px] rounded-xl border border-dashed p-1.5 transition-colors ${isOver ? 'border-primary/60 bg-primary/5' : 'border-border/40 hover:border-primary/40'}`}
                  >
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                    <div className="mt-0.5 space-y-1">
                      {slotMeals.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground/30 italic">—</p>
                      ) : slotMeals.map(pm => renderMiniCard(pm, false))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Hors planning — drop zone to unplan */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOverUnplanned(true); }}
        onDragLeave={() => setDragOverUnplanned(false)}
        onDrop={handleDropUnplanned}
        className={`rounded-2xl p-3 sm:p-4 transition-all ${dragOverUnplanned ? 'bg-muted/60 ring-2 ring-border' : 'bg-card/80 backdrop-blur-sm'}`}
      >
        <h3 className="text-sm sm:text-base font-bold text-foreground mb-2">Hors planning</h3>
        {unplanned.length === 0 ? (
          <p className={`text-xs italic ${dragOverUnplanned ? 'text-foreground/60' : 'text-muted-foreground/50'}`}>
            {dragOverUnplanned ? 'Relâche pour retirer du planning ↓' : 'Tous les repas sont planifiés ✨'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unplanned.map(pm => renderMiniCard(pm, true))}
          </div>
        )}
      </div>
    </div>
  );
}
