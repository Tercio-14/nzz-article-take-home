import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { FRONT_URL } from './src/config';

// Task 1 is the scaffold: one web view on the front page, to prove the app reaches the fixture
// server. The native layout, the message protocol, consent and tracking come in the next tasks.
export default function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="auto" />
      <WebView source={{ uri: FRONT_URL }} style={styles.webView} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
