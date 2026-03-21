-- ============================================================
-- Tacoplan: Supabase Schema V2 — Multi-device Sync Ready
-- ============================================================
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Safe to run multiple times (uses IF NOT EXISTS + DROP POLICY IF EXISTS)
-- ============================================================

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
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TEXT;

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

ALTER TABLE user_day_extras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own day extras" ON user_day_extras;
CREATE POLICY "Users manage own day extras" ON user_day_extras
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
