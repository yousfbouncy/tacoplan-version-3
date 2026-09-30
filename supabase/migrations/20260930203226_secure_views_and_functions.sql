-- Las vistas normales usan privilegios del propietario por defecto. Forzar
-- SECURITY INVOKER hace que las políticas RLS de las tablas base sigan
-- aplicándose al usuario que consulta.
alter view public.latest_user_device set (security_invoker = true);
alter view public.admin_user_snapshot_v1 set (security_invoker = true);
alter view public.tachograph_jornada_sums set (security_invoker = true);

-- Las vistas administrativas solo se consumen dentro de RPCs protegidos.
revoke all on public.latest_user_device from public, anon, authenticated;
revoke all on public.admin_user_snapshot_v1 from public, anon, authenticated;

-- El resumen de tacógrafo sí es útil para la app autenticada, pero nunca para
-- el rol anónimo. SECURITY INVOKER conserva el aislamiento por user_id.
revoke all on public.tachograph_jornada_sums from public, anon;
grant select on public.tachograph_jornada_sums to authenticated;

-- Son funciones de trigger, no endpoints RPC. Los triggers continúan
-- funcionando aunque se retire EXECUTE a los roles de la API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_profile_last_jornada_at() from public, anon, authenticated;

-- Fija un search_path conocido para evitar resolución de objetos controlada
-- por el llamador. Se aplica a todas las sobrecargas presentes.
do $$
declare
  function_signature regprocedure;
begin
  for function_signature in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'handle_new_user',
        'semver_compare',
        'admin_list_users_v1',
        'is_admin',
        'touch_profile_last_jornada_at',
        'business_round_money',
        'admin_target_user_ids_v1',
        'admin_target_push_tokens_v1',
        'business_resolve_invoice_status',
        'is_admin_user',
        'semver_part',
        'admin_dashboard_stats_v1',
        'admin_target_user_ids_v2',
        'tacoplan_set_updated_at'
      ])
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public, auth',
      function_signature
    );
  end loop;
end $$;
