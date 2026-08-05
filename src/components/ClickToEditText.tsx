import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Input } from "@/components/ui/input";

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
}

/**
 * Texte épuré au repos ; bascule en champ éditable au clic.
 * Sert aux noms d’ingrédients (Macro, recettes, Ninja).
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
}: ClickToEditTextProps) {
  const [editing, setEditing] = useState(forceEditing || !value.trim());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (forceEditing) setEditing(true);
  }, [forceEditing]);

  useEffect(() => {
    if (editing && autoFocusWhenEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, autoFocusWhenEditing]);

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
    onBlurCommit?.();
    if (forceEditing || !value.trim()) return;
    setEditing(false);
    onEditingChange?.(false);
  };

  return (
    <div className="flex items-start gap-1.5 min-w-0 w-full">
      {editing ? (
        <Input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={stopEditing}
          onKeyDown={(e) => {
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
        />
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
