// Pure module: no React Native imports, so it can be unit-tested directly.
//
// The app never uses the platform's built-in URL class or its query-string helper. React Native's
// implementations are incomplete: they pass in Node under Jest and then behave differently on a device,
// which is the worst kind of bug to find. Everything the app needs from a URL is shallow — the origin to
// compare against the server, the path to match `/article/<id>`, and the query string to carry along —
// so a small string parser is both safer and easier to reason about.

export type ParsedUrl = {
  /** Lowercased scheme without the colon, or '' for a relative reference such as `/article/2`. */
  scheme: string;
  /** Host without the port, or '' when the URL has no authority (`mailto:`, `tel:`, relative paths). */
  host: string;
  /** Port as written, or '' when none is given. No default port is ever inferred. */
  port: string;
  /** `scheme://host[:port]`, or '' when there is no authority. */
  origin: string;
  /** Path including its leading slash for hierarchical URLs; the opaque remainder otherwise. */
  path: string;
  /** Query string without the leading '?'. */
  query: string;
  /** Fragment without the leading '#'. */
  hash: string;
};

// scheme://host[:port][/path][?query][#hash] — the authority form.
const WITH_AUTHORITY = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

// scheme:opaque[?query][#hash] — `mailto:`, `tel:`, `about:`, `data:` and friends.
const WITHOUT_AUTHORITY = /^([a-zA-Z][a-zA-Z0-9+.-]*):([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

// A relative reference: no scheme at all, for example `/article/2?ref=related`.
const RELATIVE = /^([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

/**
 * Splits a URL into the parts the app needs, or returns `null` when the input cannot be read as one.
 *
 * Only blank input and a malformed scheme (`'://x'`) are rejected; a relative reference is valid and
 * comes back with an empty `scheme` and `origin`.
 */
export function parseUrl(input: string): ParsedUrl | null {
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (trimmed === '') return null;

  const authority = WITH_AUTHORITY.exec(trimmed);
  if (authority) {
    const scheme = authority[1].toLowerCase();
    const { host, port } = splitHostAndPort(authority[2]);
    const origin = host === '' ? '' : port === '' ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;

    return {
      scheme,
      host,
      port,
      origin,
      path: authority[3] ?? '',
      query: authority[4] ?? '',
      hash: authority[5] ?? '',
    };
  }

  const opaque = WITHOUT_AUTHORITY.exec(trimmed);
  if (opaque) {
    return {
      scheme: opaque[1].toLowerCase(),
      host: '',
      port: '',
      origin: '',
      path: opaque[2] ?? '',
      query: opaque[3] ?? '',
      hash: opaque[4] ?? '',
    };
  }

  // Anything still carrying a '://' had a broken scheme, for example '://x'.
  if (trimmed.includes('://')) return null;

  const relative = RELATIVE.exec(trimmed);
  if (!relative) return null;

  return {
    scheme: '',
    host: '',
    port: '',
    origin: '',
    path: relative[1] ?? '',
    query: relative[2] ?? '',
    hash: relative[3] ?? '',
  };
}

/** Splits `host:port`, tolerating a bare host. IPv6 literals keep their brackets. */
function splitHostAndPort(authority: string): { host: string; port: string } {
  const bracketed = /^(\[[^\]]*\])(?::(\d*))?$/.exec(authority);
  if (bracketed) return { host: bracketed[1], port: bracketed[2] ?? '' };

  const separator = authority.lastIndexOf(':');
  if (separator === -1) return { host: authority, port: '' };

  return { host: authority.slice(0, separator), port: authority.slice(separator + 1) };
}
