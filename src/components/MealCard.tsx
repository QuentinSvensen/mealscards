import { useState } from "react";
import { ArrowRight, MoreVertical, Pencil, Trash2, Flame, Weight, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Meal } from "@/hooks/useMeals";

interface MealCardProps {
  meal: Meal;
  onMoveToPossible: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUpdateCalories: (calories: string | null) => void;
  onUpdateGrams: (grams: string | null) => void;
  onUpdateIngredients: (ingredients: string | null) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isHighlighted?: boolean;
}

export function MealCard({ meal, onMoveToPossible, onRename, onDelete, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onDragStart, onDragOver, onDrop, isHighlighted }: MealCardProps) {
  const [editing, setEditing] = useState<"name" | "calories" | "grams" | "ingredients" | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleSave = () => {
    const val = editValue.trim();
    if (editing === "name" && val && val !== meal.name) onRename(val);
    if (editing === "calories") onUpdateCalories(val || null);
    if (editing === "grams") onUpdateGrams(val || null);
    if (editing === "ingredients") onUpdateIngredients(val || null);
    setEditing(null);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group flex flex-col rounded-2xl px-4 py-3 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg ${isHighlighted ? 'ring-4 ring-yellow-400 scale-105' : ''}`}
      style={{ backgroundColor: meal.color }}
    >
      {editing === "ingredients" ? (
        <Textarea
          autoFocus
          placeholder="Ingrédient 1, Ingrédient 2, ..."
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          className="min-h-[60px] border-white/30 bg-white/20 text-white placeholder:text-white/60 text-sm"
        />
      ) : editing ? (
        <Input
          autoFocus
          placeholder={editing === "name" ? "Nom" : editing === "calories" ? "Ex: 350 kcal" : "Ex: 150g"}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="h-8 border-white/30 bg-white/20 text-white placeholder:text-white/60 flex-1"
        />
      ) : (
        <div className="flex items-center gap-2">
          <span className="flex-1 font-semibold text-white text-sm truncate">{meal.name}</span>
          {meal.grams && (
            <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-1">
              <Weight className="h-3 w-3" />{meal.grams}
            </span>
          )}
          {meal.calories && (
            <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-1">
              <Flame className="h-3 w-3" />{meal.calories}
            </span>
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
              <DropdownMenuItem onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }}>
                <Weight className="mr-2 h-4 w-4" /> Grammes
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditValue(meal.ingredients || ""); setEditing("ingredients"); }}>
                <List className="mr-2 h-4 w-4" /> Ingrédients
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" /> Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Ingredients display */}
      {!editing && meal.ingredients && (
        <div className="mt-1.5 text-xs text-white/70 flex flex-wrap gap-x-1">
          {meal.ingredients.split(/[,\n]+/).filter(Boolean).map((ing, i, arr) => (
            <span key={i}>{ing.trim()}{i < arr.length - 1 ? ' •' : ''}</span>
          ))}
        </div>
      )}
    </div>
  );
}
