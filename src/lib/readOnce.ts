// Pure module: no React Native imports, so it can be unit-tested directly.
//
// An article counts as read once the last line of its text has been on screen. The page keeps checking
// on scroll, on resize and on a timer, so the signal arrives many times; the newsroom wants one event
// per article screen. One reporter is created per article-screen instance, so a reader who opens the
// same article again gets a second reporter and a second event, which is what the brief asks for.

export type ReadReporter = {
  /** Reports the article as read. Only the first call of this reporter does anything. */
  report(articleId: string): void;
  /** Whether this reporter has already fired. */
  hasReported(): boolean;
};

export function createReadReporter(onRead: (articleId: string) => void): ReadReporter {
  let reported = false;

  return {
    report(articleId: string): void {
      if (reported) return;

      reported = true;
      onRead(articleId);
    },
    hasReported(): boolean {
      return reported;
    },
  };
}
