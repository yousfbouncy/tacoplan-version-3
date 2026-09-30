// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";

// server/supabase.ts
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
function loadDotEnvIfPresent() {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, "utf-8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = value;
    }
  } catch {
  }
}
loadDotEnvIfPresent();
var supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
var supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
var supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!supabaseUrl) {
  throw new Error("supabaseUrl is required (set SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL)");
}
if (!supabaseAnonKey) {
  throw new Error("supabaseAnonKey is required (set SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY)");
}
var SUPABASE_URL = supabaseUrl;
var SUPABASE_ANON_KEY = supabaseAnonKey;
var supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
var supabaseAdmin = supabaseServiceRoleKey ? createClient(SUPABASE_URL, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
}) : null;
function requireSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (required for admin auth operations on the server).");
  }
  return supabaseAdmin;
}
function createUserClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}
async function getUserFromToken(accessToken) {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email || "" };
}

// lib/sync-pagination.ts
var CLOUD_PAGE_SIZE = 1e3;
async function collectCloudPages(fetchPage, pageSize = CLOUD_PAGE_SIZE) {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("pageSize debe ser un entero positivo");
  }
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// server/routes.ts
async function fetchAllServerRows(client, table, userId, orderBy) {
  return collectCloudPages((from, to) => {
    let query = client.from(table).select("*").eq("user_id", userId);
    for (const order of orderBy) {
      query = query.order(order.column, { ascending: order.ascending });
    }
    return query.range(from, to);
  });
}
function validTimestampOrNull(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}
function nonnegativeIntOrNull(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}
function cloudIsNewer(cloudUpdatedAt, localUpdatedAt) {
  const cloud = typeof cloudUpdatedAt === "string" ? cloudUpdatedAt : "";
  const local = typeof localUpdatedAt === "string" ? localUpdatedAt : "";
  return !!cloud && (!local || cloud > local);
}
function decodeJwtRole(jwt) {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const payloadB64Url = parts[1];
    const pad = "=".repeat((4 - payloadB64Url.length % 4) % 4);
    const payloadB64 = (payloadB64Url + pad).replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payloadB64, "base64").toString("utf-8");
    const payload = JSON.parse(json);
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No autorizado" });
  }
  const token = header.replace("Bearer ", "");
  const user = await getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ message: "Token invalido o expirado" });
  }
  req.user = user;
  req.accessToken = token;
  next();
}
async function registerRoutes(app2) {
  app2.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });
  app2.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name } = req.body;
      const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
      const passwordStr = typeof password === "string" ? password : "";
      const nameStr = typeof name === "string" ? name : "";
      if (!emailStr || !passwordStr) {
        return res.status(400).json({ message: "Email y contrasena requeridos" });
      }
      if (!emailStr.includes("@")) {
        return res.status(400).json({ message: "Email invalido" });
      }
      if (passwordStr.length < 6) {
        return res.status(400).json({ message: "La contrasena debe tener al menos 6 caracteres" });
      }
      const { data, error } = await supabase.auth.signUp({
        email: emailStr,
        password: passwordStr,
        options: {
          data: { full_name: nameStr || "" }
        }
      });
      if (error) {
        console.error("Supabase register error:", error);
        const msg = error.message || "";
        if (msg.toLowerCase().includes("already registered") || msg.toLowerCase().includes("already been registered") || msg.toLowerCase().includes("user already registered")) {
          return res.status(409).json({ code: "EMAIL_EXISTS", message: "Este email ya esta registrado. Puedes iniciar sesion o recuperar tu contrasena." });
        }
        return res.status(400).json({ message: error.message });
      }
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        return res.status(409).json({ code: "EMAIL_EXISTS", message: "Este email ya esta registrado. Puedes iniciar sesion o recuperar tu contrasena." });
      }
      if (data.user && !data.session) {
        return res.json({
          ok: true,
          needsVerification: true,
          message: "Cuenta creada. Revisa tu email para el codigo de verificacion."
        });
      }
      if (data.user && data.session) {
        return res.json({
          ok: true,
          needsVerification: false,
          user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name || nameStr || "" },
          session: {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at
          }
        });
      }
      res.json({ ok: true, needsVerification: true, message: "Revisa tu email para verificar tu cuenta." });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
      const passwordStr = typeof password === "string" ? password : "";
      if (!emailStr || !passwordStr) {
        return res.status(400).json({ message: "Email y contrasena requeridos" });
      }
      if (!emailStr.includes("@")) {
        return res.status(400).json({ message: "Email invalido" });
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email: emailStr, password: passwordStr });
      if (error) {
        console.error("Supabase login error:", error);
        if (error.message.includes("Invalid login credentials")) {
          return res.status(401).json({ message: "Email o contrasena incorrectos" });
        }
        if (error.message.includes("Email not confirmed")) {
          return res.status(403).json({ message: "Debes verificar tu email antes de iniciar sesion" });
        }
        return res.status(400).json({ message: error.message });
      }
      if (!data.session || !data.user) {
        return res.status(400).json({ message: "No se pudo iniciar sesion" });
      }
      res.json({
        user: {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.full_name || ""
        },
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at
        }
      });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { email } = req.body;
      const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
      if (!emailStr) {
        return res.status(400).json({ message: "Email requerido" });
      }
      if (!emailStr.includes("@")) {
        return res.status(400).json({ message: "Email invalido" });
      }
      const { error } = await supabase.auth.resetPasswordForEmail(emailStr, {
        redirectTo: void 0
      });
      if (error) {
        console.error("Supabase reset password error:", error);
        return res.status(400).json({ message: error.message });
      }
      res.json({ ok: true, message: "Si el email existe, recibiras un enlace para restablecer tu contrasena." });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/auth/update-password", async (req, res) => {
    try {
      const { access_token, new_password } = req.body;
      const accessTokenStr = typeof access_token === "string" ? access_token : "";
      const newPasswordStr = typeof new_password === "string" ? new_password : "";
      if (!accessTokenStr || !newPasswordStr) {
        return res.status(400).json({ message: "Token y nueva contrasena requeridos" });
      }
      if (newPasswordStr.length < 6) {
        return res.status(400).json({ message: "La contrasena debe tener al menos 6 caracteres" });
      }
      const { data: userData, error: userError } = await supabase.auth.getUser(accessTokenStr);
      if (userError || !userData?.user?.id) {
        return res.status(401).json({ message: "Token invalido o expirado" });
      }
      const { error } = await requireSupabaseAdmin().auth.admin.updateUserById(userData.user.id, { password: newPasswordStr });
      if (error) {
        console.error("Supabase update password error:", error);
        return res.status(400).json({ message: error.message });
      }
      res.json({ ok: true, message: "Contrasena actualizada correctamente. Ya puedes iniciar sesion." });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/auth/verify-email", async (req, res) => {
    try {
      const { email, token } = req.body;
      const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
      const tokenStr = typeof token === "string" ? token.trim() : "";
      if (!emailStr || !tokenStr) {
        return res.status(400).json({ message: "Email y codigo requeridos" });
      }
      if (!emailStr.includes("@")) {
        return res.status(400).json({ message: "Email invalido" });
      }
      const { data, error } = await supabase.auth.verifyOtp({
        email: emailStr,
        token: tokenStr,
        type: "signup"
      });
      if (error) {
        console.error("Supabase verify error:", error);
        return res.status(400).json({ message: "Codigo incorrecto o expirado" });
      }
      if (!data.user) {
        return res.status(400).json({ message: "No se pudo verificar el codigo" });
      }
      res.json({
        ok: true,
        verified: true,
        message: "Cuenta confirmada. Por favor inicie sesion."
      });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/auth/resend-verification", async (req, res) => {
    try {
      const { email } = req.body;
      const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
      if (!emailStr) return res.status(400).json({ message: "Email requerido" });
      if (!emailStr.includes("@")) return res.status(400).json({ message: "Email invalido" });
      const { error } = await supabase.auth.resend({ type: "signup", email: emailStr });
      if (error) {
        console.error("Resend error:", error);
        return res.status(400).json({ message: error.message });
      }
      res.json({ ok: true, message: "Codigo reenviado a tu email" });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/auth/config", async (_req, res) => {
    const supabaseUrl2 = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey2 = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl2 || !supabaseAnonKey2) {
      return res.status(500).json({ message: "Missing Supabase public config on server" });
    }
    const role = decodeJwtRole(supabaseAnonKey2);
    if (role && role !== "anon") {
      return res.status(500).json({ message: "Invalid SUPABASE_ANON_KEY (must be anon key)" });
    }
    res.json({ supabaseUrl: supabaseUrl2, supabaseAnonKey: supabaseAnonKey2 });
  });
  app2.post("/api/auth/refresh", async (req, res) => {
    try {
      const { refresh_token } = req.body;
      const refreshTokenStr = typeof refresh_token === "string" ? refresh_token : "";
      if (!refreshTokenStr) {
        return res.status(400).json({ message: "Refresh token requerido" });
      }
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshTokenStr });
      if (error || !data.session) {
        return res.status(401).json({ message: "No se pudo renovar la sesion" });
      }
      res.json({
        user: {
          id: data.user?.id,
          email: data.user?.email,
          name: data.user?.user_metadata?.full_name || ""
        },
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at
        }
      });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/auth/me", authMiddleware, async (req, res) => {
    res.json({ user: req.user });
  });
  app2.get("/api/user/diet-rates", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { data, error } = await client.from("user_diet_rates").select("*").eq("user_id", userId).order("trip_type");
      if (error) return res.status(500).json({ message: error.message });
      if (!data || data.length === 0) {
        const defaults = [
          { trip_type: "NACIONAL", percent: 100, amount: 54.3 },
          { trip_type: "NACIONAL", percent: 60, amount: 32.58 },
          { trip_type: "NACIONAL", percent: 30, amount: 16.29 },
          { trip_type: "INTERNACIONAL", percent: 100, amount: 72.77 },
          { trip_type: "INTERNACIONAL", percent: 60, amount: 43.66 },
          { trip_type: "INTERNACIONAL", percent: 30, amount: 21.83 },
          { trip_type: "REGIONAL", percent: 100, amount: 0 },
          { trip_type: "REGIONAL", percent: 60, amount: 0 },
          { trip_type: "REGIONAL", percent: 30, amount: 0 }
        ];
        const rows = defaults.map((d) => ({ ...d, user_id: userId }));
        const { data: inserted, error: insertErr } = await client.from("user_diet_rates").insert(rows).select();
        if (insertErr) return res.status(500).json({ message: insertErr.message });
        return res.json({ rates: inserted });
      }
      res.json({ rates: data });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/user/diet-rates", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { rates } = req.body;
      if (!rates || !Array.isArray(rates)) {
        return res.status(400).json({ message: "Rates requeridos" });
      }
      for (const r of rates) {
        const { error } = await client.from("user_diet_rates").upsert(
          { user_id: userId, trip_type: r.trip_type, percent: r.percent, amount: r.amount, updated_at: (/* @__PURE__ */ new Date()).toISOString() },
          { onConflict: "user_id,trip_type,percent" }
        );
        if (error) console.error("Upsert diet rate error:", error);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/user/day-extras", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { data, error } = await client.from("user_day_extras").select("*").eq("user_id", userId).maybeSingle();
      if (error) return res.status(500).json({ message: error.message });
      if (!data) {
        const { data: inserted, error: insertErr } = await client.from("user_day_extras").insert({ user_id: userId, extra_saturday: 0, extra_sunday: 0, extra_holiday: 0, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).select().single();
        if (insertErr) return res.status(500).json({ message: insertErr.message });
        return res.json({ extras: inserted });
      }
      res.json({ extras: data });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/user/day-extras", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { extra_saturday, extra_sunday, extra_holiday } = req.body;
      const { error } = await client.from("user_day_extras").upsert(
        { user_id: userId, extra_saturday, extra_sunday, extra_holiday, updated_at: (/* @__PURE__ */ new Date()).toISOString() },
        { onConflict: "user_id" }
      );
      if (error) return res.status(500).json({ message: error.message });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/user/holidays", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { data, error } = await client.from("user_holidays").select("*").eq("user_id", userId).order("date");
      if (error) return res.status(500).json({ message: error.message });
      res.json({ holidays: data || [] });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/user/holidays", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { date, name } = req.body;
      if (!date) return res.status(400).json({ message: "Fecha requerida" });
      const { data, error } = await client.from("user_holidays").insert({ user_id: userId, date, name: name || "" }).select().single();
      if (error) return res.status(500).json({ message: error.message });
      res.json({ holiday: data });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/user/holidays/:id", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const client = createUserClient(token);
      const { error } = await client.from("user_holidays").delete().eq("id", req.params.id);
      if (error) return res.status(500).json({ message: error.message });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/user/profile", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const { name } = req.body;
      const { data, error } = await requireSupabaseAdmin().auth.admin.updateUserById(req.user.id, {
        user_metadata: { full_name: name }
      });
      if (error) return res.status(500).json({ message: error.message });
      res.json({ ok: true, user: { id: data.user.id, email: data.user.email, name } });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/sync/push", authMiddleware, async (req, res) => {
    try {
      const user = req.user;
      const token = req.accessToken;
      const { jornadas, compensaciones } = req.body;
      console.log(`[Sync Push] user=${user.id}, jornadas=${(jornadas || []).length}, compensaciones=${(compensaciones || []).length}`);
      const client = createUserClient(token);
      let jPushed = 0, jErrors = 0;
      if (jornadas && jornadas.length > 0) {
        for (const j of jornadas) {
          const existing = await client.from("jornadas").select("updated_at").eq("user_id", user.id).eq("id", j.id).maybeSingle();
          if (existing.error) throw existing.error;
          if (cloudIsNewer(existing.data?.updated_at, j.updatedAt)) {
            jPushed++;
            continue;
          }
          const baseRow = {
            id: j.id,
            user_id: user.id,
            fecha_inicio: j.fechaInicio,
            hora_inicio: j.horaInicio,
            lugar_inicio: j.lugarInicio,
            fecha_fin: j.fechaFin,
            hora_fin: j.horaFin,
            lugar_fin: j.lugarFin,
            start_at: j.startAt,
            end_at: j.endAt,
            conduccion_min: j.conduccionMin,
            tipo_ruta: j.tipoRuta,
            pernocta: j.pernocta,
            dieta_modo: j.dietaModo,
            dieta_manual_tipo: j.dietaManualTipo,
            dieta_manual_pct: j.dietaManualPct,
            dieta_importe_eur: j.dietaImporteEur,
            dietas_items: j.dietasItems,
            dieta_percent: j.dietaPercent,
            day_flag: j.dayFlag,
            day_extra_eur: j.dayExtraEur,
            descanso_anterior_min: j.descansoAnteriorMin,
            tipo_descanso_anterior: j.tipoDescansoAnterior,
            duracion_jornada_min: j.duracionJornadaMin,
            updated_at: j.updatedAt
          };
          const optionalFields = {
            conduccion_domingo_min: j.conduccionDomingoMin ?? null,
            conduccion_lunes_min: j.conduccionLunesMin ?? null,
            diet_base_eur: j.dietBaseEur || null,
            diet_rule: j.dietRule || null,
            diet_calculated_at: j.dietCalculatedAt || null,
            counts_as_daily_reduced: j.countsAsDailyReduced || false,
            plus_items: j.plusItems || null,
            planned_rest_min: j.plannedRestMin ?? null,
            planned_rest_type: j.plannedRestType || null,
            legal_summary: j.legalSummary || null,
            observaciones: j.observaciones || null,
            previous_rest_source: j.previousRestSource || null,
            previous_rest_id: j.previousRestId || null,
            previous_rest_valid: j.previousRestValid ?? null,
            previous_rest_start_at: j.previousRestStartAt ?? null,
            previous_rest_end_at: j.previousRestEndAt ?? null,
            previous_rest_legal_type: j.previousRestLegalType ?? null,
            previous_rest_start_location: j.previousRestStartLocation ?? null,
            previous_rest_end_location: j.previousRestEndLocation ?? null,
            previous_rest_in_base: j.previousRestInBase ?? null,
            previous_rest_distance_km: j.previousRestDistanceKm ?? null,
            previous_rest_performed_in_vehicle: j.previousRestPerformedInVehicle ?? null,
            previous_rest_accommodation: j.previousRestAccommodation ?? null,
            previous_rest_comp_generated_min: j.previousRestCompGeneratedMin ?? null,
            previous_rest_comp_used_min: j.previousRestCompUsedMin ?? null,
            previous_rest_observations: j.previousRestObservations ?? null,
            split_rest_detected: j.splitRestDetected ?? false,
            split_rest_first_part_min: j.splitRestFirstPartMin ?? null,
            split_rest_second_part_min: j.splitRestSecondPartMin ?? null,
            counts_as_reduced_rest: j.countsAsReducedRest ?? true,
            payment_mode: j.paymentMode ?? null,
            km_inicio: j.kmInicio ?? null,
            km_fin: j.kmFin ?? null,
            km_total: j.kmTotal ?? null,
            price_per_km: j.pricePerKm ?? null,
            importe_km: j.importeKm ?? null,
            price_per_trip: j.pricePerTrip ?? null,
            importe_viaje: j.importeViaje ?? null,
            report_hide_amounts: j.reportHideAmounts ?? false,
            report_hide_pluses: j.reportHidePluses ?? false,
            tacho_daily_summary_id: j.tachoDailySummaryId ?? null,
            tacho_driving_min: j.tachoDrivingMin ?? null,
            tacho_work_min: j.tachoWorkMin ?? null,
            tacho_available_min: j.tachoAvailableMin ?? null,
            tacho_rest_min: j.tachoRestMin ?? null,
            tacho_countries: Array.isArray(j.tachoCountries) ? j.tachoCountries : [],
            tacho_country_entries: j.tachoCountryEntries ?? 0,
            tacho_km_total: j.tachoKmTotal ?? null,
            tacho_first_activity_at: j.tachoFirstActivityAt ?? null,
            tacho_last_activity_at: j.tachoLastActivityAt ?? null,
            tacho_disconnections: j.tachoDisconnections ?? 0,
            tacho_data_quality: j.tachoDataQuality ?? null,
            is_double_driving: j.isDoubleDriving === true,
            second_driver_name: j.secondDriverName ?? null,
            morocco_payment_mode: j.moroccoPaymentMode || null,
            morocco_trip_rate: j.moroccoTripRate ?? null,
            morocco_pernight_rate: j.moroccoPernightRate ?? null,
            ferry_pending: j.ferryPending ?? false,
            ferry_rest_type: j.ferryRestType || null,
            ferry_destination: j.ferryDestination || null,
            ferry_extras: j.ferryExtras || null,
            ferry_interruptions: j.ferryInterruptions || null,
            ferry_rest_completed: j.ferryRestCompleted ?? false
          };
          const row = { ...baseRow, ...optionalFields };
          const { error } = await client.from("jornadas").upsert(row, { onConflict: "id" });
          if (error) {
            console.error("[Sync Push] jornada upsert error:", error);
            jErrors++;
          } else {
            jPushed++;
          }
        }
      }
      let cPushed = 0, cErrors = 0;
      if (compensaciones && compensaciones.length > 0) {
        for (const c of compensaciones) {
          let existingQuery = client.from("compensaciones").select("id,updated_at").eq("user_id", user.id);
          existingQuery = c.jornadaId ? existingQuery.eq("jornada_id", c.jornadaId) : existingQuery.eq("id", c.id);
          const existing = await existingQuery.limit(1).maybeSingle();
          if (existing.error) throw existing.error;
          if (cloudIsNewer(existing.data?.updated_at, c.updatedAt)) {
            cPushed++;
            continue;
          }
          const row = {
            id: existing.data?.id || c.id,
            user_id: user.id,
            jornada_id: c.jornadaId,
            horas_deuda: c.horasDeuda,
            minutos_deuda: c.minutosDeuda,
            fecha_limite: c.fechaLimite,
            compensada: c.compensada,
            fecha_compensacion: c.fechaCompensacion,
            source_rest_start_at: c.sourceRestStartAt ?? null,
            source_rest_end_at: c.sourceRestEndAt ?? null,
            source_rest_duration_min: c.sourceRestDurationMin ?? null,
            source_rest_legal_type: c.sourceRestLegalType ?? null,
            source_rest_location_start: c.sourceRestLocationStart ?? null,
            source_rest_location_end: c.sourceRestLocationEnd ?? null,
            source_rest_in_base: c.sourceRestInBase ?? null,
            source_rest_distance_km: c.sourceRestDistanceKm ?? null,
            source_rest_observations: c.sourceRestObservations ?? null,
            recovered_in_jornada_id: c.recoveredInJornadaId ?? null,
            recovery_rest_start_at: c.recoveryRestStartAt ?? null,
            recovery_rest_end_at: c.recoveryRestEndAt ?? null,
            recovery_rest_duration_min: c.recoveryRestDurationMin ?? null,
            updated_at: c.updatedAt
          };
          const { error } = await client.from("compensaciones").upsert(row, { onConflict: c.jornadaId ? "user_id,jornada_id" : "id" });
          if (error) {
            console.error("[Sync Push] compensacion upsert error:", error);
            cErrors++;
          } else {
            cPushed++;
          }
        }
      }
      const hasErrors = jErrors > 0 || cErrors > 0;
      res.json({ ok: !hasErrors, pushed: { jornadas: jPushed, compensaciones: cPushed }, errors: { jornadas: jErrors, compensaciones: cErrors } });
    } catch (e) {
      console.error("Sync push error:", e);
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/sync/pull", authMiddleware, async (req, res) => {
    try {
      const user = req.user;
      const token = req.accessToken;
      const client = createUserClient(token);
      const [jornadas, compensaciones] = await Promise.all([
        fetchAllServerRows(client, "jornadas", user.id, [
          { column: "start_at", ascending: false },
          { column: "id", ascending: true }
        ]),
        fetchAllServerRows(client, "compensaciones", user.id, [
          { column: "fecha_limite", ascending: true },
          { column: "id", ascending: true }
        ])
      ]);
      console.log(`[Sync Pull] user=${user.id}, found ${(jornadas || []).length} jornadas, ${(compensaciones || []).length} compensaciones`);
      const mappedJornadas = (jornadas || []).map((j) => ({
        id: j.id,
        fechaInicio: j.fecha_inicio,
        horaInicio: j.hora_inicio,
        lugarInicio: j.lugar_inicio,
        fechaFin: j.fecha_fin,
        horaFin: j.hora_fin,
        lugarFin: j.lugar_fin,
        startAt: validTimestampOrNull(j.start_at),
        endAt: validTimestampOrNull(j.end_at),
        conduccionMin: nonnegativeIntOrNull(j.conduccion_min),
        conduccionDomingoMin: j.conduccion_domingo_min ?? null,
        conduccionLunesMin: j.conduccion_lunes_min ?? null,
        tipoRuta: j.tipo_ruta,
        pernocta: j.pernocta,
        dietaModo: j.dieta_modo,
        dietaManualTipo: j.dieta_manual_tipo,
        dietaManualPct: j.dieta_manual_pct,
        dietaImporteEur: j.dieta_importe_eur,
        dietasItems: j.dietas_items,
        dietaPercent: j.dieta_percent ?? null,
        dayFlag: j.day_flag ?? null,
        dayExtraEur: j.day_extra_eur ?? null,
        dietBaseEur: j.diet_base_eur ?? null,
        dietRule: j.diet_rule ?? null,
        dietCalculatedAt: j.diet_calculated_at ?? null,
        descansoAnteriorMin: nonnegativeIntOrNull(j.descanso_anterior_min),
        tipoDescansoAnterior: j.tipo_descanso_anterior,
        duracionJornadaMin: nonnegativeIntOrNull(j.duracion_jornada_min),
        countsAsDailyReduced: j.counts_as_daily_reduced || false,
        plannedRestMin: j.planned_rest_min ?? null,
        plannedRestType: j.planned_rest_type ?? null,
        plusItems: j.plus_items ?? null,
        observaciones: j.observaciones ?? null,
        legalSummary: j.legal_summary ?? null,
        previousRestSource: j.previous_rest_source ?? null,
        previousRestId: j.previous_rest_id ?? null,
        previousRestValid: j.previous_rest_valid ?? null,
        previousRestStartAt: j.previous_rest_start_at ?? null,
        previousRestEndAt: j.previous_rest_end_at ?? null,
        previousRestLegalType: j.previous_rest_legal_type ?? null,
        previousRestStartLocation: j.previous_rest_start_location ?? null,
        previousRestEndLocation: j.previous_rest_end_location ?? null,
        previousRestInBase: j.previous_rest_in_base ?? null,
        previousRestDistanceKm: j.previous_rest_distance_km == null ? null : Number(j.previous_rest_distance_km),
        previousRestPerformedInVehicle: j.previous_rest_performed_in_vehicle ?? null,
        previousRestAccommodation: j.previous_rest_accommodation ?? null,
        previousRestCompGeneratedMin: j.previous_rest_comp_generated_min ?? null,
        previousRestCompUsedMin: j.previous_rest_comp_used_min ?? null,
        previousRestObservations: j.previous_rest_observations ?? null,
        splitRestDetected: j.split_rest_detected ?? false,
        splitRestFirstPartMin: j.split_rest_first_part_min ?? null,
        splitRestSecondPartMin: j.split_rest_second_part_min ?? null,
        countsAsReducedRest: j.counts_as_reduced_rest ?? true,
        paymentMode: j.payment_mode ?? null,
        kmInicio: j.km_inicio ?? null,
        kmFin: j.km_fin ?? null,
        kmTotal: j.km_total ?? null,
        pricePerKm: j.price_per_km ?? null,
        importeKm: j.importe_km ?? null,
        pricePerTrip: j.price_per_trip ?? null,
        importeViaje: j.importe_viaje ?? null,
        reportHideAmounts: j.report_hide_amounts ?? false,
        reportHidePluses: j.report_hide_pluses ?? false,
        tachoDailySummaryId: j.tacho_daily_summary_id ?? null,
        tachoDrivingMin: j.tacho_driving_min ?? null,
        tachoWorkMin: j.tacho_work_min ?? null,
        tachoAvailableMin: j.tacho_available_min ?? null,
        tachoRestMin: j.tacho_rest_min ?? null,
        tachoCountries: j.tacho_countries ?? [],
        tachoCountryEntries: j.tacho_country_entries ?? 0,
        tachoKmTotal: j.tacho_km_total ?? null,
        tachoFirstActivityAt: j.tacho_first_activity_at ?? null,
        tachoLastActivityAt: j.tacho_last_activity_at ?? null,
        tachoDisconnections: j.tacho_disconnections ?? 0,
        tachoDataQuality: j.tacho_data_quality ?? null,
        isDoubleDriving: j.is_double_driving === true,
        secondDriverName: j.second_driver_name ?? null,
        moroccoPaymentMode: j.morocco_payment_mode ?? null,
        moroccoTripRate: j.morocco_trip_rate ?? null,
        moroccoPernightRate: j.morocco_pernight_rate ?? null,
        ferryPending: j.ferry_pending != null ? j.ferry_pending : null,
        ferryRestType: j.ferry_rest_type ?? null,
        ferryDestination: j.ferry_destination ?? null,
        ferryExtras: j.ferry_extras ?? null,
        ferryInterruptions: j.ferry_interruptions ?? null,
        ferryRestCompleted: j.ferry_rest_completed != null ? j.ferry_rest_completed : null,
        updatedAt: j.updated_at,
        syncStatus: "synced"
      }));
      const mappedCompensaciones = (compensaciones || []).map((c) => ({
        id: c.id,
        jornadaId: c.jornada_id,
        horasDeuda: c.horas_deuda,
        minutosDeuda: c.minutos_deuda,
        fechaLimite: c.fecha_limite,
        compensada: c.compensada,
        fechaCompensacion: c.fecha_compensacion,
        sourceRestStartAt: c.source_rest_start_at ?? null,
        sourceRestEndAt: c.source_rest_end_at ?? null,
        sourceRestDurationMin: c.source_rest_duration_min ?? null,
        sourceRestLegalType: c.source_rest_legal_type ?? null,
        sourceRestLocationStart: c.source_rest_location_start ?? null,
        sourceRestLocationEnd: c.source_rest_location_end ?? null,
        sourceRestInBase: c.source_rest_in_base ?? null,
        sourceRestDistanceKm: c.source_rest_distance_km == null ? null : Number(c.source_rest_distance_km),
        sourceRestObservations: c.source_rest_observations ?? null,
        recoveredInJornadaId: c.recovered_in_jornada_id ?? null,
        recoveryRestStartAt: c.recovery_rest_start_at ?? null,
        recoveryRestEndAt: c.recovery_rest_end_at ?? null,
        recoveryRestDurationMin: c.recovery_rest_duration_min ?? null,
        updatedAt: c.updated_at,
        syncStatus: "synced"
      }));
      res.json({ jornadas: mappedJornadas, compensaciones: mappedCompensaciones });
    } catch (e) {
      console.error("Sync pull error:", e);
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/sync/jornada/:id", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const client = createUserClient(token);
      await client.from("compensaciones").delete().eq("jornada_id", req.params.id);
      await client.from("jornadas").delete().eq("id", req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/user/ferry-config", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { data, error } = await client.from("user_ferry_config").select("*").eq("user_id", userId).maybeSingle();
      if (error) return res.status(500).json({ message: error.message });
      if (!data) {
        const defaults = {
          user_id: userId,
          crosses_ferry: false,
          route_mode: "spain",
          payment_mode: "spain_diet",
          trip_rate: 0,
          pernight_rate: 0,
          ferry_rest_enabled: false,
          ferry_transit_rate: 54.3,
          ferry_cabin_rate: 54.3,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        };
        const { data: inserted, error: insertErr } = await client.from("user_ferry_config").insert(defaults).select().single();
        if (insertErr) return res.status(500).json({ message: insertErr.message });
        return res.json({ config: inserted });
      }
      res.json({ config: data });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/user/ferry-config", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { crosses_ferry, route_mode, payment_mode, trip_rate, pernight_rate, ferry_rest_enabled, ferry_transit_rate, ferry_cabin_rate } = req.body;
      const { error } = await client.from("user_ferry_config").upsert(
        {
          user_id: userId,
          crosses_ferry: crosses_ferry ?? false,
          route_mode: route_mode ?? "spain",
          payment_mode: payment_mode ?? "spain_diet",
          trip_rate: trip_rate ?? 0,
          pernight_rate: pernight_rate ?? 0,
          ferry_rest_enabled: ferry_rest_enabled ?? false,
          ferry_transit_rate: ferry_transit_rate ?? 54.3,
          ferry_cabin_rate: ferry_cabin_rate ?? 54.3,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        },
        { onConflict: "user_id" }
      );
      if (error) return res.status(500).json({ message: error.message });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/user/ferry-rests", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { data, error } = await client.from("ferry_rests").select("*").eq("user_id", userId).order("fecha", { ascending: false });
      if (error) return res.status(500).json({ message: error.message });
      res.json({ ferryRests: data || [] });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/user/ferry-rests", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { id, fecha, start_time, rest_type, interruptions, computed_end, valid, reason } = req.body;
      if (!fecha || !start_time || !rest_type) {
        return res.status(400).json({ message: "fecha, start_time y rest_type requeridos" });
      }
      const row = {
        id: id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        fecha,
        start_time,
        rest_type,
        interruptions: interruptions || [],
        computed_end: computed_end || null,
        valid: valid ?? true,
        reason: reason || null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const { data, error } = await client.from("ferry_rests").upsert(row, { onConflict: "id" }).select().single();
      if (error) return res.status(500).json({ message: error.message });
      res.json({ ferryRest: data });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/user/ferry-rests/:id", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const client = createUserClient(token);
      const { error } = await client.from("ferry_rests").delete().eq("id", req.params.id);
      if (error) return res.status(500).json({ message: error.message });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/user/morocco-trips", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { data, error } = await client.from("morocco_trips").select("*").eq("user_id", userId).order("fecha", { ascending: false });
      if (error) return res.status(500).json({ message: error.message });
      res.json({ moroccoTrips: data || [] });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/user/morocco-trips", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { id, fecha, origen, destino, estado, importe } = req.body;
      if (!fecha || !origen || !destino) {
        return res.status(400).json({ message: "fecha, origen y destino requeridos" });
      }
      const row = {
        id: id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        fecha,
        origen,
        destino,
        estado: estado || "completed",
        importe: importe ?? 0,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const { data, error } = await client.from("morocco_trips").upsert(row, { onConflict: "id" }).select().single();
      if (error) return res.status(500).json({ message: error.message });
      res.json({ moroccoTrip: data });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/user/morocco-trips/:id", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const client = createUserClient(token);
      const { error } = await client.from("morocco_trips").delete().eq("id", req.params.id);
      if (error) return res.status(500).json({ message: error.message });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/sync/profile", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const userEmail = req.user.email;
      const client = createUserClient(token);
      const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (error) return res.status(500).json({ message: error.message });
      if (!data) {
        const { data: insertedProfile, error: insertProfileError } = await client.from("profiles").upsert({
          id: userId,
          email: userEmail || "",
          display_name: "",
          language: "es",
          period_type: "AUTO_01_30",
          period_start_day: 1,
          period_end_day: 30,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }, { onConflict: "id" }).select().single();
        if (insertProfileError) return res.status(500).json({ message: insertProfileError.message });
        return res.json({ profile: insertedProfile });
      }
      res.json({ profile: data });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/sync/profile", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { display_name, language, period_type, period_start_day, period_end_day } = req.body;
      const { error } = await client.from("profiles").upsert({
        id: userId,
        display_name: display_name ?? null,
        language: language ?? "es",
        period_type: period_type ?? "AUTO_01_30",
        period_start_day: period_start_day ?? 1,
        period_end_day: period_end_day ?? 30,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }, { onConflict: "id" });
      if (error) return res.status(500).json({ message: error.message });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/sync/dietas-config", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const [ratesRes, extrasRes, holidaysRes] = await Promise.all([
        client.from("user_diet_rates").select("*").eq("user_id", userId),
        client.from("user_day_extras").select("*").eq("user_id", userId).maybeSingle(),
        client.from("user_holidays").select("*").eq("user_id", userId).order("date")
      ]);
      const rates = ratesRes.data || [];
      const extras = extrasRes.error ? null : extrasRes.data;
      const holidays = holidaysRes.data || [];
      const { data: dietasConfigData, error: dietasConfigError } = await client.from("dietas_config").select("*").eq("user_id", userId).maybeSingle();
      if (dietasConfigError) return res.status(500).json({ message: dietasConfigError.message });
      let dietasConfig = dietasConfigData;
      if (!dietasConfig) {
        const { data: newConfig, error: insertError } = await client.from("dietas_config").insert({
          user_id: userId,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).select().single();
        if (insertError) return res.status(500).json({ message: insertError.message });
        dietasConfig = newConfig;
      }
      res.json({ rates, extras, holidays, dietasConfig });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/sync/dietas-config", authMiddleware, async (req, res) => {
    try {
      const token = req.accessToken;
      const userId = req.user.id;
      const client = createUserClient(token);
      const { rates, extras, dietasConfig } = req.body;
      if (rates && Array.isArray(rates)) {
        for (const r of rates) {
          await client.from("user_diet_rates").upsert(
            { user_id: userId, trip_type: r.trip_type, percent: r.percent, amount: r.amount, updated_at: (/* @__PURE__ */ new Date()).toISOString() },
            { onConflict: "user_id,trip_type,percent" }
          );
        }
      }
      if (extras) {
        await client.from("user_day_extras").upsert(
          { user_id: userId, extra_saturday: extras.extra_saturday, extra_sunday: extras.extra_sunday, extra_holiday: extras.extra_holiday, updated_at: (/* @__PURE__ */ new Date()).toISOString() },
          { onConflict: "user_id" }
        );
      }
      if (dietasConfig) {
        await client.from("dietas_config").upsert({
          user_id: userId,
          ...dietasConfig,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }, { onConflict: "user_id" });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/sync/all", authMiddleware, async (req, res) => {
    try {
      const user = req.user;
      const token = req.accessToken;
      const client = createUserClient(token);
      const userId = user.id;
      const [profileRes, jornadasRows, compensacionesRows, ratesRows, extrasRes, holidaysRows] = await Promise.all([
        client.from("profiles").select("*").eq("id", userId).maybeSingle(),
        fetchAllServerRows(client, "jornadas", userId, [
          { column: "start_at", ascending: false },
          { column: "id", ascending: true }
        ]),
        fetchAllServerRows(client, "compensaciones", userId, [
          { column: "fecha_limite", ascending: true },
          { column: "id", ascending: true }
        ]),
        fetchAllServerRows(client, "user_diet_rates", userId, [
          { column: "trip_type", ascending: true },
          { column: "percent", ascending: true },
          { column: "id", ascending: true }
        ]),
        client.from("user_day_extras").select("*").eq("user_id", userId).maybeSingle(),
        fetchAllServerRows(client, "user_holidays", userId, [
          { column: "date", ascending: true },
          { column: "id", ascending: true }
        ])
      ]);
      if (profileRes.error) throw profileRes.error;
      if (extrasRes.error) throw extrasRes.error;
      let profile = profileRes.error ? null : profileRes.data;
      if (!profile) {
        const { data: insertedProfile, error: insertProfileError } = await client.from("profiles").insert({
          id: userId,
          email: user.email || "",
          display_name: "",
          language: "es",
          period_type: "AUTO_01_30",
          period_start_day: 1,
          period_end_day: 30,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).select().single();
        if (!insertProfileError) profile = insertedProfile;
      }
      const mappedJornadas = jornadasRows.map((j) => ({
        id: j.id,
        fechaInicio: j.fecha_inicio,
        horaInicio: j.hora_inicio,
        lugarInicio: j.lugar_inicio,
        fechaFin: j.fecha_fin,
        horaFin: j.hora_fin,
        lugarFin: j.lugar_fin,
        startAt: validTimestampOrNull(j.start_at),
        endAt: validTimestampOrNull(j.end_at),
        conduccionMin: nonnegativeIntOrNull(j.conduccion_min),
        conduccionDomingoMin: j.conduccion_domingo_min ?? null,
        conduccionLunesMin: j.conduccion_lunes_min ?? null,
        tipoRuta: j.tipo_ruta,
        pernocta: j.pernocta,
        dietaModo: j.dieta_modo,
        dietaManualTipo: j.dieta_manual_tipo,
        dietaManualPct: j.dieta_manual_pct,
        dietaImporteEur: j.dieta_importe_eur,
        dietasItems: j.dietas_items,
        dietaPercent: j.dieta_percent ?? null,
        dayFlag: j.day_flag ?? null,
        dayExtraEur: j.day_extra_eur ?? null,
        dietBaseEur: j.diet_base_eur ?? null,
        dietRule: j.diet_rule ?? null,
        dietCalculatedAt: j.diet_calculated_at ?? null,
        descansoAnteriorMin: nonnegativeIntOrNull(j.descanso_anterior_min),
        tipoDescansoAnterior: j.tipo_descanso_anterior,
        duracionJornadaMin: nonnegativeIntOrNull(j.duracion_jornada_min),
        countsAsDailyReduced: j.counts_as_daily_reduced || false,
        plannedRestMin: j.planned_rest_min ?? null,
        plannedRestType: j.planned_rest_type ?? null,
        plusItems: j.plus_items ?? null,
        observaciones: j.observaciones ?? null,
        legalSummary: j.legal_summary ?? null,
        previousRestSource: j.previous_rest_source ?? null,
        previousRestId: j.previous_rest_id ?? null,
        previousRestValid: j.previous_rest_valid ?? null,
        previousRestStartAt: j.previous_rest_start_at ?? null,
        previousRestEndAt: j.previous_rest_end_at ?? null,
        previousRestLegalType: j.previous_rest_legal_type ?? null,
        previousRestStartLocation: j.previous_rest_start_location ?? null,
        previousRestEndLocation: j.previous_rest_end_location ?? null,
        previousRestInBase: j.previous_rest_in_base ?? null,
        previousRestDistanceKm: j.previous_rest_distance_km == null ? null : Number(j.previous_rest_distance_km),
        previousRestPerformedInVehicle: j.previous_rest_performed_in_vehicle ?? null,
        previousRestAccommodation: j.previous_rest_accommodation ?? null,
        previousRestCompGeneratedMin: j.previous_rest_comp_generated_min ?? null,
        previousRestCompUsedMin: j.previous_rest_comp_used_min ?? null,
        previousRestObservations: j.previous_rest_observations ?? null,
        splitRestDetected: j.split_rest_detected ?? false,
        splitRestFirstPartMin: j.split_rest_first_part_min ?? null,
        splitRestSecondPartMin: j.split_rest_second_part_min ?? null,
        countsAsReducedRest: j.counts_as_reduced_rest ?? true,
        paymentMode: j.payment_mode ?? null,
        kmInicio: j.km_inicio ?? null,
        kmFin: j.km_fin ?? null,
        kmTotal: j.km_total ?? null,
        pricePerKm: j.price_per_km ?? null,
        importeKm: j.importe_km ?? null,
        pricePerTrip: j.price_per_trip ?? null,
        importeViaje: j.importe_viaje ?? null,
        reportHideAmounts: j.report_hide_amounts ?? false,
        reportHidePluses: j.report_hide_pluses ?? false,
        tachoDailySummaryId: j.tacho_daily_summary_id ?? null,
        tachoDrivingMin: j.tacho_driving_min ?? null,
        tachoWorkMin: j.tacho_work_min ?? null,
        tachoAvailableMin: j.tacho_available_min ?? null,
        tachoRestMin: j.tacho_rest_min ?? null,
        tachoCountries: j.tacho_countries ?? [],
        tachoCountryEntries: j.tacho_country_entries ?? 0,
        tachoKmTotal: j.tacho_km_total ?? null,
        tachoFirstActivityAt: j.tacho_first_activity_at ?? null,
        tachoLastActivityAt: j.tacho_last_activity_at ?? null,
        tachoDisconnections: j.tacho_disconnections ?? 0,
        tachoDataQuality: j.tacho_data_quality ?? null,
        isDoubleDriving: j.is_double_driving === true,
        secondDriverName: j.second_driver_name ?? null,
        moroccoPaymentMode: j.morocco_payment_mode ?? null,
        moroccoTripRate: j.morocco_trip_rate ?? null,
        moroccoPernightRate: j.morocco_pernight_rate ?? null,
        ferryPending: j.ferry_pending != null ? j.ferry_pending : null,
        ferryRestType: j.ferry_rest_type ?? null,
        ferryDestination: j.ferry_destination ?? null,
        ferryExtras: j.ferry_extras ?? null,
        ferryInterruptions: j.ferry_interruptions ?? null,
        ferryRestCompleted: j.ferry_rest_completed != null ? j.ferry_rest_completed : null,
        updatedAt: j.updated_at,
        syncStatus: "synced"
      }));
      const mappedCompensaciones = compensacionesRows.map((c) => ({
        id: c.id,
        jornadaId: c.jornada_id,
        horasDeuda: c.horas_deuda,
        minutosDeuda: c.minutos_deuda,
        fechaLimite: c.fecha_limite,
        compensada: c.compensada,
        fechaCompensacion: c.fecha_compensacion,
        sourceRestStartAt: c.source_rest_start_at ?? null,
        sourceRestEndAt: c.source_rest_end_at ?? null,
        sourceRestDurationMin: c.source_rest_duration_min ?? null,
        sourceRestLegalType: c.source_rest_legal_type ?? null,
        sourceRestLocationStart: c.source_rest_location_start ?? null,
        sourceRestLocationEnd: c.source_rest_location_end ?? null,
        sourceRestInBase: c.source_rest_in_base ?? null,
        sourceRestDistanceKm: c.source_rest_distance_km == null ? null : Number(c.source_rest_distance_km),
        sourceRestObservations: c.source_rest_observations ?? null,
        recoveredInJornadaId: c.recovered_in_jornada_id ?? null,
        recoveryRestStartAt: c.recovery_rest_start_at ?? null,
        recoveryRestEndAt: c.recovery_rest_end_at ?? null,
        recoveryRestDurationMin: c.recovery_rest_duration_min ?? null,
        updatedAt: c.updated_at,
        syncStatus: "synced"
      }));
      const rates = ratesRows;
      let extras = extrasRes.data;
      if (!extras) {
        const { data: insertedExtras, error: insertExtrasError } = await client.from("user_day_extras").upsert({ user_id: userId, extra_saturday: 0, extra_sunday: 0, extra_holiday: 0, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "user_id" }).select().single();
        if (insertExtrasError) throw insertExtrasError;
        extras = insertedExtras;
      }
      const holidays = holidaysRows;
      res.json({
        profile,
        jornadas: mappedJornadas,
        compensaciones: mappedCompensaciones,
        dietasConfig: { rates, extras, holidays }
      });
    } catch (e) {
      console.error("[Sync All] error:", e);
      res.status(500).json({ message: e.message });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs2 from "fs";
import * as path2 from "path";
import * as http from "http";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  const sensitiveKeys = /* @__PURE__ */ new Set([
    "access_token",
    "refresh_token",
    "password",
    "new_password",
    "token",
    "authorization"
  ]);
  function redact(value, depth = 0) {
    if (depth > 8) return "[REDACTED]";
    if (value == null) return value;
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
    if (typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (sensitiveKeys.has(String(k).toLowerCase())) out[k] = "[REDACTED]";
        else out[k] = redact(v, depth + 1);
      }
      return out;
    }
    if (typeof value === "string" && value.length > 2e3) return value.slice(0, 2e3) + "\u2026";
    return value;
  }
  app2.use((req, res, next) => {
    const start = Date.now();
    const path3 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path3.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && !path3.startsWith("/api/auth")) {
        logLine += ` :: ${JSON.stringify(redact(capturedJsonResponse))}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path2.resolve(process.cwd(), "app.json");
    const appJsonContent = fs2.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path2.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs2.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs2.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function proxyToMetro(req, res, metroPort) {
  const proxyHeaders = { ...req.headers };
  proxyHeaders.host = `localhost:${metroPort}`;
  proxyHeaders.origin = `http://localhost:${metroPort}`;
  delete proxyHeaders.referer;
  const options = {
    hostname: "127.0.0.1",
    port: metroPort,
    path: req.originalUrl,
    method: req.method,
    headers: proxyHeaders
  };
  const proxyReq = http.request(options, (proxyRes) => {
    const responseHeaders = {};
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (value !== void 0) {
        responseHeaders[key] = value;
      }
    }
    delete responseHeaders["access-control-allow-origin"];
    res.writeHead(proxyRes.statusCode || 502, responseHeaders);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on("error", () => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Metro bundler not ready yet");
  });
  req.pipe(proxyReq, { end: true });
}
function configureExpoAndLanding(app2) {
  const templatePath = path2.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs2.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  const distPath = path2.resolve(process.cwd(), "dist");
  const hasWebBuild = fs2.existsSync(path2.join(distPath, "index.html"));
  const isDev = process.env.NODE_ENV !== "production";
  const metroPort = 8082;
  log("Serving static Expo files with dynamic manifest routing");
  if (hasWebBuild) {
    log("Web build found in dist/ - serving app at /");
  }
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      if (req.path === "/" || req.path === "/manifest") {
        return serveExpoManifest(platform, res);
      }
    }
    next();
  });
  app2.use("/assets", express.static(path2.resolve(process.cwd(), "assets")));
  app2.use(express.static(path2.resolve(process.cwd(), "static-build")));
  if (hasWebBuild) {
    log("Serving static web build from dist/");
    app2.use(express.static(distPath));
    app2.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return next();
      }
      if (req.method === "GET" && req.accepts("html")) {
        return res.sendFile(path2.join(distPath, "index.html"));
      }
      next();
    });
  } else if (isDev) {
    log(`Dev mode: proxying web requests to Metro on port ${metroPort}`);
    app2.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return next();
      }
      return proxyToMetro(req, res, metroPort);
    });
  } else {
    app2.use((req, res, next) => {
      if (req.path === "/" && !req.header("expo-platform")) {
        return serveLandingPage({
          req,
          res,
          landingPageTemplate,
          appName
        });
      }
      next();
    });
  }
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const isProd = process.env.NODE_ENV === "production";
    const message = isProd && status >= 500 ? "Internal Server Error" : error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  server.listen(
    {
      port,
      host
    },
    () => {
      log(`express server serving on http://${host}:${port}`);
    }
  );
  if (process.env.NODE_ENV === "production" && port !== 8081) {
    const { createServer: createHttpServer } = await import("node:http");
    const prodServer = createHttpServer(app);
    prodServer.listen({ port: 8081, host: "0.0.0.0" }, () => {
      log(`express server also serving on port 8081 (deployment)`);
    });
  }
})();
