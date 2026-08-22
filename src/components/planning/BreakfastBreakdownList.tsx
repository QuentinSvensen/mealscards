import { Flame } from "lucide-react";
import type { BreakfastBreakdownItem } from "@/domain/planning/breakfastBreakdown";

/** Affiche la liste détaillée des petits déjeuners sélectionnés pour une journée. */
export function BreakfastBreakdownList({
  items,
  totalCal,
  totalPro,
  totalFiber,
}: {
  items: BreakfastBreakdownItem[];
  totalCal?: number;
  totalPro?: number;
  totalFiber?: number;
}) {
  if (items.length === 0) {
    return <p className="text-[10px] text-muted-foreground italic px-1">Aucun petit déjeuner</p>;
  }

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
        Sélectionnés ce jour
      </p>
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-md bg-muted/50"
        >
          <span className="truncate font-medium">{item.name}</span>
          <span className="shrink-0 text-muted-foreground text-[10px] flex items-center gap-1">
            {item.cal > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Flame className="w-2.5 h-2.5 text-orange-500" />
                {Math.round(item.cal)}
              </span>
            )}
            {item.cal > 0 && item.pro > 0 && <span className="opacity-40">·</span>}
            {item.pro > 0 && <span>🍗{Math.round(item.pro)}</span>}
            {item.pro > 0 && item.fiber > 0 && <span className="opacity-40">·</span>}
            {item.cal > 0 && item.pro === 0 && item.fiber > 0 && <span className="opacity-40">·</span>}
            {item.fiber > 0 && <span>🌾{Math.round(item.fiber)}</span>}
          </span>
        </div>
      ))}
      {items.length > 1 && (totalCal != null || totalPro != null || totalFiber != null) && (
        <div className="flex items-center justify-between gap-2 text-[10px] font-bold px-2 pt-1.5 mt-0.5 border-t border-border/40">
          <span>Total petit déj</span>
          <span className="text-muted-foreground flex items-center gap-1">
            {totalCal != null && totalCal > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Flame className="w-2.5 h-2.5 text-orange-500" />
                {Math.round(totalCal)}
              </span>
            )}
            {totalCal != null && totalCal > 0 && totalPro != null && totalPro > 0 && (
              <span className="opacity-40">·</span>
            )}
            {totalPro != null && totalPro > 0 && <span>🍗{Math.round(totalPro)}</span>}
            {((totalPro != null && totalPro > 0) || (totalCal != null && totalCal > 0)) && totalFiber != null && totalFiber > 0 && (
              <span className="opacity-40">·</span>
            )}
            {totalFiber != null && totalFiber > 0 && (
              <span>🌾{Math.round(totalFiber)}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
