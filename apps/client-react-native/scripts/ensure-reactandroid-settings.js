const fs = require("fs");
const path = require("path");

const projectRoot = path.dirname(__dirname);
const reactNativeDir = path.join(projectRoot, "node_modules", "react-native");
const reactAndroidDir = path.join(reactNativeDir, "ReactAndroid");
const settingsPath = path.join(reactAndroidDir, "settings.gradle.kts");

if (!fs.existsSync(reactNativeDir)) {
  return;
}

// Remove any custom settings.gradle.kts in ReactAndroid, as it's now a subproject
if (fs.existsSync(settingsPath)) {
  fs.unlinkSync(settingsPath);
}
