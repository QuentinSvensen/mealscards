import { useState, useRef, useEffect } from "react";
import { useMeals, DAYS, TIMES, type PossibleMeal } from "@/hooks/useMeals";
import { Timer, Flame, Weight, Calendar } from "lucide-react";
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

interface TouchDragState {
  pmId: string;
  ghost: HTMLElement;
  startX: number;
  startY: number;
  origTop: number;
  origLeft: number;
}

export function WeeklyPlanning() {
  const { possibleMeals, updatePlanning, reorderPossibleMeals } = useMeals();

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

  /* =========================
     DESKTOP DRAG
  ========================== */

  const handleDrop = async (e: React.DragEvent, day: string, time: string) => {
    e.preventDefault();
    setDragOverSlot(null);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) updatePlanning.mutate({ id: pmId, day_of_week: day, meal_time: time });
  };

  const handleDropUnplanned = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverUnplanned(false);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) updatePlanning.mutate({ id: pmId, day_of_week: null, meal_time: null });
  };

  /* =========================
     MOBILE DRAG (FIXED)
  ========================== */

  const handleTouchStart = (e: React.TouchEvent, pm: PossibleMeal) => {
    const touch = e.touches[0];
    const origEl = e.currentTarget as HTMLElement;
    const rect = origEl.getBoundingClientRect();

    if (longPressTimer.current) clearTimeout(longPressTimer.current);

    longPressTimer.current = setTimeout(() => {
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
    }, 350);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchDrag.current) return;

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

    setTouchHighlight(null);
  };

  const handleTouchCancel = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (touchDrag.current) touchDrag.current.ghost.remove();
    touchDrag.current = null;
    setTouchDragActive(false);
    setTouchHighlight(null);
  };

  /* =========================
     CARD
  ========================== */

  const renderMiniCard = (pm: PossibleMeal) => {
    const meal = pm.meals;
    if (!meal) return null;

    return (
      <div
        key={pm.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("pmId", pm.id);
        }}
        onTouchStart={(e) => handleTouchStart(e, pm)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        className="rounded-xl text-white select-none touch-none cursor-grab active:cursor-grabbing px-2 py-1.5"
        style={{ backgroundColor: meal.color }}
      >
        {meal.name}
      </div>
    );
  };

  /* =========================
     RENDER
  ========================== */

  return (
    <div className="max-w-4xl mx-auto space-y-3">
      {DAYS.map((day) => (
        <div key={day} className="rounded-2xl p-3 bg-card/80">
          <div className="grid grid-cols-2 gap-2">
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
                  className={`min-h-[60px] rounded-xl border p-2 ${isOver ? "bg-primary/10" : ""}`}
                >
                  {slotMeals.map((pm) => renderMiniCard(pm))}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div
        data-unplanned
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverUnplanned(true);
        }}
        onDragLeave={() => setDragOverUnplanned(false)}
        onDrop={handleDropUnplanned}
        className="rounded-2xl p-3 bg-card/80"
      >
        {unplanned.map((pm) => renderMiniCard(pm))}
      </div>
    </div>
  );
}
