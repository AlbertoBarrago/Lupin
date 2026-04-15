const SEARCH_TIMEOUT_MS = 15000
const MAX_RESULTS = 8

function decodeUddg(href) {
  // href = "//duckduckgo.com/l/?uddg=https%3A%2F%2F...&rut=..."
  try {
    const m = href.match(/[?&]uddg=([^&]+)/)
    if (m) return decodeURIComponent(m[1])
  } catch {}
  // fallback: absolute URL as-is
  return href.startsWith('//') ? 'https:' + href : href
}

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
