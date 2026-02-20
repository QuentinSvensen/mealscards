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

// ─── Touch drag state ────────────────────────────────────────────────────────
interface TouchDragState {
  pmId: string;
  ghost: HTMLElement;
  startX: number;
  startY: number;
  origTop: number;
  origLeft: number;
}

export function WeeklyPlanning() {
  const { possibleMeals, updatePlanning, reorderPossibleMeals, getMealsByCategory } = useMeals();
  const { getPreference, setPreference } = usePreferences();

  // Breakfast selections per day
  const breakfastSelections = getPreference<Record<string, string>>('planning_breakfast', {});
  const petitDejMeals = getMealsByCategory('petit_dejeuner');

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

  // For desktop reordering within a slot
  const slotDragRef = useRef<{ pmId: string; slotKey: string } | null>(null);
  const [slotDragOver, setSlotDragOver] = useState<string | null>(null);

  // Touch drag (long-press → ghost follows finger)
  const touchDrag = useRef<TouchDragState | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [touchDragActive, setTouchDragActive] = useState(false);
  const [touchHighlight, setTouchHighlight] = useState<string | null>(null); // slot key being hovered

  const todayRef = useRef<HTMLDivElement | null>(null);
  const todayKey = JS_DAY_TO_KEY[new Date().getDay()];
  // ✅ Détection device tactile
  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  // Scroll to today on mount
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
      (total, time) => total + getMealsForSlot(day, time).reduce((s, pm) => s + parseCalories(pm.meals?.calories), 0),
      0,
    );
    const breakfast = getBreakfastForDay(day);
    return mealCals + (breakfast ? parseCalories(breakfast.calories) : 0);
  };

  // ── Desktop drag & drop ──────────────────────────────────────────────────────

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

  // ── Touch drag & drop ────────────────────────────────────────────────────────
  // Strategy: long-press (500ms) creates a ghost clone. The ghost follows the finger.
  // On touchend, use elementFromPoint to find the slot and mutate.

  const handleTouchStart = (e: React.TouchEvent, pm: PossibleMeal) => {
    const touch = e.touches[0];
    const origEl = e.currentTarget as HTMLElement;
    const rect = origEl.getBoundingClientRect();

    // Cancel any previous timer
    if (longPressTimer.current) clearTimeout(longPressTimer.current);

    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      // Freeze body scroll during drag
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";

      // Build ghost
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
    // If a drag is active, always block scroll
    if (touchDrag.current) {
      e.preventDefault();
    } else if (!longPressTimer.current) {
      return;
    } else {
      // Still in long-press window — cancel if user moved too much (let natural scroll happen)
      return;
    }

    // Actively dragging
    e.preventDefault();
    const touch = e.touches[0];
    const state = touchDrag.current;
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;

    state.ghost.style.top = `${state.origTop + dy}px`;
    state.ghost.style.left = `${state.origLeft + dx}px`;

    // Highlight slot under finger
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
    // Restore scroll
    document.body.style.overflow = "";
    document.body.style.touchAction = "";

    // Remove ghost, find drop target
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
    // Restore scroll
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
  };

  const handleRemoveFromSlot = (pm: PossibleMeal) => {
    updatePlanning.mutate({ id: pm.id, day_of_week: null, meal_time: null });
  };

  // ── Render mini card ─────────────────────────────────────────────────────────

  const renderMiniCard = (pm: PossibleMeal, compact = false) => {
    const meal = pm.meals;
    if (!meal) return null;
    const expired = isExpiredDate(pm.expiration_date);
    const counterDays = getCounterDays(pm.counter_start_date);
    const counterUrgent = counterDays !== null && counterDays >= 3;

    return (
      <div
        key={pm.id}
        draggable={!isTouchDevice} // ✅ une seule fois
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
        className={`rounded-xl text-white select-none
          ${touchDragActive ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing"}
          transition-transform hover:scale-[1.01]
          ${expired ? "ring-[3px] ring-red-500 shadow-lg shadow-red-500/30" : ""}
          ${slotDragOver === pm.id ? "ring-2 ring-white/60" : ""}
          ${compact ? "px-2 py-1" : "px-2 py-1.5"}
        `}
        style={{ backgroundColor: meal.color }}
      >
        {/* Row 1: emoji + name + counter + remove */}
        <div className="flex items-center gap-1 min-w-0 flex-wrap">
          <span className="text-[11px] opacity-70 shrink-0">{getCategoryEmoji(meal.category)}</span>
          <span className="font-semibold text-xs flex-1 break-words min-w-0">{meal.name}</span>
          {counterDays !== null && (
            <span
              className={`text-[11px] font-black px-1.5 py-0.5 rounded-full shrink-0 flex items-center gap-0.5 border
              ${
                counterUrgent
                  ? "bg-red-600 text-white border-red-300 shadow-md"
                  : "bg-black/50 text-white border-white/30"
              }`}
            >
              <Timer className="h-2.5 w-2.5" />
              {counterDays}j
            </span>
          )}
          {!compact && (
            <button
              onClick={() => handleRemoveFromSlot(pm)}
              className="text-white/60 hover:text-white text-[10px] shrink-0 ml-0.5 hover:bg-white/20 rounded px-0.5"
              title="Retirer"
            >
              ✕
            </button>
          )}
        </div>
        {/* Row 2: details */}
        {!compact && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {pm.expiration_date && (
              <span
                className={`text-[9px] flex items-center gap-0.5 ${expired ? "text-red-200 font-bold" : "text-white/60"}`}
              >
                <Calendar className="h-2 w-2" />
                {format(parseISO(pm.expiration_date), "d MMM", { locale: fr })}
              </span>
            )}
            {meal.calories && (
              <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                <Flame className="h-2 w-2" />
                {meal.calories}
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
              .map((s) => s.trim())
              .join(" • ")}
          </div>
        )}
      </div>
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
              {dayCalories > 0 && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 shrink-0">
                  <Flame className="h-2.5 w-2.5 text-orange-500" />
                  {Math.round(dayCalories)} kcal
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
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
                        <p className="text-[10px] text-muted-foreground/30 italic">—</p>
                      ) : (
                        slotMeals.map((pm) => renderMiniCard(pm, false))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Total calorique de la semaine */}
      {weekTotal > 0 && (
        <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-bold text-foreground">Total semaine</span>
          <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
            <Flame className="h-4 w-4" />
            {Math.round(weekTotal)} kcal
          </span>
        </div>
      )}

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
