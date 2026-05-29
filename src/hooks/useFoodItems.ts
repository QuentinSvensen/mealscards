/**
 * useFoodItems — Hook léger pour lire les aliments et supprimer.
 *
 * Version allégée du hook FoodItems pour les composants qui n'ont besoin
 * que de la lecture (items, isLoading) et de la suppression (deleteItem).
 * Rafraîchit automatiquement à la connexion de l'utilisateur.
 *
 * Pour le CRUD complet (ajout, modification, duplication, réordonnancement),
 * voir le hook dans src/components/FoodItems.tsx.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export type StorageType = "frigo" | "sec" | "surgele" | "extras" | "test" | "toujours";
export type FoodType = "feculent" | "viande" | null;

export interface FoodItem {
  id: string;
  name: string;
  grams: string | null;
  calories: string | null;
  protein: string | null;
  expiration_date: string | null;
  counter_start_date: string | null;
  sort_order: number;
  created_at: string;
  is_meal: boolean;
  is_infinite: boolean;
  is_dry: boolean;
  is_indivisible: boolean;
  no_counter: boolean;
  storage_type: StorageType;
  quantity: number | null;
  food_type: FoodType;
}

/** Affiche un toast d’erreur pour les mutations sur les aliments. */
const onMutationError = (error: Error) => {
  toast({ title: "Erreur", description: error.message, variant: "destructive" });
};

/** Lecture des aliments et suppression seule (voir doc en tête de fichier). */
export function useFoodItems(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const qc = useQueryClient();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["food_items"] });

  useEffect(() => {
    if (!enabled) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        qc.invalidateQueries({ queryKey: ["food_items"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc, enabled]);

  // Filet de sécurité : masque les aliments "fantômes" (0 quantité ou 0 g) qui
  // pourraient subsister en base après une déduction liée à une planification.
  // Un aliment à quantity=0 ou à grams="0" n'a aucun stock réel — on ne l'affiche pas.
  // On épargne les aliments infinis et les items sans grammes (no_counter / repas).
  const isGhostFoodItem = (d: any): boolean => {
    if (d?.is_infinite) return false;
    const q = d?.quantity;
    if (q === 0) return true;
    const rawGrams = typeof d?.grams === "string" ? d.grams.trim() : d?.grams;
    if (rawGrams === null || rawGrams === undefined || rawGrams === "") return false;
    const numericGrams = parseFloat(String(rawGrams).replace(",", "."));
    if (Number.isNaN(numericGrams)) return false;
    if (numericGrams <= 0 && (q === null || q === undefined || q <= 0)) return true;
    return false;
  };

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["food_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_items")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as any[])
        .filter((d) => !isGhostFoodItem(d))
        .map((d) => ({
          ...d,
          is_meal: d.is_meal ?? false,
          is_infinite: d.is_infinite ?? false,
          is_dry: d.is_dry ?? false,
          is_indivisible: d.is_indivisible ?? false,
          no_counter: d.no_counter ?? (!d.grams),
          storage_type: d.storage_type ?? (d.is_dry ? "sec" : "frigo"),
          quantity: d.quantity ?? null,
          food_type: d.food_type ?? null,
          protein: d.protein ?? null,
        })) as FoodItem[];
    },
    retry: 3,
    retryDelay: 500,
    staleTime: 2 * 60 * 1000,
    enabled,
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("food_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  /** Met à jour une fiche aliment et reflète immédiatement les changements dans le cache local. */
  const updateItem = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<FoodItem> & { id: string }) => {
      const { error } = await supabase.from("food_items").update(updates as any).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, ...updates }) => {
      await qc.cancelQueries({ queryKey: ["food_items"] });
      const previous = qc.getQueryData<FoodItem[]>(["food_items"]);
      qc.setQueryData<FoodItem[]>(["food_items"], (old) =>
        old?.map((item) => item.id === id ? { ...item, ...updates } as FoodItem : item) ?? [],
      );
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) qc.setQueryData(["food_items"], context.previous);
      onMutationError(error);
    },
    onSettled: invalidate,
  });

  return { items, isLoading, deleteItem, updateItem };
}
