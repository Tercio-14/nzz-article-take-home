// The article screen: the page fills the screen and scrolls itself, under a floating native header.
//
// The header is translucent and sits over the page, so the app tells the page how much space its
// chrome covers. The page reserves that from its first paint, which is why the insets go in before the
// content loads and any later change goes out as an `app:insets` event.

import { useHeaderHeight } from '@react-navigation/elements';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageWebView, PageWebViewHandle } from '../components/PageWebView';
import { isBookmarked } from '../lib/appState';
import { articleIdFromPath } from '../lib/links';
import { RootStackParamList } from '../navigation/routes';
import { useAppState } from '../state/AppStateProvider';
import { paletteFor } from '../theme';

export function ArticleScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Article'>) {
  const { path, articleId } = route.params;
  const { state, fontScaleUp, fontScaleDown, setTheme, toggleBookmark } = useAppState();

  const palette = paletteFor(state.theme);
  const headerHeight = useHeaderHeight();
  const safeArea = useSafeAreaInsets();
  const page = useRef<PageWebViewHandle>(null);

  const bookmarked = isBookmarked(state, articleId);

  // What the app's own chrome covers, in CSS pixels, top and bottom.
  const insets = useMemo(
    () => ({ top: Math.round(headerHeight), bottom: Math.round(safeArea.bottom) }),
    [headerHeight, safeArea.bottom],
  );

  const openArticle = useCallback(
    (nextPath: string) => {
      const nextId = articleIdFromPath(nextPath);
      if (!nextId) return;

      navigation.push('Article', { path: nextPath, articleId: nextId });
    },
    [navigation],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTransparent: true,
      headerTitle: '',
      headerTintColor: palette.text,
      headerStyle: { backgroundColor: 'transparent' },
      headerRight: () => (
        <View style={styles.actions}>
          <HeaderButton label="A−" palette={palette} onPress={fontScaleDown} accessibilityLabel="Smaller text" />
          <HeaderButton label="A+" palette={palette} onPress={fontScaleUp} accessibilityLabel="Larger text" />
          <HeaderButton
            label={state.theme === 'dark' ? '☀' : '☾'}
            palette={palette}
            onPress={() => setTheme(state.theme === 'dark' ? 'light' : 'dark')}
            accessibilityLabel="Switch between light and dark"
          />
          <HeaderButton
            label={bookmarked ? '★' : '☆'}
            palette={palette}
            onPress={() => toggleBookmark(articleId)}
            accessibilityLabel={bookmarked ? 'Remove bookmark' : 'Bookmark this article'}
          />
        </View>
      ),
    });
  }, [navigation, palette, state.theme, bookmarked, articleId, fontScaleUp, fontScaleDown, setTheme, toggleBookmark]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {/* TODO (task 5): pull to refresh at the top of the article, the end-of-text probe that marks it
          read, and the contents links and Jump button scrolling to just below this header. */}
      <PageWebView
        ref={page}
        page="article"
        path={path}
        articleId={articleId}
        insets={insets}
        palette={palette}
        onOpenArticle={openArticle}
      />
    </View>
  );
}

function HeaderButton({
  label,
  palette,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  palette: ReturnType<typeof paletteFor>;
  onPress(): void;
  accessibilityLabel: string;
}) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={8}>
      <Text style={[styles.actionLabel, { color: palette.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  actionLabel: {
    fontSize: 17,
    fontWeight: '500',
  },
});
