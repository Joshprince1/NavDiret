# Android release builds

NavDiret defines two EAS Android builds:

- `preview` creates an internally distributed installable APK for testers.
- `production` creates a Play Store AAB. Its build number auto-increments from the local app config.

The current Android application ID is `com.navdiret.app`; the user-facing version is `1.0.0`, with `android.versionCode` set to `2`. Keep the package ID stable after publishing. EAS increments the production version code for each production build; update `version` when preparing a new user-facing release.

## First-time EAS setup

Run these commands in the project directory from PowerShell:

```powershell
npm install --global eas-cli
eas login
eas project:init
```

`eas project:init` creates or links the EAS project and records its project ID. This project uses dynamic `app.config.js`, so if the CLI cannot write the ID automatically, add the project ID that EAS displays under the returned `extra.eas.projectId`, and set `owner` to the Expo account that owns the project in the config returned by `app.config.js`.

On the first Android build, EAS will ask about Android signing credentials. Choose the option to let EAS generate and manage the Android keystore. Keep that keystore associated with this EAS project for future updates; a Play Store update must use the same signing identity. Manage or inspect it later with:

```powershell
eas credentials --platform android
```

## Build artifacts

```powershell
eas build --platform android --profile preview
eas build --platform android --profile production
```

The preview build page provides an APK download link for tester installation. The production build page provides an AAB download for Play Console upload. An APK is for direct installation and testing; Google Play submissions use the AAB.

Location permission configuration is in the `expo-location` plugin in `app.json`. Prebuild currently generates coarse/fine location, background location, foreground service, and foreground service location permissions in AndroidManifest; Expo modules also contribute permissions such as `VIBRATE`. Battery state uses no Android runtime permission. Background location is a sensitive Google Play permission: declare it in Play Console, provide the required prominent in-app disclosure, and submit it for review under Google's current policy before relying on background tracking in a public release.

The source config includes no routing or geocoding endpoint by default. Configure private endpoint environment values in the EAS `preview` and/or `production` environments only if those builds should use them; do not add private credentials or user route data to source control.
