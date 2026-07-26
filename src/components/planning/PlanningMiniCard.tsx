/**
 * PlanningMiniCard — carte compacte d'un repas dans une cellule du planning
 * (drag desktop, touch mobile, override kcal/prot, ingrédients structurés).
 */
import { useState } from "react";
import { Calendar, Flame, Weight, Wheat, Timer } from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import type { PossibleMeal } from "@/hooks/useMeals";
import { getMealColor } from "@/lib/ingredientUtils";
import type { StockInfo } from "@/lib/stockUtils";
import { StructuredIngredientInline } from "@/components/StructuredIngredientInline";

/**
 * Libellé de date pour le badge d'une carte planning : uniquement la date de péremption.
 * Rien n'est affiché si l'aliment n'a pas de date de péremption.
 */
function formatPlanningMiniCardDateLabel(
  expirationDate: string | null | undefined,
): string | null {
  if (!expirationDate) return null;
  try {
    return format(parseISO(expirationDate), "d MMM", { locale: fr });
  } catch {
    return expirationDate;
  }
}

/** Emoji de catégorie de repas pour l'affichage compact des cartes. */
export function getCategoryEmoji(cat?: string) {
  switch (cat) {
    case "entree":
      return "🥗";
    case "plat":
      return "🍽️";
    case "dessert":
      return "🍰";
    case "bonus":
      return "⭐";
    default:
      return "🍴";
  }
}

/**
 * Classes CSS du badge de date sur une mini-carte Planning
 * (bordure / texte rouge discrets si planifié après péremption — style d'origine).
 */
function getPlanningDateBadgeClassName(expired: boolean): string {
  const base =
    "inline-flex items-center gap-0.5 rounded px-1 py-0.5 border align-middle text-[9px] font-normal";
  if (expired) {
    return `${base} font-bold text-red-300 border-red-400/50 bg-red-500/20`;
  }
  return `${base} text-white/60 border-white/15 bg-white/5`;
}

export interface PlanningMiniCardProps {
  pm: PossibleMeal;
  meal: { name?: string; category?: string; ingredients?: string | null; grams?: string | null };
  expired: boolean;
  counterDays: number | null;
  counterBadgeTitle?: string;
  counterUrgent: boolean;
  isPast: boolean;
  displayCal: string | null;
  displayPro: string | null;
  displayFiber: string | null;
  compact: boolean;
  hideIngredients?: boolean;
  /** Masque le badge / l'édition des calories (préférence « Masquer calories »). */
  hideCalorieDisplay?: boolean;
  isTouchDevice: boolean;
  touchDragActive: boolean;
  slotDragOver: string | null;
  onDragStart: (e: React.DragEvent) => void;
  /** Nettoyage après drag (ref / state carte en cours). */
  onDragEnd?: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: () => void;
  onRemove: () => void;
  onCalorieChange: (val: string | null) => void;
  onProteinChange: (val: string | null) => void;
  expiredIngredientNames?: Set<string>;
  expiringSoonIngredientNames?: Set<string>;
  onDoubleClick?: () => void;
  stockMap?: Map<string, StockInfo>;
  /** Carte issue de « Tous » : contour jaune pour la distinguer. */
  fromMaster?: boolean;
}

/**
 * Carte compacte d'un repas dans une cellule du planning (drag, touch, override kcal, ingrédients).
 */
export function PlanningMiniCard({
  pm,
  meal,
  expired,
  counterDays,
  counterBadgeTitle,
  counterUrgent,
  displayCal,
  displayPro,
  displayFiber,
  compact,
  hideIngredients,
  hideCalorieDisplay,
  isTouchDevice,
  touchDragActive,
  slotDragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  onCalorieChange,
  onProteinChange,
  expiredIngredientNames,
  expiringSoonIngredientNames,
  onDoubleClick,
  stockMap,
  fromMaster = false,
}: PlanningMiniCardProps) {
  const [editingCal, setEditingCal] = useState(false);
  const [calValue, setCalValue] = useState("");
  const [editingPro, setEditingPro] = useState(false);
  const [proValue, setProValue] = useState("");
  const cardColorIngredients = meal.ingredients?.trim() ? meal.ingredients : pm.ingredients_override;
  const dateBadgeLabel = formatPlanningMiniCardDateLabel(pm.expiration_date);
  const dateBadgeIsExpiration = !!pm.expiration_date;
  const visibleCal = hideCalorieDisplay ? null : displayCal;

  const macroControls = !compact ? (
    <div className="flex flex-wrap items-center justify-end gap-0.5 min-w-0 max-w-full">
      {!hideCalorieDisplay && (editingCal ? (
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          value={calValue}
          onChange={(e) => setCalValue(e.target.value)}
          onBlur={() => {
            const trimmed = calValue.trim();
            onCalorieChange(trimmed || null);
            setEditingCal(false);
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-16 h-5 text-[11px] bg-white/20 border border-white/40 rounded px-1 text-white placeholder:text-white/40 focus:outline-none"
          placeholder="kcal"
        />
      ) : displayCal ? (
        <button
          onClick={() => { setCalValue(displayCal); setEditingCal(true); }}
          className="text-[9px] sm:text-xs font-black text-white px-1 sm:px-2 py-px sm:py-0.5 rounded-full flex items-center gap-0.5 shrink-0 max-w-full bg-black/30 hover:bg-black/40"
          title="Modifier les calories (temporaire)"
        >
          <Flame className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          {displayCal}
        </button>
      ) : (
        <button
          onClick={() => { setCalValue(""); setEditingCal(true); }}
          className="text-[10px] text-white/40 hover:text-white/60"
          title="Ajouter des calories"
        >
          <Flame className="h-3 w-3" />
        </button>
      ))}
      {editingPro ? (
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          value={proValue}
          onChange={(e) => setProValue(e.target.value)}
          onBlur={() => {
            const trimmed = proValue.trim();
            onProteinChange(trimmed || null);
            setEditingPro(false);
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-16 h-5 text-[11px] bg-white/20 border border-white/40 rounded px-1 text-white placeholder:text-white/40 focus:outline-none"
          placeholder="prot"
        />
      ) : displayPro ? (
        <button
          onClick={() => { setProValue(displayPro); setEditingPro(true); }}
          className="text-[9px] sm:text-[10px] font-bold text-white px-1 sm:px-1.5 py-px sm:py-0.5 rounded-full flex items-center justify-center shrink-0 max-w-full bg-black/30 hover:bg-black/40"
          title="Modifier les protéines (temporaire)"
        >
          🍗 {displayPro}
        </button>
      ) : (
        <button
          onClick={() => { setProValue(""); setEditingPro(true); }}
          className="text-[10px] text-white/40 hover:text-white/60"
          title="Ajouter des protéines"
        >
          🍗
        </button>
      )}
      {displayFiber ? (
        <>
          <span className="basis-full h-0 sm:hidden" />
          <span
            className="w-fit max-w-full text-[9px] sm:text-[10px] font-bold text-white px-1 sm:px-1.5 py-px sm:py-0.5 rounded-full flex items-center justify-center shrink-0 ml-auto sm:ml-0 bg-black/30"
            title="Fibres"
          >
            <Wheat className="h-2 w-2 sm:h-2.5 sm:w-2.5 mr-0.5" />
            {displayFiber}
          </span>
        </>
      ) : null}
    </div>
  ) : null;

  return (
    <div
      draggable={!isTouchDevice}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onDoubleClick={onDoubleClick}
      title={
        fromMaster
          ? "Issu de Tous"
          : isTouchDevice
            ? "Maintenir pour déplacer"
            : undefined
      }
      className={`${compact ? "w-fit max-w-full" : "w-full"} min-w-0 overflow-hidden rounded-xl text-white select-none
        ${touchDragActive ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing"}
        transition-transform hover:scale-[1.01]
        ${slotDragOver === pm.id ? "ring-2 ring-white/60" : fromMaster ? "ring-2 ring-yellow-400" : ""}
        ${compact ? "px-1.5 py-0.5" : "px-1.5 py-0.5 sm:px-2 sm:py-1.5"}
      `}
      style={{ backgroundColor: getMealColor(cardColorIngredients, meal.name) }}
    >
      {/* Mobile : mise en page verticale */}
      <div className="flex flex-col sm:hidden">
        <div className="flex flex-col min-w-0 gap-0.5">
          <div className="min-w-0 max-w-full overflow-hidden">
            <div className="flex items-start gap-1 min-w-0 max-w-full">
              <span className="text-[9px] opacity-70 shrink-0">{getCategoryEmoji(meal.category)}</span>
              <span className="block flex-1 min-w-0 max-w-full font-semibold text-[10px] leading-tight whitespace-normal break-words [overflow-wrap:anywhere] [word-break:break-word]">{meal.name}</span>
            </div>
          </div>
        </div>
        {!compact && (dateBadgeLabel || meal.grams || visibleCal || displayPro || displayFiber || pm.ingredients_override || meal.ingredients) && (
          <div className="mt-auto pt-0.5">
            <div className="flex items-end justify-between gap-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1 min-w-0">
                {dateBadgeLabel && (
                  <span className={getPlanningDateBadgeClassName(dateBadgeIsExpiration && expired)}>
                    <Calendar className="h-2 w-2 inline" />
                    {dateBadgeLabel}
                  </span>
                )}
                {meal.grams && (
                  <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                    <Weight className="h-2 w-2" />
                    {meal.grams}
                  </span>
                )}
              </div>
              {macroControls}
            </div>
            {(pm.ingredients_override || meal.ingredients || pm.expiration_date) && (
              <div className={`${meal.grams ? "mt-0.5" : ""} text-[9px] text-white/50 break-words whitespace-normal`}>
                {!hideIngredients && (pm.ingredients_override || meal.ingredients) && (
                  <StructuredIngredientInline
                    compact
                    ingredients={pm.ingredients_override ?? meal.ingredients}
                    expiredIngredientNames={expiredIngredientNames}
                    expiringSoonIngredientNames={expiringSoonIngredientNames}
                    stockMap={stockMap}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bureau : mise en page en deux colonnes — gauche (titre + date en bas), droite (badges) */}
      <div className="hidden sm:flex flex-col items-stretch gap-0.5 min-w-0 max-w-full">
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div className="flex items-start gap-1 min-w-0 max-w-full">
            <span className="text-[11px] opacity-70 shrink-0">{getCategoryEmoji(meal.category)}</span>
            <span className="block flex-1 min-w-0 max-w-full font-semibold text-xs leading-tight whitespace-normal break-words [overflow-wrap:anywhere] [word-break:break-word]">{meal.name}</span>
            {counterDays !== null ? (
              <span
                className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5 border shrink-0
                ${counterUrgent ? "bg-red-600 text-white border-red-300 shadow-md" : "bg-black/50 text-white border-white/30"}`}
                title={counterBadgeTitle}
              >
                <Timer className="h-2.5 w-2.5" />
                {counterDays}j
              </span>
            ) : null}
          </div>
          {!compact && (dateBadgeLabel || meal.grams || visibleCal || displayPro || displayFiber || pm.ingredients_override || meal.ingredients) && (
            <div className="pt-0.5">
              <div className="flex items-end justify-between gap-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  {dateBadgeLabel && (
                  <span className={getPlanningDateBadgeClassName(dateBadgeIsExpiration && expired)}>
                    <Calendar className="h-2 w-2 inline" />
                    {dateBadgeLabel}
                  </span>
                  )}
                  {meal.grams && (
                    <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                      <Weight className="h-2 w-2" />
                      {meal.grams}
                    </span>
                  )}
                </div>
                {macroControls}
              </div>
              {!hideIngredients && (pm.ingredients_override || meal.ingredients) && (
                <div className={`${pm.expiration_date || meal.grams ? "mt-0.5" : ""} text-[9px] text-white/50 flex flex-wrap gap-x-1`}>
                  <StructuredIngredientInline
                    compact
                    ingredients={pm.ingredients_override ?? meal.ingredients}
                    expiredIngredientNames={expiredIngredientNames}
                    expiringSoonIngredientNames={expiringSoonIngredientNames}
                    stockMap={stockMap}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
