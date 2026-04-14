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

  // {"type":"file_delete","path":"..."} → FileDeleteTool
  if (value.type === 'file_delete' && typeof value.path === 'string') {
    return { type: 'tool_call', tool: 'FileDeleteTool', args: { path: value.path } }
  }

  // {"type":"bash","command":"..."} → BashTool
  if (value.type === 'bash' && typeof value.command === 'string') {
    return { type: 'tool_call', tool: 'BashTool', args: { command: value.command } }
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
