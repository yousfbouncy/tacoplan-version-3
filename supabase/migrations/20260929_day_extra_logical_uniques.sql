-- Tacoplan: impedir duplicados económicos lógicos en user_day_extra_entries.
--
-- Limpia duplicados históricos conservando la fila más reciente y después
-- protege la tabla para que dos dispositivos no puedan volver a crear el mismo
-- concepto económico para el mismo usuario/día.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_day_extra_entries'
  ) THEN
    RETURN;
  END IF;

  -- Solo ejecutar si el esquema tiene las columnas que usa la app actual.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_day_extra_entries'
      AND column_name = 'entry_type'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_day_extra_entries'
      AND column_name = 'day_flag'
  ) THEN
    RETURN;
  END IF;

  -- Día extra normal: una sola fila por usuario + fecha + tipo de día.
  DELETE FROM public.user_day_extra_entries d
  USING (
    SELECT id
    FROM (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY user_id, date, day_flag
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        ) AS rn
      FROM public.user_day_extra_entries
      WHERE entry_type = 'day_extra'
    ) ranked
    WHERE rn > 1
  ) dup
  WHERE d.id = dup.id;

  -- Descanso semanal fuera de base: una sola fila por usuario + fecha.
  DELETE FROM public.user_day_extra_entries d
  USING (
    SELECT id
    FROM (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY user_id, date
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        ) AS rn
      FROM public.user_day_extra_entries
      WHERE entry_type = 'offsite_weekly_rest'
    ) ranked
    WHERE rn > 1
  ) dup
  WHERE d.id = dup.id;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_day_extra_user_date_flag'
  ) THEN
    EXECUTE '
      CREATE UNIQUE INDEX uq_day_extra_user_date_flag
      ON public.user_day_extra_entries(user_id, date, day_flag)
      WHERE entry_type = ''day_extra''
    ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_offsite_weekly_user_date'
  ) THEN
    EXECUTE '
      CREATE UNIQUE INDEX uq_offsite_weekly_user_date
      ON public.user_day_extra_entries(user_id, date)
      WHERE entry_type = ''offsite_weekly_rest''
    ';
  END IF;
END $$;
