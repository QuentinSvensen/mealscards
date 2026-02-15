import { useState } from "react";
import { ArrowLeft, Minus, Plus, MoreVertical, Trash2, Calendar, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PossibleMeal } from "@/hooks/useMeals";
import { DAYS, TIMES } from "@/hooks/useMeals";

interface PossibleMealCardProps {
  pm: PossibleMeal;
  onRemove: () => void;
  onDelete: () => void;
  onUpdateQuantity: (quantity: number) => void;
  onUpdateExpiration: (date: string | null) => void;
  onUpdatePlanning: (day: string | null, time: string | null) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isHighlighted?: boolean;
}

const DAY_LABELS: Record<string, string> = {
  lundi: 'Lun', mardi: 'Mar', mercredi: 'Mer', jeudi: 'Jeu',
  vendredi: 'Ven', samedi: 'Sam', dimanche: 'Dim',
};

export function PossibleMealCard({ pm, onRemove, onDelete, onUpdateQuantity, onUpdateExpiration, onUpdatePlanning, onDragStart, onDragOver, onDrop, isHighlighted }: PossibleMealCardProps) {
  const [editingExpiration, setEditingExpiration] = useState(false);
  const [editingPlanning, setEditingPlanning] = useState(false);

  const meal = pm.meals;
  if (!meal) return null;

  const isExpired = pm.expiration_date && new Date(pm.expiration_date) < new Date();

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
        <Button size="icon" variant="ghost" onClick={onRemove} className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <span className="flex-1 font-semibold text-white text-sm truncate">{meal.name}</span>

        {meal.calories && (
          <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full">{meal.calories}</span>
        )}

        {/* Quantity controls */}
        <div className="flex items-center gap-1 bg-white/20 rounded-full px-1">
          <Button size="icon" variant="ghost" onClick={() => onUpdateQuantity(pm.quantity - 1)} className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/20 p-0">
            <Minus className="h-3 w-3" />
          </Button>
          <span className="text-white text-xs font-bold min-w-[16px] text-center">{pm.quantity}</span>
          <Button size="icon" variant="ghost" onClick={() => onUpdateQuantity(pm.quantity + 1)} className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/20 p-0">
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditingExpiration(true)}>
              <Calendar className="mr-2 h-4 w-4" /> Date de péremption
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditingPlanning(true)}>
              <Clock className="mr-2 h-4 w-4" /> Planifier
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Row 2: metadata */}
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {editingExpiration ? (
          <Input
            autoFocus
            type="date"
            defaultValue={pm.expiration_date || ""}
            onBlur={(e) => { onUpdateExpiration(e.target.value || null); setEditingExpiration(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onUpdateExpiration((e.target as HTMLInputElement).value || null); setEditingExpiration(false); }
            }}
            className="h-7 w-36 border-white/30 bg-white/20 text-white text-xs"
          />
        ) : pm.expiration_date ? (
          <button
            onClick={() => setEditingExpiration(true)}
            className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${isExpired ? 'bg-red-500/40 text-white' : 'bg-white/20 text-white/80'}`}
          >
            <Calendar className="h-3 w-3" />
            {new Date(pm.expiration_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </button>
        ) : null}

        {editingPlanning ? (
          <div className="flex gap-1 items-center">
            <Select
              defaultValue={pm.day_of_week || undefined}
              onValueChange={(val) => {
                onUpdatePlanning(val, pm.meal_time);
                setEditingPlanning(false);
              }}
            >
              <SelectTrigger className="h-7 w-24 border-white/30 bg-white/20 text-white text-xs">
                <SelectValue placeholder="Jour" />
              </SelectTrigger>
              <SelectContent>
                {DAYS.map((d) => (
                  <SelectItem key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              defaultValue={pm.meal_time || undefined}
              onValueChange={(val) => {
                onUpdatePlanning(pm.day_of_week, val);
                setEditingPlanning(false);
              }}
            >
              <SelectTrigger className="h-7 w-20 border-white/30 bg-white/20 text-white text-xs">
                <SelectValue placeholder="Quand" />
              </SelectTrigger>
              <SelectContent>
                {TIMES.map((t) => (
                  <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="icon" variant="ghost" onClick={() => { onUpdatePlanning(null, null); setEditingPlanning(false); }} className="h-6 w-6 text-white/60 hover:text-white">
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ) : (pm.day_of_week || pm.meal_time) ? (
          <button
            onClick={() => setEditingPlanning(true)}
            className="text-xs bg-white/20 text-white/80 px-2 py-0.5 rounded-full flex items-center gap-1"
          >
            <Clock className="h-3 w-3" />
            {pm.day_of_week ? DAY_LABELS[pm.day_of_week] : ''}{pm.day_of_week && pm.meal_time ? ' ' : ''}{pm.meal_time || ''}
          </button>
        ) : null}
      </div>
    </div>
  );
}
