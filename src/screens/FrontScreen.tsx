// The front page screen: one native scroll view holding the strip, the page and a footer.
//
// The page itself does not scroll. It reports its height and the web view is given exactly that, so
// the native scroll view does all the scrolling and the footer really does sit below the end of the
// page rather than below a scrolling box.
//
// Two details that only showed up in use:
//
// - This screen has a pull-to-refresh spinner of its own, so the web view's overlay is turned off
//   while the reader is pulling. Otherwise an ordinary load lit up both at once.
// - A height belongs to the document that reported it. It is dropped when a new load starts, and
//   `pageAreaHeight` ignores it unless a page is actually being shown, so a failed load cannot leave
//   the scroll view as tall as the page that is gone with the error buried somewhere down it.

import { useHeaderHeight } from '@react-navigation/elements';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { PageWebView, PageWebViewHandle } from '../components/PageWebView';
import { recentlyRead } from '../lib/appState';
import { articleIdFromPath } from '../lib/links';
import { pageAreaHeight } from '../lib/pageLayout';
import { SessionPhase } from '../lib/pageSession';
import { RootStackParamList } from '../navigation/routes';
import { useAppState } from '../state/AppStateProvider';
import { paletteFor } from '../theme';
import { RecentlyReadStrip } from './RecentlyReadStrip';

export function FrontScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Front'>) {
  const { state } = useAppState();
  const palette = paletteFor(state.theme);

  const page = useRef<PageWebViewHandle>(null);
  const scroller = useRef<ScrollView>(null);

  // Where the page sits inside the scroll view, so a heading's offset in the document can be turned
  // into a position to scroll this view to.
  const pageTop = useRef(0);
  const [height, setHeight] = useState<number | null>(null);
  const [phase, setPhase] = useState<SessionPhase>('waiting-for-consent');
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const windowHeight = useWindowDimensions().height;
  const headerHeight = useHeaderHeight();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: palette.background },
      headerTintColor: palette.text,
    });
  }, [navigation, palette]);

  const onPhaseChange = useCallback((next: SessionPhase) => {
    setPhase(next);

    // A new document has started: the height the last one reported no longer describes anything.
    if (next === 'loading') setHeight(null);

    // The pull is over as soon as the load is, whether it worked or not.
    if (next !== 'loading') setPullRefreshing(false);
  }, []);

  const onRefresh = useCallback(() => {
    setPullRefreshing(true);
    page.current?.reload();
  }, []);

  // A "Jump to" link was tapped and the heading measured. The front header is opaque and sits outside
  // this scroll view, so the top of the visible area is simply the scroll position.
  const onAnchorMeasured = useCallback((_fragment: string, top: number) => {
    scroller.current?.scrollTo({ y: Math.max(0, pageTop.current + top), animated: true });
  }, []);

  const onPageLayout = useCallback((event: LayoutChangeEvent) => {
    pageTop.current = event.nativeEvent.layout.y;
  }, []);

  const openArticle = useCallback(
    (path: string) => {
      const articleId = articleIdFromPath(path);
      if (!articleId) return;

      navigation.navigate('Article', { path, articleId });
    },
    [navigation],
  );

  const openById = useCallback(
    (articleId: string) => openArticle(`/article/${articleId}?ref=recently-read`),
    [openArticle],
  );

  // Loading and error views land in the visible area rather than down a scroll view sized by a page
  // that is no longer there.
  const pageHeight = pageAreaHeight({
    phase,
    reportedHeight: height,
    fallbackHeight: Math.max(240, windowHeight - headerHeight),
  });

  return (
    <ScrollView
      ref={scroller}
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={pullRefreshing} onRefresh={onRefresh} tintColor={palette.text} />
      }
    >
      <RecentlyReadStrip articleIds={recentlyRead(state, 5)} palette={palette} onOpen={openById} />

      <PageWebView
        ref={page}
        page="front"
        path="/front"
        palette={palette}
        style={{ height: pageHeight }}
        showLoadingOverlay={!pullRefreshing}
        onLayout={onPageLayout}
        onAnchorMeasured={onAnchorMeasured}
        onHeight={setHeight}
        onPhaseChange={onPhaseChange}
        onOpenArticle={openArticle}
      />

      <View style={[styles.footer, { borderTopColor: palette.rule }]}>
        <Text style={[styles.footerText, { color: palette.muted }]}>
          NZZ · Neue Zürcher Zeitung — take-home fixture
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  footerText: {
    fontSize: 12,
  },
});
