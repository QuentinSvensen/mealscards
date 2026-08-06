/**
 * Liste d’ingrédients sélectionnables pour l’encadré Tests (Base / Extras).
 * Édition en local pendant la frappe (évite le curseur qui saute) ;
 * autofill macros uniquement au blur, et seulement si match exact + champs vides ;
 * tri manuel par drag & drop (poignée), y compris entre sous-catégories Base.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ClickToEditText } from "@/components/ClickToEditText";
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
  "grid grid-cols-[0.75rem_1.1rem_max-content_max-content_minmax(0,1fr)_1.9rem_1.65rem_1.65rem] gap-x-1 gap-y-0 items-center";

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
  /** Teinte de l’encadré (violet pour Extras). */
  frameTone?: "default" | "violet";
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
 * Indique si le dataTransfer expose un type MIME (comparaison insensible à la casse).
 */
function dataTransferHasType(dt: DataTransfer, mime: string): boolean {
  const target = mime.toLowerCase();
  return Array.from(dt.types).some((t) => String(t).toLowerCase() === target);
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
  /** Index du nom en édition (sinon texte épuré si le nom est rempli). */
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  const focusedRef = useRef(false);
  const nameEditGuardRef = useRef(false);
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
  // Ignore un passage à vide si le brouillon a encore des lignes (anti-wipe),
  // sauf si des ids ont quitté le parent (déplacement vers une autre liste).
  useEffect(() => {
    if (!focusedRef.current && dragIdx === null) {
      const incomingIds = new Set(lines.map((l) => l.id));
      const draftLostLines = draftRef.current.filter(
        (l) => isLineMeaningful(l) && !incomingIds.has(l.id),
      );
      if (draftLostLines.length > 0) {
        setDraftLines(ensureTrailingEmpty(lines));
        return;
      }
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

  /** Survole la zone groupe (accueil depuis une autre sous-cat / Extras). */
  const handleGroupDragOver = (e: React.DragEvent) => {
    if (!onExternalLineDrop) return;
    if (!dataTransferHasType(e.dataTransfer, NINJA_CREAMI_LINE_DND_MIME)) return;
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

  /** Classes de bordure / fond selon la teinte (violet pour Extras ; Base un cran plus sombre que Tests). */
  const frameClasses =
    frameTone === "violet"
      ? groupDropActive
        ? "bg-violet-950/45 ring-1 ring-violet-400/50 shadow-md shadow-black/25"
        : "bg-violet-950/25 ring-1 ring-violet-500/30 shadow-sm shadow-black/20 hover:bg-violet-950/35 hover:ring-violet-400/40"
      : groupDropActive
        ? "bg-cyan-500/15 ring-1 ring-cyan-400/50 shadow-md shadow-black/25"
        : "bg-white/[0.05] ring-1 ring-white/10 shadow-sm shadow-black/20 hover:bg-white/[0.08] hover:ring-white/18";

  return (
    <div
      className={`rounded-xl px-2 py-2 space-y-1.5 transition-all duration-150 ${frameClasses}`}
      onDragOver={handleGroupDragOver}
      onDragLeave={handleGroupDragLeave}
      onDrop={handleGroupDrop}
    >
      <div className="flex items-center gap-1.5 px-0.5 min-w-0 pb-0.5">
        {groupReorderHandle}
        {titleEditable ? (
          <ClickToEditText
            value={draftTitle}
            onChange={setDraftTitle}
            emptyLabel="Sous-catégorie"
            placeholder="Sous-catégorie"
            title="Cliquer pour renommer la sous-catégorie"
            forceEditing={!draftTitle.trim()}
            textClassName="text-sm font-extrabold tracking-wide text-white"
            inputClassName="h-8 flex-1 min-w-0 border-white/20 bg-white/10 text-sm font-extrabold tracking-wide text-white px-1.5"
            onEditingChange={(editing) => {
              titleFocusedRef.current = editing;
            }}
            onBlurCommit={() => {
              titleFocusedRef.current = false;
              const next = draftTitle.trim() || "Sous-catégorie";
              setDraftTitle(next);
              onTitleChange?.(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const next = draftTitle.trim() || "Sous-catégorie";
                setDraftTitle(next);
                onTitleChange?.(next);
              }
            }}
          />
        ) : (
          <div className="text-sm font-extrabold tracking-wide text-white flex-1">{title}</div>
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
      <div className={`${GRID} px-2 pb-1`}>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium text-center" title="Réordonner" />
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium text-center" title="Sélection">
          ✓
        </span>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium text-center">g</span>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium text-center">#</span>
        <span className="text-[9px] uppercase tracking-wide text-white/40 font-medium">Nom</span>
        <span className="text-[9px] uppercase tracking-wide text-orange-300/80 font-medium text-center">Cal</span>
        <span className="text-[9px] uppercase tracking-wide text-sky-300/80 font-medium text-center">P</span>
        <span className="text-[9px] uppercase tracking-wide text-emerald-300/80 font-medium text-center">Fib</span>
      </div>
      <div className="flex flex-col gap-1.5">
      {draftLines.map((line, idx) => {
        const selectable = isNinjaCreamiLineSelectable(line);
        const checked = selectedIds.has(line.id);
        const canDrag = isLineMeaningful(line);
        const isCreateRow = !canDrag;
        const inputBg = isCreateRow
          ? "bg-transparent border-0 border-b border-white/10 rounded-none shadow-none focus-visible:ring-0 text-white/50"
          : "bg-transparent border-0 border-b border-white/20 rounded-none shadow-none focus-visible:ring-0 focus-visible:border-primary/60";
        /** Styles discrets pour un champ gramme/# encore vide. */
        const emptyUnitField =
          "border-white/10 placeholder:text-white/20 placeholder:font-normal";
        const rowSelected = checked && selectable;
        const qtyEmpty = !String(line.qty ?? "").trim();
        const countEmpty = !String(line.count ?? "").trim();
        return (
          <div
            key={line.id || idx}
            data-ninja-line-row
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            className={`${GRID} relative px-2 py-1 rounded-xl transition-all duration-150 ${
              isCreateRow
                ? "opacity-50 bg-white/[0.03] ring-1 ring-dashed ring-white/20"
                : rowSelected
                  ? "bg-primary/20 ring-1 ring-primary/40 shadow-[inset_3px_0_0_0_hsl(var(--primary))] backdrop-blur-[2px]"
                  : "bg-white/[0.07] ring-1 ring-white/10 shadow-sm shadow-black/20 hover:bg-white/[0.11] hover:ring-white/20 hover:shadow-md hover:shadow-black/25"
            } ${dragIdx === idx ? "opacity-30 scale-[0.99]" : ""} ${
              dragOverIdx === idx && dragIdx !== idx
                ? "bg-cyan-500/15 ring-cyan-400/45"
                : ""
            }`}
          >
            {dragOverIdx === idx && dragIdx !== idx && (
              <span
                className="absolute left-2 right-2 top-0 h-0.5 rounded-full bg-cyan-300/80"
                aria-hidden
              />
            )}
            <div
              data-drag-handle
              draggable={canDrag}
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragEnd={handleDragEnd}
              className={`h-6 w-full flex items-center justify-center text-white/30 hover:text-white/60 ${
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
              className={`h-6 w-[2rem] min-w-0 text-[11px] px-0.5 text-center ${inputBg} ${
                qtyEmpty ? emptyUnitField : ""
              }`}
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
              className={`h-6 w-[1.2rem] min-w-0 text-[11px] px-0 text-center ${inputBg} ${
                countEmpty ? emptyUnitField : ""
              }`}
            />
            <div className="relative min-w-0">
              {!line.name.trim() || editingNameIdx === idx ? (
                <Input
                  placeholder={`Ingrédient ${idx + 1}`}
                  value={line.name}
                  dir="ltr"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus={editingNameIdx === idx && !!line.name.trim()}
                  onFocus={() => {
                    focusedRef.current = true;
                    if (line.name.trim()) setSuggestionLineIdx(idx);
                  }}
                  onChange={(e) => updateLineLocal(idx, { name: e.target.value })}
                  onKeyDown={(e) => {
                    handleNameKeyDown(idx, e);
                    if (e.key === "Enter" && !(suggestionLineIdx === idx && getSuggestions(idx).length > 0)) {
                      setEditingNameIdx(null);
                      setSuggestionLineIdx(null);
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      if (nameEditGuardRef.current) return;
                      setSuggestionLineIdx(null);
                      handleBlurLine(idx, "name");
                      if (draftRef.current[idx]?.name.trim()) setEditingNameIdx(null);
                    }, 120);
                  }}
                  className={`h-6 min-w-0 w-full text-xs px-1 ${inputBg}`}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingNameIdx(idx)}
                  className="h-6 min-w-0 w-full text-left text-xs font-semibold px-1 truncate hover:text-primary transition-colors"
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
                        nameEditGuardRef.current = true;
                        selectSuggestion(idx, name);
                        setTimeout(() => {
                          nameEditGuardRef.current = false;
                        }, 100);
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
              className={`h-6 w-full min-w-0 text-[10px] px-0 text-center text-orange-300 ${inputBg}`}
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
              className={`h-6 w-full min-w-0 text-[10px] px-0 text-center text-blue-300 ${inputBg}`}
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
              className={`h-6 w-full min-w-0 text-[10px] px-0 text-center text-emerald-300 ${inputBg}`}
            />
          </div>
        );
      })}
      </div>
    </div>
  );
}
