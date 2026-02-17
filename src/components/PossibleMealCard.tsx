import { useState } from "react";
import { ArrowLeft, Copy, MoreVertical, Trash2, Calendar, Timer, Flame, Weight, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PossibleMeal } from "@/hooks/useMeals";
import { DAYS, TIMES } from "@/hooks/useMeals";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

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
  const [calOpen, setCalOpen] = useState(false);

  const meal = pm.meals;
  if (!meal) return null;

  const isExpired = pm.expiration_date && new Date(pm.expiration_date) < new Date();
  const counterDays = getCounterDays(pm.counter_start_date);
  const counterUrgent = counterDays !== null && counterDays >= 3;

  const handleSaveEdit = () => {
    const val = editValue.trim() || null;
    if (editing === "calories") onUpdateCalories(val);
    if (editing === "grams") onUpdateGrams(val);
    if (editing === "ingredients") onUpdateIngredients(val);
    setEditing(null);
  };

  const selectedDate = pm.expiration_date ? parseISO(pm.expiration_date) : undefined;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group flex flex-col rounded-2xl px-3 py-2.5 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg ${isHighlighted ? 'ring-4 ring-yellow-400 scale-105' : ''} ${isExpired ? 'opacity-70' : ''}`}
      style={{ backgroundColor: meal.color }}
    >
      {/* Row 1: name + counter inline + actions */}
      <div className="flex items-center gap-1.5">
        <Button size="icon" variant="ghost" onClick={onRemove} className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>

        <span className="font-semibold text-white text-sm truncate">{meal.name}</span>

        {/* Counter directly after name */}
        {counterDays !== null && (
          <button
            onClick={() => onUpdateCounter(null)}
            className={`text-xs font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 transition-all shrink-0 ${
              counterUrgent
                ? 'bg-red-500/80 text-white animate-pulse shadow-lg shadow-red-500/30'
                : 'bg-white/25 text-white'
            }`}
          >
            <Timer className="h-3 w-3" /> {counterDays}j
          </button>
        )}

        <div className="flex-1" />

        {meal.grams && (
          <button onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }} className="text-[10px] text-white/70 bg-white/20 px-1 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30 shrink-0">
            <Weight className="h-2.5 w-2.5" />{meal.grams}
          </button>
        )}
        {meal.calories && (
          <button onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }} className="text-[10px] text-white/70 bg-white/20 px-1 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30 shrink-0">
            <Flame className="h-2.5 w-2.5" />{meal.calories}
          </button>
        )}

        <Button size="icon" variant="ghost" onClick={onDuplicate} className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20" title="Dupliquer">
          <Copy className="h-3 w-3" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
              <MoreVertical className="h-3.5 w-3.5" />
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
          className="mt-1.5 min-h-[50px] border-white/30 bg-white/20 text-white placeholder:text-white/60 text-xs" />
      ) : editing ? (
        <Input autoFocus placeholder={editing === "calories" ? "Ex: 350 kcal" : "Ex: 150g"} value={editValue}
          onChange={(e) => setEditValue(e.target.value)} onBlur={handleSaveEdit}
          onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
          className="mt-1.5 h-6 border-white/30 bg-white/20 text-white placeholder:text-white/60 text-xs" />
      ) : null}

      {/* Row 2: expiration (calendar picker) + planning */}
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        <Calendar className="h-2.5 w-2.5 text-white/50 shrink-0" />

        {/* Expiration date — calendar popover */}
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button
              className={`h-5 min-w-[88px] border border-white/20 bg-white/10 text-white text-[10px] px-1.5 rounded-md flex items-center hover:bg-white/20 transition-colors ${isExpired ? 'text-red-200' : ''}`}
            >
              {pm.expiration_date
                ? format(parseISO(pm.expiration_date), 'd MMM yy', { locale: fr })
                : <span className="text-white/40">Date péremption</span>
              }
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarPicker
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                onUpdateExpiration(date ? format(date, 'yyyy-MM-dd') : null);
                setCalOpen(false);
              }}
              initialFocus
            />
            {pm.expiration_date && (
              <div className="p-2 border-t">
                <button
                  onClick={() => { onUpdateExpiration(null); setCalOpen(false); }}
                  className="text-xs text-muted-foreground hover:text-destructive w-full text-center"
                >
                  Effacer la date
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <Select value={pm.day_of_week || "none"} onValueChange={(val) => onUpdatePlanning(val === "none" ? null : val, pm.meal_time)}>
          <SelectTrigger className="h-5 w-[58px] border-white/20 bg-white/10 text-white text-[10px] px-1">
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
          <SelectTrigger className="h-5 w-[50px] border-white/20 bg-white/10 text-white text-[10px] px-1">
            <SelectValue placeholder="Quand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {TIMES.map((t) => (
              <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Row 3: ingredients */}
      {!editing && meal.ingredients && (
        <div className="mt-1 text-[10px] text-white/60 flex flex-wrap gap-x-1">
          {meal.ingredients.split(/[,\n]+/).filter(Boolean).map((ing, i, arr) => (
            <span key={i}>{ing.trim()}{i < arr.length - 1 ? ' •' : ''}</span>
          ))}
        </div>
      )}
    </div>
  );
}
