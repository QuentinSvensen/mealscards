import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MealCategory = 'entree' | 'plat' | 'dessert';

export interface Meal {
  id: string;
  name: string;
  category: string;
  calories: string | null;
  color: string;
  sort_order: number;
  created_at: string;
  is_available: boolean;
}

export interface PossibleMeal {
  id: string;
  meal_id: string;
  quantity: number;
  expiration_date: string | null;
  day_of_week: string | null;
  meal_time: string | null;
  sort_order: number;
  created_at: string;
  meals: Meal;
}

const MEAL_COLORS = [
  "hsl(340, 82%, 65%)",
  "hsl(25, 95%, 63%)",
  "hsl(142, 60%, 50%)",
  "hsl(210, 80%, 60%)",
  "hsl(270, 70%, 65%)",
  "hsl(45, 93%, 58%)",
  "hsl(180, 60%, 50%)",
  "hsl(0, 75%, 60%)",
];

function randomColor() {
  return MEAL_COLORS[Math.floor(Math.random() * MEAL_COLORS.length)];
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
  });

  const isLoading = ml || pl;

  // --- Master meal mutations ---

  const addMeal = useMutation({
    mutationFn: async ({ name, category }: { name: string; category: string }) => {
      const maxOrder = meals.filter(m => m.category === category).reduce((max, m) => Math.max(max, m.sort_order), -1);
      const { error } = await supabase
        .from("meals")
        .insert({ name, category, color: randomColor(), sort_order: maxOrder + 1 });
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

  const deleteMeal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("meals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const reorderMeals = useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      await Promise.all(
        items.map((item) =>
          supabase.from("meals").update({ sort_order: item.sort_order }).eq("id", item.id)
        )
      );
    },
    onSuccess: invalidateAll,
  });

  // --- Possible meal mutations ---

  const moveToPossible = useMutation({
    mutationFn: async (mealId: string) => {
      const existing = possibleMeals.find((pm) => pm.meal_id === mealId);
      if (existing) {
        const { error } = await (supabase as any)
          .from("possible_meals")
          .update({ quantity: existing.quantity + 1 })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const maxOrder = possibleMeals.length;
        const { error } = await (supabase as any)
          .from("possible_meals")
          .insert({ meal_id: mealId, sort_order: maxOrder });
        if (error) throw error;
      }
    },
    onSuccess: invalidateAll,
  });

  const removeFromPossible = useMutation({
    mutationFn: async (possibleMealId: string) => {
      const pm = possibleMeals.find((p) => p.id === possibleMealId);
      if (!pm) return;
      if (pm.quantity > 1) {
        const { error } = await (supabase as any)
          .from("possible_meals")
          .update({ quantity: pm.quantity - 1 })
          .eq("id", possibleMealId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("possible_meals")
          .delete()
          .eq("id", possibleMealId);
        if (error) throw error;
      }
    },
    onSuccess: invalidateAll,
  });

  const updateQuantity = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      if (quantity <= 0) {
        const { error } = await (supabase as any).from("possible_meals").delete().eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("possible_meals")
          .update({ quantity })
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: invalidateAll,
  });

  const updateExpiration = useMutation({
    mutationFn: async ({ id, expiration_date }: { id: string; expiration_date: string | null }) => {
      const { error } = await (supabase as any)
        .from("possible_meals")
        .update({ expiration_date })
        .eq("id", id);
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

  const deletePossibleMeal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("possible_meals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const reorderPossibleMeals = useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      await Promise.all(
        items.map((item) =>
          (supabase as any).from("possible_meals").update({ sort_order: item.sort_order }).eq("id", item.id)
        )
      );
    },
    onSuccess: invalidateAll,
  });

  // --- Helpers ---

  const getMealsByCategory = (cat: string) =>
    meals.filter((m) => m.category === cat).sort((a, b) => a.sort_order - b.sort_order);

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
    meals,
    possibleMeals,
    isLoading,
    addMeal,
    renameMeal,
    updateCalories,
    deleteMeal,
    reorderMeals,
    moveToPossible,
    removeFromPossible,
    updateQuantity,
    updateExpiration,
    updatePlanning,
    deletePossibleMeal,
    reorderPossibleMeals,
    getMealsByCategory,
    getPossibleByCategory,
    sortByExpiration,
    sortByPlanning,
    getRandomPossible,
  };
}
