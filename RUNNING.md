# Running the app

## Prerequisites

- **Node 18+** (built and tested on Node 22) and npm.
- **iOS:** macOS with **Xcode** and an iOS simulator installed, plus **CocoaPods**
  (`brew install cocoapods` if `pod --version` fails). Built and tested on Xcode 26.6, iPhone 17,
  iOS 26.5.
- **Android:** Android Studio with the SDK, platform-tools and an emulator image, plus **JDK 17 or
  21** — not 25 (see below). The emulator needs roughly **12 GB of free disk** to boot.
- **An internet connection**, even when testing offline behaviour: the article photos load from the
  NZZ image CDN, which the control panel's **Unreachable** switch does not affect.

This is an **Expo development build**, not Expo Go — the app uses `react-native-webview` and native
configuration (Android cleartext HTTP, iOS local networking), so the Expo Go client cannot run it.

## 1. Install

```bash
npm ci
```

`npm ci` installs exactly what the lockfile pins, which is what you want for a fresh clone. Use
`npm install` only if you are deliberately changing dependencies.

## 2. Start the fixture server (leave it running)

In its own terminal window:

```bash
npm run fixture
```

It prints the addresses it serves and logs every request, which is useful while testing. The control
panel is at **http://localhost:8787/control** in a desktop browser — use it to change the consent mode,
make the server unreachable and watch the Tracking and Reading tables.

The server keeps everything in memory, so restarting it resets versions, faults and the consent string.

## 3. Run the app

### iOS

**First time** (builds the native project — several minutes):

```bash
npm run ios
```

**After that**, in a second terminal:

```bash
npm start
```

then press **`i`** to open the simulator. Press **`r`** to reload after a JavaScript change. You only
need `npm run ios` again if native configuration or a native dependency changes.

If more than one simulator is booted, name the one you want — otherwise the target is ambiguous:

```bash
npm run ios -- --device "iPhone 17"     # or the device UDID
```

### Android

**JDK 17 or 21 is required.** JDK 25 — including the one bundled with Android Studio — fails during
the CMake configure steps with *"A restricted method in java.lang.System has been called"*. Install
JDK 21 and point Gradle at it, either way:

```bash
brew install openjdk@21

# Either: export it for the build
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
npm run android

# Or: after the first prebuild, pin it permanently in android/gradle.properties
# org.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
```

Start an emulator first, then build:

```bash
emulator -avd <your-avd-name>     # e.g. Medium_Phone_API_37.0
npm run android
```

After the first build, `npm start` then **`a`** is enough.

Android reaches the host machine on **10.0.2.2**, so the app talks to the fixture server at
`http://10.0.2.2:8787`. This is already configured in `src/config.ts` — no change needed. Cleartext
HTTP is enabled for Android in `app.json` via `expo-build-properties`.

If `emulator` or `adb` are not found, add the SDK to your shell:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
```

### On a physical device

Set `BASE_URL_OVERRIDE` in `src/config.ts` to your machine's Wi-Fi address — the fixture server prints
it on startup, for example `http://192.168.1.19:8787` — with the phone on the same network.

## 4. Tests and types

```bash
npm test              # 361 tests
npx tsc --noEmit      # type check
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE :::8787` | The server is already running, or `lsof -ti:8787 \| xargs kill` |
| Metro port 8081 taken | Accept the offered alternative port, or `lsof -ti:8081 \| xargs kill` |
| App stuck on a spinner | Check the fixture server is running and Network is **Normal** in the control panel |
| "Could not connect to development server" | `npm start` is not running |
| Page loads but the ad slot is empty | Expected without consent — set **Reader has chosen** and restart the app |
| Emulator will not boot | Free disk space; it needs about 12 GB |
| Android build fails: *"A restricted method in java.lang.System has been called"* | You are on JDK 25. Use JDK 17 or 21: `brew install openjdk@21`, then export `JAVA_HOME` to it or set `org.gradle.java.home` in `android/gradle.properties` |
