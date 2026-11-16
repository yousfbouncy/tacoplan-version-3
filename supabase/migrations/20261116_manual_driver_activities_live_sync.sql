-- Manual activity segments may remain open until the next activity or shift closure.
-- Their stable text IDs allow retrying saved offline updates without duplicates.
ALTER TABLE public.tacho_activities ALTER COLUMN fin DROP NOT NULL;
ALTER TABLE public.tacho_activities ADD COLUMN IF NOT EXISTS shift_id text;
ALTER TABLE public.tacho_activities ADD COLUMN IF NOT EXISTS segment_index integer;
CREATE INDEX IF NOT EXISTS tacho_activities_live_shift_idx
 ON public.tacho_activities (user_id,shift_id,inicio DESC)
 WHERE source='manual';
