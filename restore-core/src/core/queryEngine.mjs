import {
  extractJsonObject,
  isValidFinalShape,
  isValidToolCallShape,
} from './jsonProtocol.mjs'
import { buildSystemPrompt } from '../prompt/systemPrompt.mjs'

function normalizeTaskText(task) {
  return String(task || '')
    .replace(/^\s*assistant>\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeProjectQuestion(task) {
  const value = normalizeTaskText(task).toLowerCase()
  if (!value) return false
  return (
    value.includes('project') ||
    value.includes('repository') ||
    value.includes('repo') ||
    value.includes('codebase') ||
    value.includes('this code') ||
    value.includes('why is this') ||
    value.includes('what is this') ||
    value.includes('interesting') ||
    value.includes('good project') ||
    value.includes('bel progetto') ||
    value.includes('perché')
  )
}

function buildProjectProbeInstruction(workspaceContext) {
  const targets = [
    'README.md',
    ...workspaceContext.markers.filter(name => name !== 'README.md'),
  ].slice(0, 6)

  return [
    'PROJECT_PROBE:',
    'This question is about the repository as a whole.',
    'Before answering, inspect the repo first.',
    `Start with GlobTool to inspect structure, then read the most relevant files such as: ${targets.length ? targets.join(', ') : 'README.md and likely entry files'}.`,
    'Do not answer with "Unknown" or claim missing project information until you have inspected at least one structural source and one content source.',
  ].join(' ')
}

function isWeakFinalAnswer(answer) {
  const value = String(answer || '').trim().toLowerCase()
  if (!value) return true
  return (
    value === 'unknown' ||
    value.startsWith('unknown.') ||
    value.includes('no information about the project is available yet') ||
    value.includes('inspected “init” file') ||
    value.includes('inspected "init" file')
  )
}

function buildWorkspaceFallback(workspaceContext) {
  const markers = workspaceContext.markers.length
    ? workspaceContext.markers.join(', ')
    : 'no obvious manifest markers'
  const topLevel = workspaceContext.topLevel
    .slice(0, 8)
    .map(entry => entry.replace(/^\[(dir|file)\]\s*/, ''))
    .join(', ')

  return [
    'I do not have enough inspected implementation detail for a strong answer yet, but this repository already looks structured rather than empty.',
    `I can see workspace signals like ${markers}.`,
    workspaceContext.readmeSummary
      ? `The README suggests: ${workspaceContext.readmeSummary}`
      : 'There is no useful README summary yet.',
    topLevel ? `Top-level entries include ${topLevel}.` : '',
    'Ask again after /init or tell Lupin to inspect the repository first, and it should answer with something more concrete.',
  ]
    .filter(Boolean)
    .join(' ')
}

export class QueryEngine {
  constructor({ modelAdapter, toolRuntime, maxSteps = 12, debug = false }) {
    this.modelAdapter = modelAdapter
    this.toolRuntime = toolRuntime
    this.maxSteps = maxSteps
    this.debug = debug
  }

  async runTask(task, historyMessages = []) {
    const normalizedTask = normalizeTaskText(task)
    const workspaceContext = this.toolRuntime.getWorkspaceContext()
    const systemPrompt = buildSystemPrompt(
      this.toolRuntime.listTools(),
      workspaceContext,
    )
    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
    ]

    if (looksLikeProjectQuestion(normalizedTask)) {
      messages.push({
        role: 'user',
        content: buildProjectProbeInstruction(workspaceContext),
      })
    }

    messages.push({ role: 'user', content: normalizedTask })

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
        const answer = isWeakFinalAnswer(parsed.content)
          ? buildWorkspaceFallback(workspaceContext)
          : parsed.content
        return {
          answer,
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
        const answer = isWeakFinalAnswer(forcedParsed.content)
          ? buildWorkspaceFallback(workspaceContext)
          : forcedParsed.content
        return {
          answer,
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
