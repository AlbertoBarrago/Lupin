/** @module WebFetchTool */

/** Maximum milliseconds to wait for a fetch response before aborting. */
const FETCH_TIMEOUT_MS = 15000
/** Maximum number of characters to return from the stripped page content. */
const MAX_CONTENT_CHARS = 12000

/**
 * Strip HTML tags and decode common HTML entities from a raw HTML string,
 * returning a plain-text representation suitable for passing to a language model.
 *
 * @param {string} html - Raw HTML source to sanitise.
 * @returns {string} Plain text with scripts, styles, and tags removed.
 */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Tool that fetches a URL and returns the page content as plain text.
 * HTML is stripped before returning so the result is safe to embed in prompts.
 * Use for reading documentation, articles, or any web page.
 *
 * @type {{
 *   name: string,
 *   description: string,
 *   schema: object,
 *   run: (args: {url: string}) => Promise<{url: string, content: string, truncated: boolean}>
 * }}
 */
export const WebFetchTool = {
  name: 'WebFetchTool',
  description: 'Fetch a URL and return the page content as plain text (HTML stripped). Use for reading documentation, articles, or any web page.',
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL to fetch (must start with http:// or https://)' },
    },
    required: ['url'],
  },
  /**
   * Execute the fetch and return stripped page text.
   *
   * @param {{url: string}} args - Tool arguments.
   * @returns {Promise<{url: string, content: string, truncated: boolean}>}
   *   The fetched URL, plain-text content (capped at {@link MAX_CONTENT_CHARS} characters),
   *   and a flag indicating whether the content was truncated.
   * @throws {Error} If the URL scheme is not http/https, the network request fails,
   *   or the server returns a non-2xx status code.
   */
  async run(args) {
    const url = String(args?.url || '').trim()
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('url must start with http:// or https://')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    let response
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Lupin/1.0)',
          'Accept': 'text/html,application/xhtml+xml,text/plain',
        },
      })
    } catch (err) {
      throw new Error(`fetch failed: ${err?.message || err}`)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const raw = await response.text()
    const text = stripHtml(raw)
    const truncated = text.length > MAX_CONTENT_CHARS
    return {
      url,
      content: text.slice(0, MAX_CONTENT_CHARS),
      truncated,
    }
  },
}
