const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLocationTelemetry, getBackgroundRecoveryStatus, getLocationFreshness, isAddressRelevantToCurrentPosition, isLocationFixNewer, isValidCoordinate, shouldAttemptAddressLookup } = require('../src/features/location/locationTelemetry.ts');
const { AsyncLookupCache } = require('../src/features/location/asyncLookupCache.ts');

function gpsFix({ latitude = 6.5244, longitude = 3.3792, accuracy = 12, timestamp = 1_800_000_000_000 } = {}) {
  return { coords: { latitude, longitude, accuracy }, timestamp };
}

test('accepts valid coordinates and rejects malformed or out-of-range fixes', () => {
  assert.equal(isValidCoordinate(0, 0), true);
  assert.equal(isValidCoordinate(90, 180), true);
  assert.equal(isValidCoordinate(Number.NaN, 0), false);
  assert.equal(isValidCoordinate(90.01, 0), false);
  assert.equal(isValidCoordinate(0, -180.01), false);
});

test('labels old or invalid GPS timestamps stale or unavailable and never lets an older fix replace a newer one', () => {
  const now = 1_800_000_000_000;
  assert.equal(getLocationFreshness(now - 10_000, now), 'fresh');
  assert.equal(getLocationFreshness(now - 31_000, now), 'stale');
  assert.equal(getLocationFreshness(Number.NaN, now), 'unavailable');
  assert.equal(getLocationFreshness(now + 10_000, now), 'unavailable');
  assert.equal(isLocationFixNewer(now, now - 1), false);
  assert.equal(isLocationFixNewer(now, now), true);
});

test('recovers tracking state when returning to foreground and stops if permission was revoked', () => {
  assert.equal(getBackgroundRecoveryStatus(false, true), 'stopped');
  assert.equal(getBackgroundRecoveryStatus(true, true), 'running');
  assert.equal(getBackgroundRecoveryStatus(true, false), 'permission-needed');
});

test('maps only returned geocoder fields into the telemetry model', () => {
  const telemetry = buildLocationTelemetry({
    position: gpsFix(),
    place: { source: 'online', address: { street: 'Marina Road', name: 'Marina Road', district: 'Lagos Island', city: 'Lagos', country: 'Nigeria' } },
    placeStatus: 'resolved',
    offline: false,
    freshness: 'fresh',
  });
  assert.equal(telemetry.street, 'Marina Road');
  assert.equal(telemetry.area, 'Lagos Island');
  assert.equal(telemetry.nearbyRoad, null);
  assert.equal(telemetry.city, 'Lagos');
  assert.equal(telemetry.country, 'Nigeria');
  assert.equal(telemetry.addressSource, 'online');
  assert.equal(telemetry.latitude, 6.5244);
});

test('reports offline and unresolved address sources without discarding a valid GPS fix', () => {
  const telemetry = buildLocationTelemetry({
    position: gpsFix(), place: null, placeStatus: 'unavailable', offline: true, freshness: 'stale',
  });
  assert.equal(telemetry.addressSource, 'offline');
  assert.equal(telemetry.street, null);
  assert.equal(telemetry.latitude, 6.5244);
  assert.equal(telemetry.freshness, 'stale');
});

test('reuses a cached address while offline', () => {
  const telemetry = buildLocationTelemetry({
    position: gpsFix(),
    place: { source: 'cached', address: { street: 'Broad Street', city: 'Lagos' } },
    placeStatus: 'resolved',
    offline: true,
    freshness: 'fresh',
  });
  assert.equal(telemetry.addressSource, 'cached');
  assert.equal(telemetry.street, 'Broad Street');
  assert.equal(telemetry.latitude, 6.5244);
});

test('never displays an address from a response far from the current GPS position', () => {
  assert.equal(isAddressRelevantToCurrentPosition({ latitude: 6.5244, longitude: 3.3792 }, { latitude: 6.5245, longitude: 3.3792 }), true);
  assert.equal(isAddressRelevantToCurrentPosition({ latitude: 6.5244, longitude: 3.3792 }, { latitude: 6.5244, longitude: 3.3822 }), false);
  assert.equal(isAddressRelevantToCurrentPosition({ latitude: 6.5244, longitude: 3.3792 }, null), false);
});

test('a geocode completing after movement cannot replace the current place with a stale result', async () => {
  let current = { latitude: 6.5244, longitude: 3.3792 };
  let finishLookup;
  const pending = new Promise((resolve) => { finishLookup = resolve; });
  const oldLookup = pending.then((address) => ({ address, shouldPublish: isAddressRelevantToCurrentPosition(
    { latitude: 6.5244, longitude: 3.3792 }, current,
  ) }));
  current = { latitude: 6.5244, longitude: 3.3822 };
  finishLookup({ street: 'Old Street' });
  const result = await oldLookup;
  assert.equal(result.shouldPublish, false);
});

test('throttles foreground lookups by both elapsed time and movement', () => {
  const previous = { latitude: 6.5244, longitude: 3.3792, at: 100_000 };
  assert.equal(shouldAttemptAddressLookup(previous, { latitude: 6.5252, longitude: 3.3792 }, 120_000), false);
  assert.equal(shouldAttemptAddressLookup(previous, { latitude: 6.5245, longitude: 3.3792 }, 140_000), false);
  assert.equal(shouldAttemptAddressLookup(previous, { latitude: 6.5252, longitude: 3.3792 }, 140_000), true);
  assert.equal(shouldAttemptAddressLookup(previous, { latitude: 6.5252, longitude: 3.3792 }, 120_000, true), true);
});

test('deduplicates concurrent lookups and serves a short-lived memory cache', async () => {
  let now = 10_000;
  let calls = 0;
  const cache = new AsyncLookupCache(5_000, () => now);
  const loader = async () => { calls += 1; await Promise.resolve(); return { title: 'Queens Road' }; };
  const [first, concurrent] = await Promise.all([cache.getOrLoad('6.5244:3.3792', loader), cache.getOrLoad('6.5244:3.3792', loader)]);
  assert.equal(calls, 1);
  assert.equal(first?.value.title, 'Queens Road');
  assert.equal(concurrent?.value.title, 'Queens Road');
  const cached = await cache.getOrLoad('6.5244:3.3792', loader);
  assert.equal(cached?.source, 'cached');
  assert.equal(calls, 1);
  now += 6_000;
  const expired = await cache.getOrLoad('6.5244:3.3792', loader);
  assert.equal(expired?.source, 'online');
  assert.equal(calls, 2);
});

test('bounds memory cache growth while retaining the newest entries', async () => {
  const cache = new AsyncLookupCache(60_000, () => 1_000, 2);
  const load = (title) => async () => ({ title });
  await cache.getOrLoad('a', load('A'));
  await cache.getOrLoad('b', load('B'));
  await cache.getOrLoad('c', load('C'));
  await assert.rejects(cache.getOrLoad('a', async () => { throw new Error('evicted'); }), /evicted/);
  assert.equal((await cache.getOrLoad('b', load('B')))?.source, 'cached');
  assert.equal((await cache.getOrLoad('c', load('C')))?.source, 'cached');
});

test('does not expose address details when GPS coordinates are invalid', () => {
  const telemetry = buildLocationTelemetry({
    position: gpsFix({ latitude: 91 }),
    place: { source: 'online', address: { street: 'Should not show' } },
    placeStatus: 'resolved',
    offline: false,
    freshness: 'fresh',
  });
  assert.equal(telemetry.latitude, null);
  assert.equal(telemetry.street, null);
  assert.equal(telemetry.freshness, 'unavailable');
  assert.equal(telemetry.addressSource, 'unresolved');
});
