alter table public.meals
  add column if not exists fiber text;

alter table public.food_items
  add column if not exists fiber text;

alter table public.food_library
  add column if not exists fiber text;
