import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { normalizeForMatch } from "@/lib/ingredientUtils";

export interface ClickToEditTextProps {
  value: string;
  onChange: (value: string) => void;
  /** Affiché quand la valeur est vide (mode texte). */
  emptyLabel?: string;
  placeholder?: string;
  /** Classes du texte au repos (affichage épuré). */
  textClassName?: string;
  /** Classes de l’input en édition. */
  inputClassName?: string;
  title?: string;
  /** Toujours éditable si true (ex. ligne vide à remplir). */
  forceEditing?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onEditingChange?: (editing: boolean) => void;
  /** Appelé en quittant l’édition (blur). */
  onBlurCommit?: () => void;
  /** Contenu affiché à droite du texte / input (badge, etc.). */
  trailing?: ReactNode;
  autoFocusWhenEditing?: boolean;
  /**
   * Noms proposés (ex. aliments en stock) filtrés sur la saisie,
   * comme dans l’éditeur d’ingrédients Possible.
   */
  suggestionPool?: string[];
  /** Nombre max de suggestions affichées (défaut 6). */
  maxSuggestions?: number;
}

/**
 * Texte épuré au repos ; bascule en champ éditable au clic.
 * Sert aux noms d’ingrédients (Macro, recettes, Ninja, pop-up Possible).
 */
export function ClickToEditText({
  value,
  onChange,
  emptyLabel = "Cliquer pour nommer",
  placeholder,
  textClassName = "",
  inputClassName = "",
  title,
  forceEditing = false,
  onKeyDown,
  onEditingChange,
  onBlurCommit,
  trailing,
  autoFocusWhenEditing = true,
  suggestionPool,
  maxSuggestions = 6,
}: ClickToEditTextProps) {
  const [editing, setEditing] = useState(forceEditing || !value.trim());
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pickGuardRef = useRef(false);

  const normalizedPool = useMemo(() => {
    if (!suggestionPool?.length) return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of suggestionPool) {
      const name = raw?.trim();
      if (!name) continue;
      const key = normalizeForMatch(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b, "fr"));
  }, [suggestionPool]);

  /** Filtre le stock / catalogue sur les lettres tapées. */
  const suggestions = useMemo(() => {
    if (!editing || !normalizedPool.length) return [] as string[];
    const query = value.trim();
    if (!query) return [];
    const normalizedQuery = normalizeForMatch(query);
    if (!normalizedQuery) return [];
    return normalizedPool
      .filter((name) => {
        const normalizedName = normalizeForMatch(name);
        return normalizedName !== normalizedQuery && normalizedName.includes(normalizedQuery);
      })
      .slice(0, maxSuggestions);
  }, [editing, normalizedPool, value, maxSuggestions]);

  useEffect(() => {
    if (forceEditing) setEditing(true);
  }, [forceEditing]);

  useEffect(() => {
    if (editing && autoFocusWhenEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, autoFocusWhenEditing]);

  useEffect(() => {
    setActiveSuggestionIdx(0);
  }, [value, editing]);

  /**
   * Passe en mode édition et notifie le parent.
   */
  const startEditing = () => {
    setEditing(true);
    onEditingChange?.(true);
  };

  /**
   * Quitte l’édition (sauf si forceEditing / valeur vide).
   */
  const stopEditing = () => {
    if (pickGuardRef.current) return;
    onBlurCommit?.();
    if (forceEditing || !value.trim()) return;
    setEditing(false);
    onEditingChange?.(false);
  };

  /**
   * Applique une suggestion et ferme l’édition.
   */
  const applySuggestion = (name: string) => {
    pickGuardRef.current = true;
    onChange(name);
    onBlurCommit?.();
    if (!forceEditing) {
      setEditing(false);
      onEditingChange?.(false);
    }
    setTimeout(() => {
      pickGuardRef.current = false;
    }, 120);
  };

  return (
    <div className="relative flex items-start gap-1.5 min-w-0 w-full">
      {editing ? (
        <>
          <Input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={stopEditing}
            onKeyDown={(e) => {
              if (suggestions.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveSuggestionIdx((i) => (i + 1) % suggestions.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveSuggestionIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  applySuggestion(suggestions[activeSuggestionIdx] ?? suggestions[0]);
                  return;
                }
              }
              if (e.key === "Escape") {
                e.currentTarget.blur();
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                onKeyDown?.(e);
                e.currentTarget.blur();
                return;
              }
              onKeyDown?.(e);
            }}
            className={inputClassName}
            title={title}
            aria-label={title || placeholder || "Modifier le nom"}
            aria-autocomplete={suggestionPool ? "list" : undefined}
            aria-expanded={suggestions.length > 0}
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[10rem] max-w-[min(100vw,16rem)] max-h-40 overflow-y-auto rounded-lg border border-white/20 bg-slate-900/95 py-1 shadow-xl backdrop-blur">
              {suggestions.map((name, suggestionIdx) => (
                <button
                  key={name}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applySuggestion(name);
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
        </>
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className={`min-w-0 flex-1 text-left rounded px-0.5 py-0.5 hover:bg-muted/40 transition-colors ${textClassName}`}
          title={title || "Cliquer pour renommer"}
        >
          <span className="break-words whitespace-normal leading-tight">
            {value.trim() || emptyLabel}
          </span>
        </button>
      )}
      {trailing}
    </div>
  );
}
