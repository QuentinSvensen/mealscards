/**
 * IngredientEditor — Grille d'édition des ingrédients d'un repas.
 *
 * Utilisé par MealCard et PossibleMealCard pour modifier les ingrédients.
 * Chaque ligne contient : poignée de tri, bouton "Ou" (alternative),
 * bouton "?" (optionnel), champs grammes, quantité, nom, calories, protéines, fibres.
 *
 * Fonctionnalités :
 * - Drag & drop pour réordonner les lignes d'ingrédients
 * - Navigation au clavier (Enter → champ suivant, Escape → valider)
 * - Ajout automatique d'une ligne vide quand on tape dans la dernière
 * - Commit sur perte de focus (onBlur) ou bouton "✓ Valider"
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
  /** Reçoit les lignes à jour au moment de la validation (évite un état parent obsolète sur mobile). */
  onCommit: (lines: IngLine[]) => void;
  ingredientSuggestions?: string[];
  ingredientMacroSources?: IngredientMacroAutofillSources;
}

/** Colonnes compactes sur mobile : macros en largeur minimale, le nom prend le reste. */
const INGREDIENT_GRID_CLASS =
  "grid grid-cols-[auto_auto_auto_auto_max-content_max-content_minmax(0,1fr)_max-content_max-content_max-content] lg:grid-cols-[0.8rem_1.2rem_1.2rem_0.8rem_3rem_2.2rem_minmax(0,12rem)_2.5rem_2.5rem_2.5rem] gap-x-0.5 gap-y-0 pl-0 pr-0";

/** Donne le focus à un champ sans faire défiler la page. */
function focusWithoutScroll(el: HTMLInputElement | null | undefined) {
  el?.focus({ preventScroll: true });
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
  /** Index de la ligne dont le nom est en édition (sinon affichage texte épuré). */
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  const handleRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  /** Ignore le blur de fermeture du menu ⋮ juste après le montage. */
  const ignoreBlurUntilRef = useRef(0);

  useEffect(() => {
    ignoreBlurUntilRef.current = Date.now() + 300;
    // Place le focus dans l’éditeur une fois le menu ⋮ vraiment fermé.
    const t = window.setTimeout(() => {
      focusWithoutScroll(qtyRefs.current[0]);
    }, 50);
    return () => window.clearTimeout(t);
  }, []);

  /** Remplace une fibre vide par « 0 » quand la ligne a déjà des macros cal/prot. */
  const withZeroFiberFallback = (source: IngLine[]): IngLine[] =>
    source.map((line) => {
      if (line.fiber?.trim()) return line;
      if (line.name.trim() && (line.cal?.trim() || line.pro?.trim())) {
        return { ...line, fiber: "0" };
      }
      return line;
    });

  /** Valide avec la dernière version des lignes (synchrone ou via ref après blur mobile). */
  const commitCurrentLines = () => onCommit(withZeroFiberFallback(linesRef.current));

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
    if (!resolved.cal && !resolved.pro && !resolved.fiber) return line;

    if (mode === "recalculate" && !hasScalableIngredientMacroSource(line, ingredientMacroSources)) {
      return line;
    }

    if (mode === "emptyOnly") {
      return {
        ...line,
        cal: line.cal?.trim() ? line.cal : (resolved.cal || line.cal),
        pro: line.pro?.trim() ? line.pro : (resolved.pro || line.pro),
        fiber: line.fiber?.trim() ? line.fiber : (resolved.fiber || line.fiber),
      };
    }

    return {
      ...line,
      cal: resolved.cal || line.cal,
      pro: resolved.pro || line.pro,
      fiber: resolved.fiber || line.fiber,
    };
  };

  /** Affiche « 0 » pour les fibres quand cal/prot sont déjà connus mais le champ fibre est vide. */
  const fiberInputValue = (line: IngLine): string => {
    if (line.fiber?.trim()) return line.fiber;
    if (line.name.trim() && (line.cal?.trim() || line.pro?.trim())) return "0";
    return line.fiber ?? "";
  };

  const updateLine = (idx: number, field: "qty" | "count" | "name" | "cal" | "pro" | "fiber", value: string) => {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    if (field === "name" && idx === next.length - 1 && value.trim()) {
      next.push({ qty: "", count: "", name: "", cal: "", pro: "", fiber: "", isOr: false, isAnd: false, isOptional: false });
    }
    if (field === "name") {
      // Garde l’input monté dès la 1re lettre (sinon il devient un bouton, blur → scroll).
      setEditingNameIdx(idx);
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
      next.push({ qty: "", count: "", name: "", cal: "", pro: "", fiber: "", isOr: false, isAnd: false, isOptional: false });
    }
    onUpdate(next);
    setEditingNameIdx(idx);
    setSuggestionLineIdx(null);
    setActiveSuggestionIdx(0);
    setTimeout(() => focusWithoutScroll(nameRefs.current[idx]), 0);
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
      if (field === "qty") focusWithoutScroll(countRefs.current[idx]);
      else if (field === "count") {
        setEditingNameIdx(idx);
        setTimeout(() => focusWithoutScroll(nameRefs.current[idx]), 0);
      } else if (field === "name") {
        setEditingNameIdx(null);
        setSuggestionLineIdx(null);
        if (idx < lines.length - 1) focusWithoutScroll(qtyRefs.current[idx + 1]);
        else if (lines[idx].name.trim()) setTimeout(() => focusWithoutScroll(qtyRefs.current[idx + 1]), 0);
        else commitCurrentLines();
      }
    }
    if (e.key === "Escape") commitCurrentLines();
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
      ref={containerRef}
      onBlur={() => {
        setTimeout(() => {
          if (handleRef.current) return;
          if (Date.now() < ignoreBlurUntilRef.current) return;
          const container = containerRef.current;
          if (container && !container.contains(document.activeElement)) commitCurrentLines();
        }, 100);
      }}
      className="flex flex-col gap-1.5 min-w-0"
    >
      <div className={`${INGREDIENT_GRID_CLASS} px-2 pb-1`}>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium text-center"></span>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium text-center">Ou</span>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium text-center">Et</span>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium text-center">?</span>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium text-center">g</span>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium text-center">#</span>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium">Nom</span>
        <span className="text-[9px] uppercase tracking-wide text-orange-300/80 font-medium text-center">Cal</span>
        <span className="text-[9px] uppercase tracking-wide text-sky-300/80 font-medium text-center">P</span>
        <span className="text-[9px] uppercase tracking-wide text-emerald-300/80 font-medium text-center">Fib</span>
      </div>
      {lines.map((line, idx) => (
        <div
          key={idx}
          draggable
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDrop={(e) => handleDrop(e, idx)}
          onDragEnd={handleDragEnd}
          className={`${INGREDIENT_GRID_CLASS} relative px-2 py-1 rounded-xl transition-all duration-150 ${
            dragIdx === idx
              ? 'opacity-30 scale-[0.99]'
              : 'bg-white/[0.07] ring-1 ring-white/10 shadow-sm shadow-black/20 hover:bg-white/[0.11] hover:ring-white/20 hover:shadow-md hover:shadow-black/25'
          } ${
            dragOverIdx === idx && dragIdx !== idx ? 'bg-yellow-400/15 ring-yellow-300/45' : ''
          }`}
        >
          {dragOverIdx === idx && dragIdx !== idx && (
            <span
              className="absolute left-2 right-2 top-0 h-0.5 rounded-full bg-yellow-300/80"
              aria-hidden
            />
          )}
          <div
            className="h-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60"
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
            className={`h-6 flex items-center justify-center rounded text-[9px] font-bold transition-all ${
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
            className={`h-6 flex items-center justify-center rounded text-[9px] font-bold transition-all ${
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
            className={`h-6 flex items-center justify-center rounded text-[9px] font-bold transition-all ${
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
            placeholder="g"
            inputMode="decimal"
            value={line.qty}
            onChange={e => updateLine(idx, "qty", e.target.value)}
            onKeyDown={e => handleKeyDown(idx, "qty", e)}
            className={`h-6 w-[2.25rem] min-w-0 rounded-none border-0 border-b bg-transparent text-white text-xs px-1 text-center shadow-none focus-visible:ring-0 focus-visible:border-primary/50 ${
              !String(line.qty ?? "").trim()
                ? "border-white/10 placeholder:text-white/20"
                : "border-white/20 placeholder:text-white/25"
            }`}
          />
          <Input
            ref={el => { countRefs.current[idx] = el; }}
            placeholder="#"
            inputMode="numeric"
            value={line.count}
            onChange={e => updateLine(idx, "count", e.target.value)}
            onKeyDown={e => handleKeyDown(idx, "count", e)}
            className={`h-6 w-[1.35rem] min-w-0 rounded-none border-0 border-b bg-transparent text-white text-xs px-0.5 text-center shadow-none focus-visible:ring-0 focus-visible:border-primary/50 ${
              !String(line.count ?? "").trim()
                ? "border-white/10 placeholder:text-white/20"
                : "border-white/20 placeholder:text-white/25"
            }`}
          />
          <div className="relative min-w-0">
            {!line.name.trim() || editingNameIdx === idx ? (
              <Input
                ref={el => { nameRefs.current[idx] = el; }}
                placeholder={`Ingrédient ${idx + 1}`}
                value={line.name}
                dir="ltr"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onFocus={() => {
                  setEditingNameIdx(idx);
                  if (line.name.trim()) setSuggestionLineIdx(idx);
                }}
                onChange={e => updateLine(idx, "name", e.target.value)}
                onKeyDown={e => handleKeyDown(idx, "name", e)}
                onBlur={() => {
                  // Laisse le temps au clic suggestion (mousedown) de s’exécuter
                  setTimeout(() => {
                    if (handleRef.current) return;
                    setSuggestionLineIdx(null);
                    if (line.name.trim()) setEditingNameIdx(null);
                  }, 120);
                }}
                className="h-6 min-w-0 w-full rounded-none border-0 border-b border-white/20 bg-transparent text-left text-white placeholder:text-white/40 text-xs px-1 shadow-none focus-visible:ring-0 focus-visible:border-primary/50"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingNameIdx(idx);
                  setTimeout(() => focusWithoutScroll(nameRefs.current[idx]), 0);
                }}
                className="h-6 min-w-0 w-full text-left text-white text-xs font-semibold px-1 truncate hover:text-primary transition-colors"
                title="Cliquer pour renommer"
              >
                {line.name}
              </button>
            )}
            {suggestionLineIdx === idx && getSuggestions(idx).length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[10rem] max-w-[min(100vw,16rem)] max-h-40 overflow-y-auto rounded-lg border border-white/20 bg-slate-900/95 py-1 shadow-xl backdrop-blur">
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
            onKeyDown={e => { if (e.key === "Enter") commitCurrentLines(); if (e.key === "Escape") commitCurrentLines(); }}
            className="h-6 w-[2.1rem] min-w-0 rounded-none border-0 border-b border-orange-400/25 bg-transparent text-orange-200 placeholder:text-white/40 text-[10px] px-0.5 shadow-none focus-visible:ring-0 focus-visible:border-orange-400/50"
          />
          <Input
            placeholder="prot"
            inputMode="text"
            value={line.pro}
            onChange={e => updateLine(idx, "pro", e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitCurrentLines(); if (e.key === "Escape") commitCurrentLines(); }}
            className="h-6 w-[2.1rem] min-w-0 rounded-none border-0 border-b border-sky-400/25 bg-transparent text-sky-200 placeholder:text-white/40 text-[10px] px-0.5 shadow-none focus-visible:ring-0 focus-visible:border-sky-400/50"
          />
          <Input
            placeholder="fib"
            inputMode="text"
            value={fiberInputValue(line)}
            onChange={e => updateLine(idx, "fiber", e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitCurrentLines(); if (e.key === "Escape") commitCurrentLines(); }}
            className="h-6 w-[2.1rem] min-w-0 rounded-none border-0 border-b border-emerald-400/25 bg-transparent text-emerald-200 placeholder:text-white/40 text-[10px] px-0.5 shadow-none focus-visible:ring-0 focus-visible:border-emerald-400/50"
          />
        </div>
      ))}
      <button type="button" onClick={commitCurrentLines} className="text-[10px] text-white/60 hover:text-white text-left mt-0.5">✓ Valider</button>
    </div>
  );
}
