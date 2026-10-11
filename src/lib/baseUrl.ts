// Pure module: no React Native imports, so it can be unit-tested directly.
//
// The fixture server runs on the development machine. Which address reaches it depends on where the
// app runs: the iOS simulator shares the host's loopback, the Android emulator reaches the host
// through 10.0.2.2, and a physical device needs the host's address on the same Wi-Fi.

export const FIXTURE_PORT = 8787;

/** What the fixture server prints for the iOS simulator. */
export const IOS_HOST = 'localhost';

/** What the fixture server prints for the Android emulator: the host, seen from inside the emulator. */
export const ANDROID_HOST = '10.0.2.2';

export type HostPlatform = 'ios' | 'android' | string;

/**
 * Base address of the fixture server for the platform the app runs on.
 *
 * `override` wins when given, for a physical device on a LAN address. Pass a full origin
 * (`http://192.168.1.20:8787`); a trailing slash is removed so callers can append paths safely.
 */
export function resolveBaseUrl(os: HostPlatform, override?: string): string {
  if (override) return stripTrailingSlashes(override);

  const host = os === 'android' ? ANDROID_HOST : IOS_HOST;

  return `http://${host}:${FIXTURE_PORT}`;
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}
