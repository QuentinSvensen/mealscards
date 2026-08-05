/**
 * Pop-up « Ajouter extras » : visuel des ingrédients Ninja Creami → Tests
 * (Base par sous-catégorie + Extras) avec sélection multi, grammes éditables
 * et total macros (recette actuelle + sélection).
 */
import { useEffect, useMemo, useState } from "react";
import { Flame, Plus, Wheat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  catalogLineHasContent,
  isNinjaCreamiLineSelectable,
  sumSelectedNinjaCreamiMacros,
  type NinjaCreamiBaseGroup,
  type NinjaCreamiCatalogLine,
  type NinjaCreamiMacroTotals,
} from "@/domain/ninjaCreami/ninjaCreami";
import { serializeIngredients, type IngLine } from "@/lib/ingredientUtils";

export interface NinjaCreamiTestsExtrasDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseGroups: NinjaCreamiBaseGroup[];
  extrasLines: NinjaCreamiCatalogLine[];
  /** Macros déjà présentes sur la carte Possible (avant ajout). */
  recipeMacros?: NinjaCreamiMacroTotals;
  /** Appelé avec les lignes sélectionnées (grammes éventuellement modifiés). */
  onConfirm: (lines: NinjaCreamiCatalogLine[]) => void;
}

/**
 * Formate le nom d’une ligne catalogue (sans grammes — g édités à part).
 */
function formatCatalogLineName(line: NinjaCreamiCatalogLine): string {
  const parts: string[] = [];
  if (line.count.trim()) parts.push(`×${line.count.trim()}`);
  parts.push(line.name.trim() || "—");
  return parts.join(" ");
}

/**
 * Convertit une ligne catalogue en IngLine pour sérialisation.
 */
function toIngLine(line: NinjaCreamiCatalogLine): IngLine {
  return {
    qty: line.qty,
    count: line.count,
    name: line.name,
    cal: line.cal,
    pro: line.pro,
    fiber: line.fiber,
    isOr: false,
    isAnd: false,
    isOptional: false,
  };
}

/**
 * Sérialise des lignes Tests sélectionnées pour les ajouter à une recette Possible.
 */
export function serializeNinjaCreamiExtrasForPossible(
  lines: NinjaCreamiCatalogLine[],
): string | null {
  const picked = lines.filter(isNinjaCreamiLineSelectable).map(toIngLine);
  return serializeIngredients(picked);
}

/**
 * Affiche un total macros compact (Cal / P / Fib).
 */
function MacroTotalsRow({
  label,
  totals,
}: {
  label: string;
  totals: NinjaCreamiMacroTotals;
}) {
  const fmt = (n: number) =>
    Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : "—";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-muted-foreground px-0.5">
      <span>{label}</span>
      <span className="inline-flex items-center gap-0.5 text-orange-400">
        <Flame className="h-3 w-3" />
        {fmt(totals.calories) || "—"}
      </span>
      <span className="inline-flex items-center gap-0.5 text-blue-400">
        <span className="text-[10px]">🍗</span>
        {fmt(totals.protein) || "—"}
      </span>
      <span className="inline-flex items-center gap-0.5 text-emerald-400">
        <Wheat className="h-3 w-3" />
        {fmt(totals.fiber) || "—"}
      </span>
    </div>
  );
}

/**
 * Dialog de sélection des extras / base Tests (visuel proche de l’encadré Tests).
 */
export function NinjaCreamiTestsExtrasDialog({
  open,
  onOpenChange,
  baseGroups,
  extrasLines,
  recipeMacros = { calories: 0, protein: 0, fiber: 0 },
  onConfirm,
}: NinjaCreamiTestsExtrasDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  /** Grammes saisis par id de ligne (édition locale dans la pop-up). */
  const [qtyById, setQtyById] = useState<Record<string, string>>({});

  const selectableBase = useMemo(
    () =>
      baseGroups.map((g) => ({
        ...g,
        lines: g.lines.filter((l) => isNinjaCreamiLineSelectable(l) && catalogLineHasContent(l)),
      })),
    [baseGroups],
  );
  const selectableExtras = useMemo(
    () => extrasLines.filter((l) => isNinjaCreamiLineSelectable(l) && catalogLineHasContent(l)),
    [extrasLines],
  );

  const allSelectable = useMemo(
    () => [...selectableBase.flatMap((g) => g.lines), ...selectableExtras],
    [selectableBase, selectableExtras],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    const init: Record<string, string> = {};
    for (const line of allSelectable) {
      init[line.id] = line.qty;
    }
    setQtyById(init);
    // Réinit uniquement à l’ouverture (pas à chaque refresh du catalogue).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hasAny = allSelectable.length > 0;

  const linesWithQty = useMemo(
    () =>
      allSelectable.map((line) => ({
        ...line,
        qty: qtyById[line.id] ?? line.qty,
      })),
    [allSelectable, qtyById],
  );

  const selectedExtrasMacros = useMemo(
    () => sumSelectedNinjaCreamiMacros(linesWithQty, selectedIds),
    [linesWithQty, selectedIds],
  );

  /** Total recette actuelle + sélection pop-up. */
  const combinedTotals = useMemo<NinjaCreamiMacroTotals>(
    () => ({
      calories: Math.round((recipeMacros.calories + selectedExtrasMacros.calories) * 10) / 10,
      protein: Math.round((recipeMacros.protein + selectedExtrasMacros.protein) * 10) / 10,
      fiber: Math.round((recipeMacros.fiber + selectedExtrasMacros.fiber) * 10) / 10,
    }),
    [recipeMacros, selectedExtrasMacros],
  );

  /** Bascule la sélection d’une ligne. */
  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Met à jour les grammes d’une ligne et la sélectionne automatiquement.
   */
  const setLineQty = (id: string, qty: string) => {
    setQtyById((prev) => ({ ...prev, [id]: qty }));
    setSelectedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  /** Valide la sélection → parent (avec grammes édités). */
  const confirm = () => {
    const picked = linesWithQty.filter((l) => selectedIds.has(l.id));
    if (picked.length === 0) return;
    onConfirm(picked);
    onOpenChange(false);
  };

  /**
   * Affiche les macros catalogue au 100 g (pas scaled par les grammes saisis).
   * Les fibres à 0 s’affichent comme « 0 » (pas « — »).
   */
  const lineMacroPreview = (line: NinjaCreamiCatalogLine) => {
    const fmtOrDash = (raw: string) => {
      const t = raw.trim();
      if (!t) return "—";
      return t;
    };
    const fmtFiber = (raw: string) => {
      const t = raw.trim();
      if (!t) return "0";
      const n = parseFloat(t.replace(",", "."));
      if (Number.isFinite(n) && n === 0) return "0";
      return t;
    };
    return {
      cal: fmtOrDash(line.cal),
      pro: fmtOrDash(line.pro),
      fiber: fmtFiber(line.fiber),
    };
  };

  /**
   * Rend une ligne sélectionnable avec champ grammes.
   */
  const renderLine = (line: NinjaCreamiCatalogLine) => {
    const macros = lineMacroPreview(line);
    const selected = selectedIds.has(line.id);
    return (
      <div
        key={line.id}
        className={`flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-white/5 ${
          selected ? "bg-white/5" : ""
        }`}
      >
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-primary shrink-0"
          checked={selected}
          onChange={() => toggleId(line.id)}
          aria-label={`Sélectionner ${line.name}`}
        />
        <div className="relative shrink-0 w-14">
          <Input
            value={qtyById[line.id] ?? line.qty}
            onChange={(e) => setLineQty(line.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            inputMode="decimal"
            className="h-7 text-[11px] px-1.5 pr-4 tabular-nums"
            aria-label={`Grammes ${line.name}`}
          />
          <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">
            g
          </span>
        </div>
        <span className="text-xs text-foreground truncate min-w-0 flex-1">
          {formatCatalogLineName(line)}
        </span>
        <span className="text-[10px] text-orange-300/90 tabular-nums shrink-0 w-8 text-right">
          {macros.cal}
        </span>
        <span className="text-[10px] text-blue-300/90 tabular-nums shrink-0 w-7 text-right">
          {macros.pro}
        </span>
        <span className="text-[10px] text-emerald-300/90 tabular-nums shrink-0 w-7 text-right">
          {macros.fiber}
        </span>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-base">🧬</span> Ajouter extras
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-3 space-y-3 overflow-y-auto min-h-0 flex-1">
          <div className="text-sm font-bold text-foreground flex items-center gap-2">
            <span className="text-base">🧬</span> Tests
          </div>

          {!hasAny && (
            <p className="text-sm text-muted-foreground italic text-center py-4">
              Aucun ingrédient dans Tests pour le moment.
            </p>
          )}

          {selectableBase.some((g) => g.lines.length > 0) && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-foreground/90 px-0.5">Base</div>
              {selectableBase.map((group) =>
                group.lines.length === 0 ? null : (
                  <div
                    key={group.id}
                    className="rounded-xl bg-black/25 border border-white/10 p-2 space-y-1.5"
                  >
                    <div className="text-[11px] font-bold text-foreground/80 px-0.5">
                      {group.name}
                    </div>
                    {group.lines.map(renderLine)}
                  </div>
                ),
              )}
            </div>
          )}

          {selectableExtras.length > 0 && (
            <div className="rounded-xl bg-violet-950/25 ring-1 ring-violet-500/30 shadow-sm shadow-black/20 p-2 space-y-1.5">
              <div className="text-[11px] font-bold text-foreground/90 px-0.5">Extras</div>
              {selectableExtras.map(renderLine)}
            </div>
          )}
        </div>

        <div className="space-y-1 border-t border-white/10 pt-2">
          <MacroTotalsRow label="Recette" totals={recipeMacros} />
          {selectedIds.size > 0 && (
            <MacroTotalsRow label="Extras sélectionnés" totals={selectedExtrasMacros} />
          )}
          <MacroTotalsRow label="Total" totals={combinedTotals} />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={confirm}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
