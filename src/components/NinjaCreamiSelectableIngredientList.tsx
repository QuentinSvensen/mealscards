/**
 * Liste d’ingrédients sélectionnables pour l’encadré Tests (Base / Extras).
 * Édition en local pendant la frappe (évite le curseur qui saute) ;
 * autofill macros uniquement au blur, et seulement si match exact + champs vides ;
 * tri manuel par drag & drop (poignée), y compris entre sous-catégories Base.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  resolveIngredientLineMacros,
  type IngredientMacroAutofillSources,
} from "@/domain/macros/ingredientMacroDatabase";
import {
  createEmptyNinjaCreamiCatalogLine,
  isNinjaCreamiLineSelectable,
  NINJA_CREAMI_LINE_DND_MIME,
  type NinjaCreamiCatalogLine,
  type NinjaCreamiLineDragPayload,
} from "@/domain/ninjaCreami/ninjaCreami";
import { normalizeForMatch, normalizeKey, type IngLine } from "@/lib/ingredientUtils";

const GRID =
  "grid grid-cols-[0.75rem_1.1rem_max-content_max-content_minmax(0,1fr)_1.9rem_1.65rem_1.65rem] gap-x-px gap-y-0.5 items-center";

export interface NinjaCreamiSelectableIngredientListProps {
  title: string;
  lines: NinjaCreamiCatalogLine[];
  selectedIds: Set<string>;
  onLinesChange: (lines: NinjaCreamiCatalogLine[]) => void;
  onSelectedIdsChange: (ids: Set<string>) => void;
  /** Appelé quand un nom d’ingrédient est validé (blur) pour sync Macro ingrédients. */
  onIngredientNameCommit?: (line: NinjaCreamiCatalogLine) => void;
  ingredientMacroSources?: IngredientMacroAutofillSources;
  /** Noms d’ingrédients existants pour l’autocomplete (comme dans les cartes recettes). */
  ingredientSuggestions?: string[];
  /** Id de sous-catégorie (Base) pour le DnD inter-groupes. */
  groupId?: string;
  /** Titre éditable (sous-catégorie Base). */
  titleEditable?: boolean;
  /** Renommage de la sous-catégorie. */
  onTitleChange?: (name: string) => void;
  /** Suppression de la sous-catégorie (si autorisée). */
  onDeleteGroup?: () => void;
  /** Réception d’une ligne venant d’une autre sous-catégorie. */
  onExternalLineDrop?: (payload: NinjaCreamiLineDragPayload, targetIdx: number) => void;
  /** Teinte de l’encadré (bordeaux pour Extras). */
  frameTone?: "default" | "bordeaux";
  /** Poignée DnD de sous-catégorie (affichée dans l’en-tête de l’encadré). */
  groupReorderHandle?: ReactNode;
}

/**
 * Convertit une ligne catalogue → IngLine pour la résolution macros.
 */
function toIngLine(line: NinjaCreamiCatalogLine): IngLine {
  const { id: _id, ...rest } = line;
  return rest;
}

/**
 * Indique s’il existe une source macros à correspondance exacte (pas de fuzzy).
 */
function hasExactMacroSource(
  name: string,
  sources: IngredientMacroAutofillSources | undefined,
): boolean {
  const key = normalizeKey(name);
  if (!key || !sources) return false;
  if (sources.macroLibrary?.some((e) => e.key === key || normalizeKey(e.displayName) === key)) {
    return true;
  }
  if (sources.foodItems?.some((item) => normalizeKey(item.name) === key)) {
    return true;
  }
  if (sources.mealMacros?.has(key)) return true;
  return false;
}

/**
 * Indique si une ligne a un contenu saisi (hors ligne vide de fin).
 */
function isLineMeaningful(line: NinjaCreamiCatalogLine): boolean {
  return Boolean(
    line.name.trim() ||
      line.qty.trim() ||
      line.count.trim() ||
      line.cal.trim() ||
      line.pro.trim() ||
      line.fiber.trim(),
  );
}

/**
 * Assure une seule ligne vide en bas du catalogue (retire les vides au milieu).
 */
function ensureTrailingEmpty(lines: NinjaCreamiCatalogLine[]): NinjaCreamiCatalogLine[] {
  const meaningful = lines.filter(isLineMeaningful);
  if (meaningful.length === 0) return [createEmptyNinjaCreamiCatalogLine()];
  return [...meaningful, createEmptyNinjaCreamiCatalogLine()];
}

/**
 * Remplit les macros vides depuis une source exacte (sans écraser une saisie manuelle).
 */
function autofillEmptyMacrosExact(
  line: NinjaCreamiCatalogLine,
  sources: IngredientMacroAutofillSources | undefined,
): NinjaCreamiCatalogLine {
  if (!sources || !line.name.trim() || !hasExactMacroSource(line.name, sources)) {
    return line;
  }
  const resolved = resolveIngredientLineMacros(toIngLine(line), sources);
  return {
    ...line,
    cal: line.cal.trim() ? line.cal : resolved.cal || line.cal,
    pro: line.pro.trim() ? line.pro : resolved.pro || line.pro,
    fiber: line.fiber.trim() ? line.fiber : resolved.fiber || line.fiber,
  };
}

/**
 * Parse le payload DnD inter-sous-catégories.
 */
function parseLineDragPayload(raw: string): NinjaCreamiLineDragPayload | null {
  try {
    const data = JSON.parse(raw) as NinjaCreamiLineDragPayload;
    if (!data?.fromGroupId || !data?.line?.id) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Liste Base / Extras : édition locale fluide + sélection multi + tri manuel.
 */
export function NinjaCreamiSelectableIngredientList({
  title,
  lines,
  selectedIds,
  onLinesChange,
  onSelectedIdsChange,
  onIngredientNameCommit,
  ingredientMacroSources,
  ingredientSuggestions = [],
  groupId,
  titleEditable = false,
  onTitleChange,
  onDeleteGroup,
  onExternalLineDrop,
  frameTone = "default",
  groupReorderHandle,
}: NinjaCreamiSelectableIngredientListProps) {
  const [draftLines, setDraftLines] = useState<NinjaCreamiCatalogLine[]>(lines);
  const [draftTitle, setDraftTitle] = useState(title);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [groupDropActive, setGroupDropActive] = useState(false);
  const [suggestionLineIdx, setSuggestionLineIdx] = useState<number | null>(null);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(0);
  const focusedRef = useRef(false);
  const titleFocusedRef = useRef(false);
  const dragIdxRef = useRef<number | null>(null);
  const draftRef = useRef(draftLines);
  const onLinesChangeRef = useRef(onLinesChange);
  draftRef.current = draftLines;
  onLinesChangeRef.current = onLinesChange;

  const normalizedSuggestions = useMemo(() => {
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

  /** Suggestions filtrées pour la ligne en cours de saisie. */
  const getSuggestions = (idx: number): string[] => {
    const query = draftLines[idx]?.name?.trim() ?? "";
    if (!query) return [];
    const normalizedQuery = normalizeForMatch(query);
    return normalizedSuggestions
      .filter((name) => {
        const normalizedName = normalizeForMatch(name);
        return normalizedName !== normalizedQuery && normalizedName.includes(normalizedQuery);
      })
      .slice(0, 8);
  };

  /** Applique une suggestion de nom et remplit les macros vides si match exact. */
  const selectSuggestion = (idx: number, name: string) => {
    setDraftLines((prev) => {
      const next = prev.map((l, i) => {
        if (i !== idx) return l;
        const patched = { ...l, name };
        return autofillEmptyMacrosExact(patched, ingredientMacroSources);
      });
      const normalized = ensureTrailingEmpty(next);
      draftRef.current = normalized;
      onLinesChange(normalized);
      const line = normalized[idx];
      if (line?.name.trim()) onIngredientNameCommit?.(line);
      return normalized;
    });
    setSuggestionLineIdx(null);
    setActiveSuggestionIdx(0);
  };

  // Resync depuis les prefs seulement hors édition (évite le reset curseur).
  // Ignore un passage à vide si le brouillon a encore des lignes (anti-wipe).
  useEffect(() => {
    if (!focusedRef.current && dragIdx === null) {
      const incomingHas = lines.some(isLineMeaningful);
      const draftHas = draftRef.current.some(isLineMeaningful);
      if (!incomingHas && draftHas) {
        onLinesChangeRef.current(ensureTrailingEmpty(draftRef.current));
        return;
      }
      setDraftLines(lines);
    }
  }, [lines, dragIdx]);

  useEffect(() => {
    if (!titleFocusedRef.current) setDraftTitle(title);
  }, [title]);

  /** Persiste le brouillon vers le parent (prefs). */
  const commitDraft = (next: NinjaCreamiCatalogLine[]) => {
    const normalized = ensureTrailingEmpty(next);
    setDraftLines(normalized);
    draftRef.current = normalized;
    onLinesChange(normalized);
  };

  /** Met à jour un champ en local uniquement (frappe fluide). */
  const updateLineLocal = (idx: number, patch: Partial<NinjaCreamiCatalogLine>) => {
    setDraftLines((prev) => {
      const next = prev.map((l, i) => (i === idx ? { ...l, ...patch } : l));
      return ensureTrailingEmpty(next);
    });
    if (patch.name !== undefined) {
      setSuggestionLineIdx(patch.name.trim() ? idx : null);
      setActiveSuggestionIdx(0);
    }
  };

  /** Navigation clavier dans la liste de suggestions / validation. */
  const handleNameKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
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
  };

  /** Blur : autofill exact si macros vides, puis commit parent + sync Macro. */
  const handleBlurLine = (idx: number, field: keyof NinjaCreamiCatalogLine) => {
    focusedRef.current = false;
    let next = [...draftRef.current];
    let line = next[idx];
    if (!line) return;

    if (field === "name" || field === "qty" || field === "count") {
      line = autofillEmptyMacrosExact(line, ingredientMacroSources);
      next[idx] = line;
    }

    commitDraft(next);

    if (
      line.name.trim() &&
      (field === "name" ||
        field === "qty" ||
        field === "count" ||
        field === "cal" ||
        field === "pro" ||
        field === "fiber")
    ) {
      onIngredientNameCommit?.(line);
    }
  };

  /** Bascule la sélection d’une ligne (si elle a un nom). */
  const toggleSelected = (id: string, selectable: boolean) => {
    if (!selectable) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange(next);
  };

  /** Prépare le drag HTML5 depuis la poignée (intra + inter sous-cat). */
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    if (!isLineMeaningful(draftRef.current[idx])) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    const line = draftRef.current[idx];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
    if (groupId && line) {
      const payload: NinjaCreamiLineDragPayload = { fromGroupId: groupId, line };
      e.dataTransfer.setData(NINJA_CREAMI_LINE_DND_MIME, JSON.stringify(payload));
    }
    dragIdxRef.current = idx;
    setDragIdx(idx);
  };

  /** Survole une cible de drop (ligne). */
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  };

  /** Survole la zone groupe (accueil depuis une autre sous-cat). */
  const handleGroupDragOver = (e: React.DragEvent) => {
    if (!onExternalLineDrop) return;
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(NINJA_CREAMI_LINE_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setGroupDropActive(true);
  };

  /** Quitte la zone groupe. */
  const handleGroupDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setGroupDropActive(false);
    }
  };

  /** Drop sur le conteneur groupe (fin de liste). */
  const handleGroupDrop = (e: React.DragEvent) => {
    setGroupDropActive(false);
    if (!groupId || !onExternalLineDrop) return;
    const raw = e.dataTransfer.getData(NINJA_CREAMI_LINE_DND_MIME);
    const payload = parseLineDragPayload(raw);
    if (!payload || payload.fromGroupId === groupId) return;
    e.preventDefault();
    e.stopPropagation();
    onExternalLineDrop(payload, draftRef.current.length);
  };

  /** Réordonne en interne ou accepte une ligne d’une autre sous-catégorie. */
  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setGroupDropActive(false);

    const rawExternal = e.dataTransfer.getData(NINJA_CREAMI_LINE_DND_MIME);
    const external = parseLineDragPayload(rawExternal);
    if (external && groupId && onExternalLineDrop && external.fromGroupId !== groupId) {
      dragIdxRef.current = null;
      setDragIdx(null);
      setDragOverIdx(null);
      onExternalLineDrop(external, targetIdx);
      return;
    }

    const from = dragIdxRef.current;
    dragIdxRef.current = null;
    setDragIdx(null);
    setDragOverIdx(null);
    if (from === null || from === targetIdx) return;

    const next = [...draftRef.current];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(targetIdx, 0, moved);
    commitDraft(next);
  };

  /** Nettoie l’état drag (annulation / fin). */
  const handleDragEnd = () => {
    dragIdxRef.current = null;
    setDragIdx(null);
    setDragOverIdx(null);
    setGroupDropActive(false);
  };

  /** Classes de bordure / fond selon la teinte (bordeaux pour Extras). */
  const frameClasses =
    frameTone === "bordeaux"
      ? groupDropActive
        ? "border-rose-500/55 bg-rose-950/45"
        : "border-rose-800/55 bg-rose-950/30"
      : groupDropActive
        ? "border-cyan-400/60 bg-cyan-500/10"
        : "border-white/10 bg-black/25";

  return (
    <div
      className={`rounded-xl border p-2 space-y-1.5 transition-colors ${frameClasses}`}
      onDragOver={handleGroupDragOver}
      onDragLeave={handleGroupDragLeave}
      onDrop={handleGroupDrop}
    >
      <div className="flex items-center gap-1 px-0.5 min-w-0">
        {groupReorderHandle}
        {titleEditable ? (
          <Input
            value={draftTitle}
            onFocus={() => {
              titleFocusedRef.current = true;
            }}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={() => {
              titleFocusedRef.current = false;
              const next = draftTitle.trim() || "Sous-catégorie";
              setDraftTitle(next);
              onTitleChange?.(next);
            }}
            className="h-7 flex-1 min-w-0 border-white/15 bg-white/5 text-[11px] font-bold px-1.5"
            title="Renommer la sous-catégorie"
          />
        ) : (
          <div className="text-[11px] font-bold text-foreground/90 flex-1">{title}</div>
        )}
        {onDeleteGroup && (
          <button
            type="button"
            onClick={onDeleteGroup}
            className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="Supprimer la sous-catégorie"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className={GRID}>
        <span className="text-[8px] text-muted-foreground text-center" title="Réordonner" />
        <span className="text-[8px] text-muted-foreground text-center" title="Sélection">
          ✓
        </span>
        <span className="text-[8px] text-muted-foreground text-center">g</span>
        <span className="text-[8px] text-muted-foreground text-center">#</span>
        <span className="text-[8px] text-muted-foreground">Nom</span>
        <span className="text-[8px] text-muted-foreground text-center">Cal</span>
        <span className="text-[8px] text-muted-foreground text-center">P</span>
        <span className="text-[8px] text-muted-foreground text-center">Fib</span>
      </div>
      {draftLines.map((line, idx) => {
        const selectable = isNinjaCreamiLineSelectable(line);
        const checked = selectedIds.has(line.id);
        const canDrag = isLineMeaningful(line);
        const isCreateRow = !canDrag;
        const inputBg = isCreateRow
          ? "bg-transparent border-white/10 text-white/50 placeholder:text-white/35"
          : "bg-white/10 border-white/20";
        return (
          <div
            key={line.id || idx}
            data-ninja-line-row
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            className={`${GRID} rounded-md px-0 py-0.5 transition-opacity ${
              isCreateRow ? "opacity-55" : ""
            } ${dragIdx === idx ? "opacity-30" : ""} ${
              dragOverIdx === idx && dragIdx !== idx ? "border-t-2 border-cyan-300/70" : ""
            }`}
          >
            <div
              data-drag-handle
              draggable={canDrag}
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragEnd={handleDragEnd}
              className={`h-7 w-full flex items-center justify-center text-white/30 hover:text-white/60 ${
                canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-default opacity-20"
              }`}
              title={canDrag ? "Glisser pour réordonner / changer de sous-catégorie" : undefined}
            >
              <GripVertical className="h-3 w-3 shrink-0" />
            </div>
            <input
              type="checkbox"
              className="h-3 w-3 accent-primary justify-self-center disabled:opacity-30"
              checked={checked}
              disabled={!selectable}
              onChange={() => toggleSelected(line.id, selectable)}
              title={selectable ? "Inclure dans le test" : "Saisir un nom d’abord"}
            />
            <Input
              placeholder="g"
              inputMode="decimal"
              value={line.qty}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onChange={(e) => updateLineLocal(idx, { qty: e.target.value })}
              onBlur={() => handleBlurLine(idx, "qty")}
              className={`h-7 w-[2rem] min-w-0 text-[11px] px-0.5 ${inputBg}`}
            />
            <Input
              placeholder="#"
              inputMode="numeric"
              value={line.count}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onChange={(e) => updateLineLocal(idx, { count: e.target.value })}
              onBlur={() => handleBlurLine(idx, "count")}
              className={`h-7 w-[1.2rem] min-w-0 text-[11px] px-0 ${inputBg}`}
            />
            <div className="relative min-w-0">
              <Input
                placeholder={`Ingrédient ${idx + 1}`}
                value={line.name}
                dir="ltr"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onFocus={() => {
                  focusedRef.current = true;
                  if (line.name.trim()) setSuggestionLineIdx(idx);
                }}
                onChange={(e) => updateLineLocal(idx, { name: e.target.value })}
                onKeyDown={(e) => handleNameKeyDown(idx, e)}
                onBlur={() => {
                  setSuggestionLineIdx(null);
                  handleBlurLine(idx, "name");
                }}
                className={`h-7 min-w-0 w-full text-xs px-1 ${inputBg}`}
              />
              {suggestionLineIdx === idx && getSuggestions(idx).length > 0 && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[10rem] max-w-[min(100vw,16rem)] max-h-40 overflow-y-auto rounded-lg border border-white/20 bg-slate-900/95 py-1 shadow-xl backdrop-blur">
                  {getSuggestions(idx).map((name, suggestionIdx) => (
                    <button
                      key={name}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectSuggestion(idx, name);
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
              placeholder="—"
              inputMode="decimal"
              value={line.cal}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onChange={(e) => updateLineLocal(idx, { cal: e.target.value })}
              onBlur={() => handleBlurLine(idx, "cal")}
              className={`h-7 w-full min-w-0 text-[10px] px-0 text-center text-orange-300 ${inputBg}`}
            />
            <Input
              placeholder="—"
              inputMode="decimal"
              value={line.pro}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onChange={(e) => updateLineLocal(idx, { pro: e.target.value })}
              onBlur={() => handleBlurLine(idx, "pro")}
              className={`h-7 w-full min-w-0 text-[10px] px-0 text-center text-blue-300 ${inputBg}`}
            />
            <Input
              placeholder="—"
              inputMode="decimal"
              value={line.fiber}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onChange={(e) => updateLineLocal(idx, { fiber: e.target.value })}
              onBlur={() => handleBlurLine(idx, "fiber")}
              className={`h-7 w-full min-w-0 text-[10px] px-0 text-center text-emerald-300 ${inputBg}`}
            />
          </div>
        );
      })}
    </div>
  );
}
