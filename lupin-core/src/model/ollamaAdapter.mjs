/** @module ollamaAdapter */

/**
 * Runs a promise-returning factory with an AbortController-based timeout.
 * The controller is aborted after `timeoutMs` milliseconds; the timer is
 * always cleared when the promise settles.
 *
 * @param {function(AbortSignal): Promise<*>} promiseFactory - Factory that
 *   accepts an {@link AbortSignal} and returns a Promise.
 * @param {number} timeoutMs - Milliseconds before the request is aborted.
 * @returns {Promise<*>} The promise produced by `promiseFactory`.
 */
function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return promiseFactory(controller.signal).finally(() => clearTimeout(timer));
}

/**
 * Thin wrapper around the Ollama HTTP API that supports streaming and
 * non-streaming chat completions.
 */
export class OllamaAdapter {
  /**
   * Creates an OllamaAdapter instance.
   *
   * @param {object} opts
   * @param {string} opts.baseUrl - Base URL of the Ollama server
   *   (e.g. `'http://127.0.0.1:11434'`).
   * @param {string} opts.model - Name of the model to use
   *   (e.g. `'qwen2.5-coder:7b'`).
   * @param {number} [opts.timeoutMs=20000] - Request timeout in milliseconds.
   */
  constructor({ baseUrl, model, timeoutMs = 20000 }) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this._lastStreamStats = null;
  }

  /**
   * Switches the active model for subsequent requests.
   *
   * @param {string} model - New model name.
   * @returns {void}
   */
  setModel(model) {
    this.model = model;
  }

  /**
   * Returns token-usage statistics captured from the most recent streaming
   * response, or `null` if no stream has completed yet.
   *
   * @returns {{ promptTokens: number, completionTokens: number } | null}
   */
  getLastStreamStats() {
    return this._lastStreamStats;
  }

  /**
   * Performs a lightweight liveness check against the Ollama `/api/tags`
   * endpoint. Uses at most 5 000 ms regardless of `this.timeoutMs`.
   *
   * @returns {Promise<boolean>} `true` if the server responded with an OK
   *   status, `false` on any error or non-OK response.
   */
  async healthcheck() {
    try {
      const response = await withTimeout(
        (signal) =>
          fetch(`${this.baseUrl}/api/tags`, {
            method: "GET",
            signal,
          }),
        Math.min(this.timeoutMs, 5000),
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Streams a chat completion from the Ollama `/api/chat` endpoint, yielding
   * one text token at a time. Updates `_lastStreamStats` when the server
   * sends the final done-object containing token counts.
   *
   * @param {Array<{ role: string, content: string }>} messages - Conversation
   *   history in Ollama chat format.
   * @param {object} [options={}] - Optional request overrides.
   * @param {object} [options.options] - Model parameter overrides forwarded
   *   verbatim to Ollama (e.g. `{ temperature: 0.7 }`).
   * @yields {string} Text tokens as they arrive from the stream.
   * @throws {Error} If the Ollama server cannot be reached.
   * @throws {Error} If the server returns a non-OK HTTP status.
   */
  async *chatStream(messages, options = {}) {
    let response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: true,
          messages,
          options: options.options || undefined,
        }),
      }).finally(() => clearTimeout(timer));
    } catch {
      throw new Error(
        `cannot reach Ollama at ${this.baseUrl} — start Ollama (app or "ollama serve") and ensure model "${this.model}" is installed (ollama pull ${this.model})`,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ollama HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj?.done === true) {
            this._lastStreamStats = {
              promptTokens: obj.prompt_eval_count ?? 0,
              completionTokens: obj.eval_count ?? 0,
            };
          }
          const token = obj?.message?.content;
          if (token) yield token;
        } catch {}
      }
    }
  }

  /**
   * Non-streaming chat completion. Collects all tokens from {@link chatStream}
   * into a single string and returns it.
   *
   * @param {Array<{ role: string, content: string }>} messages - Conversation
   *   history in Ollama chat format.
   * @param {object} [options={}] - Optional request overrides passed through
   *   to {@link chatStream}.
   * @returns {Promise<string>} The complete assistant reply.
   * @throws {Error} If the model returns an empty response.
   * @throws {Error} Propagates any error thrown by {@link chatStream}.
   */
  async chat(messages, options = {}) {
    let text = "";
    for await (const token of this.chatStream(messages, options)) {
      text += token;
    }
    if (!text.trim()) throw new Error("empty ollama response");
    return text;
  }
}
