// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";

// server/supabase.ts
import { createClient } from "@supabase/supabase-js";
var supabaseUrl = process.env.SUPABASE_URL;
var supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
var supabase = createClient(supabaseUrl, supabaseAnonKey);
function createUserClient(accessToken) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}
async function getUserFromToken(accessToken) {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email || "" };
}

// server/routes.ts
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
      if (!email || !password) {
        return res.status(400).json({ message: "Email y contrasena requeridos" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "La contrasena debe tener al menos 6 caracteres" });
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name || "" }
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
          user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name || name || "" },
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
      if (!email || !password) {
        return res.status(400).json({ message: "Email y contrasena requeridos" });
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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
      if (!email) {
        return res.status(400).json({ message: "Email requerido" });
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
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
      if (!access_token || !new_password) {
        return res.status(400).json({ message: "Token y nueva contrasena requeridos" });
      }
      if (new_password.length < 6) {
        return res.status(400).json({ message: "La contrasena debe tener al menos 6 caracteres" });
      }
      const { error } = await supabase.auth.admin.updateUserById(
        (await supabase.auth.getUser(access_token)).data.user?.id || "",
        { password: new_password }
      );
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
      if (!email || !token) {
        return res.status(400).json({ message: "Email y codigo requeridos" });
      }
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
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
      if (!email) return res.status(400).json({ message: "Email requerido" });
      const { error } = await supabase.auth.resend({ type: "signup", email });
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
    res.json({
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    });
  });
  app2.post("/api/auth/refresh", async (req, res) => {
    try {
      const { refresh_token } = req.body;
      if (!refresh_token) {
        return res.status(400).json({ message: "Refresh token requerido" });
      }
      const { data, error } = await supabase.auth.refreshSession({ refresh_token });
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
          { trip_type: "INTERNACIONAL", percent: 30, amount: 21.83 }
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
      const { data, error } = await client.from("user_day_extras").select("*").eq("user_id", userId).single();
      if (error && error.code === "PGRST116") {
        const { data: inserted, error: insertErr } = await client.from("user_day_extras").insert({ user_id: userId, extra_saturday: 10, extra_sunday: 15, extra_holiday: 20 }).select().single();
        if (insertErr) return res.status(500).json({ message: insertErr.message });
        return res.json({ extras: inserted });
      }
      if (error) return res.status(500).json({ message: error.message });
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
      const { data, error } = await supabase.auth.admin.updateUserById(req.user.id, {
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
            diet_base_eur: j.dietBaseEur || null,
            diet_rule: j.dietRule || null,
            diet_calculated_at: j.dietCalculatedAt || null,
            counts_as_daily_reduced: j.countsAsDailyReduced || false,
            plus_items: j.plusItems || null,
            planned_rest_min: j.plannedRestMin ?? null,
            planned_rest_type: j.plannedRestType || null,
            legal_summary: j.legalSummary || null
          };
          let row = { ...baseRow, ...optionalFields };
          let { error } = await client.from("jornadas").upsert(row, { onConflict: "id" });
          if (error && error.code === "PGRST204") {
            row = { ...baseRow };
            const retry = await client.from("jornadas").upsert(row, { onConflict: "id" });
            error = retry.error;
          }
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
          const row = {
            id: c.id,
            user_id: user.id,
            jornada_id: c.jornadaId,
            horas_deuda: c.horasDeuda,
            minutos_deuda: c.minutosDeuda,
            fecha_limite: c.fechaLimite,
            compensada: c.compensada,
            fecha_compensacion: c.fechaCompensacion,
            updated_at: c.updatedAt
          };
          const { error } = await client.from("compensaciones").upsert(row, { onConflict: "id" });
          if (error) {
            console.error("[Sync Push] compensacion upsert error:", error);
            cErrors++;
          } else {
            cPushed++;
          }
        }
      }
      console.log(`[Sync Push] Done: ${jPushed} jornadas ok, ${jErrors} errors; ${cPushed} compensaciones ok, ${cErrors} errors`);
      res.json({ ok: true });
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
      const { data: jornadas, error: jErr } = await client.from("jornadas").select("*").order("start_at", { ascending: false });
      if (jErr) {
        console.error("[Sync Pull] jornadas error:", jErr);
        return res.status(500).json({ message: jErr.message });
      }
      const { data: compensaciones, error: cErr } = await client.from("compensaciones").select("*").order("fecha_limite", { ascending: true });
      if (cErr) {
        console.error("[Sync Pull] compensaciones error:", cErr);
        return res.status(500).json({ message: cErr.message });
      }
      console.log(`[Sync Pull] user=${user.id}, found ${(jornadas || []).length} jornadas, ${(compensaciones || []).length} compensaciones`);
      const mappedJornadas = (jornadas || []).map((j) => ({
        id: j.id,
        fechaInicio: j.fecha_inicio,
        horaInicio: j.hora_inicio,
        lugarInicio: j.lugar_inicio,
        fechaFin: j.fecha_fin,
        horaFin: j.hora_fin,
        lugarFin: j.lugar_fin,
        startAt: j.start_at,
        endAt: j.end_at,
        conduccionMin: j.conduccion_min,
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
        descansoAnteriorMin: j.descanso_anterior_min,
        tipoDescansoAnterior: j.tipo_descanso_anterior,
        duracionJornadaMin: j.duracion_jornada_min,
        countsAsDailyReduced: j.counts_as_daily_reduced || false,
        plannedRestMin: j.planned_rest_min ?? null,
        plannedRestType: j.planned_rest_type ?? null,
        plusItems: j.plus_items ?? null,
        legalSummary: j.legal_summary ?? null,
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
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs from "fs";
import * as path from "path";
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
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
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
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path2 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path2.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
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
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
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
function configureExpoAndLanding(app2) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  const distPath = path.resolve(process.cwd(), "dist");
  const hasWebBuild = fs.existsSync(path.join(distPath, "index.html"));
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
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app2.use(express.static(path.resolve(process.cwd(), "static-build")));
  if (hasWebBuild) {
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
        return res.sendFile(path.join(distPath, "index.html"));
      }
      next();
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
    const message = error.message || "Internal Server Error";
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
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
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
