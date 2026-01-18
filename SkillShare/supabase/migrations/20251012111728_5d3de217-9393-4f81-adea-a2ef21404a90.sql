-- Create user profiles table
CREATE TABLE public.profiles (
  id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- User skills table
CREATE TABLE public.user_skills (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  skill_name text NOT NULL,
  skill_type text NOT NULL CHECK (skill_type IN ('possess', 'want')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_skills ENABLE ROW LEVEL SECURITY;

-- User skills policies
CREATE POLICY "Users can view their own skills"
  ON public.user_skills FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own skills"
  ON public.user_skills FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own skills"
  ON public.user_skills FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own skills"
  ON public.user_skills FOR DELETE
  USING (auth.uid() = user_id);

-- Waiting room table for matchmaking
CREATE TABLE public.waiting_room (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'in_call')),
  possess_skills text[] NOT NULL,
  want_skills text[] NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  matched_with uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS and realtime
ALTER TABLE public.waiting_room ENABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE public.waiting_room;

-- Waiting room policies - users can see others in waiting room for matching
CREATE POLICY "Users can view waiting room"
  ON public.waiting_room FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert themselves into waiting room"
  ON public.waiting_room FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own waiting room entry"
  ON public.waiting_room FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = matched_with);

CREATE POLICY "Users can delete their own waiting room entry"
  ON public.waiting_room FOR DELETE
  USING (auth.uid() = user_id);

-- Call sessions table
CREATE TABLE public.call_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user1_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user2_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  matched_skills jsonb NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended'))
);

-- Enable RLS
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

-- Call sessions policies
CREATE POLICY "Users can view their own sessions"
  ON public.call_sessions FOR SELECT
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can update their own sessions"
  ON public.call_sessions FOR UPDATE
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

-- Create trigger function for profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$;

-- Create trigger for automatic profile creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Add triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_waiting_room_updated_at
  BEFORE UPDATE ON public.waiting_room
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();