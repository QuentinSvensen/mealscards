import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles, Loader2, RefreshCw, ChefHat } from "lucide-react";
import type { FoodItem } from "@/components/FoodItems";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface AISuggestion {
  name: string;
  ingredients_used: string[];
  difficulty: "facile" | "moyen" | "difficile";
}

const DIFFICULTY_COLORS: Record<string, string> = {
  facile: "bg-green-500/80",
  moyen: "bg-amber-500/80",
  difficile: "bg-red-500/80",
};

interface Props {
  foodItems: FoodItem[];
}

export function FoodItemsSuggestions({ foodItems }: Props) {
  const [open, setOpen] = useState(true);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const fetchSuggestions = async () => {
    if (foodItems.length === 0) {
      toast({ title: "Aucun aliment dans le stock", description: "Ajoute des aliments pour obtenir des suggestions.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-food-suggestions", {
        body: { foodItems: foodItems.map(fi => ({ name: fi.name, grams: fi.grams, is_infinite: fi.is_infinite })) },
      });
      if (error) {
        toast({ title: "Erreur IA", description: error.message, variant: "destructive" });
        return;
      }
      if (data?.error) {
        toast({ title: "Erreur IA", description: data.error, variant: "destructive" });
        return;
      }
      setSuggestions(data?.suggestions || []);
      setHasLoaded(true);
    } catch (e) {
      toast({ title: "Erreur", description: "Impossible de contacter l'IA.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4 mt-4">
      <div className="flex items-center gap-2 w-full">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-yellow-500" />
            Suggestions IA
          </h2>
          {hasLoaded && <span className="text-sm font-normal text-muted-foreground">{suggestions.length}</span>}
        </button>

        <Button
          size="sm"
          variant="ghost"
          onClick={fetchSuggestions}
          disabled={loading}
          className="h-7 px-2 gap-1 text-[11px] shrink-0"
          title="Générer des suggestions IA"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">{hasLoaded ? "Actualiser" : "Générer"}</span>
        </Button>
      </div>

      {open && (
        <div className="mt-3">
          {!hasLoaded && !loading && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <ChefHat className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground italic">
                Clique sur "Générer" pour obtenir des idées de recettes basées sur tes aliments
              </p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">L'IA réfléchit…</span>
            </div>
          )}

          {hasLoaded && !loading && suggestions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4 italic">
              Aucune suggestion trouvée pour ces aliments.
            </p>
          )}

          {!loading && suggestions.length > 0 && (
            <div className="flex flex-col gap-2">
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  className="flex flex-col rounded-2xl px-3 py-2.5 bg-primary/10 border border-primary/20"
                >
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-foreground flex-1 truncate">{s.name}</p>
                    <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full shrink-0 ${DIFFICULTY_COLORS[s.difficulty] ?? "bg-muted"}`}>
                      {s.difficulty}
                    </span>
                  </div>
                  {s.ingredients_used?.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {s.ingredients_used.join(" · ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
