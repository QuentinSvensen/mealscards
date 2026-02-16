import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ShoppingGroup {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface ShoppingItem {
  id: string;
  group_id: string | null;
  name: string;
  quantity: string | null;
  checked: boolean;
  sort_order: number;
  created_at: string;
}

export function useShoppingList() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shopping_groups"] });
    qc.invalidateQueries({ queryKey: ["shopping_items"] });
  };

  const { data: groups = [] } = useQuery({
    queryKey: ["shopping_groups"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shopping_groups").select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      return data as ShoppingGroup[];
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["shopping_items"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shopping_items").select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      return data as ShoppingItem[];
    },
  });

  const addGroup = useMutation({
    mutationFn: async (name: string) => {
      const maxOrder = groups.reduce((max, g) => Math.max(max, g.sort_order), -1);
      const { error } = await (supabase as any)
        .from("shopping_groups").insert({ name, sort_order: maxOrder + 1 });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const renameGroup = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await (supabase as any)
        .from("shopping_groups").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("shopping_groups").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const addItem = useMutation({
    mutationFn: async ({ name, group_id }: { name: string; group_id: string | null }) => {
      const groupItems = items.filter(i => i.group_id === group_id);
      const maxOrder = groupItems.reduce((max, i) => Math.max(max, i.sort_order), -1);
      const { error } = await (supabase as any)
        .from("shopping_items").insert({ name, group_id, sort_order: maxOrder + 1 });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const toggleItem = useMutation({
    mutationFn: async ({ id, checked }: { id: string; checked: boolean }) => {
      const { error } = await (supabase as any)
        .from("shopping_items").update({ checked }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateItemQuantity = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: string | null }) => {
      const { error } = await (supabase as any)
        .from("shopping_items").update({ quantity }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const renameItem = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await (supabase as any)
        .from("shopping_items").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("shopping_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const getItemsByGroup = (groupId: string | null) =>
    items.filter(i => i.group_id === groupId).sort((a, b) => a.sort_order - b.sort_order);

  const ungroupedItems = items.filter(i => !i.group_id).sort((a, b) => a.sort_order - b.sort_order);

  return {
    groups, items, ungroupedItems,
    addGroup, renameGroup, deleteGroup,
    addItem, toggleItem, updateItemQuantity, renameItem, deleteItem,
    getItemsByGroup,
  };
}
