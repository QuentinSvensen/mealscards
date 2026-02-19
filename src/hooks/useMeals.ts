import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type MealCategory = 'petit_dejeuner' | 'entree' | 'plat' | 'dessert' | 'bonus';

export interface Meal {
  id: string;
  name: string;
  category: string;
  calories: string | null;
  grams: string | null;
  ingredients: string | null;
  color: string;
  sort_order: number;
  created_at: string;
  is_available: boolean;
  is_favorite: boolean;
}

export interface PossibleMeal {
  id: string;
  meal_id: string;
  quantity: number;
  expiration_date: string | null;
  day_of_week: string | null;
  meal_time: string | null;
  counter_start_date: string | null;
  sort_order: number;
  created_at: string;
  meals: Meal;
}

const MEAL_COLORS = [
  "hsl(345, 45%, 48%)", "hsl(22, 55%, 48%)", "hsl(155, 35%, 40%)",
  "hsl(215, 45%, 46%)", "hsl(275, 35%, 48%)", "hsl(40, 50%, 44%)",
  "hsl(185, 40%, 40%)", "hsl(5, 40%, 46%)", "hsl(130, 30%, 40%)",
  "hsl(240, 35%, 50%)", "hsl(315, 30%, 46%)", "hsl(60, 35%, 40%)",
  "hsl(195, 40%, 42%)", "hsl(15, 50%, 45%)", "hsl(170, 35%, 38%)",
  "hsl(255, 30%, 46%)", "hsl(30, 45%, 42%)", "hsl(200, 40%, 44%)",
  "hsl(350, 35%, 44%)", "hsl(90, 30%, 40%)",
];

function colorFromName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return MEAL_COLORS[Math.abs(hash) % MEAL_COLORS.length];
}

export const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
export const TIMES = ['midi', 'soir'] as const;

const DAY_INDEX: Record<string, number> = {};
DAYS.forEach((d, i) => { DAY_INDEX[d] = i; });

export function useMeals() {
  const qc = useQueryClient();
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["meals"] });
    qc.invalidateQueries({ queryKey: ["possible_meals"] });
  };

  // Re-fetch queries when auth session becomes available
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        // Invalidate all queries so they re-fetch with the new session
        qc.invalidateQueries({ queryKey: ["meals"] });
        qc.invalidateQueries({ queryKey: ["possible_meals"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc]);

  const { data: meals = [], isLoading: ml } = useQuery({
    queryKey: ["meals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meals")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as Meal[];
    },
    retry: 3,
    retryDelay: 500,
  });

  const { data: possibleMeals = [], isLoading: pl } = useQuery({
    queryKey: ["possible_meals"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("possible_meals")
        .select("*, meals(*)")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as PossibleMeal[];
    },
    retry: 3,
    retryDelay: 500,
  });

  const isLoading = ml || pl;

  // --- Master meal mutations ---

  const addMeal = useMutation({
    mutationFn: async ({ name, category }: { name: string; category: string }) => {
      const maxOrder = meals.filter(m => m.category === category).reduce((max, m) => Math.max(max, m.sort_order), -1);
      const { error } = await supabase
        .from("meals")
        .insert({ name, category, color: colorFromName(name), sort_order: maxOrder + 1, is_available: true } as any);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const addMealToPossibleDirectly = useMutation({
    mutationFn: async ({ name, category }: { name: string; category: string }) => {
      const { data: mealData, error: mealError } = await supabase
        .from("meals")
        .insert({ name, category, color: colorFromName(name), sort_order: 0, is_available: false } as any)
        .select()
        .single();
      if (mealError) throw mealError;
      const maxOrder = possibleMeals.length;
      const { error } = await (supabase as any)
        .from("possible_meals")
        .insert({ meal_id: mealData.id, sort_order: maxOrder });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const renameMeal = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("meals").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const updateCalories = useMutation({
    mutationFn: async ({ id, calories }: { id: string; calories: string | null }) => {
      const { error } = await supabase.from("meals").update({ calories } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const updateGrams = useMutation({
    mutationFn: async ({ id, grams }: { id: string; grams: string | null }) => {
      const { error } = await supabase.from("meals").update({ grams } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const updateIngredients = useMutation({
    mutationFn: async ({ id, ingredients }: { id: string; ingredients: string | null }) => {
      const { error } = await supabase.from("meals").update({ ingredients } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const toggleFavorite = useMutation({
    mutationFn: async ({ id, is_favorite }: { id: string; is_favorite: boolean }) => {
      const { error } = await supabase.from("meals").update({ is_favorite } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const deleteMeal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("meals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const reorderMeals = useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      await Promise.all(items.map((item) =>
        supabase.from("meals").update({ sort_order: item.sort_order }).eq("id", item.id)
      ));
    },
    onSuccess: invalidateAll,
  });

  // --- Possible meal mutations ---

  const moveToPossible = useMutation({
    mutationFn: async (mealId: string) => {
      const maxOrder = possibleMeals.length;
      const { error } = await (supabase as any)
        .from("possible_meals")
        .insert({ meal_id: mealId, sort_order: maxOrder });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const duplicatePossibleMeal = useMutation({
    mutationFn: async (sourcePmId: string) => {
      const source = possibleMeals.find(pm => pm.id === sourcePmId);
      if (!source) return;
      const maxOrder = possibleMeals.length;
      const { error } = await (supabase as any)
        .from("possible_meals")
        .insert({
          meal_id: source.meal_id,
          sort_order: maxOrder,
          expiration_date: source.expiration_date,
          counter_start_date: source.counter_start_date,
        });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const removeFromPossible = useMutation({
    mutationFn: async (possibleMealId: string) => {
      const pm = possibleMeals.find(p => p.id === possibleMealId);
      const { error } = await (supabase as any)
        .from("possible_meals")
        .delete()
        .eq("id", possibleMealId);
      if (error) throw error;
      // Clean up orphaned hidden meals
      if (pm && !pm.meals?.is_available) {
        const otherRefs = possibleMeals.filter(p => p.meal_id === pm.meal_id && p.id !== possibleMealId);
        if (otherRefs.length === 0) {
          await supabase.from("meals").delete().eq("id", pm.meal_id);
        }
      }
    },
    onSuccess: invalidateAll,
  });

  const updateExpiration = useMutation({
    mutationFn: async ({ id, expiration_date }: { id: string; expiration_date: string | null }) => {
      // Linked: update all possible_meals with same meal_id
      const pm = possibleMeals.find(p => p.id === id);
      if (!pm) return;
      const { error } = await (supabase as any)
        .from("possible_meals")
        .update({ expiration_date })
        .eq("meal_id", pm.meal_id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const updatePlanning = useMutation({
    mutationFn: async ({ id, day_of_week, meal_time }: { id: string; day_of_week: string | null; meal_time: string | null }) => {
      const { error } = await (supabase as any)
        .from("possible_meals")
        .update({ day_of_week, meal_time })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const updateCounter = useMutation({
    mutationFn: async ({ id, counter_start_date }: { id: string; counter_start_date: string | null }) => {
      const { error } = await (supabase as any)
        .from("possible_meals")
        .update({ counter_start_date })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const deletePossibleMeal = useMutation({
    mutationFn: async (id: string) => {
      const pm = possibleMeals.find(p => p.id === id);
      const { error } = await (supabase as any).from("possible_meals").delete().eq("id", id);
      if (error) throw error;
      if (pm && !pm.meals?.is_available) {
        const otherRefs = possibleMeals.filter(p => p.meal_id === pm.meal_id && p.id !== id);
        if (otherRefs.length === 0) {
          await supabase.from("meals").delete().eq("id", pm.meal_id);
        }
      }
    },
    onSuccess: invalidateAll,
  });

  const reorderPossibleMeals = useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      await Promise.all(items.map((item) =>
        (supabase as any).from("possible_meals").update({ sort_order: item.sort_order }).eq("id", item.id)
      ));
    },
    onSuccess: invalidateAll,
  });

  // --- Helpers ---

  const getMealsByCategory = (cat: string) =>
    meals.filter((m) => m.category === cat && m.is_available).sort((a, b) => a.sort_order - b.sort_order);

  const getPossibleByCategory = (cat: string) =>
    possibleMeals.filter((pm) => pm.meals?.category === cat).sort((a, b) => a.sort_order - b.sort_order);

  const sortByExpiration = (items: PossibleMeal[]) =>
    [...items].sort((a, b) => {
      if (!a.expiration_date && !b.expiration_date) return 0;
      if (!a.expiration_date) return 1;
      if (!b.expiration_date) return -1;
      return a.expiration_date.localeCompare(b.expiration_date);
    });

  const sortByPlanning = (items: PossibleMeal[]) =>
    [...items].sort((a, b) => {
      const dayA = a.day_of_week ? (DAY_INDEX[a.day_of_week] ?? 99) : 99;
      const dayB = b.day_of_week ? (DAY_INDEX[b.day_of_week] ?? 99) : 99;
      if (dayA !== dayB) return dayA - dayB;
      const timeA = a.meal_time === 'midi' ? 0 : a.meal_time === 'soir' ? 1 : 2;
      const timeB = b.meal_time === 'midi' ? 0 : b.meal_time === 'soir' ? 1 : 2;
      return timeA - timeB;
    });

  const getRandomPossible = (cat: string): PossibleMeal | null => {
    const items = getPossibleByCategory(cat);
    if (items.length === 0) return null;
    return items[Math.floor(Math.random() * items.length)];
  };

  return {
    meals, possibleMeals, isLoading,
    addMeal, addMealToPossibleDirectly, renameMeal, updateCalories, updateGrams, updateIngredients,
    toggleFavorite, deleteMeal, reorderMeals,
    moveToPossible, duplicatePossibleMeal, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible,
  };
}
