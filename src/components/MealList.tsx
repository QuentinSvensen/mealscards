import { useState, useCallback } from "react";

interface MealListProps {
  title: string;
  emoji: string;
  count: number;
  children: React.ReactNode;
  onExternalDrop?: (mealId: string) => void;
  headerActions?: React.ReactNode;
}

export function MealList({ title, emoji, count, children, onExternalDrop, headerActions }: MealListProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const mealId = e.dataTransfer.getData("mealId");
    const source = e.dataTransfer.getData("source");
    if (mealId && source !== title && onExternalDrop) {
      onExternalDrop(mealId);
    }
  }, [onExternalDrop, title]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col rounded-3xl bg-card/80 backdrop-blur-sm p-5 min-h-[200px] transition-all ${
        dragOver ? "ring-4 ring-primary/40 bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <span className="text-2xl">{emoji}</span> {title}
        </h2>
        <span className="text-sm font-normal text-muted-foreground">{count}</span>
        <div className="ml-auto flex items-center gap-1">
          {headerActions}
        </div>
      </div>

      <div className="flex flex-col gap-2 flex-1">
        {children}
      </div>
    </div>
  );
}
