import { useState } from "react";
import { MealCard } from "./MealCard";
import type { Meal } from "@/hooks/useMeals";

interface MealListProps {
  title: string;
  emoji: string;
  meals: Meal[];
  direction: "left" | "right";
  onMove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDrop: (mealId: string) => void;
}

export function MealList({ title, emoji, meals, direction, onMove, onRename, onDelete, onDrop }: MealListProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const mealId = e.dataTransfer.getData("mealId");
    if (mealId) onDrop(mealId);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col rounded-3xl bg-card/80 backdrop-blur-sm p-5 min-h-[300px] transition-all ${
        dragOver ? "ring-4 ring-primary/40 bg-primary/5" : ""
      }`}
    >
      <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
        <span className="text-2xl">{emoji}</span> {title}
        <span className="ml-auto text-sm font-normal text-muted-foreground">{meals.length}</span>
      </h2>

      <div className="flex flex-col gap-2 flex-1">
        {meals.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-8 italic">
            {direction === "right" ? "Glisse des repas ici →" : "← Glisse des repas ici"}
          </p>
        )}
        {meals.map((meal) => (
          <MealCard
            key={meal.id}
            meal={meal}
            direction={direction}
            onMove={() => onMove(meal.id)}
            onRename={(name) => onRename(meal.id, name)}
            onDelete={() => onDelete(meal.id)}
            onDragStart={(e) => e.dataTransfer.setData("mealId", meal.id)}
          />
        ))}
      </div>
    </div>
  );
}
