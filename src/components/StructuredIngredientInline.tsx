/**
 * Affichage compact des ingrédients sur une ligne : chaque bloc « ou » (plusieurs options séparées par |)
 * est entouré de parenthèses ; à l’intérieur, les « + » restent entre parenthèses (ex. ( A ou ( x + y ) ) ).
 * Le mot « ou » est en ambre. Utilisé par MealCard, PossibleMealCard, WeeklyPlanning, MealPlanGenerator, etc.
 */
import React from "react";
import {
  formatQtyDisplay,
  groupParsedIngredientLinesForDisplay,
  normalizeKey,
  parseIngredientsToLines,
} from "@/lib/ingredientUtils";
import { findStockKey, type StockInfo } from "@/lib/stockUtils";
import { cn } from "@/lib/utils";

export type StructuredIngredientInlineProps = {
  ingredients: string;
  className?: string;
  /** Police plus petite pour les mini-cartes du planning */
  compact?: boolean;
  expiredIngredientNames?: Set<string>;
  missingIngredientNames?: Set<string>;
  counterIngredientNames?: Set<string>;
  expiringSoonIngredientNames?: Set<string>;
  stockMap?: Map<string, StockInfo>;
  /**
   * Si vrai, une alternative indisponible au stock reste lisible (opacité) sans barrer le texte,
   * utile pour les popups où le barré est trop agressif.
   */
  softUnavailableStyle?: boolean;
};

/**
 * Rend les ingrédients structurés (virgule → •, groupe | → ( … ou … ), bundles + → ( … + … )).
 */
export function StructuredIngredientInline({
  ingredients,
  className,
  compact,
  expiredIngredientNames,
  missingIngredientNames,
  counterIngredientNames,
  expiringSoonIngredientNames,
  stockMap,
  softUnavailableStyle,
}: StructuredIngredientInlineProps) {
  if (!ingredients?.trim()) return null;
  const lines = parseIngredientsToLines(ingredients);
  if (lines.length === 0 || (lines.length === 1 && !lines[0].name.trim())) return null;

  const cleanGroups = groupParsedIngredientLinesForDisplay(lines);
  if (cleanGroups.length === 0) return null;

  const ouCls = compact
    ? "text-amber-300/90 text-[8px] font-bold px-0.5 shrink-0"
    : "text-amber-300/90 text-[9px] font-bold px-0.5 shrink-0";
  const parenCls = "text-white/40 font-light shrink-0";
  /** Parenthèses englobant tout un choix « ou » (plusieurs alternatives). */
  const outerParenCls = compact
    ? "text-white/50 text-[9px] font-bold shrink-0"
    : "text-white/50 text-[10px] font-bold shrink-0";
  const plusCls = "text-white/40 font-light px-0.5 shrink-0";

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1 gap-y-0.5", className)}>
      {cleanGroups.map((group, gi) => {
        const hasMultipleOr = group.length > 1;
        return (
          <span key={gi} className="inline-flex flex-wrap items-center gap-x-1">
          {hasMultipleOr && <span className={outerParenCls}>( </span>}
          {group.map((alt, ai) => {
            const isBundle = alt.length > 1;
            const altIsAvailable =
              !stockMap ||
              alt.every((item) => {
                const k = findStockKey(stockMap, item.name);
                const s = k ? stockMap.get(k) : null;
                return s && (s.infinite || s.grams > 0 || s.count > 0);
              });

            return (
              <React.Fragment key={ai}>
                {ai > 0 && <span className={ouCls}>ou</span>}
                <span className="inline-flex flex-wrap items-center gap-x-0.5">
                  {isBundle && <span className={parenCls}>( </span>}
                  {alt.map((item, ii) => {
                    const norm = normalizeKey(item.name);
                    const isExpired = expiredIngredientNames?.has(norm);
                    const isSoon = expiringSoonIngredientNames?.has(norm);
                    const isMissing = missingIngredientNames?.has(norm);
                    const hasCounter = counterIngredientNames?.has(norm);
                    const isOpt = item.isOptional;

                    let cls = "";
                    if (isMissing) cls = "bg-white/10 text-white/40 line-through px-0.5 rounded";
                    else if (isExpired) cls = "bg-red-500/40 text-red-100 px-0.5 rounded font-semibold italic ring-1 ring-red-500/50";
                    else if (isSoon) cls = "ring-1 ring-red-500/60 font-semibold px-0.5 rounded";
                    else if (hasCounter) cls = "underline decoration-2 underline-offset-2 decoration-white/60 font-semibold";
                    else if (isOpt) cls = "italic text-white/40";
                    else if (stockMap && !altIsAvailable) {
                      cls = softUnavailableStyle ? "opacity-40" : "opacity-50 line-through";
                    }

                    const qtyDisp = [formatQtyDisplay(item.qty), item.count].filter(Boolean).join(" ");
                    const textDisplay = [qtyDisp, item.name].filter(Boolean).join(" ");

                    return (
                      <React.Fragment key={ii}>
                        {isBundle && ii > 0 && <span className={plusCls}>+</span>}
                        <span className={cn(cls, "leading-tight whitespace-nowrap")}>
                          {isOpt ? "?" : ""}
                          {textDisplay}
                        </span>
                      </React.Fragment>
                    );
                  })}
                  {isBundle && <span className={parenCls}> )</span>}
                </span>
              </React.Fragment>
            );
          })}
          {hasMultipleOr && <span className={outerParenCls}> )</span>}
          {gi < cleanGroups.length - 1 && <span className="text-white/30 ml-0.5 shrink-0">•</span>}
          </span>
        );
      })}
    </span>
  );
}
