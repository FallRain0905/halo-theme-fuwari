# FallRain Music Mobile

Standalone Capacitor/Vite music app that reuses the existing Halo music library
backend.

## Data Source

The app reads:

```text
https://blog.fallrain0905.top/music-library/songs.json
```

Audio, covers, and lyrics use the same `/music-library/*` URLs as the web music
page.

## Development

```powershell
cd apps/music-mobile
pnpm install
pnpm dev
```

Open:

```text
http://127.0.0.1:5174
```

## Build

```powershell
pnpm build
```

## Android

Install Android Studio first, then:

```powershell
pnpm cap:add:android
pnpm cap:sync
pnpm cap:open:android
```

Build the APK from Android Studio.
