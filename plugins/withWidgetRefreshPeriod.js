const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

module.exports = function withWidgetRefreshPeriod(config) {
  return withDangerousMod(config, ["android", async (modConfig) => {
    const xmlDir = path.join(modConfig.modRequest.platformProjectRoot, "app/src/main/res/xml");
    if (!fs.existsSync(xmlDir)) return modConfig;
    for (const filename of fs.readdirSync(xmlDir)) {
      if (!filename.endsWith("_info.xml")) continue;
      const filePath = path.join(xmlDir, filename);
      const xml = fs.readFileSync(filePath, "utf8");
      fs.writeFileSync(filePath, xml.replace(/android:updatePeriodMillis="\d+"/, 'android:updatePeriodMillis="1800000"'));
    }
    return modConfig;
  }]);
};
