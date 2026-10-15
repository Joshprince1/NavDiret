const { withGradleProperties } = require('@expo/config-plugins');

const KOTLIN_GRADLE_PLUGIN_VERSION = '2.2.10';

module.exports = function withAndroidKotlinVersion(config) {
  return withGradleProperties(config, (mod) => {
    const properties = mod.modResults;
    const existing = properties.find(
      (property) => property.type === 'property' && property.key === 'android.kotlinVersion',
    );

    if (existing) {
      existing.value = KOTLIN_GRADLE_PLUGIN_VERSION;
    } else {
      properties.push({
        type: 'property',
        key: 'android.kotlinVersion',
        value: KOTLIN_GRADLE_PLUGIN_VERSION,
      });
    }

    return mod;
  });
};
