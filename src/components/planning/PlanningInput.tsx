import { useEffect, useRef, useState } from "react";

export interface PlanningInputProps {
  storageKey: string;
  currentValue: number;
  onSave: (val: number) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Champ numérique du planning avec mode « + » pour ajouter une valeur à la saisie courante
 * (manuel midi/soir/goûter, extras, etc.).
 */
export function PlanningInput({
  storageKey: _storageKey,
  currentValue,
  onSave,
  placeholder,
  className,
}: PlanningInputProps) {
  const [addMode, setAddMode] = useState(false);
  const [tempVal, setTempVal] = useState("");
  const [editVal, setEditVal] = useState(String(currentValue || ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!addMode) setEditVal(String(currentValue || ""));
  }, [currentValue, addMode]);

  /** Valide l'ajout relatif (+N) et quitte le mode addition. */
  const commitAdd = () => {
    const raw = parseInt(tempVal, 10) || 0;
    if (raw !== 0) onSave(currentValue + raw);
    setAddMode(false);
    setTempVal("");
  };

  /** Enregistre la valeur absolue saisie si elle a changé. */
  const commitEdit = () => {
    const raw = parseInt(editVal, 10) || 0;
    if (raw === currentValue) return;
    onSave(raw);
  };

  if (addMode) {
    return (
      <div className="relative flex items-center w-full">
        <input
          ref={inputRef}
          type="number"
          value={tempVal}
          onChange={(e) => setTempVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitAdd();
            }
            if (e.key === "Escape") {
              setAddMode(false);
              setTempVal("");
            }
          }}
          placeholder={`+${placeholder || ""}`}
          className={`${className} pr-4`}
          autoFocus
        />
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            commitAdd();
          }}
          className="absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-[9px] font-bold text-green-400 hover:text-green-300 rounded"
          title="Valider l'ajout"
        >
          ✓
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center">
      <input
        type="number"
        value={editVal}
        onChange={(e) => setEditVal(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitEdit();
          }
        }}
        placeholder={placeholder}
        className={className}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAddMode(true);
        }}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-[9px] font-bold text-primary/60 hover:text-primary rounded"
        title="Ajouter"
      >
        +
      </button>
    </div>
  );
}
