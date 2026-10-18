-- AutoStart suggestions are never legal jornadas until explicitly confirmed.
create table if not exists public.autostart_proposals (
 id text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 detected_at timestamptz not null,
 source text not null default 'location' check (source = 'location'),
 status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
 confirmed_jornada_id uuid null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists autostart_one_pending_per_user on public.autostart_proposals(user_id) where status='pending';
create index if not exists autostart_proposals_user_idx on public.autostart_proposals(user_id, detected_at desc);
alter table public.autostart_proposals enable row level security;
create policy "autostart own select" on public.autostart_proposals for select to authenticated using (user_id = (select auth.uid()));
create policy "autostart own insert" on public.autostart_proposals for insert to authenticated with check (user_id = (select auth.uid()) and status='pending');
create policy "autostart own update" on public.autostart_proposals for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "autostart own delete" on public.autostart_proposals for delete to authenticated using (user_id = (select auth.uid()));
