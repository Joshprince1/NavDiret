# Android development and background tracking test

## Build and install over USB

Install Android Studio with the Android SDK and Platform Tools, enable Developer options and USB debugging on the phone, connect it by USB, and accept the device's debugging authorization prompt. Confirm `adb devices` lists the phone with status `device`.

From the project folder, run either:

```powershell
npm run android:device
```

or:

```powershell
npx expo run:android --device
```

The command builds and installs the native debug app, then starts Metro. Keep that terminal open during JavaScript development. The PowerShell helper checks that an authorized device is connected before starting. For map tiles, set `GOOGLE_MAPS_API_KEY` in the current PowerShell session before building; never commit the key. Route and geocoding endpoints remain optional and private.

If native dependencies or app configuration change later, regenerate the native project with `npx expo prebuild --platform android --no-install`, then rebuild. Do not edit generated Android files by hand.

## Test foreground and screen-off tracking

1. Launch NavDiret while outdoors or near a window and allow location access while using the app.
2. Expand the place sheet and opt in to background trip tracking. Grant background / all-the-time location access when Android asks.
3. Confirm Android's foreground-service notification says NavDiret is tracking and that the app shows its background-tracking badge.
4. Lock the screen and travel for several minutes in an open area. Reopen NavDiret and confirm the trip's recent route and breadcrumbs are present locally.
5. Repeat with battery saver enabled or a low unplugged battery to observe the reduced sampling profile and the battery-aware status badge.

The operating system and device vendor can still throttle location delivery or stop the process. A stopped process cannot be recovered by a JavaScript error boundary. For repeatable motion testing, use a real moving device outdoors or an emulator's Extended Controls > Location route playback. Expo Go is not suitable for validating background location; use this native build.

React recovery boundaries cover rendering and lifecycle errors in the app, map, and guidance UI. They cannot catch a process-level native crash, an error from an event handler, or an unhandled asynchronous failure; location, network, and storage operations should continue to handle those failures at their source.

## Optional installable APK from EAS

The `device-apk` profile in `eas.json` creates an internally distributable APK. After linking the project to an Expo account once, run:

```powershell
npx eas-cli@latest build --platform android --profile device-apk
```

This is an EAS cloud build. EAS local builds (`--local`) are not officially supported on Windows; use `expo run:android` for a local USB build, or use Linux/macOS for EAS local builds. The APK is an installable app build, while `expo run:android` is the faster debug workflow that connects to Metro.
