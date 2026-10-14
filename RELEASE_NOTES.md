# NavDiret v1.0.0 — Initial Public Preview

NavDiret is a privacy-first navigation app focused on live location, useful place names, and clear travel guidance.

## Highlights

- Real-time location and directional guidance, with explicit GPS freshness and route status.
- Local-first SQLite storage for saved places, route history, and offline place/route data. Location history is not automatically uploaded to a NavDiret cloud service.
- Spoken turn-by-turn guidance with a persistent mute control.
- Saved destinations with Home, Work, Favorites, and customizable categories, icons, and colors.
- Live speed HUD with km/h or mph display and an adjustable personal speed reminder.
- Light, dark, and time-based automatic night appearance.
- Error recovery boundaries with a reload action for navigation and map failures.

## Install on Android

1. Download `NavDiret-v1.0.0.apk` from the Assets section of this GitHub Release to your Android device.
2. Open the downloaded APK from your browser's download notification or the Files app.
3. If Android asks, open Settings and allow **Install unknown apps** for the app you used to open the APK (for example, your browser or Files). Return to the installer and continue.
4. Review the requested permissions and tap **Install**. Launch NavDiret from your app list.

Only install APKs from a release source you trust. You can turn off **Allow from this source** after installation. Android labels and settings paths vary by device manufacturer.

## Preview limitations

- This is an initial public preview; verify routes and GPS behavior before relying on the app while traveling.
- Background trip tracking is opt-in and subject to Android permission, battery, and manufacturer behavior. Google Play distribution of background location requires a policy declaration and compliant prominent disclosure.
- Live road routing and place search require a privately configured service. Without one, local saved places and clearly labeled practice routes remain available; practice routes are not road navigation data.
- Map tile availability depends on the platform map provider and network access.
