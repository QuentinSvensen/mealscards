import { useState, useRef } from "react";
import { ArrowLeft, Copy, MoreVertical, Trash2, Calendar, Timer, Flame, Weight, List, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  onReturnWithoutDeduction?: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdateExpiration: (date: string | null) => void;
  onUpdatePlanning: (day: string | null, time: string | null) => void;
  onUpdateCounter: (date: string | null) => void;
  onUpdateCalories: (cal: string | null) => void;
  onUpdateGrams: (g: string | null) => void;
  onUpdateIngredients: (ing: string | null) => void;
  onUpdatePossibleIngredients?: (newIngredients: string | null) => void;
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

// --- Ingredient grid helpers (same logic as MealCard) ---

interface IngLine { qty: string; count: string; name: string; isOr: boolean; }

function parseIngredientLine(raw: string): IngLine {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { qty: "", count: "", name: "", isOr: false };
  const unitRegex = "(?:g|gr|gramme?s?|kg|ml|cl|l)";
  const matchFull = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i"));
  if (matchFull) return { qty: matchFull[1], count: matchFull[2], name: matchFull[3].trim(), isOr: false };
  const matchUnit = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(.+)$`, "i"));
  if (matchUnit) return { qty: matchUnit[1], count: "", name: matchUnit[2].trim(), isOr: false };
  const matchNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (matchNum) return { qty: "", count: matchNum[1], name: matchNum[2].trim(), isOr: false };
  return { qty: "", count: "", name: trimmed, isOr: false };
}

function formatQty(qty: string): string {
  const trimmed = qty.trim();
  if (!trimmed) return "";
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return trimmed + "g";
  return trimmed;
}

function parseIngredientsToLines(raw: string | null): IngLine[] {
  if (!raw) return [{ qty: "", count: "", name: "", isOr: false }];
  const groups = raw.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
  const lines: IngLine[] = [];
  for (const group of groups) {
    const alts = group.split(/\|/).map(s => s.trim()).filter(Boolean);
    alts.forEach((alt, i) => {
      const parsed = parseIngredientLine(alt);
      parsed.isOr = i > 0;
      lines.push(parsed);
    });
  }
  if (lines.length < 2) lines.push({ qty: "", count: "", name: "", isOr: false });
  return lines;
}

function serializeIngredients(lines: IngLine[]): string | null {
  const result: string[] = [];
  let currentGroup: string[] = [];
  const flushGroup = () => { if (currentGroup.length > 0) { result.push(currentGroup.join(" | ")); currentGroup = []; } };
  for (const l of lines) {
    const qtyStr = formatQty(l.qty);
    const countStr = l.count.trim();
    const nameStr = l.name.trim();
    if (!qtyStr && !countStr && !nameStr) continue;
    const token = [qtyStr, countStr, nameStr].filter(Boolean).join(" ");
    if (l.isOr) { currentGroup.push(token); } else { flushGroup(); currentGroup.push(token); }
  }
  flushGroup();
  return result.length ? result.join(", ") : null;
}

export function PossibleMealCard({ pm, onRemove, onReturnWithoutDeduction, onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning, onUpdateCounter, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onUpdatePossibleIngredients, onDragStart, onDragOver, onDrop, isHighlighted }: PossibleMealCardProps) {
  const [editing, setEditing] = useState<"calories" | "grams" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [calOpen, setCalOpen] = useState(false);
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [ingLines, setIngLines] = useState<IngLine[]>([]);
  const qtyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const countRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);

  const meal = pm.meals;
  if (!meal) return null;

  const displayIngredients = pm.ingredients_override ?? meal.ingredients;

  const isExpired = pm.expiration_date && new Date(pm.expiration_date) < new Date();
  const expIsToday = pm.expiration_date ? (() => {
    const d = new Date(pm.expiration_date!);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  })() : false;
  const counterDays = getCounterDays(pm.counter_start_date);
  const counterUrgent = counterDays !== null && counterDays >= 3;

  const handleSaveEdit = () => {
    const val = editValue.trim() || null;
    if (editing === "calories") onUpdateCalories(val);
    if (editing === "grams") onUpdateGrams(val);
    setEditing(null);
  };

  const openIngredients = () => {
    setIngLines(parseIngredientsToLines(displayIngredients));
    setEditingIngredients(true);
  };

  const commitIngredients = () => {
    const serialized = serializeIngredients(ingLines);
    if (onUpdatePossibleIngredients) {
      onUpdatePossibleIngredients(serialized);
    } else {
      onUpdateIngredients(serialized);
    }
    setEditingIngredients(false);
  };

  const updateLine = (idx: number, field: "qty" | "count" | "name", value: string) => {
    setIngLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "name" && idx === next.length - 1 && value.trim()) {
        next.push({ qty: "", count: "", name: "", isOr: false });
      }
      return next;
    });
  };

  const toggleOr = (idx: number) => {
    if (idx === 0) return;
    setIngLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], isOr: !next[idx].isOr };
      return next;
    });
  };

  const handleIngKeyDown = (idx: number, field: "qty" | "count" | "name", e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (field === "qty") countRefs.current[idx]?.focus();
      else if (field === "count") nameRefs.current[idx]?.focus();
      else if (idx < ingLines.length - 1) qtyRefs.current[idx + 1]?.focus();
      else if (ingLines[idx].name.trim()) setTimeout(() => qtyRefs.current[idx + 1]?.focus(), 0);
      else commitIngredients();
    }
    if (e.key === "Escape") commitIngredients();
  };

  const selectedDate = pm.expiration_date ? parseISO(pm.expiration_date) : undefined;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group flex flex-col rounded-2xl px-3 py-2.5 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg ${isHighlighted ? 'ring-4 ring-yellow-400 scale-105' : expIsToday ? 'ring-2 ring-red-500' : isExpired ? 'ring-2 ring-red-500' : ''}`}
      style={{ backgroundColor: meal.color }}
    >
      {/* Row 1: name + counter inline + actions */}
      <div className="flex items-center gap-1.5">
        <Button size="icon" variant="ghost" onClick={onRemove} className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>

        <span className="font-semibold text-white text-sm truncate">{meal.name}</span>

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
            {onReturnWithoutDeduction && (
              <DropdownMenuItem onClick={onReturnWithoutDeduction}>
                <Undo2 className="mr-2 h-4 w-4" /> Remettre au choix (sans déduire)
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }}>
              <Flame className="mr-2 h-4 w-4" /> Calories
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }}>
              <Weight className="mr-2 h-4 w-4" /> Grammes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openIngredients}>
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
      {editing ? (
        <Input autoFocus placeholder={editing === "calories" ? "Ex: 350 kcal" : "Ex: 150g"} value={editValue}
          onChange={(e) => setEditValue(e.target.value)} onBlur={handleSaveEdit}
          onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
          className="mt-1.5 h-6 border-white/30 bg-white/20 text-white placeholder:text-white/60 text-xs" />
      ) : editingIngredients ? (
        <div
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) commitIngredients();
          }}
          className="flex flex-col gap-1 mt-1.5"
        >
          <div className="grid grid-cols-[1.5rem_3.5rem_2.5rem_1fr] gap-1 mb-0.5">
            <span className="text-[9px] text-white/50 text-center">Ou</span>
            <span className="text-[9px] text-white/50 text-center">Grammes</span>
            <span className="text-[9px] text-white/50 text-center">Qté</span>
            <span className="text-[9px] text-white/50">Nom</span>
          </div>
          {ingLines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-[1.5rem_3.5rem_2.5rem_1fr] gap-1">
              <button
                type="button"
                onClick={() => toggleOr(idx)}
                className={`h-7 flex items-center justify-center rounded text-[9px] font-bold transition-all ${
                  idx === 0
                    ? 'text-white/15 cursor-default'
                    : line.isOr
                      ? 'bg-yellow-400/30 text-yellow-200 border border-yellow-400/50'
                      : 'text-white/30 hover:text-white/60 hover:bg-white/10'
                }`}
                disabled={idx === 0}
              >
                {line.isOr ? "ou" : idx > 0 ? "+" : ""}
              </button>
              <Input
                ref={el => { qtyRefs.current[idx] = el; }}
                autoFocus={idx === 0}
                placeholder="g"
                inputMode="decimal"
                value={line.qty}
                onChange={e => updateLine(idx, "qty", e.target.value)}
                onKeyDown={e => handleIngKeyDown(idx, "qty", e)}
                className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-1.5"
              />
              <Input
                ref={el => { countRefs.current[idx] = el; }}
                placeholder="#"
                inputMode="numeric"
                value={line.count}
                onChange={e => updateLine(idx, "count", e.target.value)}
                onKeyDown={e => handleIngKeyDown(idx, "count", e)}
                className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-1"
              />
              <Input
                ref={el => { nameRefs.current[idx] = el; }}
                placeholder={`Ingrédient ${idx + 1}`}
                value={line.name}
                onChange={e => updateLine(idx, "name", e.target.value)}
                onKeyDown={e => handleIngKeyDown(idx, "name", e)}
                className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-2"
              />
            </div>
          ))}
          <button onClick={commitIngredients} className="text-[10px] text-white/60 hover:text-white text-left mt-0.5">✓ Valider</button>
        </div>
      ) : null}

      {/* Row 2: expiration (calendar picker) + planning */}
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        <Calendar className="h-2.5 w-2.5 text-white/50 shrink-0" />

        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button
              className={`h-5 min-w-[88px] border bg-white/10 text-white text-[10px] px-1.5 rounded-md flex items-center hover:bg-white/20 transition-colors ${
                expIsToday ? 'border-red-500 ring-1 ring-red-500 text-red-200' : isExpired ? 'border-white/20 text-red-200' : 'border-white/20'
              }`}
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

      {/* Row 3: ingredients (click to edit) */}
      {!editing && !editingIngredients && displayIngredients && (
        <button onClick={openIngredients} className="mt-1 text-[10px] text-white/60 flex flex-wrap gap-x-1 text-left hover:text-white/80 transition-colors">
          {displayIngredients.split(/[,\n]+/).filter(Boolean).map((ing, i, arr) => (
            <span key={i}>{ing.trim()}{i < arr.length - 1 ? ' •' : ''}</span>
          ))}
        </button>
      )}
    </div>
  );
}