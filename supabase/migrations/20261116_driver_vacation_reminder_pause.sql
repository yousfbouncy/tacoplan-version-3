-- Driver-controlled vacation period suppresses only reminders to register a jornada.
alter table public.profiles
 add column if not exists vacation_start_date date,
 add column if not exists vacation_end_date date;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='profiles_vacation_period_valid') then
  alter table public.profiles add constraint profiles_vacation_period_valid check (
   (vacation_start_date is null and vacation_end_date is null)
   or (vacation_start_date is not null and vacation_end_date is not null and vacation_end_date >= vacation_start_date)
  );
 end if;
end $$;
-- Existing owner-authenticated RLS continues to govern both columns.
