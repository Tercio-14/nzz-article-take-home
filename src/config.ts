// The one place the app's addresses and identity are configured.
//
// Thin on purpose: it reads the platform and hands the decision to the pure module in `lib/baseUrl`.

import { Platform } from 'react-native';

import { resolveBaseUrl } from './lib/baseUrl';

/**
 * Set this to the host's Wi-Fi address (`http://192.168.x.y:8787`) to run on a physical device.
 * Left empty, the app uses the right address for the simulator or emulator.
 */
const BASE_URL_OVERRIDE = '';

/** Base address of the fixture server: its pages, its consent service and the tracker's collector. */
export const BASE_URL = resolveBaseUrl(Platform.OS, BASE_URL_OVERRIDE);

export const FRONT_URL = `${BASE_URL}/front`;

/** The namespace the collector expects. A batch under any other namespace is flagged. */
export const TRACKER_NAMESPACE = 'news-app';

export const APP_VERSION = '1.0.0';
export const APP_BUILD = '1';

/** The platform value the tracker SDK takes; it accepts 'ios' and 'android' only. */
export const TRACKER_PLATFORM: 'ios' | 'android' = Platform.OS === 'android' ? 'android' : 'ios';

/**
 * What the pages read as `window.appContext`. The web team's tracker adds it to every event it hands
 * over, saved copies included, so it has to be set before a page's own scripts run.
 */
export type AppContext = {
  appVersion: string;
  appBuild: string;
  os: string;
  deviceType: string;
};

// `isPad` only exists on the iOS platform type, so it has to be narrowed before it is read.
const isTablet = 'isPad' in Platform && Platform.isPad;

export const APP_CONTEXT: AppContext = {
  appVersion: APP_VERSION,
  appBuild: APP_BUILD,
  os: Platform.OS,
  deviceType: isTablet ? 'tablet' : 'phone',
};
