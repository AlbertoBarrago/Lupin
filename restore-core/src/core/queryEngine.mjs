import {
  extractJsonObject,
  isValidFinalShape,
  isValidToolCallShape,
} from './jsonProtocol.mjs'
import { buildSystemPrompt } from '../prompt/systemPrompt.mjs'

export class QueryEngine {
  constructor({ modelAdapter, toolRuntime, maxSteps = 12, debug = false }) {
    this.modelAdapter = modelAdapter
    this.toolRuntime = toolRuntime
    this.maxSteps = maxSteps
    this.debug = debug
  }

  async runTask(task, historyMessages = []) {
    const systemPrompt = buildSystemPrompt(
      this.toolRuntime.listTools(),
      this.toolRuntime.getWorkspaceContext(),
    )
    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: task },
    ]

    for (let step = 1; step <= this.maxSteps; step++) {
      const raw = await this.modelAdapter.chat(messages, {
        options: { temperature: 0.2 },
      })

      let parsed
      try {
        parsed = extractJsonObject(raw)
      } catch {
        messages.push({ role: 'assistant', content: raw })
        messages.push({
          role: 'user',
          content:
            'FORMAT_ERROR: Return valid JSON only. Use {"type":"tool_call",...} or {"type":"final","content":"..."}.',
        })
        continue
      }

      if (isValidFinalShape(parsed)) {
        return {
          answer: parsed.content,
          transcript: messages,
          steps: step,
        }
      }

      if (isValidToolCallShape(parsed)) {
        const result = await this.toolRuntime.execute(parsed.tool, parsed.args || {})
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) })
        messages.push({
          role: 'user',
          content: `TOOL_RESULT ${parsed.tool}: ${JSON.stringify(result)}`,
        })
        continue
      }

      messages.push({ role: 'assistant', content: JSON.stringify(parsed) })
      messages.push({
        role: 'user',
        content:
          'INVALID_SHAPE: expected {"type":"tool_call","tool":"...","args":{...}} or {"type":"final","content":"..."}.',
      })
    }

    try {
      const forcedRaw = await this.modelAdapter.chat(
        [
          ...messages,
          {
            role: 'user',
            content:
              'FINAL_ONLY: stop tool usage and return only {"type":"final","content":"..."} with your best possible answer from current context.',
          },
        ],
        { options: { temperature: 0.1 } },
      )
      const forcedParsed = extractJsonObject(forcedRaw)
      if (isValidFinalShape(forcedParsed)) {
        return {
          answer: forcedParsed.content,
          transcript: messages,
          steps: this.maxSteps,
        }
      }
    } catch {}

    return {
      answer:
        'I reached the step limit before finishing. Try refining the task or using /status to verify model connectivity.',
      transcript: messages,
      steps: this.maxSteps,
    }
  }
}
