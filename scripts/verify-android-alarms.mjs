#!/usr/bin/env node
/**
 * Fail Android builds if the Tacoplan native AlarmManager module isn't
 * discovered by Expo Autolinking. Without it, the app previously crashed
 * after the first login ("Cannot find native module TacoplanAndroidAlarm").
 *
 * --eas: run only for EAS Android builds, not iOS.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

if (process.argv.includes("--eas") && process.env.EAS_BUILD_PLATFORM !== "android") {
  console.log("[NATIVE ALARMS] Skipping Android-only check.");
  process.exit(0);
}

const root = process.cwd();
const moduleRoot = join(root, "modules/tacoplan-android-alarm");
const manifest = JSON.parse(readFileSync(join(moduleRoot, "expo-module.config.json"), "utf8"));
const klass = "expo.modules.tacoplanandroidalarm.TacoplanAndroidAlarmModule";
if (!manifest.platforms?.includes("android") || !manifest.android?.modules?.includes(klass)) {
  throw new Error("[NATIVE ALARMS] Missing Android module declaration.");
}
if (!readFileSync(join(moduleRoot, "android/build.gradle"), "utf8").includes("expo-module-gradle-plugin")) {
  throw new Error("[NATIVE ALARMS] Invalid native module Gradle setup.");
}

let resolved;
try {
  const output = execFileSync(
    "npx",
    ["--no-install", "expo-modules-autolinking", "resolve", "--platform", "android"],
    { cwd: root, encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
  );
  try {
    resolved = JSON.parse(output);
  } catch (parseError) {
    console.error("[NATIVE ALARMS] Autolinking raw output:", output.slice(0, 6000));
    throw parseError;
  }
} catch (error) {
  console.error("[NATIVE ALARMS] Could not resolve Android Expo modules.", error.message);
  process.exit(1);
}
const modules = Array.isArray(resolved?.modules) ? resolved.modules : [];
const match = modules.find(m =>
  m.packageName === "tacoplan-android-alarm" ||
  JSON.stringify(m).includes(klass),
);
if (!match) {
  console.error("[NATIVE ALARMS] Expo did NOT autolink TacoplanAndroidAlarm.");
  console.error("[NATIVE ALARMS] Found:", modules.map(m => m.packageName).join(", "));
  process.exit(1);
}
console.log("[NATIVE ALARMS] Module autolinked:", match.packageName, klass);
