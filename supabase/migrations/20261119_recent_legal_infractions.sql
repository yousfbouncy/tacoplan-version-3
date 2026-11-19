-- Display tachograph infractions only for the last 56 calendar days.
-- Source of truth: jornadas.legal_summary, which is already backed up in Supabase.
-- Historical records remain stored. No deletion at expiry.
CREATE OR REPLACE FUNCTION public.tacoplan_recent_legal_infractions()
RETURNS TABLE (
  jornada_id text,
  occurred_on date,
  code text,
  severity text,
  description text,
  incident_index bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    j.id,
    dates.occurred_on,
    issue.value->>'code',
    COALESCE(issue.value->>'severity', 'grave'),
    COALESCE(issue.value->>'description', ''),
    issue.ordinality
  FROM public.jornadas AS j
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN COALESCE(NULLIF(left(j.end_at, 10), ''), NULLIF(left(j.fecha_fin, 10), ''), NULLIF(left(j.fecha_inicio, 10), ''))
           ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}
      THEN COALESCE(NULLIF(left(j.end_at, 10), ''), NULLIF(left(j.fecha_fin, 10), ''), NULLIF(left(j.fecha_inicio, 10), ''))::date
      ELSE NULL::date
    END AS occurred_on
  ) dates
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(j.legal_summary->'infractions') = 'array'
      THEN j.legal_summary->'infractions'
      ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS issue(value, ordinality)
  WHERE j.user_id = auth.uid()
    AND dates.occurred_on BETWEEN current_date - 56 AND current_date
    AND coalesce(issue.value->>'code', '') <> ''
  ORDER BY dates.occurred_on DESC, j.id DESC, issue.ordinality
  LIMIT 500
$$;

REVOKE ALL ON FUNCTION public.tacoplan_recent_legal_infractions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tacoplan_recent_legal_infractions() TO authenticated;

      THEN COALESCE(NULLIF(left(j.end_at, 10), ''), NULLIF(left(j.fecha_fin, 10), ''), NULLIF(left(j.fecha_inicio, 10), ''))::date
      ELSE NULL::date
    END AS occurred_on
  ) dates
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(j.legal_summary->'infractions') = 'array'
      THEN j.legal_summary->'infractions'
      ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS issue(value, ordinality)
  WHERE j.user_id = auth.uid()
    AND dates.occurred_on BETWEEN current_date - 56 AND current_date
    AND coalesce(issue.value->>'code', '') <> ''
  ORDER BY dates.occurred_on DESC, j.id DESC, issue.ordinality
  LIMIT 500
$$;

REVOKE ALL ON FUNCTION public.tacoplan_recent_legal_infractions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tacoplan_recent_legal_infractions() TO authenticated;
