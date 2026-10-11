// The stack: the front page, and an article pushed on top of it.
//
// A native stack keeps the screen below mounted, which is what the brief asks for — going back must
// not reload it, and it must already show any setting changed above.

import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ArticleScreen } from '../screens/ArticleScreen';
import { FrontScreen } from '../screens/FrontScreen';
import { useAppState } from '../state/AppStateProvider';
import { paletteFor } from '../theme';
import { RootStackParamList } from './routes';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { state } = useAppState();
  const palette = paletteFor(state.theme);
  const base = state.theme === 'dark' ? DarkTheme : DefaultTheme;

  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: palette.background,
      card: palette.background,
      text: palette.text,
      border: palette.rule,
      primary: palette.accent,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator>
        <Stack.Screen name="Front" component={FrontScreen} options={{ title: 'NZZ' }} />
        <Stack.Screen name="Article" component={ArticleScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
