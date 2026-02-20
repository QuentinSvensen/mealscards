import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function usePreferences() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["user_preferences"] });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        qc.invalidateQueries({ queryKey: ["user_preferences"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc]);

  const { data: preferences = [] } = useQuery({
    queryKey: ["user_preferences"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_preferences")
        .select("*");
      if (error) throw error;
      return data as { id: string; key: string; value: any }[];
    },
    retry: 3,
    retryDelay: 500,
  });

  const getPreference = <T>(key: string, defaultValue: T): T => {
    const pref = preferences.find(p => p.key === key);
    return pref ? (pref.value as T) : defaultValue;
  };

  const setPreference = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: any }) => {
      const existing = preferences.find(p => p.key === key);
      if (existing) {
        const { error } = await (supabase as any)
          .from("user_preferences")
          .update({ value, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("user_preferences")
          .insert({ key, value });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  return { preferences, getPreference, setPreference };
}
