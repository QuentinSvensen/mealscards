import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Meal = Tables<"meals">;

const MEAL_COLORS = [
  "hsl(340, 82%, 65%)",  // rose
  "hsl(25, 95%, 63%)",   // orange
  "hsl(142, 60%, 50%)",  // vert
  "hsl(210, 80%, 60%)",  // bleu
  "hsl(270, 70%, 65%)",  // violet
  "hsl(45, 93%, 58%)",   // jaune
  "hsl(180, 60%, 50%)",  // turquoise
  "hsl(0, 75%, 60%)",    // rouge
];

function randomColor() {
  return MEAL_COLORS[Math.floor(Math.random() * MEAL_COLORS.length)];
}

export function useMeals() {
  const queryClient = useQueryClient();

  const { data: meals = [], isLoading } = useQuery({
    queryKey: ["meals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meals")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const addMeal = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from("meals")
        .insert({ name, color: randomColor() });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meals"] }),
  });

  const toggleAvailability = useMutation({
    mutationFn: async ({ id, is_available }: { id: string; is_available: boolean }) => {
      const { error } = await supabase
        .from("meals")
        .update({ is_available })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meals"] }),
  });

  const renameMeal = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase
        .from("meals")
        .update({ name })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meals"] }),
  });

  const deleteMeal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("meals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meals"] }),
  });

  const duplicateMeal = useMutation({
    mutationFn: async (meal: Meal) => {
      const { error } = await supabase
        .from("meals")
        .insert({ name: meal.name, color: meal.color, is_available: true });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meals"] }),
  });

  const moveBackOrDelete = useMutation({
    mutationFn: async (meal: Meal) => {
      // Check if same name already exists in "tous" list
      const hasDuplicate = meals.some(
        (m) => m.id !== meal.id && m.name === meal.name && !m.is_available
      );
      if (hasDuplicate) {
        // Delete instead of moving back
        const { error } = await supabase.from("meals").delete().eq("id", meal.id);
        if (error) throw error;
      } else {
        // Move back to "tous"
        const { error } = await supabase
          .from("meals")
          .update({ is_available: false })
          .eq("id", meal.id);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meals"] }),
  });

  const allMeals = meals.filter((m) => !m.is_available);
  const availableMeals = meals.filter((m) => m.is_available);

  return {
    allMeals,
    availableMeals,
    isLoading,
    addMeal,
    toggleAvailability,
    renameMeal,
    deleteMeal,
    duplicateMeal,
    moveBackOrDelete,
  };
}
