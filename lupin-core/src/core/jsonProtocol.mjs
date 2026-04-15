export function extractJsonObject(text) {
  const raw = String(text || '').trim()

  try {
    return JSON.parse(raw)
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {}
  }

  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first >= 0 && last > first) {
    const candidate = raw.slice(first, last + 1)
    return JSON.parse(candidate)
  }

  throw new Error('unable to parse JSON object from model output')
}

// Normalize alternative shapes that qwen/other models emit into standard tool_call shape
export function normalizeShape(value) {
  if (!value || typeof value !== 'object') return value

  // {"type":"file_write","path":"...","content":"..."} → FileWriteTool
  if (value.type === 'file_write' && typeof value.path === 'string') {
    return { type: 'tool_call', tool: 'FileWriteTool', args: { path: value.path, content: value.content ?? '' } }
  }

  // {"type":"file_read","path":"..."} → FileReadTool
  if (value.type === 'file_read' && typeof value.path === 'string') {
    return { type: 'tool_call', tool: 'FileReadTool', args: { path: value.path } }
  }

  // {"type":"file_edit","path":"...","oldText":"...","newText":"..."} → FileEditTool (text-match mode)
  if (value.type === 'file_edit' && typeof value.path === 'string') {
    return { type: 'tool_call', tool: 'FileEditTool', args: { path: value.path, oldText: value.oldText ?? '', newText: value.newText ?? '', replaceAll: value.replaceAll } }
  }

  // {"type":"file_patch","path":"...","lineStart":N,"lineEnd":M,"newText":"..."} → FileEditTool (line-range mode)
  if (value.type === 'file_patch' && typeof value.path === 'string') {
    return { type: 'tool_call', tool: 'FileEditTool', args: { path: value.path, lineStart: value.lineStart, lineEnd: value.lineEnd, newText: value.newText ?? '' } }
  }

  // {"type":"file_delete","path":"..."} → FileDeleteTool
  if (value.type === 'file_delete' && typeof value.path === 'string') {
    return { type: 'tool_call', tool: 'FileDeleteTool', args: { path: value.path } }
  }

  // {"type":"bash","command":"..."} → BashTool
  if (value.type === 'bash' && typeof value.command === 'string') {
    return { type: 'tool_call', tool: 'BashTool', args: { command: value.command } }
  }

  // {"type":"web_search","query":"..."} → WebSearchTool
  if (value.type === 'web_search' && typeof value.query === 'string') {
    return { type: 'tool_call', tool: 'WebSearchTool', args: { query: value.query } }
  }

  // {"type":"web_fetch","url":"..."} → WebFetchTool
  if (value.type === 'web_fetch' && typeof value.url === 'string') {
    return { type: 'tool_call', tool: 'WebFetchTool', args: { url: value.url } }
  }

  return value
}

export function isValidToolCallShape(value) {
  return (
    value &&
    value.type === 'tool_call' &&
    typeof value.tool === 'string' &&
    typeof value.args === 'object'
  )
}

export function isValidFinalShape(value) {
  return value && value.type === 'final' && typeof value.content === 'string'
}
