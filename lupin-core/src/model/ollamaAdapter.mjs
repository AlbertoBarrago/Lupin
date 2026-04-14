function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return promiseFactory(controller.signal).finally(() => clearTimeout(timer))
}

export class OllamaAdapter {
  constructor({ baseUrl, model, timeoutMs = 20000 }) {
    this.baseUrl = baseUrl
    this.model = model
    this.timeoutMs = timeoutMs
  }

  setModel(model) {
    this.model = model
  }

  async healthcheck() {
    try {
      const response = await withTimeout(
        signal =>
          fetch(`${this.baseUrl}/api/tags`, {
            method: 'GET',
            signal,
          }),
        Math.min(this.timeoutMs, 5000),
      )
      return response.ok
    } catch {
      return false
    }
  }

  async *chatStream(messages, options = {}) {
    let response
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: true,
          messages,
          options: options.options || undefined,
        }),
      }).finally(() => clearTimeout(timer))
    } catch {
      throw new Error(
        `cannot reach Ollama at ${this.baseUrl} — start Ollama (app or "ollama serve") and ensure model "${this.model}" is installed (ollama pull ${this.model})`,
      )
    }

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`ollama HTTP ${response.status}: ${body.slice(0, 300)}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let lineBuffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      lineBuffer += decoder.decode(value, { stream: true })
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed)
          const token = obj?.message?.content
          if (token) yield token
        } catch {}
      }
    }
  }

  async chat(messages, options = {}) {
    let text = ''
    for await (const token of this.chatStream(messages, options)) {
      text += token
    }
    if (!text.trim()) throw new Error('empty ollama response')
    return text
  }
}
