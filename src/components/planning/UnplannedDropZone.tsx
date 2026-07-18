import type { ReactNode } from "react";

export interface UnplannedDropZoneProps {
  isDragOver: boolean;
  isTouchHighlight: boolean;
  isEmpty: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  children?: ReactNode;
}

/**
 * Zone « Hors planning » : dépôt pour déplanifier une carte (desktop + surbrillance touch).
 */
export function UnplannedDropZone({
  isDragOver,
  isTouchHighlight,
  isEmpty,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: UnplannedDropZoneProps) {
  const active = isDragOver || isTouchHighlight;
  return (
    <div
      data-unplanned
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`rounded-2xl p-3 sm:p-5 min-h-[72px] sm:min-h-[88px] transition-all ${
        active ? "bg-muted/60 ring-2 ring-border" : "bg-card/80 backdrop-blur-sm"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm sm:text-base font-bold text-foreground">Hors planning</h3>
      </div>
      {isEmpty ? (
        <p className={`text-xs italic ${isDragOver ? "text-foreground/60" : "text-muted-foreground/50"}`}>
          {isDragOver
            ? "Relâche pour retirer du planning ↓"
            : "Tous les repas sont planifiés ✨"}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">{children}</div>
      )}
    </div>
  );
}
