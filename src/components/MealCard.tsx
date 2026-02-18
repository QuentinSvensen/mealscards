import { useState, useRef } from "react";
import { ArrowRight, MoreVertical, Pencil, Trash2, Flame, Weight, List, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [editing, setEditing] = useState<"name" | "calories" | "grams" | null>(null);
  const [editValue, setEditValue] = useState("");
  // Ingredients: managed as array of lines
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [ingredientLines, setIngredientLines] = useState<string[]>([]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleSave = () => {
    const val = editValue.trim();
    if (editing === "name" && val && val !== meal.name) onRename(val);
    if (editing === "calories") onUpdateCalories(val || null);
    if (editing === "grams") onUpdateGrams(val || null);
    setEditing(null);
  };

  const openIngredients = () => {
    const lines = meal.ingredients
      ? meal.ingredients.split(/[,\n]+/).map(s => s.trim()).filter(Boolean)
      : [];
    // Always show at least 2 empty lines
    while (lines.length < 2) lines.push("");
    setIngredientLines(lines);
    setEditingIngredients(true);
  };

  const commitIngredients = () => {
    const joined = ingredientLines.filter(Boolean).join(", ");
    onUpdateIngredients(joined || null);
    setEditingIngredients(false);
  };

  const handleIngredientChange = (idx: number, value: string) => {
    setIngredientLines(prev => {
      const next = [...prev];
      next[idx] = value;
      // Add new line if last line is not empty
      if (idx === next.length - 1 && value.trim()) {
        next.push("");
      }
      return next;
    });
  };

  const handleIngredientKey = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (idx === ingredientLines.length - 1 && ingredientLines[idx].trim()) {
        // Move focus to next (new) line
        setTimeout(() => inputRefs.current[idx + 1]?.focus(), 0);
      } else if (idx < ingredientLines.length - 1) {
        inputRefs.current[idx + 1]?.focus();
      } else {
        commitIngredients();
      }
    }
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
      {editing ? (
        <Input
          autoFocus
          placeholder={editing === "name" ? "Nom" : editing === "calories" ? "Ex: 350 kcal" : "Ex: 150g"}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="h-8 border-white/30 bg-white/20 text-white placeholder:text-white/60 flex-1"
        />
      ) : editingIngredients ? (
        <div
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              commitIngredients();
            }
          }}
          className="flex flex-col gap-1"
        >
          {ingredientLines.map((line, idx) => (
            <Input
              key={idx}
              ref={el => { inputRefs.current[idx] = el; }}
              autoFocus={idx === 0}
              placeholder={`Ingrédient ${idx + 1}…`}
              value={line}
              onChange={(e) => handleIngredientChange(idx, e.target.value)}
              onKeyDown={(e) => handleIngredientKey(idx, e)}
              className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-xs px-2"
            />
          ))}
          <button onClick={commitIngredients} className="text-[10px] text-white/60 hover:text-white text-left mt-0.5">✓ Valider</button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="flex-1 font-semibold text-white text-sm truncate">{meal.name}</span>
            {meal.grams && (
              <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                <Weight className="h-3 w-3" />{meal.grams}
              </span>
            )}
            {meal.calories && (
              <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
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
                <DropdownMenuItem onClick={openIngredients}>
                  <List className="mr-2 h-4 w-4" /> Ingrédients
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Supprimer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Ingredients display */}
          {meal.ingredients && (
            <div className="mt-1.5 text-xs text-white/70 flex flex-wrap gap-x-1">
              {meal.ingredients.split(/[,\n]+/).filter(Boolean).map((ing, i, arr) => (
                <span key={i}>{ing.trim()}{i < arr.length - 1 ? ' •' : ''}</span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
