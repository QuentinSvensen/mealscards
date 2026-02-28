import { useState, useRef, useEffect } from "react";
import { useMeals, DAYS, TIMES, type PossibleMeal } from "@/hooks/useMeals";
import { usePreferences } from "@/hooks/usePreferences";
import { Timer, Flame, Weight, Calendar } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

const DAY_LABELS: Record<string, string> = {
  lundi: "Lundi",
  mardi: "Mardi",
  mercredi: "Mercredi",
  jeudi: "Jeudi",
  vendredi: "Vendredi",
  samedi: "Samedi",
  dimanche: "Dimanche",
};

const TIME_LABELS: Record<string, string> = { midi: "Midi", soir: "Soir" };

const JS_DAY_TO_KEY: Record<number, string> = {
  1: "lundi",
  2: "mardi",
  3: "mercredi",
  4: "jeudi",
  5: "vendredi",
  6: "samedi",
  0: "dimanche",
};

const DAILY_GOAL = 2750;
const WEEKLY_GOAL = 19250;

// Calorie override key for planning cards
function calOverrideKey(pmId: string) { return `planning_cal_override_${pmId}`; }

function getCategoryEmoji(cat?: string) {
  switch (cat) {
    case "entree":
      return "🥗";
    case "plat":
      return "🍽️";
    case "dessert":
      return "🍰";
    case "bonus":
      return "⭐";
    default:
      return "🍴";
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

function parseCalories(cal: string | null | undefined): number {
  if (!cal) return 0;
  const n = parseFloat(cal.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

interface TouchDragState {
  pmId: string;
  ghost: HTMLElement;
  startX: number;
  startY: number;
  origTop: number;
  origLeft: number;
}

// ─── PlanningMiniCard ────────────────────────────────────────────────────────
function PlanningMiniCard({ pm, meal, expired, counterDays, counterUrgent, displayCal, compact, isTouchDevice, touchDragActive, slotDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onRemove, onCalorieChange }: {
  pm: PossibleMeal; meal: any; expired: boolean; counterDays: number | null; counterUrgent: boolean; displayCal: string | null; compact: boolean;
  isTouchDevice: boolean; touchDragActive: boolean; slotDragOver: string | null;
  onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void; onTouchMove: (e: React.TouchEvent) => void; onTouchEnd: (e: React.TouchEvent) => void; onTouchCancel: () => void;
  onRemove: () => void; onCalorieChange: (val: string | null) => void;
}) {
  const [editingCal, setEditingCal] = useState(false);
  const [calValue, setCalValue] = useState("");

  return (
    <div
      draggable={!isTouchDevice}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      className={`rounded-xl text-white select-none
        ${touchDragActive ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing"}
        transition-transform hover:scale-[1.01]
        ${expired ? "ring-[3px] ring-red-500 shadow-lg shadow-red-500/30" : ""}
        ${slotDragOver === pm.id ? "ring-2 ring-white/60" : ""}
        ${compact ? "px-2 py-1" : "px-2 py-1.5"}
      `}
      style={{ backgroundColor: meal.color }}
    >
      <div className="flex items-center gap-1 min-w-0 flex-wrap">
        <span className="text-[11px] opacity-70 shrink-0">{getCategoryEmoji(meal.category)}</span>
        <span className="font-semibold text-xs min-w-0 break-words">{meal.name}</span>
        {counterDays !== null && (
          <span
            className={`text-[11px] font-black px-1.5 py-0.5 rounded-full shrink-0 flex items-center gap-0.5 border
            ${counterUrgent ? "bg-red-600 text-white border-red-300 shadow-md" : "bg-black/50 text-white border-white/30"}`}
          >
            <Timer className="h-2.5 w-2.5" />
            {counterDays}j
          </span>
        )}
        <div className="flex-1" />
        {!compact && (
          editingCal ? (
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={calValue}
              onChange={(e) => setCalValue(e.target.value)}
              onBlur={() => {
                const trimmed = calValue.trim();
                onCalorieChange(trimmed || null);
                setEditingCal(false);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-16 h-5 text-[11px] bg-white/20 border border-white/40 rounded px-1 text-white placeholder:text-white/40 focus:outline-none"
              placeholder="kcal"
            />
          ) : displayCal ? (
            <button
              onClick={() => { setCalValue(displayCal); setEditingCal(true); }}
              className="text-xs font-black text-white bg-black/30 px-2 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 hover:bg-black/40"
              title="Modifier les calories (temporaire)"
            >
              <Flame className="h-3 w-3" />
              {displayCal}
            </button>
          ) : (
            <button
              onClick={() => { setCalValue(""); setEditingCal(true); }}
              className="text-[10px] text-white/40 hover:text-white/60 shrink-0"
              title="Ajouter des calories"
            >
              <Flame className="h-3 w-3" />
            </button>
          )
        )}
        {!compact && (
          <button
            onClick={onRemove}
            className="text-white/60 hover:text-white text-[10px] shrink-0 ml-0.5 hover:bg-white/20 rounded px-0.5"
            title="Retirer"
          >
            ✕
          </button>
        )}
      </div>
      {!compact && (
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {pm.expiration_date && (
            <span className={`text-[9px] flex items-center gap-0.5 ${expired ? "text-red-200 font-bold" : "text-white/60"}`}>
              <Calendar className="h-2 w-2" />
              {format(parseISO(pm.expiration_date), "d MMM", { locale: fr })}
            </span>
          )}
          {meal.grams && (
            <span className="text-[9px] text-white/60 flex items-center gap-0.5">
              <Weight className="h-2 w-2" />
              {meal.grams}
            </span>
          )}
        </div>
      )}
      {!compact && meal.ingredients && (
        <div className="mt-0.5 text-[9px] text-white/50 break-words whitespace-normal">
          {meal.ingredients
            .split(/[,\n]+/)
            .filter(Boolean)
            .map((s: string) => s.trim())
            .join(" • ")}
        </div>
      )}
    </div>
  );
}

export function WeeklyPlanning() {
  const { possibleMeals, updatePlanning, reorderPossibleMeals, getMealsByCategory } = useMeals();
  const { getPreference, setPreference } = usePreferences();

  // Breakfast selections per day
  const breakfastSelections = getPreference<Record<string, string>>('planning_breakfast', {});
  const petitDejMeals = getMealsByCategory('petit_dejeuner');
  const manualCalories = getPreference<Record<string, number>>('planning_manual_calories', {});
  const extraCalories = getPreference<Record<string, number>>('planning_extra_calories', {});
  const calOverrides = getPreference<Record<string, string>>('planning_cal_overrides', {});

  const getBreakfastForDay = (day: string) => {
    const mealId = breakfastSelections[day];
    if (!mealId) return null;
    return petitDejMeals.find(m => m.id === mealId) || null;
  };

  const setBreakfastForDay = (day: string, mealId: string | null) => {
    const updated = { ...breakfastSelections };
    if (mealId) updated[day] = mealId;
    else delete updated[day];
    setPreference.mutate({ key: 'planning_breakfast', value: updated });
  };
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const [dragOverUnplanned, setDragOverUnplanned] = useState(false);

  const slotDragRef = useRef<{ pmId: string; slotKey: string } | null>(null);
  const [slotDragOver, setSlotDragOver] = useState<string | null>(null);

  const touchDrag = useRef<TouchDragState | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [touchDragActive, setTouchDragActive] = useState(false);
  const [touchHighlight, setTouchHighlight] = useState<string | null>(null);

  const todayRef = useRef<HTMLDivElement | null>(null);
  const todayKey = JS_DAY_TO_KEY[new Date().getDay()];
  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  useEffect(() => {
    if (todayRef.current) {
      setTimeout(() => {
        const el = todayRef.current;
        if (!el) return;
        const headerHeight = 112;
        const top = el.getBoundingClientRect().top + window.scrollY - headerHeight;
        window.scrollTo({ top, behavior: "smooth" });
      }, 200);
    }
  }, []);

  const planningMeals = possibleMeals.filter((pm) => pm.meals?.category !== "petit_dejeuner");

  const getMealsForSlot = (day: string, time: string): PossibleMeal[] =>
    planningMeals
      .filter((pm) => pm.day_of_week === day && pm.meal_time === time)
      .sort((a, b) => a.sort_order - b.sort_order);

  const unplanned = planningMeals.filter((pm) => !pm.day_of_week || !pm.meal_time);

  const getDayCalories = (day: string): number => {
    const mealCals = TIMES.reduce(
      (total, time) => {
        const slotMeals = getMealsForSlot(day, time);
        if (slotMeals.length > 0) {
          return total + slotMeals.reduce((s, pm) => {
            const override = calOverrides[pm.id];
            return s + (override ? parseCalories(override) : parseCalories(pm.meals?.calories));
          }, 0);
        }
        return total + (manualCalories[`${day}-${time}`] || 0);
      },
      0,
    );
    const breakfast = getBreakfastForDay(day);
    const extra = extraCalories[day] || 0;
    return mealCals + (breakfast ? parseCalories(breakfast.calories) : 0) + extra;
  };

  const handleDrop = async (e: React.DragEvent, day: string, time: string) => {
    e.preventDefault();
    setDragOverSlot(null);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) updatePlanning.mutate({ id: pmId, day_of_week: day, meal_time: time });
  };

  const handleDropOnCard = (e: React.DragEvent, targetPm: PossibleMeal) => {
    e.preventDefault();
    e.stopPropagation();
    setSlotDragOver(null);
    const draggedPmId = e.dataTransfer.getData("pmId");
    if (!draggedPmId || draggedPmId === targetPm.id) return;
    const slot = getMealsForSlot(targetPm.day_of_week!, targetPm.meal_time!);
    const filtered = slot.filter((p) => p.id !== draggedPmId);
    const targetIdx = filtered.findIndex((p) => p.id === targetPm.id);
    const insertAt = targetIdx === -1 ? filtered.length : targetIdx;
    filtered.splice(insertAt, 0, { id: draggedPmId } as PossibleMeal);
    reorderPossibleMeals.mutate(filtered.map((p, i) => ({ id: p.id, sort_order: i })));
  };

  const handleDropUnplanned = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverUnplanned(false);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) updatePlanning.mutate({ id: pmId, day_of_week: null, meal_time: null });
  };

  const handleTouchStart = (e: React.TouchEvent, pm: PossibleMeal) => {
    const touch = e.touches[0];
    const origEl = e.currentTarget as HTMLElement;
    const rect = origEl.getBoundingClientRect();

    if (longPressTimer.current) clearTimeout(longPressTimer.current);

    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";

      const ghost = origEl.cloneNode(true) as HTMLElement;
      ghost.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        z-index: 9999;
        pointer-events: none;
        opacity: 0.85;
        transform: scale(1.05);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.35);
        transition: none;
      `;
      document.body.appendChild(ghost);

      touchDrag.current = {
        pmId: pm.id,
        ghost,
        startX: touch.clientX,
        startY: touch.clientY,
        origTop: rect.top,
        origLeft: rect.left,
      };
      setTouchDragActive(true);
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchDrag.current) {
      e.preventDefault();
    } else if (!longPressTimer.current) {
      return;
    } else {
      return;
    }

    e.preventDefault();
    const touch = e.touches[0];
    const state = touchDrag.current;
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;

    state.ghost.style.top = `${state.origTop + dy}px`;
    state.ghost.style.left = `${state.origLeft + dx}px`;

    state.ghost.style.visibility = "hidden";
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    state.ghost.style.visibility = "visible";

    const slotEl = el?.closest("[data-slot]");
    if (slotEl) {
      const day = slotEl.getAttribute("data-day")!;
      const time = slotEl.getAttribute("data-time")!;
      setTouchHighlight(`${day}-${time}`);
    } else if (el?.closest("[data-unplanned]")) {
      setTouchHighlight("unplanned");
    } else {
      setTouchHighlight(null);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    const state = touchDrag.current;
    if (!state) return;

    touchDrag.current = null;
    setTouchDragActive(false);
    setTouchHighlight(null);
    document.body.style.overflow = "";
    document.body.style.touchAction = "";

    const touch = e.changedTouches[0];
    state.ghost.style.visibility = "hidden";
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    state.ghost.remove();

    const slotEl = el?.closest("[data-slot]");
    if (slotEl) {
      const day = slotEl.getAttribute("data-day")!;
      const time = slotEl.getAttribute("data-time")!;
      updatePlanning.mutate({ id: state.pmId, day_of_week: day, meal_time: time });
    } else if (el?.closest("[data-unplanned]")) {
      updatePlanning.mutate({ id: state.pmId, day_of_week: null, meal_time: null });
    }
  };

  const handleTouchCancel = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (touchDrag.current) {
      touchDrag.current.ghost.remove();
      touchDrag.current = null;
    }
    setTouchDragActive(false);
    setTouchHighlight(null);
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
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
    const overrideCal = calOverrides[pm.id];
    const displayCal = overrideCal || meal.calories;

    return (
      <PlanningMiniCard
        key={pm.id}
        pm={pm}
        meal={meal}
        expired={expired}
        counterDays={counterDays}
        counterUrgent={counterUrgent}
        displayCal={displayCal}
        compact={compact}
        isTouchDevice={isTouchDevice}
        touchDragActive={touchDragActive}
        slotDragOver={slotDragOver}
        onDragStart={(e) => {
          e.dataTransfer.setData("pmId", pm.id);
          e.dataTransfer.setData("mealId", pm.meal_id);
          e.dataTransfer.setData("source", "planning-slot");
          slotDragRef.current = { pmId: pm.id, slotKey: `${pm.day_of_week}-${pm.meal_time}` };
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSlotDragOver(pm.id);
        }}
        onDragLeave={() => setSlotDragOver(null)}
        onDrop={(e) => handleDropOnCard(e, pm)}
        onTouchStart={(e) => handleTouchStart(e, pm)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onRemove={() => handleRemoveFromSlot(pm)}
        onCalorieChange={(val) => {
          const updated = { ...calOverrides };
          if (val) updated[pm.id] = val;
          else delete updated[pm.id];
          setPreference.mutate({ key: 'planning_cal_overrides', value: updated });
        }}
      />
    );
  };

  const weekTotal = DAYS.reduce((sum, day) => sum + getDayCalories(day), 0);

  return (
    <div className={`max-w-4xl mx-auto space-y-3 ${touchDragActive ? "touch-none" : ""}`}>
      {DAYS.map((day) => {
        const isToday_ = day === todayKey;
        const dayCalories = getDayCalories(day);
        return (
          <div
            key={day}
            ref={isToday_ ? todayRef : undefined}
            className={`rounded-2xl p-3 sm:p-4 transition-all ${isToday_ ? "bg-primary/10 ring-2 ring-primary/40" : "bg-card/80 backdrop-blur-sm"}`}
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h3
                className={`text-sm sm:text-base font-bold flex items-center gap-2 ${isToday_ ? "text-primary" : "text-foreground"}`}
              >
                {DAY_LABELS[day]}
                {isToday_ && (
                  <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-semibold">
                    Aujourd'hui
                  </span>
                )}
              </h3>
              {/* Petit déj selector */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="text-[10px] bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full font-semibold hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors truncate max-w-[120px]">
                    {getBreakfastForDay(day)?.name || '🥐 Petit déj'}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-2" align="start">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Petit déjeuner</p>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    <button onClick={() => setBreakfastForDay(day, null)} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors">
                      — Aucun
                    </button>
                    {petitDejMeals.map(m => (
                      <button key={m.id} onClick={() => setBreakfastForDay(day, m.id)} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${breakfastSelections[day] === m.id ? 'bg-primary/10 font-bold' : ''}`}>
                        {m.name} {m.calories ? `(${m.calories})` : ''}
                      </button>
                    ))}
                    {petitDejMeals.length === 0 && (
                      <p className="text-[10px] text-muted-foreground italic px-2 py-1">Aucun petit déj dans "Tous"</p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <div className="flex-1" />
              <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 shrink-0">
                <Flame className="h-2.5 w-2.5 text-orange-500" />
                {Math.round(dayCalories)} <span className="text-muted-foreground/50 font-normal">/ {DAILY_GOAL}</span>
              </span>
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:gap-3">
              {TIMES.map((time) => {
                const slotKey = `${day}-${time}`;
                const slotMeals = getMealsForSlot(day, time);
                const isOver = dragOverSlot === slotKey || touchHighlight === slotKey;
                return (
                  <div
                    key={time}
                    data-slot
                    data-day={day}
                    data-time={time}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverSlot(slotKey);
                    }}
                    onDragLeave={() => setDragOverSlot(null)}
                    onDrop={(e) => handleDrop(e, day, time)}
                    className={`min-h-[52px] rounded-xl border border-dashed p-1.5 transition-colors ${isOver ? "border-primary/60 bg-primary/5" : "border-border/40 hover:border-primary/40"}`}
                  >
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      {TIME_LABELS[time]}
                    </span>
                    <div className="mt-0.5 space-y-1">
                      {slotMeals.length === 0 ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            inputMode="numeric"
                            placeholder="kcal"
                            key={`manual-${day}-${time}`}
                            defaultValue={manualCalories[`${day}-${time}`] || ''}
                            onBlur={(e) => {
                              const val = parseInt(e.target.value) || 0;
                              const key = `${day}-${time}`;
                              const updated = { ...manualCalories };
                              if (val > 0) updated[key] = val;
                              else delete updated[key];
                              setPreference.mutate({ key: 'planning_manual_calories', value: updated });
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            className="w-16 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40"
                          />
                        </div>
                      ) : (
                        slotMeals.map((pm) => renderMiniCard(pm, false))
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Extra column */}
              <div className="min-h-[52px] rounded-xl border border-dashed border-orange-300/30 p-1.5 w-14 flex flex-col items-center">
                <span className="text-[8px] font-semibold text-orange-400/60 uppercase tracking-wide">Extra</span>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="kcal"
                  key={`extra-${day}`}
                  defaultValue={extraCalories[day] || ''}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const updated = { ...extraCalories };
                    if (val > 0) updated[day] = val;
                    else delete updated[day];
                    setPreference.mutate({ key: 'planning_extra_calories', value: updated });
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-full h-5 mt-1 text-[10px] bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-400 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40 text-center"
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* Total calorique de la semaine */}
      <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">Total semaine</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-medium">
            Moy. {Math.round(weekTotal / 7)} kcal/j
          </span>
          <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
            <Flame className="h-4 w-4" />
            {Math.round(weekTotal)} <span className="text-muted-foreground/50 font-normal text-xs">/ {WEEKLY_GOAL}</span>
          </span>
        </div>
      </div>

      {/* Hors planning — drop zone to unplan */}
      <div
        data-unplanned
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverUnplanned(true);
        }}
        onDragLeave={() => setDragOverUnplanned(false)}
        onDrop={handleDropUnplanned}
        className={`rounded-2xl p-3 sm:p-4 transition-all ${dragOverUnplanned || touchHighlight === "unplanned" ? "bg-muted/60 ring-2 ring-border" : "bg-card/80 backdrop-blur-sm"}`}
      >
        <h3 className="text-sm sm:text-base font-bold text-foreground mb-2">Hors planning</h3>
        {unplanned.length === 0 ? (
          <p className={`text-xs italic ${dragOverUnplanned ? "text-foreground/60" : "text-muted-foreground/50"}`}>
            {dragOverUnplanned ? "Relâche pour retirer du planning ↓" : "Tous les repas sont planifiés ✨"}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">{unplanned.map((pm) => renderMiniCard(pm, true))}</div>
        )}
      </div>
    </div>
  );
}
