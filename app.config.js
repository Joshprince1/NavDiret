const staticConfig = require('./app.json');

module.exports = ({ config }) => {
  const routingBaseUrl = process.env.NAVDIRET_ROUTING_URL;
  const geocodingBaseUrl = process.env.NAVDIRET_GEOCODING_URL;
  const routingProfile = process.env.NAVDIRET_ROUTING_PROFILE || 'driving';
  const mapTilesUrl = process.env.NAVDIRET_MAP_TILES_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  return {
    ...staticConfig.expo,
    ...config,
    android: { ...staticConfig.expo.android, ...config.android },
    extra: {
      ...config.extra,
      mapTilesUrl,
      routingBaseUrl: routingBaseUrl || null,
      geocodingBaseUrl: geocodingBaseUrl || null,
      routingProfile,
    },
  };
};
