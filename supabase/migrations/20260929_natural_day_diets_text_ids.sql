-- Tacoplan: alinear IDs de jornadas fuera de base con los IDs locales.
--
-- La app usa IDs string para jornadas y para NaturalDayDietEntry. La migración
-- original creó estas columnas como uuid, lo que puede rechazar IDs locales como
-- "auto_oob_..." y los IDs de jornada guardados en previous/next_journey_id.
-- Se convierten a text sin cambiar los valores existentes ni el UNIQUE(user_id,date).

DO $$
DECLARE
  id_type text;
  prev_type text;
  next_type text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_natural_day_diets'
  ) THEN
    RETURN;
  END IF;

  SELECT data_type INTO id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_natural_day_diets'
    AND column_name = 'id';

  IF id_type IS NOT NULL AND id_type <> 'text' THEN
    ALTER TABLE public.user_natural_day_diets ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE public.user_natural_day_diets
      ALTER COLUMN id TYPE text USING id::text;
    ALTER TABLE public.user_natural_day_diets
      ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;

  SELECT data_type INTO prev_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_natural_day_diets'
    AND column_name = 'previous_journey_id';

  IF prev_type IS NOT NULL AND prev_type <> 'text' THEN
    ALTER TABLE public.user_natural_day_diets
      ALTER COLUMN previous_journey_id TYPE text USING previous_journey_id::text;
  END IF;

  SELECT data_type INTO next_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_natural_day_diets'
    AND column_name = 'next_journey_id';

  IF next_type IS NOT NULL AND next_type <> 'text' THEN
    ALTER TABLE public.user_natural_day_diets
      ALTER COLUMN next_journey_id TYPE text USING next_journey_id::text;
  END IF;
END $$;
