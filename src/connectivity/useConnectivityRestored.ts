// Tells a page host when the device has come back online, so a page that failed can retry by itself.
//
// Only the transition matters. The first reading says what the device is doing right now, not that
// anything changed, so firing on it would reload a page that is already fine.

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useRef } from 'react';

/** Online enough to try a request: connected, and not known to be unreachable. */
function isOnline(state: NetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

export function useConnectivityRestored(onRestored: () => void): void {
  const callback = useRef(onRestored);
  callback.current = onRestored;

  useEffect(() => {
    // Unknown until the first reading, so that reading can never look like a change.
    let wasOnline: boolean | null = null;

    const unsubscribe = NetInfo.addEventListener(state => {
      const online = isOnline(state);
      const restored = wasOnline === false && online;

      wasOnline = online;

      if (restored) callback.current();
    });

    return unsubscribe;
  }, []);
}
