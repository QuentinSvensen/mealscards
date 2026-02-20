import { useState, useRef } from "react";
import { ArrowRight, MoreVertical, Pencil, Trash2, Flame, Weight, List, Star, Thermometer, Hash } from "lucide-react";
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
  onToggleFavorite?: () => void;
  onUpdateOvenTemp?: (temp: string | null) => void;
  onUpdateOvenMinutes?: (minutes: string | null) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isHighlighted?: boolean;
  hideDelete?: boolean;
  expirationLabel?: string | null;
  expirationDate?: string | null;
}

interface IngLine { qty: string; count: string; name: string; }

function parseIngredientLine(raw: string): IngLine {
  const trimmed = raw.trim();
  // Try pattern: "150g 5 oeufs" or "5 oeufs" or "150g oeufs"
  // Format: [grams_with_unit] [count_without_unit] name
  // Or: qty_with_unit name
  // Or: count name
  const matchFull = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Zµ°%]+\.?)\s+(\d+(?:[.,]\d+)?)\s+(.*)/i);
  if (matchFull) {
    return { qty: matchFull[1], count: matchFull[3], name: matchFull[4].trim() };
  }
  const matchUnit = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Zµ°%]+\.?)\s*(.*)/i);
  if (matchUnit) {
    return { qty: matchUnit[1], count: "", name: matchUnit[3].trim() };
  }
  const matchNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.*)/);
  if (matchNum) {
    // Bare number = count (not grams)
    return { qty: "", count: matchNum[1], name: matchNum[2].trim() };
  }
  return { qty: "", count: "", name: trimmed };
}

function formatQty(qty: string): string {
  const trimmed = qty.trim();
  if (!trimmed) return "";
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return trimmed + "g";
  return trimmed;
}

function serializeIngredients(lines: IngLine[]): string | null {
  const parts = lines
    .filter(l => l.qty.trim() || l.count.trim() || l.name.trim())
    .map(l => {
      const qtyStr = formatQty(l.qty);
      const countStr = l.count.trim();
      return [qtyStr, countStr, l.name.trim()].filter(Boolean).join(" ");
    });
  return parts.length ? parts.join(", ") : null;
}

export function MealCard({ meal, onMoveToPossible, onRename, onDelete, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes, onDragStart, onDragOver, onDrop, isHighlighted, hideDelete, expirationLabel, expirationDate }: MealCardProps) {
  const [editing, setEditing] = useState<"name" | "calories" | "grams" | "oven_temp" | "oven_minutes" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [ingLines, setIngLines] = useState<IngLine[]>([]);
  const qtyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const countRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleSave = () => {
    const val = editValue.trim();
    if (editing === "name" && val && val !== meal.name) onRename(val);
    if (editing === "calories") onUpdateCalories(val || null);
    if (editing === "grams") onUpdateGrams(val || null);
    if (editing === "oven_temp") onUpdateOvenTemp?.(val || null);
    if (editing === "oven_minutes") onUpdateOvenMinutes?.(val || null);
    setEditing(null);
  };

  const openIngredients = () => {
    const raw = meal.ingredients
      ? meal.ingredients.split(/[,\n]+/).map(s => s.trim()).filter(Boolean)
      : [];
    const parsed: IngLine[] = raw.map(parseIngredientLine);
    while (parsed.length < 2) parsed.push({ qty: "", count: "", name: "" });
    setIngLines(parsed);
    setEditingIngredients(true);
  };

  const commitIngredients = () => {
    onUpdateIngredients(serializeIngredients(ingLines));
    setEditingIngredients(false);
  };

  const updateLine = (idx: number, field: "qty" | "count" | "name", value: string) => {
    setIngLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "name" && idx === next.length - 1 && value.trim()) {
        next.push({ qty: "", count: "", name: "" });
      }
      return next;
    });
  };

  const handleIngKeyDown = (idx: number, field: "qty" | "count" | "name", e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (field === "qty") {
        countRefs.current[idx]?.focus();
      } else if (field === "count") {
        nameRefs.current[idx]?.focus();
      } else if (idx < ingLines.length - 1) {
        qtyRefs.current[idx + 1]?.focus();
      } else if (ingLines[idx].name.trim()) {
        setTimeout(() => qtyRefs.current[idx + 1]?.focus(), 0);
      } else {
        commitIngredients();
      }
    }
    if (e.key === "Escape") commitIngredients();
  };

  const ovenTemp = (meal as any).oven_temp;
  const ovenMinutes = (meal as any).oven_minutes;
  const hasCuisson = ovenTemp || ovenMinutes;

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
          placeholder={editing === "name" ? "Nom" : editing === "calories" ? "Ex: 350 kcal" : editing === "grams" ? "Ex: 150g" : editing === "oven_temp" ? "Ex: 180" : "Ex: 25"}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          inputMode={editing === "oven_temp" || editing === "oven_minutes" ? "numeric" : undefined}
          className="h-8 border-white/30 bg-white/20 text-white placeholder:text-white/60 flex-1"
        />
      ) : editingIngredients ? (
        <div
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) commitIngredients();
          }}
          className="flex flex-col gap-1"
        >
          <div className="grid grid-cols-[3.5rem_2.5rem_1fr] gap-1 mb-0.5">
            <span className="text-[9px] text-white/50 text-center">Grammes</span>
            <span className="text-[9px] text-white/50 text-center">Qté</span>
            <span className="text-[9px] text-white/50">Nom</span>
          </div>
          {ingLines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-[3.5rem_2.5rem_1fr] gap-1">
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
      ) : (
        <>
          {/* Title always on its own line */}
          <span className="font-semibold text-white text-sm min-w-0 break-words whitespace-normal">{meal.name}</span>
          {/* Options row - aligned right */}
          <div className="flex items-center gap-1 mt-1 justify-end flex-wrap">
            {expirationLabel && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 font-semibold ${
                expirationDate && new Date(expirationDate) < new Date(new Date().toDateString())
                  ? 'text-red-200 bg-red-500/30'
                  : 'text-white/70 bg-white/20'
              }`}>
                📅 {expirationLabel}
              </span>
            )}
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
            {hasCuisson && (
              <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                <Thermometer className="h-3 w-3" />
                {ovenTemp ? `${ovenTemp}°C` : ''}{ovenTemp && ovenMinutes ? ' · ' : ''}{ovenMinutes ? `${ovenMinutes}min` : ''}
              </span>
            )}
            {onToggleFavorite && (
              <button
                onClick={onToggleFavorite}
                className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-full transition-all hover:bg-white/20 ${meal.is_favorite ? 'text-yellow-300' : 'text-white/40 hover:text-yellow-200'}`}
                title={meal.is_favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
              >
                <Star className={`h-3.5 w-3.5 ${meal.is_favorite ? 'fill-yellow-300' : ''}`} />
              </button>
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
                {onUpdateOvenTemp && (
                  <DropdownMenuItem onClick={() => { setEditValue(ovenTemp || ""); setEditing("oven_temp"); }}>
                    <Thermometer className="mr-2 h-4 w-4" /> Température (°C)
                  </DropdownMenuItem>
                )}
                {onUpdateOvenMinutes && (
                  <DropdownMenuItem onClick={() => { setEditValue(ovenMinutes || ""); setEditing("oven_minutes"); }}>
                    <Thermometer className="mr-2 h-4 w-4" /> Durée (min)
                  </DropdownMenuItem>
                )}
                {!hideDelete && (
                  <DropdownMenuItem onClick={onDelete} className="text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" /> Supprimer
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Ingredients display */}
          {meal.ingredients && (
            <p className="mt-1 text-[11px] text-white/65 leading-tight">
              {meal.ingredients.split(/[,\n]+/).filter(Boolean).map(s => s.trim()).join(' • ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
