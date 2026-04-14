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
