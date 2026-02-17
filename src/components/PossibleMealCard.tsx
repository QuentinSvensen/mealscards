import { useState } from "react";
import { ArrowLeft, Copy, MoreVertical, Trash2, Calendar, Clock, Timer, Flame, Weight, Pencil, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PossibleMeal } from "@/hooks/useMeals";
import { DAYS, TIMES } from "@/hooks/useMeals";

interface PossibleMealCardProps {
  pm: PossibleMeal;
  onRemove: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdateExpiration: (date: string | null) => void;
  onUpdatePlanning: (day: string | null, time: string | null) => void;
  onUpdateCounter: (date: string | null) => void;
  onUpdateCalories: (cal: string | null) => void;
  onUpdateGrams: (g: string | null) => void;
  onUpdateIngredients: (ing: string | null) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isHighlighted?: boolean;
}

const DAY_LABELS: Record<string, string> = {
  lundi: 'Lun', mardi: 'Mar', mercredi: 'Mer', jeudi: 'Jeu',
  vendredi: 'Ven', samedi: 'Sam', dimanche: 'Dim',
};

function getCounterDays(startDate: string | null): number | null {
  if (!startDate) return null;
  const diff = Date.now() - new Date(startDate).getTime();
  return Math.floor(diff / 86400000);
}

export function PossibleMealCard({ pm, onRemove, onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning, onUpdateCounter, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onDragStart, onDragOver, onDrop, isHighlighted }: PossibleMealCardProps) {
  const [editing, setEditing] = useState<"calories" | "grams" | "ingredients" | null>(null);
  const [editValue, setEditValue] = useState("");

  const meal = pm.meals;
  if (!meal) return null;

  const isExpired = pm.expiration_date && new Date(pm.expiration_date) < new Date();
  const counterDays = getCounterDays(pm.counter_start_date);

  const handleSaveEdit = () => {
    const val = editValue.trim() || null;
    if (editing === "calories") onUpdateCalories(val);
    if (editing === "grams") onUpdateGrams(val);
    if (editing === "ingredients") onUpdateIngredients(val);
    setEditing(null);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group flex flex-col rounded-2xl px-4 py-3 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg ${isHighlighted ? 'ring-4 ring-yellow-400 scale-105' : ''} ${isExpired ? 'opacity-70' : ''}`}
      style={{ backgroundColor: meal.color }}
    >
      {/* Row 1: name + actions */}
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={onRemove} className="h-7 w-7 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <span className="flex-1 font-semibold text-white text-sm truncate">{meal.name}</span>

        {meal.grams && (
          <button onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }} className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30">
            <Weight className="h-3 w-3" />{meal.grams}
          </button>
        )}
        {meal.calories && (
          <button onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }} className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30">
            <Flame className="h-3 w-3" />{meal.calories}
          </button>
        )}

        <Button size="icon" variant="ghost" onClick={onDuplicate} className="h-7 w-7 shrink-0 text-white/80 hover:text-white hover:bg-white/20" title="Dupliquer">
          <Copy className="h-3.5 w-3.5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }}>
              <Flame className="mr-2 h-4 w-4" /> Calories
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }}>
              <Weight className="mr-2 h-4 w-4" /> Grammes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setEditValue(meal.ingredients || ""); setEditing("ingredients"); }}>
              <List className="mr-2 h-4 w-4" /> Ingrédients
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onUpdateCounter(pm.counter_start_date ? null : new Date().toISOString())}>
              <Timer className="mr-2 h-4 w-4" /> {pm.counter_start_date ? 'Arrêter compteur' : 'Démarrer compteur'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Editing overlay */}
      {editing === "ingredients" ? (
        <Textarea autoFocus placeholder="Ingrédient 1, Ingrédient 2, ..." value={editValue}
          onChange={(e) => setEditValue(e.target.value)} onBlur={handleSaveEdit}
          className="mt-2 min-h-[50px] border-white/30 bg-white/20 text-white placeholder:text-white/60 text-xs" />
      ) : editing ? (
        <Input autoFocus placeholder={editing === "calories" ? "Ex: 350 kcal" : "Ex: 150g"} value={editValue}
          onChange={(e) => setEditValue(e.target.value)} onBlur={handleSaveEdit}
          onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
          className="mt-2 h-7 border-white/30 bg-white/20 text-white placeholder:text-white/60 text-xs" />
      ) : null}

      {/* Row 2: expiration + planning + counter */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <div className="flex items-center gap-0.5">
          <Calendar className="h-3 w-3 text-white/60" />
          <Input
            type="date"
            value={pm.expiration_date || ""}
            onChange={(e) => onUpdateExpiration(e.target.value || null)}
            className={`h-6 w-[120px] border-white/20 bg-white/15 text-white text-[10px] px-1 ${isExpired ? 'text-red-200' : ''}`}
          />
        </div>

        <Select value={pm.day_of_week || "none"} onValueChange={(val) => onUpdatePlanning(val === "none" ? null : val, pm.meal_time)}>
          <SelectTrigger className="h-6 w-[72px] border-white/20 bg-white/15 text-white text-[10px] px-1">
            <SelectValue placeholder="Jour" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {DAYS.map((d) => (
              <SelectItem key={d} value={d}>{DAY_LABELS[d]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={pm.meal_time || "none"} onValueChange={(val) => onUpdatePlanning(pm.day_of_week, val === "none" ? null : val)}>
          <SelectTrigger className="h-6 w-[62px] border-white/20 bg-white/15 text-white text-[10px] px-1">
            <SelectValue placeholder="Quand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {TIMES.map((t) => (
              <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {counterDays !== null && (
          <span className="text-[10px] text-white/80 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Timer className="h-3 w-3" /> {counterDays}j
          </span>
        )}
      </div>

      {/* Row 3: ingredients */}
      {!editing && meal.ingredients && (
        <div className="mt-1.5 text-[10px] text-white/65 flex flex-wrap gap-x-1">
          {meal.ingredients.split(/[,\n]+/).filter(Boolean).map((ing, i, arr) => (
            <span key={i}>{ing.trim()}{i < arr.length - 1 ? ' •' : ''}</span>
          ))}
        </div>
      )}
    </div>
  );
}
