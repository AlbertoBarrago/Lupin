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
  constructor({ modelAdapter, toolRuntime, maxSteps = 12, debug = false }) {
    this.modelAdapter = modelAdapter
    this.toolRuntime = toolRuntime
    this.maxSteps = maxSteps
    this.debug = debug
  }

  async runTask(task, historyMessages = []) {
    const normalizedTask = normalizeTaskText(task)
    const workspaceContext = this.toolRuntime.getWorkspaceContext()
    const implementationTask = looksLikeImplementationTask(normalizedTask)
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

    if (implementationTask) {
      messages.push({
        role: 'user',
        content: buildImplementationWorkflowInstruction(),
      })
    }

    messages.push({ role: 'user', content: normalizedTask })

    let inspectionCount = 0
    let hasEditedFiles = false
    let hasVerifiedChanges = false
    const changedFiles = new Set()

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
        if (implementationTask && inspectionCount === 0) {
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
        }
      }

      if (isValidToolCallShape(parsed)) {
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
          if ([...changedFiles].some(file => file === readPath)) {
            hasVerifiedChanges = true
          }
        }
        if (parsed.tool === 'BashTool' && result?.ok && isVerificationBash(parsed.args?.command)) {
          hasVerifiedChanges = true
        }
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
