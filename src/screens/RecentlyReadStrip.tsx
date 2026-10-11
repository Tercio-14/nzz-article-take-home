// The native strip above the front page: the last five articles the reader finished, newest first.
//
// Hidden while nothing has been read. Titles come from `lib/articleTitles`, which reads them from each
// article's saved-copy manifest — the only endpoint that gives a title for a single id.

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { BASE_URL } from '../config';
import { createTitleLookup, fallbackTitle } from '../lib/articleTitles';
import { Palette } from '../theme';

/** One lookup for the app's lifetime, so titles are fetched once and then come from its cache. */
const titles = createTitleLookup(fetch, BASE_URL);

/**
 * Throws away the cached titles so the strip asks for them again.
 *
 * The front page's pull-to-refresh calls this: the ids come from app state and are always current,
 * but a title that could not be fetched caches its placeholder, and a refresh is exactly when the
 * reader expects another attempt.
 */
export function forgetRecentlyReadTitles(): void {
  titles.forget();
}

export function RecentlyReadStrip({
  articleIds,
  refreshedAt = 0,
  palette,
  onOpen,
}: {
  articleIds: string[];
  /** Changes when the cached titles have been thrown away and should be fetched again. */
  refreshedAt?: number;
  palette: Palette;
  onOpen(articleId: string): void;
}) {
  const [resolved, setResolved] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    for (const id of articleIds) {
      void titles.titleFor(id).then(title => {
        if (cancelled) return;

        setResolved(current => (current[id] === title ? current : { ...current, [id]: title }));
      });
    }

    return () => {
      cancelled = true;
    };
  }, [articleIds, refreshedAt]);

  if (articleIds.length === 0) return null;

  return (
    <View style={[styles.container, { borderBottomColor: palette.rule }]}>
      <Text style={[styles.heading, { color: palette.accent }]}>RECENTLY READ</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        // So a half-shown card at the edge still reads as "there is more this way".
        decelerationRate="fast"
      >
        {articleIds.map(id => {
          const title = resolved[id] ?? fallbackTitle(id);

          return (
            <TouchableOpacity
              key={id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${title}`}
              onPress={() => onOpen(id)}
              style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.rule }]}
            >
              <Text numberOfLines={3} style={[styles.title, { color: palette.text }]}>
                {title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// 16px gutters and an uppercase accent heading echo the page's own kickers and margins, so the strip
// reads as part of the same product rather than a control bolted above it.
const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 16,
    paddingTop: 14,
  },
  heading: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    paddingBottom: 10,
    paddingHorizontal: 16,
    textTransform: 'uppercase',
  },
  row: {
    gap: 10,
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    // Comfortably past the 44pt minimum touch target, and tall enough for three lines of title.
    minHeight: 92,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: 172,
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 19,
  },
});
