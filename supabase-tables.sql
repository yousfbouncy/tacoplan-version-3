-- ============================================================
-- TACOPLAN – Supabase Complete Schema
-- Run this in Supabase SQL Editor to replace/recreate all tables.
-- WARNING: DROP TABLE statements will delete existing data.
-- If you want to preserve data, use ALTER TABLE instead.
-- ============================================================

-- 0. Extension required for UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. PROFILES
-- ============================================================
DROP TABLE IF EXISTS profiles CASCADE;
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TEXT
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. JORNADAS (main work shift records)
-- ============================================================
DROP TABLE IF EXISTS jornadas CASCADE;
CREATE TABLE jornadas (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Start/end basic info
  fecha_inicio TEXT NOT NULL,
  hora_inicio TEXT,
  lugar_inicio TEXT,
  fecha_fin TEXT,
  hora_fin TEXT,
  lugar_fin TEXT,
  start_at TEXT,
  end_at TEXT,

  -- Driving minutes
  conduccion_min INTEGER,
  conduccion_domingo_min INTEGER,
  conduccion_lunes_min INTEGER,

  -- Route and diet
  tipo_ruta TEXT,
  pernocta BOOLEAN DEFAULT false,
  dieta_modo TEXT,
  dieta_manual_tipo TEXT,
  dieta_manual_pct TEXT,
  dieta_importe_eur TEXT,
  dietas_items JSONB,
  dieta_percent NUMERIC,
  day_flag TEXT,
  day_extra_eur TEXT,
  diet_base_eur TEXT,
  diet_rule TEXT,
  diet_calculated_at TEXT,

  -- Rest info
  descanso_anterior_min INTEGER,
  tipo_descanso_anterior TEXT,
  previous_rest_source TEXT,
  previous_rest_id TEXT,
  previous_rest_valid BOOLEAN,

  -- Duration and legal
  duracion_jornada_min INTEGER,
  counts_as_daily_reduced BOOLEAN DEFAULT false,
  planned_rest_min INTEGER,
  planned_rest_type TEXT,
  plus_items JSONB,
  legal_summary JSONB,
  observaciones TEXT,

  -- Morocco-specific fields
  morocco_payment_mode TEXT,
  morocco_trip_rate NUMERIC,
  morocco_pernight_rate NUMERIC,

  -- Ferry fields
  ferry_pending BOOLEAN DEFAULT false,
  ferry_rest_type TEXT,
  ferry_destination TEXT,
  ferry_extras JSONB,
  ferry_interruptions JSONB,
  ferry_rest_completed BOOLEAN DEFAULT false,

  -- Timestamps
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_jornadas_user_id ON jornadas(user_id);
CREATE INDEX idx_jornadas_fecha_inicio ON jornadas(fecha_inicio);
CREATE INDEX idx_jornadas_start_at ON jornadas(start_at);

ALTER TABLE jornadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jornadas_select" ON jornadas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "jornadas_insert" ON jornadas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jornadas_update" ON jornadas FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "jornadas_delete" ON jornadas FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 3. COMPENSACIONES (rest debt tracking)
-- ============================================================
DROP TABLE IF EXISTS compensaciones CASCADE;
CREATE TABLE compensaciones (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jornada_id TEXT,
  horas_deuda INTEGER NOT NULL DEFAULT 0,
  minutos_deuda INTEGER NOT NULL DEFAULT 0,
  fecha_limite TEXT,
  compensada BOOLEAN DEFAULT false,
  fecha_compensacion TEXT,
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_compensaciones_user_id ON compensaciones(user_id);
CREATE INDEX idx_compensaciones_jornada_id ON compensaciones(jornada_id);

ALTER TABLE compensaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compensaciones_select" ON compensaciones FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "compensaciones_insert" ON compensaciones FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "compensaciones_update" ON compensaciones FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "compensaciones_delete" ON compensaciones FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 4. USER_DIET_RATES (custom diet amounts per route type)
-- ============================================================
DROP TABLE IF EXISTS user_diet_rates CASCADE;
CREATE TABLE user_diet_rates (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_type TEXT NOT NULL,
  percent INTEGER NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, trip_type, percent)
);

CREATE INDEX idx_diet_rates_user_id ON user_diet_rates(user_id);

ALTER TABLE user_diet_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "diet_rates_select" ON user_diet_rates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "diet_rates_insert" ON user_diet_rates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "diet_rates_update" ON user_diet_rates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "diet_rates_delete" ON user_diet_rates FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 5. USER_DAY_EXTRAS (surcharges for special days)
-- ============================================================
DROP TABLE IF EXISTS user_day_extras CASCADE;
CREATE TABLE user_day_extras (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  extra_saturday NUMERIC NOT NULL DEFAULT 10,
  extra_sunday NUMERIC NOT NULL DEFAULT 15,
  extra_holiday NUMERIC NOT NULL DEFAULT 20,
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_day_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "day_extras_select" ON user_day_extras FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "day_extras_insert" ON user_day_extras FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "day_extras_update" ON user_day_extras FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "day_extras_delete" ON user_day_extras FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 6. USER_HOLIDAYS (user-defined holiday dates)
-- ============================================================
DROP TABLE IF EXISTS user_holidays CASCADE;
CREATE TABLE user_holidays (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_holidays_user_id ON user_holidays(user_id);

ALTER TABLE user_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holidays_select" ON user_holidays FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "holidays_insert" ON user_holidays FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "holidays_update" ON user_holidays FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "holidays_delete" ON user_holidays FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 7. USER_FERRY_CONFIG (ferry/Morocco route settings)
-- ============================================================
DROP TABLE IF EXISTS user_ferry_config CASCADE;
CREATE TABLE user_ferry_config (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  crosses_ferry BOOLEAN DEFAULT false,
  route_mode TEXT DEFAULT 'spain',
  payment_mode TEXT DEFAULT 'spain_diet',
  trip_rate NUMERIC DEFAULT 0,
  pernight_rate NUMERIC DEFAULT 0,
  ferry_rest_enabled BOOLEAN DEFAULT false,
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_ferry_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ferry_config_select" ON user_ferry_config FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ferry_config_insert" ON user_ferry_config FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ferry_config_update" ON user_ferry_config FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ferry_config_delete" ON user_ferry_config FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 8. FERRY_RESTS (completed ferry rest records)
-- ============================================================
DROP TABLE IF EXISTS ferry_rests CASCADE;
CREATE TABLE ferry_rests (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  start_time TEXT NOT NULL,
  rest_type TEXT NOT NULL,
  interruptions JSONB DEFAULT '[]',
  computed_end TEXT,
  valid BOOLEAN DEFAULT true,
  reason TEXT,
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ferry_rests_user_id ON ferry_rests(user_id);

ALTER TABLE ferry_rests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ferry_rests_select" ON ferry_rests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ferry_rests_insert" ON ferry_rests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ferry_rests_update" ON ferry_rests FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ferry_rests_delete" ON ferry_rests FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 9. MOROCCO_TRIPS (Morocco-specific trip records)
-- ============================================================
DROP TABLE IF EXISTS morocco_trips CASCADE;
CREATE TABLE morocco_trips (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  origen TEXT NOT NULL,
  destino TEXT NOT NULL,
  estado TEXT DEFAULT 'completed',
  importe NUMERIC DEFAULT 0,
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_morocco_trips_user_id ON morocco_trips(user_id);

ALTER TABLE morocco_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "morocco_trips_select" ON morocco_trips FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "morocco_trips_insert" ON morocco_trips FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "morocco_trips_update" ON morocco_trips FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "morocco_trips_delete" ON morocco_trips FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 10. VIAJES (trip logistics - synced for multi-device)
-- ============================================================
DROP TABLE IF EXISTS viajes CASCADE;
CREATE TABLE viajes (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cliente TEXT,
  notas TEXT,
  modo_viaje TEXT DEFAULT 'COMPLETO',
  estado TEXT DEFAULT 'EN_CURSO',
  paradas JSONB DEFAULT '[]',
  fin_lugar TEXT,
  fin_hora TEXT,
  fin_viaje_nota TEXT,
  jornada_id TEXT,
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_viajes_user_id ON viajes(user_id);

ALTER TABLE viajes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "viajes_select" ON viajes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "viajes_insert" ON viajes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "viajes_update" ON viajes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "viajes_delete" ON viajes FOR DELETE USING (auth.uid() = user_id);
