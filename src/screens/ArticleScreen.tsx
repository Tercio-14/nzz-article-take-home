// The article screen: the page fills the screen and scrolls itself, under a floating native header.
//
// The header is translucent and sits over the page, so the app tells the page how much space its
// chrome covers. The page reserves that from its first paint, which is why the insets go in before the
// content loads and any later change goes out as an `app:insets` event.

import { useHeaderHeight } from '@react-navigation/elements';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageWebView, PageWebViewHandle } from '../components/PageWebView';
import { isBookmarked } from '../lib/appState';
import { articleIdFromPath } from '../lib/links';
import { SessionPhase } from '../lib/pageSession';
import { PULL_THRESHOLD, PullPhase, pullState, shouldTriggerOnRelease } from '../lib/pullToRefresh';
import { createReadReporter } from '../lib/readOnce';
import { RootStackParamList } from '../navigation/routes';
import { useAppState } from '../state/AppStateProvider';
import { paletteFor } from '../theme';
import { tracking } from '../tracking';

/** How far above the header's lower edge the pull indicator sits, so it clears the text. */
const INDICATOR_LIFT = 14;

export function ArticleScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Article'>) {
  const { path, articleId } = route.params;
  const { state, fontScaleUp, fontScaleDown, setTheme, toggleBookmark, markRead } = useAppState();

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

  // Pull to refresh, driven by the page itself. A gesture laid over the web view never receives the
  // drag — the web view's own scrolling takes the touch first — so an injected probe reports the
  // touches instead and the app decides what they mean. The page only reports; it blocks nothing, so
  // ordinary scrolling, sideways drags and the swipe-back are untouched.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const pullOffset = useRef(new Animated.Value(0)).current;

  // Read inside the message handler, which must see the newest value without being re-created.
  const busyRef = useRef(false);
  busyRef.current = pullRefreshing;

  const onPhaseChange = useCallback((next: SessionPhase) => {
    // The pull is over as soon as the load is, whether it worked or not.
    if (next !== 'loading') setPullRefreshing(false);
  }, []);

  // Driven from JS, not the native driver: the probe writes the value as the finger moves, and a
  // value the native driver has taken over cannot be written from JS.
  const settle = useCallback(() => {
    Animated.spring(pullOffset, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
  }, [pullOffset]);

  const onPull = useCallback(
    (phase: PullPhase, distance: number) => {
      // The page reports whenever it is at the top; whether that means anything is the app's call.
      const state = pullState({ dragY: distance, atTop: true, busy: busyRef.current });

      if (phase === 'move') {
        pullOffset.setValue(state.offset);

        return;
      }

      if (phase === 'end' && shouldTriggerOnRelease(state)) {
        setPullRefreshing(true);
        page.current?.reload();
      }

      if (phase !== 'start') settle();
    },
    [pullOffset, settle],
  );

  // One reporter per article screen. The README asks for one read event each time a screen is opened
  // and never twice for the same screen, so a reload reports nothing further, while opening the
  // article again later is a new screen and counts again.
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;

  const reporter = useRef(
    createReadReporter(id => {
      tracking.trackArticleRead(id);
      markReadRef.current(id);
    }),
  ).current;

  const onEndOfText = useCallback(
    (reportedId: string) => {
      // Only the article this screen is showing; a stale document cannot mark something else read.
      if (reportedId === articleId) reporter.report(reportedId);
    },
    [articleId, reporter],
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
      {/* The contents links and the Jump button need no code here: the page sets
          `scroll-margin-top: var(--inset-top)` on every element with an id, and the app supplies that
          inset, so its own anchor scrolling already lands headings below this header. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pullIndicator,
          {
            top: insets.top - INDICATOR_LIFT,
            opacity: pullOffset.interpolate({
              inputRange: [0, PULL_THRESHOLD],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            }),
            transform: [{ translateY: pullOffset }],
          },
        ]}
      >
        <ActivityIndicator color={palette.text} />
      </Animated.View>

      <Animated.View style={[styles.screen, { transform: [{ translateY: pullOffset }] }]}>
        <PageWebView
          ref={page}
          page="article"
          path={path}
          articleId={articleId}
          insets={insets}
          palette={palette}
          showLoadingOverlay={!pullRefreshing}
          onEndOfText={onEndOfText}
          onOpenArticle={openArticle}
          onPhaseChange={onPhaseChange}
          onPull={onPull}
        />
      </Animated.View>
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
  // Sits over the page just below the floating header and follows the finger.
  pullIndicator: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 1,
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
