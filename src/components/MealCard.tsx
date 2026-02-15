import { useState } from "react";
import { ArrowRight, MoreVertical, Pencil, Trash2, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Meal } from "@/hooks/useMeals";

interface MealCardProps {
  meal: Meal;
  onMoveToPossible: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUpdateCalories: (calories: string | null) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isHighlighted?: boolean;
}

export function MealCard({ meal, onMoveToPossible, onRename, onDelete, onUpdateCalories, onDragStart, onDragOver, onDrop, isHighlighted }: MealCardProps) {
  const [editing, setEditing] = useState<"name" | "calories" | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleSaveName = () => {
    if (editValue.trim() && editValue.trim() !== meal.name) {
      onRename(editValue.trim());
    }
    setEditing(null);
  };

  const handleSaveCalories = () => {
    const val = editValue.trim() || null;
    if (val !== meal.calories) {
      onUpdateCalories(val);
    }
    setEditing(null);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group flex items-center gap-2 rounded-2xl px-4 py-3 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg ${isHighlighted ? 'ring-4 ring-yellow-400 scale-105' : ''}`}
      style={{ backgroundColor: meal.color }}
    >
      {editing === "name" ? (
        <Input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
          className="h-8 border-white/30 bg-white/20 text-white placeholder:text-white/60 flex-1"
        />
      ) : editing === "calories" ? (
        <Input
          autoFocus
          placeholder="Ex: 350 kcal"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSaveCalories}
          onKeyDown={(e) => e.key === "Enter" && handleSaveCalories()}
          className="h-8 border-white/30 bg-white/20 text-white placeholder:text-white/60 flex-1"
        />
      ) : (
        <>
          <span className="flex-1 font-semibold text-white text-sm truncate">{meal.name}</span>
          {meal.calories && (
            <span className="text-xs text-white/70 bg-white/20 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Flame className="h-3 w-3" />
              {meal.calories}
            </span>
          )}
        </>
      )}

      <Button size="icon" variant="ghost" onClick={onMoveToPossible} className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
        <ArrowRight className="h-4 w-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setEditValue(meal.name); setEditing("name"); }}>
            <Pencil className="mr-2 h-4 w-4" /> Renommer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }}>
            <Flame className="mr-2 h-4 w-4" /> Calories
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" /> Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
