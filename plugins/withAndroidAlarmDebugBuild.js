const { withGradleProperties } = require("expo/config-plugins");

/**
 * Temporary diagnostic: Expo SDK 58 release APKs enable R8 by default.
 * Disable shrinking so no Expo module or alarm receiver can be stripped.
 * Once native AlarmManager is confirmed on real devices, prefer targeted
 * consumer ProGuard keep rules and restore minification.
 */
module.exports = function withAndroidAlarmDebugBuild(config) {
  return withGradleProperties(config, (modConfig) => {
    const properties = modConfig.modResults;
    const key = "android.enableMinifyInReleaseBuilds";
    const existing = properties.find((item) => item.type === "property" && item.key === key);
    if (existing) existing.value = "false";
    else properties.push({ type: "property", key, value: "false" });
    return modConfig;
  });
};
