/** @module WebSearchTool */

/** Timeout in milliseconds for the DuckDuckGo search HTTP request. */
const SEARCH_TIMEOUT_MS = 15000
/** Maximum number of search results to return. */
const MAX_RESULTS = 8

/**
 * Decodes a DuckDuckGo redirect URL (`uddg` parameter) into the real destination URL.
 *
 * @param {string} href - Raw href attribute value from a DDG result anchor, e.g.
 *   `"//duckduckgo.com/l/?uddg=https%3A%2F%2F...&rut=..."`.
 * @returns {string} The decoded destination URL, or a best-effort absolute URL when
 *   the `uddg` parameter is absent.
 */
function decodeUddg(href) {
  // href = "//duckduckgo.com/l/?uddg=https%3A%2F%2F...&rut=..."
  try {
    const m = href.match(/[?&]uddg=([^&]+)/)
    if (m) return decodeURIComponent(m[1])
  } catch {}
  // fallback: absolute URL as-is
  return href.startsWith('//') ? 'https:' + href : href
}

/**
 * Parses raw DuckDuckGo HTML search results into a structured array.
 *
 * Extracts result titles, URLs (via {@link decodeUddg}), and snippet text using
 * regular expressions against the raw HTML response body.
 *
 * @param {string} html - Raw HTML string from the DuckDuckGo HTML endpoint.
 * @returns {Array<{title: string, url: string, snippet: string}>} Array of parsed search
 *   result objects, capped at {@link MAX_RESULTS} entries.
 */
function parseDDGResults(html) {
  const results = []

  // Extract parallel arrays of titles+urls and snippets
  const titleRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi

  const titles = []
  let m
  while ((m = titleRe.exec(html)) !== null) {
    const url = decodeUddg(m[1].replace(/&amp;/g, '&'))
    const title = m[2].replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim()
    if (title && url) titles.push({ title, url })
  }

  const snippets = []
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(
      m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/&#x27;/g, "'").trim()
    )
  }

  for (let i = 0; i < Math.min(titles.length, MAX_RESULTS); i++) {
    results.push({ ...titles[i], snippet: snippets[i] ?? '' })
  }

  return results
}

/**
 * Tool definition for performing web searches via DuckDuckGo.
 *
 * Uses the DuckDuckGo HTML endpoint (`https://html.duckduckgo.com/html/`) — no API key
 * required. Results are parsed from the raw HTML response and returned as a structured
 * list of titles, URLs, and snippets.
 *
 * @type {{
 *   name: string,
 *   description: string,
 *   schema: object,
 *   run: (args: {query: string}) => Promise<{query: string, results: Array<{title: string, url: string, snippet: string}>, note?: string}>
 * }}
 */
export const WebSearchTool = {
  name: 'WebSearchTool',
  description:
    'Search the web using DuckDuckGo. Returns top results with title, URL, and snippet. No API key required. Use for current information, news, documentation lookups.',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  /**
   * Executes a DuckDuckGo search and returns parsed results.
   *
   * @param {{query: string}} args - Tool arguments.
   * @param {string} args.query - The search query string.
   * @returns {Promise<{query: string, results: Array<{title: string, url: string, snippet: string}>, note?: string}>}
   *   Resolves with the query string and an array of result objects. If no results could be
   *   parsed, the `note` field contains a fallback suggestion.
   * @throws {Error} If `query` is empty, the network request fails, or DuckDuckGo returns
   *   a non-OK HTTP status.
   */
  async run(args) {
    const query = String(args?.query || '').trim()
    if (!query) throw new Error('query must not be empty')

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

    let response
    try {
      response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Lupin/1.0)',
          Accept: 'text/html',
        },
      })
    } catch (err) {
      throw new Error(`search request failed: ${err?.message || err}`)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned HTTP ${response.status}`)
    }

    const html = await response.text()
    const results = parseDDGResults(html)

    if (results.length === 0) {
      return {
        query,
        results: [],
        note: 'No results parsed — try a different query or use WebFetchTool with a direct URL.',
      }
    }

    return { query, results }
  },
}
