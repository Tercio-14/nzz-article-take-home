// Pure module: no React Native imports, so it can be unit-tested directly.
//
// Everything a page sends arrives on one channel, and the pages share it with scripts the app does not
// control: the web team's tracker posts JSON with a `command`, and stand-ins for third-party scripts
// post a bare string ('tp:heartbeat'), a bogus height ({type:'height', value:'auto'}) and other noise.
// So this parser assumes nothing: it never throws, and anything it does not positively recognise comes
// back as 'ignored'.

export type WebViewMessage =
  | { kind: 'ready'; page: 'front' | 'article'; articleId?: string }
  | { kind: 'height'; value: number }
  | { kind: 'toggleBookmark'; articleId: string }
  | { kind: 'openArticle'; path: string }
  | { kind: 'tracker'; raw: string }
  | { kind: 'ignored' };

/** The protocol version the pages announce. Anything else is not this protocol. */
export const PROTOCOL = 1;

const IGNORED: WebViewMessage = { kind: 'ignored' };

/**
 * Reads one message from a web view, as the raw string `onMessage` hands over.
 *
 * The tracker's shape is checked first: its messages carry a `command` rather than a `type`, and the
 * SDK does its own filtering, so they are passed on whole rather than picked apart here.
 */
export function parseWebViewMessage(raw: unknown): WebViewMessage {
  if (typeof raw !== 'string') return IGNORED;

  const parsed = parseJsonObject(raw);
  if (!parsed) return IGNORED;

  // The web tracker's events, handed to the SDK untouched.
  if (typeof parsed.command === 'string') return { kind: 'tracker', raw };

  switch (parsed.type) {
    case 'ready':
      return parseReady(parsed);
    case 'height':
      return isFiniteHeight(parsed.value) ? { kind: 'height', value: parsed.value } : IGNORED;
    case 'toggleBookmark':
      return isNonEmptyString(parsed.articleId) ? { kind: 'toggleBookmark', articleId: parsed.articleId } : IGNORED;
    case 'openArticle':
      return isServerPath(parsed.path) ? { kind: 'openArticle', path: parsed.path } : IGNORED;
    default:
      return IGNORED;
  }
}

/** JSON that is an object, or null for a bare string, an array, a number or anything unparseable. */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

function parseReady(parsed: Record<string, unknown>): WebViewMessage {
  if (parsed.protocol !== PROTOCOL) return IGNORED;

  if (parsed.page === 'front') return { kind: 'ready', page: 'front' };

  // An article has to say which article it is, or the app cannot attribute anything to it.
  if (parsed.page === 'article' && isNonEmptyString(parsed.articleId)) {
    return { kind: 'ready', page: 'article', articleId: parsed.articleId };
  }

  return IGNORED;
}

function isFiniteHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** A path on the server: one leading slash, never protocol-relative ('//evil.com'). */
function isServerPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}
