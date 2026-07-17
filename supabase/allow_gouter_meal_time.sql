-- Autorise meal_time = 'gouter' sur possible_meals
-- (contrainte possible_meals_time_valid : matin / midi / soir / gouter / NULL)

alter table public.possible_meals
  drop constraint if exists possible_meals_time_valid;

alter table public.possible_meals
  add constraint possible_meals_time_valid
  check (
    meal_time is null
    or meal_time in ('matin', 'midi', 'soir', 'gouter')
  );
