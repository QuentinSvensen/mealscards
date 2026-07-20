import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type OptionalIngredientChoice = { key: string; label: string };

/** Groupe d'optionnels : un seul ingrédient ou plusieurs liés par « + » (affichés avec « et »). */
export type OptionalIngredientGroup = {
  items: OptionalIngredientChoice[];
  isBundle: boolean;
};

interface OptionalIngredientsMoveDialogProps {
  open: boolean;
  mealName: string;
  groups: OptionalIngredientGroup[];
  includeKeys: Set<string>;
  onToggleKey: (key: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Pop-up affichée avant d'envoyer une carte Tous / Au choix vers Possible
 * lorsqu'il y a des ingrédients optionnels : choisir lesquels rendre obligatoires
 * uniquement sur la carte Possible (sans toucher à la recette maître).
 */
export function OptionalIngredientsMoveDialog({
  open,
  mealName,
  groups,
  includeKeys,
  onToggleKey,
  onConfirm,
  onCancel,
}: OptionalIngredientsMoveDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Ingrédients optionnels</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Pour « {mealName} » dans Possibles, coche les optionnels à inclure dans la recette
          (ils ne seront plus optionnels sur cette carte uniquement).
          Le badge « et » indique un lien dans la recette, tu peux cocher ou décocher chaque
          ingrédient individuellement.
        </p>
        <ul className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto py-1">
          {groups.map((group, groupIndex) => (
            <li key={`group-${groupIndex}`} className="flex flex-col gap-0">
              {group.items.map((opt, itemIndex) => {
                const checked = includeKeys.has(opt.key);
                return (
                  <div key={opt.key}>
                    {group.isBundle && itemIndex > 0 && (
                      <div className="flex items-center justify-center py-0.5" aria-hidden>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-500/90 bg-amber-500/10 border border-amber-500/25 rounded-full px-2 py-px">
                          et
                        </span>
                      </div>
                    )}
                    <label className="flex items-start gap-3 rounded-xl border bg-muted/30 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => onToggleKey(opt.key)}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-foreground leading-snug">
                        <span className="font-medium">{opt.label}</span>
                        <span className="block text-[11px] text-muted-foreground mt-0.5">
                          {checked
                            ? "Inclus dans Possible (non optionnel)"
                            : "Laissé non compté (optionnel)"}
                        </span>
                      </span>
                    </label>
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" className="rounded-xl" onClick={onCancel}>
            Annuler
          </Button>
          <Button type="button" className="rounded-xl" onClick={onConfirm}>
            Continuer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
