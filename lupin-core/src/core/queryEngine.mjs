import {
  extractJsonObject,
  isValidFinalShape,
  isValidToolCallShape,
  normalizeShape,
} from './jsonProtocol.mjs'
import { preloadWorkspaceFiles } from './workspaceContext.mjs'

function unescapeJson(str) {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}
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

function looksLikeImplementationTask(task) {
  const value = normalizeTaskText(task).toLowerCase()
  if (!value) return false
  return (
    value.includes('implement') ||
    value.includes('feature') ||
    value.includes('add ') ||
    value.includes('create ') ||
    value.includes('build ') ||
    value.includes('fix ') ||
    value.includes('bug') ||
    value.includes('refactor') ||
    value.includes('update ') ||
    value.includes('modify ')
  )
}

function buildImplementationWorkflowInstruction() {
  return [
    'IMPLEMENTATION_WORKFLOW:',
    'This task likely requires code changes.',
    'First inspect relevant files before editing anything.',
    'Use GlobTool/GrepTool/FileReadTool to locate the right files and understand existing patterns.',
    'Then make the smallest necessary edit.',
    'Prefer FileEditTool for targeted changes inside existing files. Use FileWriteTool when creating a new file or replacing a file intentionally.',
    'After editing, verify the result before finishing.',
    'Verification should prefer reading the changed files and running a focused BashTool command when appropriate, such as tests, lint, or typecheck.',
    'Your final answer must mention what changed and how you verified it.',
  ].join(' ')
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
  if (value === 'unknown') return true
  if (value.startsWith('unknown.')) return true
  if (value.includes('no information about the project is available yet')) return true
  if (value.includes('inspected “init” file')) return true
  if (value.includes('i apologize')) return true
  if (value.includes('sorry')) return true
  if (value.includes('let me try again')) return true
  if (value.includes('let us try again')) return true
  return false
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

function isInspectionTool(toolName) {
  return toolName === 'GlobTool' || toolName === 'GrepTool' || toolName === 'FileReadTool'
}

function isVerificationBash(command) {
  const value = String(command || '').toLowerCase()
  return (
    value.includes('test') ||
    value.includes('lint') ||
    value.includes('typecheck') ||
    value.includes('check') ||
    value.includes('vitest') ||
    value.includes('jest') ||
    value.includes('pytest') ||
    value.includes('tsc')
  )
}

export class QueryEngine {
  constructor({ modelAdapter, toolRuntime, maxSteps = 12, debug = false, initSnapshot = null }) {
    this.modelAdapter = modelAdapter
    this.toolRuntime = toolRuntime
    this.maxSteps = maxSteps
    this.debug = debug
    this.initSnapshot = initSnapshot
  }

  setSnapshot(snapshot) {
    this.initSnapshot = snapshot
  }

  // Stream model response, detect final answer, pipe content tokens to onFinalToken.
  // Returns full raw text for JSON parsing.
  async #collectWithStream(messages, options, onFinalToken) {
    let fullText = ''
    let phase = 'detect' // detect | tool_call | final_seek | final_stream
    let held = ''
    const HOLD = 20 // chars to hold back to strip closing "}
    const DETECT_LIMIT = 80 // chars before we give up detecting

    const emit = (str) => { if (onFinalToken && str) onFinalToken(str) }

    const flush = () => {
      const clean = held.replace(/\\n$/, '').replace(/["\}\s`]+$/, '')
      emit(unescapeJson(clean))
      held = ''
    }

    for await (const token of this.modelAdapter.chatStream(messages, options)) {
      fullText += token

      if (phase === 'detect') {
        if (fullText.includes('"type":"final"') || fullText.includes('"type": "final"')) {
          phase = 'final_seek'
        } else if (fullText.length > DETECT_LIMIT || fullText.includes('tool_call') || fullText.includes('file_write') || fullText.includes('file_read') || fullText.includes('file_delete') || fullText.includes('bash')) {
          phase = 'tool_call'
        }
      }

      if (phase === 'final_seek') {
        const m = fullText.match(/"content"\s*:\s*"/)
        if (m) {
          phase = 'final_stream'
          // seed held with whatever content we already have after the opening quote
          held = fullText.slice(m.index + m[0].length)
        }
      } else if (phase === 'final_stream') {
        held += token
        if (held.length > HOLD) {
          const chunk = held.slice(0, held.length - HOLD)
          held = held.slice(held.length - HOLD)
          emit(unescapeJson(chunk))
        }
      }
    }

    if (phase === 'final_stream') flush()

    if (!fullText.trim()) throw new Error('empty ollama response')
    return fullText
  }

  async runTask(task, historyMessages = [], { onFinalToken, onToolCall } = {}) {
    const normalizedTask = normalizeTaskText(task)
    const workspaceContext = this.toolRuntime.getWorkspaceContext()
    const workspaceIsEmpty = workspaceContext.topLevel.length === 0
    const implementationTask = looksLikeImplementationTask(normalizedTask)
    const preloadedFiles = preloadWorkspaceFiles(this.toolRuntime.projectRoot)
    const systemPrompt = buildSystemPrompt(
      this.toolRuntime.listTools(),
      workspaceContext,
      this.initSnapshot,
      preloadedFiles,
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

    if (implementationTask && !workspaceIsEmpty && !preloadedFiles) {
      messages.push({
        role: 'user',
        content: buildImplementationWorkflowInstruction(),
      })
    }

    if (implementationTask && workspaceIsEmpty) {
      messages.push({
        role: 'user',
        content: 'CREATION_TASK: the workspace is empty. Do not inspect — just create the required files directly using FileWriteTool. Write all files, then give a final answer.',
      })
    }

    messages.push({ role: 'user', content: normalizedTask })

    // If files are preloaded in system prompt, inspection guard is already satisfied
    let inspectionCount = preloadedFiles ? 1 : 0
    let hasEditedFiles = false
    let hasVerifiedChanges = false
    const changedFiles = new Set()
    const inspectedFiles = new Set()
    const recentToolCalls = [] // loop detection

    let streamingStarted = false

    for (let step = 1; step <= this.maxSteps; step++) {
      if (this.debug) process.stderr.write(`[lupin] step ${step}/${this.maxSteps}\n`)

      const streamCallback = onFinalToken
        ? (token) => {
            if (!streamingStarted) {
              streamingStarted = true
              onFinalToken({ type: 'start' })
            }
            onFinalToken({ type: 'token', value: token })
          }
        : null

      const raw = await this.#collectWithStream(
        messages,
        { options: { temperature: 0.1 } },
        streamCallback,
      )
      if (this.debug) process.stderr.write(`[lupin] raw: ${raw.slice(0, 300)}\n`)

      let parsed
      try {
        parsed = normalizeShape(extractJsonObject(raw))
      } catch {
        if (this.debug) process.stderr.write(`[lupin] FORMAT_ERROR at step ${step}\n`)
        messages.push({ role: 'assistant', content: raw })
        messages.push({
          role: 'user',
          content:
            'FORMAT_ERROR: Return valid JSON only. Use {"type":"tool_call",...} or {"type":"final","content":"..."}.',
        })
        continue
      }

      if (isValidFinalShape(parsed)) {
        if (implementationTask && inspectionCount === 0 && !workspaceIsEmpty) {
          messages.push({ role: 'assistant', content: JSON.stringify(parsed) })
          messages.push({
            role: 'user',
            content:
              'WORKFLOW_ERROR: this implementation task requires inspection first. Use GlobTool, GrepTool, or FileReadTool before finishing.',
          })
          continue
        }

        if (implementationTask && hasEditedFiles && !hasVerifiedChanges) {
          messages.push({ role: 'assistant', content: JSON.stringify(parsed) })
          messages.push({
            role: 'user',
            content:
              'WORKFLOW_ERROR: you edited files but did not verify the result yet. Read the changed files and/or run a focused verification command before finishing.',
          })
          continue
        }

        const answer = isWeakFinalAnswer(parsed.content)
          ? buildWorkspaceFallback(workspaceContext)
          : parsed.content
        return {
          answer,
          transcript: messages,
          steps: step,
          inspectedFiles: [...inspectedFiles],
        }
      }

      if (isValidToolCallShape(parsed)) {
        if (this.debug) process.stderr.write(`[lupin] tool: ${parsed.tool} args: ${JSON.stringify(parsed.args).slice(0, 120)}\n`)
        onToolCall?.(parsed.tool, parsed.args || {})

        // Loop detection: same tool + same args 3 times in a row = stuck
        const callKey = `${parsed.tool}:${JSON.stringify(parsed.args)}`
        recentToolCalls.push(callKey)
        if (recentToolCalls.length > 3) recentToolCalls.shift()
        if (recentToolCalls.length === 3 && recentToolCalls.every(k => k === callKey)) {
          messages.push({ role: 'assistant', content: JSON.stringify(parsed) })
          messages.push({
            role: 'user',
            content: `LOOP_DETECTED: you called ${parsed.tool} with identical args 3 times. This approach is not working. Stop repeating it and use a completely different tool or approach to make progress.`,
          })
          recentToolCalls.length = 0
          continue
        }

        const result = await this.toolRuntime.execute(parsed.tool, parsed.args || {})
        if (isInspectionTool(parsed.tool)) {
          inspectionCount += 1
        }
        if ((parsed.tool === 'FileWriteTool' || parsed.tool === 'FileEditTool') && result?.ok) {
          hasEditedFiles = true
          if (result.result?.path) {
            changedFiles.add(String(result.result.path))
          }
        }
        if (parsed.tool === 'FileReadTool' && result?.ok) {
          const readPath = String(result.result?.path || '')
          if (readPath) inspectedFiles.add(readPath)
          if ([...changedFiles].some(file => file === readPath)) {
            hasVerifiedChanges = true
          }
        }
        if (parsed.tool === 'BashTool' && result?.ok && isVerificationBash(parsed.args?.command)) {
          hasVerifiedChanges = true
        }
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) })
        const toolResultContent = result?.ok
          ? `TOOL_RESULT ${parsed.tool}: ${JSON.stringify(result)}`
          : `TOOL_ERROR ${parsed.tool}: ${result?.error || 'unknown error'}. Fix the arguments and retry — do not give up.`
        messages.push({ role: 'user', content: toolResultContent })
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
          inspectedFiles: [...inspectedFiles],
        }
      }
    } catch {}

    return {
      answer:
        'I reached the step limit before finishing. Try refining the task or using /status to verify model connectivity.',
      transcript: messages,
      steps: this.maxSteps,
      inspectedFiles: [...inspectedFiles],
    }
  }
}
