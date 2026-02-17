
-- Add user_id columns with default auth.uid()
ALTER TABLE public.meals ADD COLUMN user_id UUID DEFAULT auth.uid();
ALTER TABLE public.possible_meals ADD COLUMN user_id UUID DEFAULT auth.uid();
ALTER TABLE public.shopping_groups ADD COLUMN user_id UUID DEFAULT auth.uid();
ALTER TABLE public.shopping_items ADD COLUMN user_id UUID DEFAULT auth.uid();

-- Drop existing policies on meals
DROP POLICY IF EXISTS "Authenticated users can view meals" ON public.meals;
DROP POLICY IF EXISTS "Authenticated users can insert meals" ON public.meals;
DROP POLICY IF EXISTS "Authenticated users can update meals" ON public.meals;
DROP POLICY IF EXISTS "Authenticated users can delete meals" ON public.meals;

-- User-scoped policies for meals
CREATE POLICY "Users can view own meals" ON public.meals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own meals" ON public.meals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own meals" ON public.meals
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own meals" ON public.meals
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Drop existing policies on possible_meals
DROP POLICY IF EXISTS "Authenticated users can view possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Authenticated users can insert possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Authenticated users can update possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Authenticated users can delete possible_meals" ON public.possible_meals;

-- User-scoped policies for possible_meals
CREATE POLICY "Users can view own possible_meals" ON public.possible_meals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own possible_meals" ON public.possible_meals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own possible_meals" ON public.possible_meals
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own possible_meals" ON public.possible_meals
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Drop existing policies on shopping_groups
DROP POLICY IF EXISTS "Authenticated users can view shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Authenticated users can insert shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Authenticated users can update shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Authenticated users can delete shopping_groups" ON public.shopping_groups;

-- User-scoped policies for shopping_groups
CREATE POLICY "Users can view own shopping_groups" ON public.shopping_groups
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own shopping_groups" ON public.shopping_groups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own shopping_groups" ON public.shopping_groups
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own shopping_groups" ON public.shopping_groups
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Drop existing policies on shopping_items
DROP POLICY IF EXISTS "Authenticated users can view shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Authenticated users can insert shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Authenticated users can update shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Authenticated users can delete shopping_items" ON public.shopping_items;

-- User-scoped policies for shopping_items
CREATE POLICY "Users can view own shopping_items" ON public.shopping_items
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own shopping_items" ON public.shopping_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own shopping_items" ON public.shopping_items
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own shopping_items" ON public.shopping_items
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
