-- ============================================================
-- Tacoplan: Supabase Consolidated Database Setup
-- ============================================================
-- This SQL creates ALL tables needed for Tacoplan in a single script.
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Safe to run multiple times (drops policies before recreating)
-- ============================================================

-- ============================================================
-- SECTION 1: DROP EXISTING TABLES (if migrating from old setup)
-- ============================================================
-- Uncomment these lines to delete ALL existing tables and data:
--
-- DROP TABLE IF EXISTS user_holidays CASCADE;
-- DROP TABLE IF EXISTS user_day_extras CASCADE;
-- DROP TABLE IF EXISTS user_diet_rates CASCADE;
-- DROP TABLE IF EXISTS compensaciones CASCADE;
-- DROP TABLE IF EXISTS jornadas CASCADE;
-- DROP TABLE IF EXISTS profiles CASCADE;
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- DROP FUNCTION IF EXISTS public.handle_new_user();

-- ============================================================
-- SECTION 2: CREATE ALL TABLES
-- ============================================================

-- 1. Profiles table (auto-created on signup)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 2. Jornadas table (all columns including recent additions)
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
  updated_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE jornadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own jornadas" ON jornadas;
CREATE POLICY "Users can read own jornadas" ON jornadas FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own jornadas" ON jornadas;
CREATE POLICY "Users can insert own jornadas" ON jornadas FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own jornadas" ON jornadas;
CREATE POLICY "Users can update own jornadas" ON jornadas FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own jornadas" ON jornadas;
CREATE POLICY "Users can delete own jornadas" ON jornadas FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_jornadas_user_id ON jornadas(user_id);
CREATE INDEX IF NOT EXISTS idx_jornadas_start_at ON jornadas(start_at);

-- 3. Compensaciones table
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
DROP POLICY IF EXISTS "Users can read own compensaciones" ON compensaciones;
CREATE POLICY "Users can read own compensaciones" ON compensaciones FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own compensaciones" ON compensaciones;
CREATE POLICY "Users can insert own compensaciones" ON compensaciones FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own compensaciones" ON compensaciones;
CREATE POLICY "Users can update own compensaciones" ON compensaciones FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own compensaciones" ON compensaciones;
CREATE POLICY "Users can delete own compensaciones" ON compensaciones FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_compensaciones_user_id ON compensaciones(user_id);

-- 4. User diet rates (custom prices per trip type and percentage)
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

-- 5. User day extras (surcharges for Saturday/Sunday/Holiday)
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

-- 6. User holidays (custom holiday dates)
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

-- 7. Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- SECTION 3: ADD MISSING COLUMNS (for existing installations)
-- ============================================================
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

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;

-- ============================================================
-- SECTION 4: FERRY / MOROCCO TABLES
-- ============================================================

-- 8. User ferry config (per-user ferry/Morocco settings)
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

-- 9. Ferry rests (daily ferry rest records)
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
  updated_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ferry_rests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own ferry rests" ON ferry_rests;
CREATE POLICY "Users can read own ferry rests" ON ferry_rests FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own ferry rests" ON ferry_rests;
CREATE POLICY "Users can insert own ferry rests" ON ferry_rests FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own ferry rests" ON ferry_rests;
CREATE POLICY "Users can update own ferry rests" ON ferry_rests FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own ferry rests" ON ferry_rests;
CREATE POLICY "Users can delete own ferry rests" ON ferry_rests FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ferry_rests_user_id ON ferry_rests(user_id);
CREATE INDEX IF NOT EXISTS idx_ferry_rests_fecha ON ferry_rests(fecha);

-- 10. Morocco trips (trip/pernight records for Morocco routes)
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
DROP POLICY IF EXISTS "Users can read own morocco trips" ON morocco_trips;
CREATE POLICY "Users can read own morocco trips" ON morocco_trips FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own morocco trips" ON morocco_trips;
CREATE POLICY "Users can insert own morocco trips" ON morocco_trips FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own morocco trips" ON morocco_trips;
CREATE POLICY "Users can update own morocco trips" ON morocco_trips FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own morocco trips" ON morocco_trips;
CREATE POLICY "Users can delete own morocco trips" ON morocco_trips FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_morocco_trips_user_id ON morocco_trips(user_id);
CREATE INDEX IF NOT EXISTS idx_morocco_trips_fecha ON morocco_trips(fecha);
