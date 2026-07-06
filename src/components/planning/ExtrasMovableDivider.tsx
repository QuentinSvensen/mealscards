import { ChevronDown, ChevronUp } from "lucide-react";
import { Separator } from "@/components/ui/separator";

/**
 * Trait horizontal unique entre deux extras, déplaçable via les flèches ou un clic sur la barre.
 */
export function ExtrasMovableDivider({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  aboveCount,
  belowCount,
}: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  aboveCount: number;
  belowCount: number;
}) {
  return (
    <div
      className="flex items-center gap-1.5 py-1.5 group"
      role="separator"
      aria-label="Trait de séparation des extras"
    >
      <button
        type="button"
        disabled={!canMoveUp}
        onClick={(e) => {
          e.stopPropagation();
          onMoveUp();
        }}
        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 disabled:opacity-25 disabled:pointer-events-none transition-colors"
        title="Monter le trait (plus d'extras au-dessus)"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => {
          if (canMoveDown) onMoveDown();
          else if (canMoveUp) onMoveUp();
        }}
        className="flex-1 flex items-center gap-2 min-w-0 cursor-pointer rounded-md px-1 py-0.5 hover:bg-primary/5 transition-colors"
        title="Cliquer pour descendre le trait · flèches pour ajuster"
      >
        <Separator className="flex-1 bg-primary/50 group-hover:bg-primary/70 transition-colors" />
        <span className="text-[8px] font-semibold uppercase tracking-wide text-primary/70 shrink-0">
          Trait
        </span>
        <span className="text-[8px] text-muted-foreground shrink-0 hidden sm:inline">
          {aboveCount}↑ {belowCount}↓
        </span>
        <Separator className="flex-1 bg-primary/50 group-hover:bg-primary/70 transition-colors" />
      </button>
      <button
        type="button"
        disabled={!canMoveDown}
        onClick={(e) => {
          e.stopPropagation();
          onMoveDown();
        }}
        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 disabled:opacity-25 disabled:pointer-events-none transition-colors"
        title="Descendre le trait (moins d'extras au-dessus)"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
