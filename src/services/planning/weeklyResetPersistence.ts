import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { PossibleMealsFullBackup } from "@/domain/planning/types";

/** Enregistre ou met à jour la sauvegarde JSON `possible_meals_backup` pour l’utilisateur. */
export async function upsertPossibleMealsFullBackup(
  userId: string,
  payload: PossibleMealsFullBackup
): Promise<void> {
  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        key: "possible_meals_backup",
        value: payload as unknown as Json,
        user_id: userId,
      },
      { onConflict: "user_id,key" }
    );
  if (error) throw new Error(error.message);
}

/** Supprime en parallèle les lignes `possible_meals` dont les id sont listés. */
export async function deletePossibleMealsByIds(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map(async id => {
      const { error } = await supabase.from("possible_meals").delete().eq("id", id);
      if (error) throw new Error(error.message);
    })
  );
}
