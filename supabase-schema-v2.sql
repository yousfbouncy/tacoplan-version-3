-- ============================================================
-- Tacoplan: Supabase Schema V2 — Multi-device Sync Ready
-- ============================================================
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Safe to run multiple times (uses IF NOT EXISTS + DROP POLICY IF EXISTS)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- TABLE 1: profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  language TEXT DEFAULT 'es',
  period_type TEXT DEFAULT 'AUTO_01_30',
  period_start_day INTEGER DEFAULT 1,
  period_end_day INTEGER DEFAULT 30,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  driver_profile TEXT,
  operation_zone TEXT,
  trip_types JSONB,
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  push_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_jornada_at TIMESTAMPTZ,
  last_inactivity_notification_sent_at TIMESTAMPTZ,
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_delete" ON profiles;
CREATE POLICY "profiles_delete" ON profiles FOR DELETE USING (auth.uid() = id);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'es';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS period_type TEXT DEFAULT 'AUTO_01_30';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS period_start_day INTEGER DEFAULT 1;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS period_end_day INTEGER DEFAULT 30;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS driver_profile TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS operation_zone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trip_types JSONB;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_jornada_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_inactivity_notification_sent_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TEXT;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'dietas';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_per_km NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_per_km_nacional NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_per_km_internacional NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_per_km_regional NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_per_trip NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_per_trip_nacional NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_per_trip_internacional NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_per_trip_regional NUMERIC NOT NULL DEFAULT 0;

-- ============================================================
-- TABLE: push_tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  device_id TEXT,
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_token_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_tokens_select" ON push_tokens;
CREATE POLICY "push_tokens_select" ON push_tokens FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "push_tokens_insert" ON push_tokens;
CREATE POLICY "push_tokens_insert" ON push_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "push_tokens_update" ON push_tokens;
CREATE POLICY "push_tokens_update" ON push_tokens FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "push_tokens_delete" ON push_tokens;
CREATE POLICY "push_tokens_delete" ON push_tokens FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- TABLE 2: jornadas (ALL columns including ferry + morocco)
-- ============================================================
CREATE TABLE IF NOT EXISTS jornadas (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha_inicio TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  lugar_inicio TEXT NOT NULL,
  fecha_fin TEXT,
  hora_fin TEXT,
  lugar_fin TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  conduccion_min INTEGER,
  conduccion_domingo_min INTEGER,
  conduccion_lunes_min INTEGER,
  tipo_ruta TEXT,
  pernocta BOOLEAN,
  dieta_modo TEXT DEFAULT 'AUTO',
  dieta_manual_tipo TEXT,
  dieta_manual_pct TEXT,
  dieta_importe_eur TEXT,
  dietas_items JSONB,
  dieta_percent NUMERIC,
  day_flag TEXT,
  day_extra_eur NUMERIC,
  diet_base_eur NUMERIC,
  diet_rule TEXT,
  diet_calculated_at TEXT,
  descanso_anterior_min INTEGER,
  tipo_descanso_anterior TEXT,
  duracion_jornada_min INTEGER,
  counts_as_daily_reduced BOOLEAN DEFAULT FALSE,
  planned_rest_min INTEGER,
  planned_rest_type TEXT,
  plus_items JSONB,
  observaciones TEXT,
  legal_summary JSONB,
  previous_rest_source TEXT,
  previous_rest_id TEXT,
  previous_rest_valid BOOLEAN,
  -- Ferry fields
  ferry_pending BOOLEAN DEFAULT FALSE,
  ferry_rest_type TEXT,
  ferry_destination TEXT,
  ferry_extras JSONB,
  ferry_interruptions JSONB,
  ferry_rest_completed BOOLEAN DEFAULT FALSE,
  has_ferry BOOLEAN DEFAULT FALSE,
  ferry_data JSONB,
  -- Morocco fields
  morocco_payment_mode TEXT,
  morocco_trip_rate NUMERIC,
  morocco_pernight_rate NUMERIC,
  -- Timestamps
  updated_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE jornadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jornadas_select" ON jornadas;
CREATE POLICY "jornadas_select" ON jornadas FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "jornadas_insert" ON jornadas;
CREATE POLICY "jornadas_insert" ON jornadas FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "jornadas_update" ON jornadas;
CREATE POLICY "jornadas_update" ON jornadas FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "jornadas_delete" ON jornadas;
CREATE POLICY "jornadas_delete" ON jornadas FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_jornadas_user_id ON jornadas(user_id);
CREATE INDEX IF NOT EXISTS idx_jornadas_start_at ON jornadas(start_at);
CREATE INDEX IF NOT EXISTS idx_jornadas_updated ON jornadas(updated_at);

-- Add missing columns for existing installations
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS conduccion_domingo_min INTEGER;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS conduccion_lunes_min INTEGER;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS dieta_percent NUMERIC;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS day_flag TEXT;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS day_extra_eur NUMERIC;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS diet_base_eur NUMERIC;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS diet_rule TEXT;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS diet_calculated_at TEXT;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS planned_rest_min INTEGER;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS planned_rest_type TEXT;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS plus_items JSONB;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS legal_summary JSONB;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS dietas_items JSONB;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS previous_rest_source TEXT;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS previous_rest_id TEXT;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS previous_rest_valid BOOLEAN;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS ferry_pending BOOLEAN DEFAULT FALSE;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS ferry_rest_type TEXT;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS ferry_destination TEXT;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS ferry_extras JSONB;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS ferry_interruptions JSONB;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS ferry_rest_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS has_ferry BOOLEAN DEFAULT FALSE;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS ferry_data JSONB;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS morocco_payment_mode TEXT;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS morocco_trip_rate NUMERIC;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS morocco_pernight_rate NUMERIC;

CREATE OR REPLACE FUNCTION public.touch_profile_last_jornada_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
    SET last_jornada_at = NOW()
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_jornada_touch_profile ON public.jornadas;
CREATE TRIGGER on_jornada_touch_profile
  AFTER INSERT ON public.jornadas
  FOR EACH ROW EXECUTE FUNCTION public.touch_profile_last_jornada_at();

-- ============================================================
-- TABLE 3: compensaciones
-- ============================================================
CREATE TABLE IF NOT EXISTS compensaciones (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jornada_id TEXT REFERENCES jornadas(id) ON DELETE CASCADE,
  horas_deuda INTEGER NOT NULL,
  minutos_deuda INTEGER NOT NULL,
  fecha_limite TEXT NOT NULL,
  compensada BOOLEAN DEFAULT FALSE,
  fecha_compensacion TEXT,
  updated_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE compensaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "compensaciones_select" ON compensaciones;
CREATE POLICY "compensaciones_select" ON compensaciones FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "compensaciones_insert" ON compensaciones;
CREATE POLICY "compensaciones_insert" ON compensaciones FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "compensaciones_update" ON compensaciones;
CREATE POLICY "compensaciones_update" ON compensaciones FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "compensaciones_delete" ON compensaciones;
CREATE POLICY "compensaciones_delete" ON compensaciones FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_compensaciones_user_id ON compensaciones(user_id);

-- ============================================================
-- TABLE 4: dietas_config (centralized diet + day extras + ferry rates)
-- ============================================================
CREATE TABLE IF NOT EXISTS dietas_config (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nac_100 NUMERIC NOT NULL DEFAULT 54.30,
  nac_60 NUMERIC NOT NULL DEFAULT 32.58,
  nac_30 NUMERIC NOT NULL DEFAULT 16.29,
  intl_100 NUMERIC NOT NULL DEFAULT 72.77,
  intl_60 NUMERIC NOT NULL DEFAULT 43.66,
  intl_30 NUMERIC NOT NULL DEFAULT 21.83,
  regional_100 NUMERIC NOT NULL DEFAULT 0,
  regional_60 NUMERIC NOT NULL DEFAULT 0,
  regional_30 NUMERIC NOT NULL DEFAULT 0,
  extra_saturday NUMERIC NOT NULL DEFAULT 10,
  extra_sunday NUMERIC NOT NULL DEFAULT 15,
  extra_holiday NUMERIC NOT NULL DEFAULT 20,
  ferry_transit_rate NUMERIC NOT NULL DEFAULT 54.30,
  ferry_cabin_rate NUMERIC NOT NULL DEFAULT 54.30,
  morocco_trip_rate NUMERIC NOT NULL DEFAULT 0,
  morocco_pernight_rate NUMERIC NOT NULL DEFAULT 0,
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE dietas_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dietas_config_select" ON dietas_config;
CREATE POLICY "dietas_config_select" ON dietas_config FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "dietas_config_insert" ON dietas_config;
CREATE POLICY "dietas_config_insert" ON dietas_config FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "dietas_config_update" ON dietas_config;
CREATE POLICY "dietas_config_update" ON dietas_config FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "dietas_config_delete" ON dietas_config;
CREATE POLICY "dietas_config_delete" ON dietas_config FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- TABLE 5: user_diet_rates (keep for backward compat)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_diet_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_type TEXT NOT NULL,
  percent INTEGER NOT NULL,
  amount NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, trip_type, percent)
);

ALTER TABLE user_diet_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own diet rates" ON user_diet_rates;
CREATE POLICY "Users manage own diet rates" ON user_diet_rates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TABLE 6: user_day_extras (keep for backward compat)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_day_extras (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  extra_saturday NUMERIC NOT NULL DEFAULT 0,
  extra_sunday NUMERIC NOT NULL DEFAULT 0,
  extra_holiday NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_day_extras ADD COLUMN IF NOT EXISTS offsite_weekly_reduced_nacional NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE user_day_extras ADD COLUMN IF NOT EXISTS offsite_weekly_reduced_internacional NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE user_day_extras ADD COLUMN IF NOT EXISTS offsite_weekly_complete_nacional NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE user_day_extras ADD COLUMN IF NOT EXISTS offsite_weekly_complete_internacional NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE user_day_extras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own day extras" ON user_day_extras;
CREATE POLICY "Users manage own day extras" ON user_day_extras
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS user_day_extra_entries (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'day_extra',
  day_flag TEXT,
  offsite_rest_type TEXT,
  offsite_base TEXT,
  plus_sunday BOOLEAN NOT NULL DEFAULT FALSE,
  plus_holiday BOOLEAN NOT NULL DEFAULT FALSE,
  amount NUMERIC,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_day_extra_entries_user_date ON user_day_extra_entries(user_id, date);

ALTER TABLE user_day_extra_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own day extra entries" ON user_day_extra_entries;
CREATE POLICY "Users manage own day extra entries" ON user_day_extra_entries
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TABLE 7: user_holidays
-- ============================================================
CREATE TABLE IF NOT EXISTS user_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  UNIQUE(user_id, date)
);

ALTER TABLE user_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own holidays" ON user_holidays;
CREATE POLICY "Users manage own holidays" ON user_holidays
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TABLE 8: user_ferry_config
-- ============================================================
CREATE TABLE IF NOT EXISTS user_ferry_config (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  crosses_ferry BOOLEAN NOT NULL DEFAULT FALSE,
  route_mode TEXT NOT NULL DEFAULT 'spain',
  payment_mode TEXT NOT NULL DEFAULT 'spain_diet',
  trip_rate NUMERIC NOT NULL DEFAULT 0,
  pernight_rate NUMERIC NOT NULL DEFAULT 0,
  ferry_rest_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_ferry_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own ferry config" ON user_ferry_config;
CREATE POLICY "Users manage own ferry config" ON user_ferry_config
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TABLE 9: ferry_rests
-- ============================================================
CREATE TABLE IF NOT EXISTS ferry_rests (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  start_time TEXT NOT NULL,
  rest_type TEXT NOT NULL,
  interruptions JSONB DEFAULT '[]'::jsonb,
  computed_end TEXT,
  valid BOOLEAN DEFAULT TRUE,
  reason TEXT,
  destination TEXT,
  ferry_extras JSONB,
  accumulated_rest_min INTEGER,
  interruption_total_min INTEGER,
  updated_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ferry_rests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ferry_rests_select" ON ferry_rests;
CREATE POLICY "ferry_rests_select" ON ferry_rests FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "ferry_rests_insert" ON ferry_rests;
CREATE POLICY "ferry_rests_insert" ON ferry_rests FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "ferry_rests_update" ON ferry_rests;
CREATE POLICY "ferry_rests_update" ON ferry_rests FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "ferry_rests_delete" ON ferry_rests;
CREATE POLICY "ferry_rests_delete" ON ferry_rests FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ferry_rests_user_id ON ferry_rests(user_id);
CREATE INDEX IF NOT EXISTS idx_ferry_rests_fecha ON ferry_rests(fecha);

ALTER TABLE ferry_rests ADD COLUMN IF NOT EXISTS destination TEXT;
ALTER TABLE ferry_rests ADD COLUMN IF NOT EXISTS ferry_extras JSONB;
ALTER TABLE ferry_rests ADD COLUMN IF NOT EXISTS accumulated_rest_min INTEGER;
ALTER TABLE ferry_rests ADD COLUMN IF NOT EXISTS interruption_total_min INTEGER;

-- ============================================================
-- TABLE 10: morocco_trips
-- ============================================================
CREATE TABLE IF NOT EXISTS morocco_trips (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  origen TEXT NOT NULL,
  destino TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'completed',
  importe NUMERIC NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE morocco_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "morocco_trips_all" ON morocco_trips;
CREATE POLICY "morocco_trips_all" ON morocco_trips
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_morocco_trips_user_id ON morocco_trips(user_id);

-- ============================================================
-- TABLE 11: viajes
-- ============================================================
CREATE TABLE IF NOT EXISTS viajes (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cliente TEXT,
  notas TEXT,
  modo_viaje TEXT,
  estado TEXT NOT NULL DEFAULT 'en_curso',
  paradas JSONB DEFAULT '[]'::jsonb,
  fin_lugar TEXT,
  fin_hora TEXT,
  fin_viaje_nota TEXT,
  jornada_id TEXT,
  updated_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE viajes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viajes_all" ON viajes;
CREATE POLICY "viajes_all" ON viajes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_viajes_user_id ON viajes(user_id);

-- ============================================================
-- TRIGGER: auto-create profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NOW()::TEXT
  );
  INSERT INTO public.dietas_config (user_id, updated_at)
  VALUES (NEW.id, NOW()::TEXT)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- TABLE 12: app_update_config (remote config for update gating)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_update_config (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  channel TEXT,
  latest_version TEXT,
  min_required_version TEXT,
  force_update BOOLEAN NOT NULL DEFAULT FALSE,
  apk_url TEXT,
  message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, channel)
);

ALTER TABLE app_update_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_update_config_read" ON app_update_config;
CREATE POLICY "app_update_config_read" ON app_update_config FOR SELECT USING (true);

ALTER TABLE app_update_config
  ADD COLUMN IF NOT EXISTS minimum_version TEXT,
  ADD COLUMN IF NOT EXISTS app_store_url TEXT,
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE;

-- ============================================================
-- TABLE 13: user_notifications (in-app notifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT NULL,
  automation_id TEXT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'admin_message',
  target_type TEXT NOT NULL DEFAULT 'all',
  target_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  send_push BOOLEAN NOT NULL DEFAULT TRUE,
  create_internal_notification BOOLEAN NOT NULL DEFAULT TRUE,
  button_text TEXT,
  button_url TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility_mode TEXT NOT NULL DEFAULT 'snapshot',
  users_targeted INT NOT NULL DEFAULT 0,
  tokens_found INT NOT NULL DEFAULT 0,
  push_ok INT NOT NULL DEFAULT 0,
  push_failed INT NOT NULL DEFAULT 0,
  internal_created INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_created_at ON notification_dispatches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_dispatches_visibility ON notification_dispatches(visibility_mode, created_at DESC);

ALTER TABLE notification_dispatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_dispatches_admin_select" ON notification_dispatches;
CREATE POLICY "notification_dispatches_admin_select" ON notification_dispatches
  FOR SELECT USING (public.is_admin_user());
DROP POLICY IF EXISTS "notification_dispatches_admin_insert" ON notification_dispatches;
CREATE POLICY "notification_dispatches_admin_insert" ON notification_dispatches
  FOR INSERT WITH CHECK (public.is_admin_user() OR auth.role() = 'service_role');
DROP POLICY IF EXISTS "notification_dispatches_admin_update" ON notification_dispatches;
CREATE POLICY "notification_dispatches_admin_update" ON notification_dispatches
  FOR UPDATE USING (public.is_admin_user() OR auth.role() = 'service_role');
DROP POLICY IF EXISTS "notification_dispatches_user_select_persistent" ON notification_dispatches;
CREATE POLICY "notification_dispatches_user_select_persistent" ON notification_dispatches
  FOR SELECT USING (
    visibility_mode = 'persistent'
    AND (
      target_type = 'all'
      OR (target_type = 'user' AND target_user_id = auth.uid())
    )
  );

CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  button_text TEXT,
  button_url TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  notification_dispatch_id UUID,
  delivered_at TIMESTAMPTZ,
  push_status TEXT NOT NULL DEFAULT 'not_requested',
  delivery_error TEXT,
  visibility_mode TEXT NOT NULL DEFAULT 'snapshot',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created_at ON user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_is_read ON user_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_user_notifications_dispatch ON user_notifications(notification_dispatch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_user_dispatch_unique ON user_notifications(user_id, notification_dispatch_id);

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_notifications_select" ON user_notifications;
DROP POLICY IF EXISTS "user_notifications_insert" ON user_notifications;
DROP POLICY IF EXISTS "user_notifications_update" ON user_notifications;
DROP POLICY IF EXISTS "user_notifications_delete" ON user_notifications;

CREATE POLICY "user_notifications_select" ON user_notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_notifications_insert" ON user_notifications
  FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

CREATE POLICY "user_notifications_update" ON user_notifications
  FOR UPDATE USING (auth.uid() = user_id OR auth.role() = 'service_role');

CREATE POLICY "user_notifications_delete" ON user_notifications
  FOR DELETE USING (auth.uid() = user_id OR auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS app_user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT,
  build_number TEXT,
  device_name TEXT,
  notifications_enabled BOOLEAN DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_devices_user_id ON app_user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_app_user_devices_last_seen_at ON app_user_devices(last_seen_at DESC);

ALTER TABLE app_user_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_user_devices_select" ON app_user_devices;
CREATE POLICY "app_user_devices_select" ON app_user_devices
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "app_user_devices_insert" ON app_user_devices;
CREATE POLICY "app_user_devices_insert" ON app_user_devices
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "app_user_devices_update" ON app_user_devices;
CREATE POLICY "app_user_devices_update" ON app_user_devices
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "app_user_devices_delete" ON app_user_devices;
CREATE POLICY "app_user_devices_delete" ON app_user_devices
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE VIEW latest_user_device AS
SELECT DISTINCT ON (user_id)
  user_id,
  device_id,
  platform,
  app_version,
  build_number,
  device_name,
  notifications_enabled,
  last_seen_at,
  last_sync_at,
  created_at,
  updated_at
FROM app_user_devices
ORDER BY user_id, last_seen_at DESC NULLS LAST, updated_at DESC NULLS LAST;

CREATE OR REPLACE FUNCTION public.semver_part(v TEXT, idx INT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(regexp_replace(split_part(split_part(COALESCE(v, ''), '-', 1), '.', idx), '\D', '', 'g'), ''), '0')::INT;
$$;

CREATE OR REPLACE FUNCTION public.semver_compare(a TEXT, b TEXT)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  a1 INT := public.semver_part(a, 1);
  a2 INT := public.semver_part(a, 2);
  a3 INT := public.semver_part(a, 3);
  b1 INT := public.semver_part(b, 1);
  b2 INT := public.semver_part(b, 2);
  b3 INT := public.semver_part(b, 3);
BEGIN
  IF a1 > b1 THEN RETURN 1; END IF;
  IF a1 < b1 THEN RETURN -1; END IF;
  IF a2 > b2 THEN RETURN 1; END IF;
  IF a2 < b2 THEN RETURN -1; END IF;
  IF a3 > b3 THEN RETURN 1; END IF;
  IF a3 < b3 THEN RETURN -1; END IF;
  RETURN 0;
END;
$$;

CREATE OR REPLACE VIEW admin_user_snapshot_v1 AS
SELECT
  p.id AS user_id,
  p.email,
  p.display_name,
  p.notifications_enabled,
  p.last_jornada_at,
  d.platform,
  d.app_version,
  (SELECT auc.latest_version FROM app_update_config auc WHERE auc.platform = d.platform AND auc.channel IS NULL LIMIT 1) AS latest_version,
  CASE
    WHEN d.app_version IS NULL OR (SELECT auc.latest_version FROM app_update_config auc WHERE auc.platform = d.platform AND auc.channel IS NULL LIMIT 1) IS NULL THEN NULL
    WHEN public.semver_compare(d.app_version, (SELECT auc.latest_version FROM app_update_config auc WHERE auc.platform = d.platform AND auc.channel IS NULL LIMIT 1)) >= 0 THEN TRUE
    ELSE FALSE
  END AS is_updated,
  d.last_seen_at,
  d.last_sync_at,
  pt.has_push_token,
  pt.push_token_updated_at,
  CASE
    WHEN p.last_jornada_at IS NULL THEN NULL
    ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - p.last_jornada_at)) / 86400.0)::INT
  END AS days_since_last_jornada
FROM profiles p
LEFT JOIN latest_user_device d ON d.user_id = p.id
LEFT JOIN (
  SELECT
    user_id,
    (COUNT(*) > 0) AS has_push_token,
    MAX(COALESCE(last_token_update, updated_at)) AS push_token_updated_at
  FROM push_tokens
  GROUP BY user_id
) pt ON pt.user_id = p.id;

CREATE OR REPLACE FUNCTION public.admin_list_users_v1(
  p_q TEXT DEFAULT NULL,
  p_filter TEXT DEFAULT 'all',
  p_sort TEXT DEFAULT 'last_jornada_desc',
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  display_name TEXT,
  platform TEXT,
  app_version TEXT,
  latest_version TEXT,
  is_updated BOOLEAN,
  last_jornada_at TIMESTAMPTZ,
  days_since_last_jornada INT,
  notifications_enabled BOOLEAN,
  has_push_token BOOLEAN,
  push_token_updated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT *
    FROM admin_user_snapshot_v1
    WHERE
      (
        p_q IS NULL
        OR p_q = ''
        OR user_id::TEXT ILIKE '%' || p_q || '%'
        OR COALESCE(email, '') ILIKE '%' || p_q || '%'
        OR COALESCE(display_name, '') ILIKE '%' || p_q || '%'
      )
      AND (
        p_filter = 'all'
        OR (p_filter = 'updated' AND is_updated IS TRUE)
        OR (p_filter = 'outdated' AND is_updated IS FALSE)
        OR (p_filter = 'unknown_version' AND is_updated IS NULL)
        OR (p_filter = 'notifications_enabled' AND notifications_enabled IS TRUE)
        OR (p_filter = 'notifications_disabled' AND notifications_enabled IS FALSE)
        OR (p_filter = 'no_jornada_2_days' AND (last_jornada_at IS NULL OR last_jornada_at <= NOW() - INTERVAL '2 days'))
        OR (p_filter = 'no_jornada_7_days' AND (last_jornada_at IS NULL OR last_jornada_at <= NOW() - INTERVAL '7 days'))
        OR (p_filter = 'platform_android' AND platform = 'android')
        OR (p_filter = 'platform_ios' AND platform = 'ios')
      )
  )
  SELECT
    user_id,
    email,
    display_name,
    platform,
    app_version,
    latest_version,
    is_updated,
    last_jornada_at,
    days_since_last_jornada,
    notifications_enabled,
    COALESCE(has_push_token, FALSE) AS has_push_token,
    push_token_updated_at,
    last_seen_at,
    last_sync_at
  FROM base
  ORDER BY
    CASE
      WHEN p_sort = 'last_jornada_desc' THEN 0
      WHEN p_sort = 'days_since_desc' THEN 1
      WHEN p_sort = 'outdated_first' THEN 2
      WHEN p_sort = 'notifications_disabled_first' THEN 3
      ELSE 9
    END,
    CASE WHEN p_sort = 'outdated_first' THEN
      CASE WHEN is_updated IS FALSE THEN 0 WHEN is_updated IS NULL THEN 1 ELSE 2 END
    END,
    CASE WHEN p_sort = 'notifications_disabled_first' THEN (CASE WHEN notifications_enabled IS FALSE THEN 0 ELSE 1 END) END,
    CASE WHEN p_sort = 'days_since_desc' THEN COALESCE(days_since_last_jornada, -1) END DESC,
    CASE WHEN p_sort = 'last_jornada_desc' THEN last_jornada_at END DESC NULLS LAST,
    COALESCE(email, '') ASC
  LIMIT GREATEST(1, LEAST(500, p_limit))
  OFFSET GREATEST(0, p_offset);
$$;

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats_v1()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH u AS (
    SELECT *
    FROM admin_user_snapshot_v1
  ),
  today AS (
    SELECT (NOW() AT TIME ZONE 'utc')::DATE AS d
  )
  SELECT jsonb_build_object(
    'total_users', (SELECT COUNT(*) FROM u),
    'updated', (SELECT COUNT(*) FROM u WHERE is_updated IS TRUE),
    'outdated', (SELECT COUNT(*) FROM u WHERE is_updated IS FALSE),
    'unknown_version', (SELECT COUNT(*) FROM u WHERE is_updated IS NULL),
    'notifications_enabled', (SELECT COUNT(*) FROM u WHERE notifications_enabled IS TRUE),
    'notifications_disabled', (SELECT COUNT(*) FROM u WHERE notifications_enabled IS FALSE),
    'jornada_today', (SELECT COUNT(*) FROM u, today WHERE u.last_jornada_at IS NOT NULL AND (u.last_jornada_at AT TIME ZONE 'utc')::DATE = today.d),
    'no_jornada_2_days', (SELECT COUNT(*) FROM u WHERE last_jornada_at IS NULL OR last_jornada_at <= NOW() - INTERVAL '2 days'),
    'no_jornada_7_days', (SELECT COUNT(*) FROM u WHERE last_jornada_at IS NULL OR last_jornada_at <= NOW() - INTERVAL '7 days'),
    'android', (SELECT COUNT(*) FROM u WHERE platform = 'android'),
    'ios', (SELECT COUNT(*) FROM u WHERE platform = 'ios')
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_target_user_ids_v1(p_target_type TEXT)
RETURNS TABLE (user_id UUID)
LANGUAGE sql
STABLE
AS $$
  SELECT user_id
  FROM admin_user_snapshot_v1
  WHERE
    (p_target_type = 'all')
    OR (p_target_type = 'outdated_version' AND is_updated IS FALSE)
    OR (p_target_type = 'notifications_enabled' AND notifications_enabled IS TRUE)
    OR (p_target_type = 'no_jornada_2_days' AND (last_jornada_at IS NULL OR last_jornada_at <= NOW() - INTERVAL '2 days'))
    OR (p_target_type = 'no_jornada_7_days' AND (last_jornada_at IS NULL OR last_jornada_at <= NOW() - INTERVAL '7 days'))
    OR (p_target_type = 'platform_android' AND platform = 'android')
    OR (p_target_type = 'platform_ios' AND platform = 'ios');
$$;

CREATE OR REPLACE FUNCTION public.admin_target_user_ids_v2(
  p_target_type TEXT,
  p_platform TEXT DEFAULT NULL
)
RETURNS TABLE (user_id UUID)
LANGUAGE sql
STABLE
AS $$
  WITH latest AS (
    SELECT platform, latest_version
    FROM app_update_config
    WHERE channel IS NULL
  )
  SELECT p.id AS user_id
  FROM profiles p
  WHERE
    (p_target_type = 'all')
    OR (p_target_type = 'notifications_enabled' AND EXISTS (
      SELECT 1 FROM push_tokens pt WHERE pt.user_id = p.id AND pt.notifications_enabled = TRUE
    ))
    OR (p_target_type = 'notifications_disabled' AND NOT EXISTS (
      SELECT 1 FROM push_tokens pt WHERE pt.user_id = p.id AND pt.notifications_enabled = TRUE
    ))
    OR (p_target_type = 'no_jornada_2_days' AND (p.last_jornada_at IS NULL OR p.last_jornada_at <= NOW() - INTERVAL '2 days'))
    OR (p_target_type = 'no_jornada_7_days' AND (p.last_jornada_at IS NULL OR p.last_jornada_at <= NOW() - INTERVAL '7 days'))
    OR (p_target_type = 'platform_ios' AND EXISTS (
      SELECT 1 FROM app_user_devices d WHERE d.user_id = p.id AND d.platform = 'ios'
    ))
    OR (p_target_type = 'platform_android' AND EXISTS (
      SELECT 1 FROM app_user_devices d WHERE d.user_id = p.id AND d.platform = 'android'
    ))
    OR (p_target_type = 'outdated_version' AND EXISTS (
      SELECT 1
      FROM app_user_devices d
      JOIN latest l ON l.platform = d.platform
      WHERE d.user_id = p.id
        AND (p_platform IS NULL OR d.platform = p_platform)
        AND d.app_version IS NOT NULL
        AND l.latest_version IS NOT NULL
        AND public.semver_compare(d.app_version, l.latest_version) < 0
    ))
    OR (p_target_type = 'updated_version' AND EXISTS (
      SELECT 1
      FROM app_user_devices d
      JOIN latest l ON l.platform = d.platform
      WHERE d.user_id = p.id
        AND (p_platform IS NULL OR d.platform = p_platform)
        AND d.app_version IS NOT NULL
        AND l.latest_version IS NOT NULL
        AND public.semver_compare(d.app_version, l.latest_version) >= 0
    ));
$$;

CREATE OR REPLACE FUNCTION public.admin_target_push_tokens_v1(
  p_target_type TEXT,
  p_platform TEXT DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  expo_push_token TEXT,
  platform TEXT,
  device_id TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH latest AS (
    SELECT platform, latest_version
    FROM app_update_config
    WHERE channel IS NULL
  ),
  base AS (
    SELECT
      pt.user_id,
      pt.expo_push_token,
      pt.platform,
      pt.device_id,
      d.app_version
    FROM push_tokens pt
    LEFT JOIN app_user_devices d
      ON d.user_id = pt.user_id AND d.device_id = pt.device_id
    WHERE pt.notifications_enabled = TRUE
      AND (p_platform IS NULL OR pt.platform = p_platform)
  )
  SELECT b.user_id, b.expo_push_token, b.platform, b.device_id
  FROM base b
  WHERE
    (p_target_type = 'all')
    OR (p_target_type = 'notifications_enabled')
    OR (p_target_type = 'platform_ios' AND b.platform = 'ios')
    OR (p_target_type = 'platform_android' AND b.platform = 'android')
    OR (p_target_type = 'no_jornada_2_days' AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = b.user_id AND (p.last_jornada_at IS NULL OR p.last_jornada_at <= NOW() - INTERVAL '2 days')
    ))
    OR (p_target_type = 'no_jornada_7_days' AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = b.user_id AND (p.last_jornada_at IS NULL OR p.last_jornada_at <= NOW() - INTERVAL '7 days')
    ))
    OR (p_target_type = 'outdated_version' AND EXISTS (
      SELECT 1 FROM latest l
      WHERE l.platform = b.platform
        AND b.app_version IS NOT NULL
        AND l.latest_version IS NOT NULL
        AND public.semver_compare(b.app_version, l.latest_version) < 0
    ))
    OR (p_target_type = 'updated_version' AND EXISTS (
      SELECT 1 FROM latest l
      WHERE l.platform = b.platform
        AND b.app_version IS NOT NULL
        AND l.latest_version IS NOT NULL
        AND public.semver_compare(b.app_version, l.latest_version) >= 0
    ));
$$;
