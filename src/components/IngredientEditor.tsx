/**
 * IngredientEditor — Grille d'édition des ingrédients d'un repas.
 *
 * Utilisé par MealCard et PossibleMealCard pour modifier les ingrédients.
 * Chaque ligne contient : poignée de tri, bouton "Ou" (alternative),
 * bouton "?" (optionnel), champs grammes, quantité, nom, calories, protéines.
 *
 * Fonctionnalités :
 * - Drag & drop pour réordonner les lignes d'ingrédients
 * - Navigation au clavier (Enter → champ suivant, Escape → valider)
 * - Ajout automatique d'une ligne vide quand on tape dans la dernière
 * - Commit sur perte de focus (onBlur) ou bouton "✓ Valider"
 */
import { useMemo, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { normalizeForMatch, type IngLine } from "@/lib/ingredientUtils";
import {
  hasScalableIngredientMacroSource,
  resolveIngredientLineMacros,
  type IngredientMacroAutofillSources,
} from "@/domain/macros/ingredientMacroDatabase";

interface IngredientEditorProps {
  lines: IngLine[];
  onUpdate: (lines: IngLine[]) => void;
  onCommit: () => void;
  ingredientSuggestions?: string[];
  ingredientMacroSources?: IngredientMacroAutofillSources;
}

/**
 * Shared ingredient editing grid used by MealCard and PossibleMealCard.
 * Supports drag & drop reordering of ingredient lines.
 */
export function IngredientEditor({
  lines,
  onUpdate,
  onCommit,
  ingredientSuggestions = [],
  ingredientMacroSources,
}: IngredientEditorProps) {
  const qtyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const countRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [suggestionLineIdx, setSuggestionLineIdx] = useState<number | null>(null);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(0);
  const handleRef = useRef(false);

  const normalizedIngredientSuggestions = useMemo(() => {
    const seen = new Set<string>();
    return ingredientSuggestions
      .map((name) => name.trim())
      .filter((name) => {
        const key = normalizeForMatch(name);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.localeCompare(b, "fr"));
  }, [ingredientSuggestions]);

  /** Retourne les aliments proposés pour accélérer la saisie d'un nom d'ingrédient. */
  const getSuggestions = (idx: number): string[] => {
    const query = lines[idx]?.name?.trim() ?? "";
    if (!query) return [];

    const normalizedQuery = normalizeForMatch(query);
    return normalizedIngredientSuggestions
      .filter((name) => {
        const normalizedName = normalizeForMatch(name);
        return normalizedName !== normalizedQuery && normalizedName.includes(normalizedQuery);
      })
      .slice(0, 6);
  };

  /** Complète ou recalcule les macros d'une ligne à partir du référentiel Macro et des fiches aliments. */
  const applyMacroAutofill = (
    line: IngLine,
    mode: "emptyOnly" | "recalculate",
  ): IngLine => {
    if (!ingredientMacroSources) return line;

    const resolved = resolveIngredientLineMacros(line, ingredientMacroSources);
    if (!resolved.cal && !resolved.pro) return line;

    if (mode === "recalculate" && !hasScalableIngredientMacroSource(line, ingredientMacroSources)) {
      return line;
    }

    if (mode === "emptyOnly") {
      return {
        ...line,
        cal: line.cal?.trim() ? line.cal : (resolved.cal || line.cal),
        pro: line.pro?.trim() ? line.pro : (resolved.pro || line.pro),
      };
    }

    return {
      ...line,
      cal: resolved.cal || line.cal,
      pro: resolved.pro || line.pro,
    };
  };

  const updateLine = (idx: number, field: "qty" | "count" | "name" | "cal" | "pro", value: string) => {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    if (field === "name" && idx === next.length - 1 && value.trim()) {
      next.push({ qty: "", count: "", name: "", cal: "", pro: "", isOr: false, isAnd: false, isOptional: false });
    }
    if (field === "name") {
      setSuggestionLineIdx(value.trim() ? idx : null);
      setActiveSuggestionIdx(0);
      if (value.trim()) {
        next[idx] = applyMacroAutofill(next[idx], "emptyOnly");
      }
    }
    if ((field === "qty" || field === "count") && next[idx].name.trim()) {
      next[idx] = applyMacroAutofill(next[idx], "recalculate");
    }
    onUpdate(next);
  };

  /** Applique une suggestion d'aliment à la ligne en cours et remplit les macros si connues. */
  const selectSuggestion = (idx: number, name: string) => {
    const next = [...lines];
    next[idx] = applyMacroAutofill({ ...next[idx], name }, "recalculate");
    if (idx === next.length - 1) {
      next.push({ qty: "", count: "", name: "", cal: "", pro: "", isOr: false, isAnd: false, isOptional: false });
    }
    onUpdate(next);
    setSuggestionLineIdx(null);
    setActiveSuggestionIdx(0);
    setTimeout(() => nameRefs.current[idx]?.focus(), 0);
  };

  const toggleOr = (idx: number) => {
    if (idx === 0) return;
    const next = [...lines];
    const newIsOr = !next[idx].isOr;
    next[idx] = { ...next[idx], isOr: newIsOr, isAnd: newIsOr ? false : next[idx].isAnd };
    onUpdate(next);
  };

  const toggleAnd = (idx: number) => {
    if (idx === 0) return;
    const next = [...lines];
    const newIsAnd = !next[idx].isAnd;
    next[idx] = { ...next[idx], isAnd: newIsAnd, isOr: newIsAnd ? false : next[idx].isOr };
    onUpdate(next);
  };

  const toggleOptional = (idx: number) => {
    const next = [...lines];
    next[idx] = { ...next[idx], isOptional: !next[idx].isOptional };
    onUpdate(next);
  };

  const handleKeyDown = (idx: number, field: "qty" | "count" | "name", e: React.KeyboardEvent<HTMLInputElement>) => {
    if (field === "name") {
      const suggestions = suggestionLineIdx === idx ? getSuggestions(idx) : [];
      if (suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveSuggestionIdx((current) => (current + 1) % suggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveSuggestionIdx((current) => (current - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          selectSuggestion(idx, suggestions[activeSuggestionIdx] ?? suggestions[0]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSuggestionLineIdx(null);
          return;
        }
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (field === "qty") countRefs.current[idx]?.focus();
      else if (field === "count") nameRefs.current[idx]?.focus();
      else if (idx < lines.length - 1) qtyRefs.current[idx + 1]?.focus();
      else if (lines[idx].name.trim()) setTimeout(() => qtyRefs.current[idx + 1]?.focus(), 0);
      else onCommit();
    }
    if (e.key === "Escape") onCommit();
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    e.dataTransfer.effectAllowed = "move";
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    const next = [...lines];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    onUpdate(next);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div
      onBlur={(e) => {
        setTimeout(() => {
          if (handleRef.current) return;
          const container = e.currentTarget;
          if (container && !container.contains(document.activeElement)) onCommit();
        }, 100);
      }}
      className="flex flex-col gap-1"
    >
      <div className="grid grid-cols-[0.8rem_1.2rem_1.2rem_0.8rem_2.5rem_1.8rem_1fr_2rem_2rem] lg:grid-cols-[0.8rem_1.2rem_1.2rem_0.8rem_3rem_2.2rem_minmax(0,12rem)_2.5rem_2.5rem] gap-x-0.5 gap-y-0.5 mb-0.5 pl-0 pr-0">
        <span className="text-[8px] text-white/50 text-center"></span>
        <span className="text-[8px] text-white/50 text-center">Ou</span>
        <span className="text-[8px] text-white/50 text-center">Et</span>
        <span className="text-[8px] text-white/50 text-center">?</span>
        <span className="text-[8px] text-white/50 text-center">g</span>
        <span className="text-[8px] text-white/50 text-center">#</span>
        <span className="text-[8px] text-white/50">Nom</span>
        <span className="text-[8px] text-white/50 text-center">Cal</span>
        <span className="text-[8px] text-white/50 text-center">P</span>
      </div>
      {lines.map((line, idx) => (
        <div
          key={idx}
          draggable
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDrop={(e) => handleDrop(e, idx)}
          onDragEnd={handleDragEnd}
          className={`grid grid-cols-[0.8rem_1.2rem_1.2rem_0.8rem_2.5rem_1.8rem_1fr_2rem_2rem] lg:grid-cols-[0.8rem_1.2rem_1.2rem_0.8rem_3rem_2.2rem_minmax(0,12rem)_2.5rem_2.5rem] gap-x-0.5 gap-y-0.5 pl-0 pr-0 transition-opacity ${
            dragIdx === idx ? 'opacity-30' : ''
          } ${dragOverIdx === idx && dragIdx !== idx ? 'border-t-2 border-yellow-300/60' : ''}`}
        >
          <div
            className="h-7 flex items-center justify-center cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60"
            onMouseDown={() => {
              // Mark that drag interaction started from handle — prevent blur commit
              handleRef.current = true;
              setTimeout(() => { handleRef.current = false; }, 500);
            }}
          >
            <GripVertical className="h-3 w-3" />
          </div>
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
            title={idx === 0 ? "" : line.isOr ? "Cet ingrédient est un OU du précédent" : "Marquer comme alternative (OU)"}
          >
            {line.isOr ? "ou" : "|"}
          </button>
          <button
            type="button"
            onClick={() => toggleAnd(idx)}
            className={`h-7 flex items-center justify-center rounded text-[9px] font-bold transition-all ${
              idx === 0
                ? 'text-white/15 cursor-default'
                : line.isAnd
                  ? 'bg-blue-400/30 text-blue-200 border border-blue-400/50'
                  : 'text-white/30 hover:text-white/60 hover:bg-white/10'
            }`}
            disabled={idx === 0}
            title={idx === 0 ? "" : line.isAnd ? "Lié au précédent (ET)" : "Lier au précédent (ET)"}
          >
            {line.isAnd ? "et" : "+"}
          </button>
          <button
            type="button"
            onClick={() => toggleOptional(idx)}
            className={`h-7 flex items-center justify-center rounded text-[9px] font-bold transition-all ${
              line.isOptional
                ? 'bg-purple-400/30 text-purple-200 border border-purple-400/50'
                : 'text-white/20 hover:text-white/50 hover:bg-white/10'
            }`}
            title="Ingrédient optionnel"
          >
            ?
          </button>
          <Input
            ref={el => { qtyRefs.current[idx] = el; }}
            autoFocus={idx === 0}
            placeholder="g"
            inputMode="decimal"
            value={line.qty}
            onChange={e => updateLine(idx, "qty", e.target.value)}
            onKeyDown={e => handleKeyDown(idx, "qty", e)}
            className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-1.5"
          />
          <Input
            ref={el => { countRefs.current[idx] = el; }}
            placeholder="#"
            inputMode="numeric"
            value={line.count}
            onChange={e => updateLine(idx, "count", e.target.value)}
            onKeyDown={e => handleKeyDown(idx, "count", e)}
            className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-1"
          />
          <div className="relative">
            <Input
              ref={el => { nameRefs.current[idx] = el; }}
              placeholder={`Ingrédient ${idx + 1}`}
              value={line.name}
              onFocus={() => { if (line.name.trim()) setSuggestionLineIdx(idx); }}
              onChange={e => updateLine(idx, "name", e.target.value)}
              onKeyDown={e => handleKeyDown(idx, "name", e)}
              className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-2"
            />
            {suggestionLineIdx === idx && getSuggestions(idx).length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-lg border border-white/20 bg-slate-900/95 py-1 shadow-xl backdrop-blur">
                {getSuggestions(idx).map((name, suggestionIdx) => (
                  <button
                    key={name}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handleRef.current = true;
                      selectSuggestion(idx, name);
                      setTimeout(() => { handleRef.current = false; }, 100);
                    }}
                    onMouseEnter={() => setActiveSuggestionIdx(suggestionIdx)}
                    className={`block w-full px-2 py-1.5 text-left text-[11px] transition-colors ${
                      suggestionIdx === activeSuggestionIdx
                        ? "bg-white/20 text-white"
                        : "text-white/80 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Input
            placeholder="cal"
            inputMode="text"
            value={line.cal}
            onChange={e => updateLine(idx, "cal", e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCommit(); }}
            className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-[10px] px-1"
          />
          <Input
            placeholder="prot"
            inputMode="text"
            value={line.pro}
            onChange={e => updateLine(idx, "pro", e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCommit(); }}
            className="h-7 border-white/30 bg-blue-500/20 text-white placeholder:text-white/40 text-[10px] px-1"
          />
        </div>
      ))}
      <button onClick={onCommit} className="text-[10px] text-white/60 hover:text-white text-left mt-0.5">✓ Valider</button>
    </div>
  );
}
