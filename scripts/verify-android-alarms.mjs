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

// Expo SDK 58 prints a Node inspect-style object, not strict JSON.
let output = "";
try {
  output = execFileSync(
    "npx",
    ["--no-install", "expo-modules-autolinking", "resolve", "--platform", "android"],
    { cwd: root, encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } },
  );
} catch (error) {
  console.error("[NATIVE ALARMS] Could not resolve Android Expo modules.", error.message);
  process.exit(1);
}
const plain = output.replace(/\\x1B\\[[0-9;]*m/g, "");
const linkedPackage = /packageName:\\s*['"]tacoplan-android-alarm['"]/.test(plain) ||
  /"packageName"\\s*:\\s*"tacoplan-android-alarm"/.test(plain);
const linkedClass = plain.includes(klass);
if (!linkedPackage || !linkedClass) {
  console.error("[NATIVE ALARMS] Expo did NOT autolink TacoplanAndroidAlarm.", {
    linkedPackage, linkedClass,
  });
  console.error("[NATIVE ALARMS] Output tail:", plain.slice(-4500));
  process.exit(1);
}
console.log("[NATIVE ALARMS] Verified native AlarmManager module autolinking:", klass);
