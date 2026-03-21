-- User diet rates (custom prices per trip type and percentage)
CREATE TABLE IF NOT EXISTS user_diet_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_type text NOT NULL,
  percent int NOT NULL,
  amount numeric NOT NULL,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, trip_type, percent)
);

ALTER TABLE user_diet_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own diet rates" ON user_diet_rates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- User day extras (surcharges for Saturday/Sunday/Holiday)
CREATE TABLE IF NOT EXISTS user_day_extras (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  extra_saturday numeric NOT NULL DEFAULT 0,
  extra_sunday numeric NOT NULL DEFAULT 0,
  extra_holiday numeric NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_day_extras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own day extras" ON user_day_extras
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- User holidays (custom holiday dates)
CREATE TABLE IF NOT EXISTS user_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  name text NOT NULL DEFAULT '',
  UNIQUE(user_id, date)
);

ALTER TABLE user_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own holidays" ON user_holidays
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
