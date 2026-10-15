const { withProjectBuildGradle } = require('@expo/config-plugins');

const MAPLIBRE_BUILD_CONFIG = `
// MapLibre RN 10.x declares BuildConfig fields; AGP 9 disables generation by default.
subprojects { subproject ->
  if (subproject.name == "maplibre_maplibre-react-native") {
    subproject.plugins.withId("com.android.library") {
      subproject.android.buildFeatures.buildConfig = true
    }
  }
}
`;

module.exports = function withMapLibreBuildConfig(config) {
  return withProjectBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('subproject.name == "maplibre_maplibre-react-native"')) {
      mod.modResults.contents += MAPLIBRE_BUILD_CONFIG;
    }
    return mod;
  });
};
