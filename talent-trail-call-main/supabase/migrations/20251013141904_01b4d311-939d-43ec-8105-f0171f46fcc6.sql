-- Fix search_path for match_waiting_users function
CREATE OR REPLACE FUNCTION public.match_waiting_users()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  potential_match RECORD;
  matched_skills_data JSONB;
BEGIN
  -- Only proceed if the new entry is in 'waiting' status
  IF NEW.status != 'waiting' THEN
    RETURN NEW;
  END IF;

  -- Find a potential match: someone who wants what this user has AND has what this user wants
  SELECT wr.* INTO potential_match
  FROM public.waiting_room wr
  WHERE wr.status = 'waiting'
    AND wr.user_id != NEW.user_id
    -- Check if there's at least one skill match in both directions
    AND EXISTS (
      SELECT 1 FROM unnest(wr.want_skills) ws
      WHERE ws = ANY(NEW.possess_skills)
    )
    AND EXISTS (
      SELECT 1 FROM unnest(NEW.want_skills) ws
      WHERE ws = ANY(wr.possess_skills)
    )
  LIMIT 1;

  -- If a match is found, update both users
  IF potential_match.id IS NOT NULL THEN
    -- Build the matched skills JSON
    matched_skills_data := jsonb_build_object(
      'user1_teaches', (
        SELECT array_agg(skill)
        FROM unnest(NEW.possess_skills) skill
        WHERE skill = ANY(potential_match.want_skills)
      ),
      'user2_teaches', (
        SELECT array_agg(skill)
        FROM unnest(potential_match.possess_skills) skill
        WHERE skill = ANY(NEW.want_skills)
      )
    );

    -- Update the current user
    UPDATE public.waiting_room
    SET 
      status = 'matched',
      matched_with = potential_match.user_id,
      updated_at = now()
    WHERE id = NEW.id;

    -- Update the matched user
    UPDATE public.waiting_room
    SET 
      status = 'matched',
      matched_with = NEW.user_id,
      updated_at = now()
    WHERE id = potential_match.id;

    -- Create a call session
    INSERT INTO public.call_sessions (user1_id, user2_id, matched_skills, status)
    VALUES (NEW.user_id, potential_match.user_id, matched_skills_data, 'active');

    -- Return the updated NEW record
    SELECT * INTO NEW FROM public.waiting_room WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;