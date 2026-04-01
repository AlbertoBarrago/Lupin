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

  async chat(messages, options = {}) {
    let response
    try {
      response = await withTimeout(
        signal =>
          fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            signal,
            body: JSON.stringify({
              model: this.model,
              stream: false,
              messages,
              options: options.options || undefined,
            }),
          }),
        this.timeoutMs,
      )
    } catch (error) {
      throw new Error(
        `cannot reach Ollama at ${this.baseUrl}; run "ollama serve" and ensure model "${this.model}" is installed`,
      )
    }

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`ollama HTTP ${response.status}: ${body.slice(0, 300)}`)
    }

    const payload = await response.json()
    const text = payload?.message?.content?.trim()
    if (!text) {
      throw new Error('empty ollama response')
    }
    return text
  }
}
