/**
 * useFoodItems — Hook CRUD unique pour les aliments (table food_items).
 *
 * Source unique : lecture, ajout, modification, suppression, duplication,
 * réordonnancement. Filtre fantômes unique. Option `enabled` pour Index.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { suppressStockRealtime } from "@/lib/stockRealtimeGate";
import type { FoodItem, FoodType, StorageType } from "@/types/food";

export type { FoodItem, FoodType, StorageType } from "@/types/food";

/** Affiche un toast d'erreur pour les mutations sur les aliments. */
const onMutationError = (error: Error) => {
  toast({ title: "Erreur", description: error.message, variant: "destructive" });
};

/**
 * Filet de sécurité : masque les aliments « fantômes » (0 quantité ou 0 g)
 * qui pourraient subsister en base après une déduction liée à une planification.
 */
function isGhostFoodItem(d: {
  is_infinite?: boolean;
  quantity?: number | null;
  grams?: string | null;
}): boolean {
  if (d?.is_infinite) return false;
  const q = d?.quantity;
  if (q === 0) return true;
  const rawGrams = typeof d?.grams === "string" ? d.grams.trim() : d?.grams;
  if (rawGrams === null || rawGrams === undefined || rawGrams === "") return false;
  const numericGrams = parseFloat(String(rawGrams).replace(",", "."));
  if (Number.isNaN(numericGrams)) return false;
  if (numericGrams <= 0 && (q === null || q === undefined || q <= 0)) return true;
  return false;
}

/** Normalise une ligne food_items vers le type FoodItem côté client. */
function mapFoodItemRow(d: Record<string, unknown>): FoodItem {
  return {
    ...(d as unknown as FoodItem),
    is_meal: (d.is_meal as boolean | undefined) ?? false,
    is_infinite: (d.is_infinite as boolean | undefined) ?? false,
    is_dry: (d.is_dry as boolean | undefined) ?? false,
    is_indivisible: (d.is_indivisible as boolean | undefined) ?? false,
    no_counter: (d.no_counter as boolean | undefined) ?? !d.grams,
    storage_type: (d.storage_type as StorageType | undefined) ?? (d.is_dry ? "sec" : "frigo"),
    quantity: (d.quantity as number | null | undefined) ?? null,
    food_type: (d.food_type as FoodType | undefined) ?? null,
    protein: (d.protein as string | null | undefined) ?? null,
    fiber: (d.fiber as string | null | undefined) ?? null,
  };
}

/** CRUD aliments : lecture + mutations (ajout, update, delete, duplicate, reorder). */
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

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["food_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_items")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as Record<string, unknown>[])
        .filter((d) => !isGhostFoodItem(d as Parameters<typeof isGhostFoodItem>[0]))
        .map(mapFoodItemRow);
    },
    retry: 3,
    retryDelay: 500,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    enabled,
  });

  /** Ajoute une fiche aliment avec sort_order en fin de liste. */
  const addItem = useMutation({
    mutationFn: async ({
      name,
      storage_type,
      quantity,
      grams,
      food_type,
      expiration_date,
      calories,
      protein,
      fiber,
      is_meal,
      no_counter,
      is_indivisible,
    }: {
      name: string;
      storage_type: StorageType;
      quantity?: number | null;
      grams?: string | null;
      food_type?: FoodType;
      expiration_date?: string | null;
      calories?: string | null;
      protein?: string | null;
      fiber?: string | null;
      is_meal?: boolean;
      no_counter?: boolean;
      is_indivisible?: boolean;
    }) => {
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
      const { data, error } = await supabase
        .from("food_items")
        .insert({
          name,
          sort_order: maxOrder + 1,
          is_dry: storage_type === "sec",
          storage_type,
          is_meal: is_meal ?? false,
          no_counter: no_counter ?? ((storage_type === "extras" || storage_type === "test") ? true : !grams),
          is_indivisible: is_indivisible ?? false,
          ...(quantity ? { quantity } : {}),
          ...(grams ? { grams } : {}),
          ...(food_type ? { food_type } : {}),
          ...(expiration_date ? { expiration_date } : {}),
          ...(calories ? { calories } : {}),
          ...(protein ? { protein } : {}),
          ...(fiber ? { fiber } : {}),
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  /** Met à jour une fiche aliment (optimistic + row serveur authoritative). */
  const updateItem = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<FoodItem> & { id: string }) => {
      suppressStockRealtime();
      const { data, error } = await supabase
        .from("food_items")
        .update(updates as never)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return mapFoodItemRow(data as Record<string, unknown>);
    },
    onMutate: async ({ id, ...updates }) => {
      suppressStockRealtime();
      await qc.cancelQueries({ queryKey: ["food_items"] });
      const previous = qc.getQueryData<FoodItem[]>(["food_items"]);
      qc.setQueryData<FoodItem[]>(["food_items"], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((item) => (
          item.id === id ? { ...item, ...updates } as FoodItem : item
        ));
      });
      return { previous };
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previous) {
        qc.setQueryData(["food_items"], context.previous);
      }
      onMutationError(error);
    },
    onSuccess: (updated) => {
      suppressStockRealtime();
      qc.setQueryData<FoodItem[]>(["food_items"], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((item) => (item.id === updated.id ? updated : item));
      });
    },
  });

  /** Supprime une fiche aliment par id. */
  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("food_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  /** Duplique une fiche et mémorise le lien de couleur en sessionStorage. */
  const duplicateItem = useMutation({
    mutationFn: async (id: string) => {
      const source = items.find((i) => i.id === id);
      if (!source) return;
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
      const { data: inserted, error } = await supabase.from("food_items").insert({
        name: source.name,
        grams: source.grams,
        calories: source.calories,
        fiber: source.fiber,
        expiration_date: source.expiration_date,
        counter_start_date: source.counter_start_date,
        is_meal: source.is_meal,
        is_infinite: source.is_infinite,
        is_dry: source.is_dry,
        storage_type: source.storage_type,
        quantity: source.quantity,
        sort_order: maxOrder + 1,
      } as never).select().single();
      if (error) throw error;
      return { newId: inserted.id, sourceId: source.id };
    },
    onSuccess: (result) => {
      if (result) {
        const overrides = JSON.parse(sessionStorage.getItem("color_overrides") || "{}");
        overrides[result.newId] = result.sourceId;
        sessionStorage.setItem("color_overrides", JSON.stringify(overrides));
      }
      invalidate();
    },
    onError: onMutationError,
  });

  /** Réordonne les fiches via batch de sort_order. */
  const reorderItems = useMutation({
    mutationFn: async (ordered: { id: string; sort_order: number }[]) => {
      await Promise.all(ordered.map(({ id, sort_order }) =>
        supabase.from("food_items").update({ sort_order } as never).eq("id", id)
      ));
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  return { items, isLoading, addItem, updateItem, deleteItem, duplicateItem, reorderItems };
}
