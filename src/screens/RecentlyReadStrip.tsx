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

export function RecentlyReadStrip({
  articleIds,
  palette,
  onOpen,
}: {
  articleIds: string[];
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
  }, [articleIds]);

  if (articleIds.length === 0) return null;

  return (
    <View style={[styles.container, { borderBottomColor: palette.rule }]}>
      <Text style={[styles.heading, { color: palette.muted }]}>RECENTLY READ</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {articleIds.map(id => (
          <TouchableOpacity
            key={id}
            accessibilityRole="button"
            onPress={() => onOpen(id)}
            style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.rule }]}
          >
            <Text numberOfLines={3} style={[styles.title, { color: palette.text }]}>
              {resolved[id] ?? fallbackTitle(id)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
    paddingTop: 8,
  },
  heading: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  row: {
    gap: 8,
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    padding: 10,
    width: 150,
  },
  title: {
    fontSize: 13,
    lineHeight: 17,
  },
});
