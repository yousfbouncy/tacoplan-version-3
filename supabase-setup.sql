-- Tacoplan: Supabase Database Setup
-- Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- 1. Profiles table (auto-created on signup)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 2. Jornadas table
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
  tipo_ruta TEXT,
  pernocta BOOLEAN,
  dieta_modo TEXT DEFAULT 'AUTO',
  dieta_manual_tipo TEXT,
  dieta_manual_pct TEXT,
  dieta_importe_eur TEXT,
  dietas_items JSONB,
  descanso_anterior_min INTEGER,
  tipo_descanso_anterior TEXT,
  duracion_jornada_min INTEGER,
  counts_as_daily_reduced BOOLEAN DEFAULT FALSE,
  updated_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE jornadas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own jornadas" ON jornadas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own jornadas" ON jornadas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own jornadas" ON jornadas FOR UPDATE USING (auth.uid() = user_id);
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
CREATE POLICY "Users can read own compensaciones" ON compensaciones FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own compensaciones" ON compensaciones FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own compensaciones" ON compensaciones FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own compensaciones" ON compensaciones FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_compensaciones_user_id ON compensaciones(user_id);

-- 4. Trigger to auto-create profile on signup
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
