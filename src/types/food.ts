/**
 * Types domaine des aliments (food_items).
 * Source unique pour éviter d’importer des types depuis les hooks React.
 */

export type StorageType = "frigo" | "sec" | "surgele" | "extras" | "test" | "toujours";
export type FoodType = "feculent" | "viande" | null;

export interface FoodItem {
  id: string;
  name: string;
  grams: string | null;
  calories: string | null;
  protein: string | null;
  fiber: string | null;
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
