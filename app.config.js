const staticConfig = require('./app.json');

module.exports = ({ config }) => {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const routingBaseUrl = process.env.NAVDIRET_ROUTING_URL;
  const geocodingBaseUrl = process.env.NAVDIRET_GEOCODING_URL;
  const routingProfile = process.env.NAVDIRET_ROUTING_PROFILE || 'driving';
  return {
    ...staticConfig.expo,
    ...config,
    android: {
      ...staticConfig.expo.android,
      ...config.android,
      ...(googleMapsApiKey ? { config: { ...config.android?.config, googleMaps: { apiKey: googleMapsApiKey } } } : {}),
    },
    extra: {
      ...config.extra,
      googleMapsConfigured: Boolean(googleMapsApiKey),
      routingBaseUrl: routingBaseUrl || null,
      geocodingBaseUrl: geocodingBaseUrl || null,
      routingProfile,
    },
  };
};
