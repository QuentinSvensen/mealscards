import { useState } from "react";
import { ArrowLeft, ArrowRight, Copy, MoreVertical, Pencil, Trash2 } from "lucide-react";
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
  direction: "left" | "right";
  onMove: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onDragStart: (e: React.DragEvent) => void;
}

export function MealCard({ meal, direction, onMove, onRename, onDelete, onDuplicate, onDragStart }: MealCardProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(meal.name);

  const handleSave = () => {
    if (editName.trim() && editName.trim() !== meal.name) {
      onRename(editName.trim());
    }
    setEditing(false);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="group flex items-center gap-2 rounded-2xl px-4 py-3 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg"
      style={{ backgroundColor: meal.color }}
    >
      {direction === "left" && (
        <Button size="icon" variant="ghost" onClick={onMove} className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}

      {editing ? (
        <Input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="h-8 border-white/30 bg-white/20 text-white placeholder:text-white/60 flex-1"
        />
      ) : (
        <span className="flex-1 font-semibold text-white text-sm truncate">{meal.name}</span>
      )}

      {direction === "right" && (
        <Button size="icon" variant="ghost" onClick={onMove} className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
          <ArrowRight className="h-4 w-4" />
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setEditName(meal.name); setEditing(true); }}>
            <Pencil className="mr-2 h-4 w-4" /> Renommer
          </DropdownMenuItem>
          {onDuplicate && (
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="mr-2 h-4 w-4" /> Doubler
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" /> Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
