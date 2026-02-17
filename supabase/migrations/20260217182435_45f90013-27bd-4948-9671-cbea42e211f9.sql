
-- Drop all existing permissive policies on meals
DROP POLICY IF EXISTS "Anyone can delete meals" ON public.meals;
DROP POLICY IF EXISTS "Anyone can insert meals" ON public.meals;
DROP POLICY IF EXISTS "Anyone can update meals" ON public.meals;
DROP POLICY IF EXISTS "Anyone can view meals" ON public.meals;

-- Create auth-required policies for meals
CREATE POLICY "Authenticated users can view meals" ON public.meals
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert meals" ON public.meals
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update meals" ON public.meals
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete meals" ON public.meals
  FOR DELETE TO authenticated USING (true);

-- Drop all existing permissive policies on possible_meals
DROP POLICY IF EXISTS "Anyone can delete possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Anyone can insert possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Anyone can update possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Anyone can view possible_meals" ON public.possible_meals;

-- Create auth-required policies for possible_meals
CREATE POLICY "Authenticated users can view possible_meals" ON public.possible_meals
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert possible_meals" ON public.possible_meals
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update possible_meals" ON public.possible_meals
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete possible_meals" ON public.possible_meals
  FOR DELETE TO authenticated USING (true);

-- Drop all existing permissive policies on shopping_groups
DROP POLICY IF EXISTS "Anyone can delete shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Anyone can insert shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Anyone can select shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Anyone can update shopping_groups" ON public.shopping_groups;

-- Create auth-required policies for shopping_groups
CREATE POLICY "Authenticated users can view shopping_groups" ON public.shopping_groups
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert shopping_groups" ON public.shopping_groups
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update shopping_groups" ON public.shopping_groups
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete shopping_groups" ON public.shopping_groups
  FOR DELETE TO authenticated USING (true);

-- Drop all existing permissive policies on shopping_items
DROP POLICY IF EXISTS "Anyone can delete shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Anyone can insert shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Anyone can select shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Anyone can update shopping_items" ON public.shopping_items;

-- Create auth-required policies for shopping_items
CREATE POLICY "Authenticated users can view shopping_items" ON public.shopping_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert shopping_items" ON public.shopping_items
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update shopping_items" ON public.shopping_items
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete shopping_items" ON public.shopping_items
  FOR DELETE TO authenticated USING (true);
