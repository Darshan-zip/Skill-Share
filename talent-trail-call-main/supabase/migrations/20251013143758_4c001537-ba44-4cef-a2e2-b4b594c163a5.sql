-- Ensure realtime publishes full row data and includes needed tables
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.waiting_room;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_sessions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Ensure full row data is sent on updates
ALTER TABLE public.waiting_room REPLICA IDENTITY FULL;
ALTER TABLE public.call_sessions REPLICA IDENTITY FULL;