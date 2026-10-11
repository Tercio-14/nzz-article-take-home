// The one web view both screens use. Everything in the protocol passes through here.
//
// Thin on purpose: what counts as a load, which navigation opens a screen, what the page is told and
// when, and what may reach the collector are all decided in `src/lib`. This component wires those
// decisions to a real `WebView` and to the app's state.
//
// Two things here are deliberate and easy to get wrong:
//
// - The loading overlay follows the *session*, never the web view's own load events. Navigation inside
//   a page fires `onLoadStart`, and showing a spinner for it would be wrong: that is not a load.
// - The web view is keyed by `loadId`, so a reload really is a new document. Changing only the
//   fragment would not reload the page, and the consent string lives in the fragment.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { APP_CONTEXT, BASE_URL } from '../config';
import { useConnectivityRestored } from '../connectivity/useConnectivityRestored';
import { useConsent } from '../consent/ConsentProvider';
import { buildPageUrl, decideOnConsentChange } from '../lib/consent';
import { classifyNavigation, createOpenArticleDeduper } from '../lib/links';
import { parseWebViewMessage } from '../lib/messages';
import { overlayFor } from '../lib/pageLayout';
import { Insets, PageKind, appEventsScript, beforeContentLoadedScript } from '../lib/pageScripts';
import { SessionPhase } from '../lib/pageSession';
import { parseUrl } from '../lib/parseUrl';
import { SentState, planStateUpdates } from '../lib/stateSync';
import { useAppState, usePageState } from '../state/AppStateProvider';
import { Palette } from '../theme';
import { tracking } from '../tracking';
import { usePageSession } from './usePageSession';

export type PageWebViewHandle = {
  /** Loads the page again as a new document. */
  reload(): void;
};

export type PageWebViewProps = {
  page: PageKind;
  /** A path on the server, with its query string, for example `/article/3?ref=teaser`. */
  path: string;
  articleId?: string;
  /** Article only: the space the app's own chrome covers. */
  insets?: Insets;
  onHeight?(height: number): void;
  onOpenArticle(path: string): void;
  onPhaseChange?(phase: SessionPhase): void;
  /**
   * Whether this host draws the loading spinner. Pass false when the screen is already showing one of
   * its own, such as the front page's pull-to-refresh control. The error view is shown either way.
   */
  showLoadingOverlay?: boolean;
  palette: Palette;
  style?: object;
};

/** One document the web view is showing, with the consent it was loaded with. */
type Load = {
  id: number;
  uri: string;
  consent: string | null;
};

const BASE_ORIGIN = parseUrl(BASE_URL)?.origin ?? BASE_URL;

export const PageWebView = forwardRef<PageWebViewHandle, PageWebViewProps>(function PageWebView(props, ref) {
  const {
    page,
    path,
    articleId,
    insets,
    onHeight,
    onOpenArticle,
    onPhaseChange,
    showLoadingOverlay = true,
    palette,
    style,
  } = props;

  const { consent, gateOpen } = useConsent();
  const { toggleBookmark } = useAppState();
  const pageState = usePageState();

  const webView = useRef<WebView>(null);
  const [load, setLoad] = useState<Load | null>(null);

  // What the current document has already been told, and whether it has been counted as a screen view.
  const lastSent = useRef<SentState | null>(null);
  const screenViewedLoadId = useRef<number | null>(null);
  const alreadyReloadedForConsent = useRef(false);

  // Read inside callbacks that must see the newest value without being re-created.
  const consentRef = useRef(consent);
  consentRef.current = consent;
  const pageStateRef = useRef(pageState);
  pageStateRef.current = pageState;
  const insetsRef = useRef(insets);
  insetsRef.current = insets;

  const deduper = useMemo(() => createOpenArticleDeduper(), []);

  const inject = useCallback((script: string) => {
    webView.current?.injectJavaScript(script);
  }, []);

  /** Hands the page the whole state. Runs when the session says the page can receive it. */
  const sendInitialState = useCallback(() => {
    const plan = planStateUpdates(null, pageStateRef.current, page, insetsRef.current);

    lastSent.current = plan.nextSent;
    inject(appEventsScript(plan.events));
  }, [inject, page]);

  const session = usePageSession(gateOpen, sendInitialState);
  const { state: sessionState, dispatch } = session;
  const { phase, loadId } = sessionState;

  const overlay = overlayFor({ phase, showLoadingOverlay });

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  useImperativeHandle(ref, () => ({ reload: () => dispatch({ type: 'LOAD_STARTED' }) }), [dispatch]);

  // A load has started: fix the URL for this document now, with the consent known at this moment.
  useEffect(() => {
    if (phase === 'waiting-for-consent' || loadId === 0) return;
    if (load?.id === loadId) return;

    const atLoadStart = consentRef.current;

    lastSent.current = null;
    setLoad({ id: loadId, uri: buildPageUrl(BASE_URL, path, atLoadStart), consent: atLoadStart });
  }, [phase, loadId, load?.id, path]);

  useEffect(() => {
    if (gateOpen) dispatch({ type: 'GATE_OPEN' });
  }, [gateOpen, dispatch]);

  // Consent arrived or changed while this page is open.
  useEffect(() => {
    if (!load) return;

    const decision = decideOnConsentChange(
      { loadedWithConsent: load.consent, alreadyReloadedForConsent: alreadyReloadedForConsent.current },
      consent,
    );

    if (decision !== 'reload') return;

    alreadyReloadedForConsent.current = true;
    dispatch({ type: 'LOAD_STARTED' });
  }, [consent, load, dispatch]);

  // Each later change reaches the page once. Not tied to focus: the screen below has to be up to date
  // before the reader gets back to it, and it must never reload to get there.
  useEffect(() => {
    if (phase !== 'ready' || lastSent.current === null) return;

    const plan = planStateUpdates(lastSent.current, pageState, page, insets);
    if (plan.events.length === 0) return;

    lastSent.current = plan.nextSent;
    inject(appEventsScript(plan.events));
  }, [pageState, insets, phase, page, inject]);

  useConnectivityRestored(
    useCallback(() => dispatch({ type: 'CONNECTIVITY_RESTORED' }), [dispatch]),
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const raw = event.nativeEvent.data;

      // Everything goes to the SDK, which picks out the web tracker's events and ignores the rest.
      tracking.pushPageMessage(raw);

      const message = parseWebViewMessage(raw);

      switch (message.kind) {
        case 'ready':
          // One screen view per document: a page that announces itself twice is still one document.
          if (screenViewedLoadId.current !== loadId) {
            screenViewedLoadId.current = loadId;
            tracking.trackScreenView(page === 'front' ? { name: 'front' } : { name: 'article', id: articleId });
          }

          dispatch({ type: 'READY' });
          break;
        case 'height':
          onHeight?.(message.value);
          break;
        case 'toggleBookmark':
          toggleBookmark(message.articleId);
          break;
        case 'openArticle':
          if (deduper.shouldOpen(message.path)) onOpenArticle(message.path);
          break;
        default:
          break;
      }
    },
    [loadId, page, articleId, dispatch, onHeight, toggleBookmark, deduper, onOpenArticle],
  );

  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      const decision = classifyNavigation({
        url: request.url,
        baseOrigin: BASE_ORIGIN,
        currentUrl: load?.uri ?? '',
        isTopFrame: request.isTopFrame,
      });

      if (decision.action === 'allow') return true;

      if (decision.action === 'openArticle') {
        if (deduper.shouldOpen(decision.path)) onOpenArticle(decision.path);

        return false;
      }

      void Linking.openURL(request.url).catch(() => undefined);

      return false;
    },
    [load?.uri, deduper, onOpenArticle],
  );

  const beforeContentLoaded = useMemo(
    () => beforeContentLoadedScript({ appContext: APP_CONTEXT, insets: page === 'article' ? insets : undefined }),
    // Captured once per document: the page reads it at startup and later changes arrive as app:insets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, load?.id],
  );

  return (
    <View style={[styles.container, style]}>
      {load && (
        <WebView
          key={String(load.id)}
          ref={webView}
          source={{ uri: load.uri }}
          style={[styles.webView, { backgroundColor: palette.background }]}
          originWhitelist={['*']}
          setSupportMultipleWindows={false}
          injectedJavaScriptBeforeContentLoaded={beforeContentLoaded}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onError={() => dispatch({ type: 'LOAD_ERROR' })}
          onHttpError={event => {
            // Only the document itself; a failed image must not fail the page.
            if (event.nativeEvent.url === load.uri && event.nativeEvent.statusCode >= 400) {
              dispatch({ type: 'LOAD_ERROR' });
            }
          }}
          scrollEnabled={page === 'article'}
          overScrollMode="never"
          allowsInlineMediaPlayback
          {...(page === 'article' ? { contentInsetAdjustmentBehavior: 'never' as const } : {})}
        />
      )}

      {overlay !== 'none' && (
        <View style={[styles.overlay, { backgroundColor: palette.background }]}>
          {overlay === 'error' ? (
            <View style={styles.centred}>
              <Text style={[styles.errorTitle, { color: palette.text }]}>This page could not be loaded.</Text>
              <Text style={[styles.errorBody, { color: palette.muted }]}>
                Check that the fixture server is reachable, then try again.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => dispatch({ type: 'RETRY' })}
                style={[styles.retry, { borderColor: palette.text }]}
              >
                <Text style={[styles.retryLabel, { color: palette.text }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ActivityIndicator size="large" color={palette.text} />
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  webView: {
    flex: 1,
  },
  overlay: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  centred: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  retry: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  retryLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
});
