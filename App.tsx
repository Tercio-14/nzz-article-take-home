import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConsentProvider } from './src/consent/ConsentProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AppStateProvider } from './src/state/AppStateProvider';

// The app state comes first: it is read from storage before anything renders, so a page is never told
// the defaults and then the real values. Consent wraps the navigator because no page may start loading
// until the gate is open.
export default function App() {
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <ConsentProvider>
          <StatusBar style="auto" />
          <RootNavigator />
        </ConsentProvider>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
