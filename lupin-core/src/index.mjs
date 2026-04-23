#!/usr/bin/env node
/**
 * @module index
 * CLI entry point for Lupin. Handles argument parsing, interactive REPL loop,
 * slash command dispatch, streaming task execution, and session persistence.
 */

import fs from 'node:fs'
import readline from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'
import { OllamaAdapter } from './model/ollamaAdapter.mjs'
import { ToolRuntime } from './core/toolRuntime.mjs'
import { QueryEngine } from './core/queryEngine.mjs'
import { SessionStore } from './storage/sessionStore.mjs'
import { BashTool } from './tools/BashTool.mjs'
import { FileEditTool } from './tools/FileEditTool.mjs'
import { FileReadTool } from './tools/FileReadTool.mjs'
import { FileWriteTool } from './tools/FileWriteTool.mjs'
import { FileBatchReadTool } from './tools/FileBatchReadTool.mjs'
import { FileDeleteTool } from './tools/FileDeleteTool.mjs'
import { GlobTool } from './tools/GlobTool.mjs'
import { GrepTool } from './tools/GrepTool.mjs'
import { WebFetchTool } from './tools/WebFetchTool.mjs'
import { WebSearchTool } from './tools/WebSearchTool.mjs'
import { formatWorkspaceSnapshot, initWorkspace, renderLupinMd } from './core/workspaceInit.mjs'

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
}

/**
 * Maps a tool name and its arguments to a short, human-readable label
 * suitable for display in the spinner or progress output.
 *
 * @param {string} toolName - The name of the tool being invoked.
 * @param {object} args - The arguments passed to the tool.
 * @param {string} [args.path] - File path (used by file tools).
 * @param {string} [args.pattern] - Glob or grep pattern.
 * @param {string} [args.command] - Shell command string (used by BashTool).
 * @param {string} [args.query] - Search query string (used by WebSearchTool).
 * @param {string} [args.url] - URL to fetch (used by WebFetchTool).
 * @returns {string} A short label string, or the raw `toolName` if no mapping exists.
 */
function formatToolLabel(toolName, args) {
  const short = {
    FileWriteTool: () => `writing ${args?.path || ''}`,
    FileEditTool: () => `editing ${args?.path || ''}`,
    FileReadTool: () => `reading ${args?.path || ''}`,
    FileDeleteTool: () => `deleting ${args?.path || ''}`,
    FileBatchReadTool: () => `reading ${args?.pattern || ''}`,
    GlobTool: () => `scanning files`,
    GrepTool: () => `searching ${args?.pattern || ''}`,
    BashTool: () => `$ ${String(args?.command || '').slice(0, 40)}`,
    WebSearchTool: () => `searching web: ${String(args?.query || '').slice(0, 40)}`,
    WebFetchTool: () => `fetching ${String(args?.url || '').slice(0, 50)}`,
  }
  return short[toolName]?.() ?? toolName
}

/**
 * Formats a raw token count into a compact human-readable string.
 * Values >= 1000 are rendered as `"1.2k"`; smaller values are stringified as-is.
 *
 * @param {number} n - The token count to format.
 * @returns {string} Formatted token count string.
 */
function fmtTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/**
 * Prints a color-coded diff of a file write or edit operation to stdout.
 * For `FileWriteTool`, shows up to 12 lines of the new content with `+` prefixes.
 * For `FileEditTool`, shows old lines in red (`-`) and new lines in green (`+`),
 * handling both line-range mode and text-match mode.
 * No-ops when `process.stdout.isTTY` is falsy or when the tool result indicates failure.
 *
 * @param {string} toolName - Either `'FileWriteTool'` or `'FileEditTool'`.
 * @param {object} args - Arguments passed to the tool.
 * @param {string} [args.path] - Target file path.
 * @param {string} [args.content] - New file content (FileWriteTool).
 * @param {string} [args.oldText] - Text being replaced (FileEditTool text-match mode).
 * @param {string} [args.newText] - Replacement text (FileEditTool).
 * @param {number} [args.lineStart] - Start line of range edit (FileEditTool line-range mode).
 * @param {number} [args.lineEnd] - End line of range edit (FileEditTool line-range mode).
 * @param {object} result - The tool execution result payload.
 * @param {boolean} result.ok - Whether the tool succeeded.
 * @returns {void}
 */
function renderEditDiff(toolName, args, result) {
  if (!process.stdout.isTTY) return
  if (!result?.ok) return

  const filePath = args?.path || result?.result?.path || ''

  if (toolName === 'FileWriteTool') {
    const content = String(args?.content || '')
    const lines = content.split('\n').slice(0, 12)
    const truncated = content.split('\n').length > 12
    console.log(`\n${C.cyan}  + ${filePath}${C.reset}`)
    for (const line of lines) {
      console.log(`${C.green}  + ${line}${C.reset}`)
    }
    if (truncated) console.log(`${C.dim}  + ...${C.reset}`)
    return
  }

  if (toolName === 'FileEditTool') {
    // Line-range mode
    if (args?.lineStart != null && args?.lineEnd != null) {
      const newLines = String(args?.newText ?? '').split('\n')
      console.log(`\n${C.cyan}  ✏  ${filePath}${C.reset}${C.dim}  @@ lines ${args.lineStart}–${args.lineEnd} @@${C.reset}`)
      for (const line of newLines.slice(0, 10)) {
        console.log(`${C.green}  + ${line}${C.reset}`)
      }
      if (newLines.length > 10) console.log(`${C.dim}  + ...${C.reset}`)
      return
    }

    // Text-match mode
    if (args?.oldText != null) {
      const oldLines = String(args.oldText).split('\n')
      const newLines = String(args.newText ?? '').split('\n')
      console.log(`\n${C.cyan}  ✏  ${filePath}${C.reset}`)
      for (const line of oldLines.slice(0, 6)) {
        console.log(`${C.red}  - ${line}${C.reset}`)
      }
      if (oldLines.length > 6) console.log(`${C.dim}  - ...${C.reset}`)
      for (const line of newLines.slice(0, 6)) {
        console.log(`${C.green}  + ${line}${C.reset}`)
      }
      if (newLines.length > 6) console.log(`${C.dim}  + ...${C.reset}`)
    }
  }
}

/**
 * Prints a timing and token-usage footer line to stdout after a task completes.
 * No-ops when `process.stdout.isTTY` is falsy.
 *
 * @param {number} elapsedMs - Wall-clock time for the task in milliseconds.
 * @param {{ promptTokens?: number, completionTokens?: number } | undefined} tokenStats
 *   Aggregated token counts from the agentic loop.
 * @returns {void}
 */
function renderStatsLine(elapsedMs, tokenStats) {
  if (!process.stdout.isTTY) return
  const secs = (elapsedMs / 1000).toFixed(1)
  const prompt = fmtTokens(tokenStats?.promptTokens ?? 0)
  const completion = fmtTokens(tokenStats?.completionTokens ?? 0)
  console.log(`\n${C.dim}⏱  ${secs}s  ·  ↑${prompt} prompt  ↓${completion} completion${C.reset}`)
}

/**
 * Creates a terminal spinner that writes animated Braille frames to stdout.
 * All methods are safe to call when `process.stdout.isTTY` is falsy — they
 * become no-ops in that case.
 *
 * @param {string} [label='thinking'] - Default label shown next to the spinner frame.
 * @returns {{
 *   start:  (text?: string) => void,
 *   update: (text: string) => void,
 *   stop:   () => void
 * }} Spinner control object:
 *   - `start(text?)` — hides the cursor and begins the animation interval;
 *     falls back to `label` if `text` is omitted.
 *   - `update(text)` — overwrites the current spinner line with a new label
 *     without restarting the interval.
 *   - `stop()` — cancels the interval, clears the spinner line, and restores
 *     the cursor.
 */
function createSpinner(label = 'thinking') {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let i = 0
  let interval = null
  return {
    start(text = label) {
      if (!process.stdout.isTTY) return
      process.stdout.write('\x1b[?25l') // hide cursor
      interval = setInterval(() => {
        process.stdout.write(`\r\x1b[38;5;245m${frames[i++ % frames.length]} ${text}\x1b[0m`)
      }, 80)
    },
    update(text) {
      if (!process.stdout.isTTY || !interval) return
      process.stdout.write(`\r\x1b[38;5;245m${frames[i % frames.length]} ${text}\x1b[0m`)
    },
    stop() {
      if (!interval) return
      clearInterval(interval)
      interval = null
      process.stdout.write('\r\x1b[2K') // clear line
      process.stdout.write('\x1b[?25h') // show cursor
    },
  }
}

/**
 * Writes a fresh LUPIN.md to `projectRoot`, or updates it in place if one
 * already exists, by rendering the provided workspace snapshot via
 * `renderLupinMd`. Any previous content is passed to `renderLupinMd` so it
 * can perform incremental updates.
 *
 * @param {string} projectRoot - Absolute path to the project root directory.
 * @param {object} snapshot - Workspace snapshot produced by `workspaceInit.mjs`.
 * @returns {Promise<string>} Resolves with the absolute path to the written LUPIN.md file.
 */
async function writeOrRefreshLupinMd(projectRoot, snapshot) {
  const lupinMdPath = path.join(projectRoot, 'LUPIN.md')
  let previousContent = ''
  try {
    previousContent = await fs.promises.readFile(lupinMdPath, 'utf8')
  } catch {}
  const lupinMdContent = renderLupinMd(snapshot, previousContent)
  await fs.promises.writeFile(lupinMdPath, lupinMdContent + '\n', 'utf8')
  return lupinMdPath
}

const STARTUP_LOGOS = [
  [
    ' _    _   _ ____ ___ _   _ ',
    '| |  | | | |  _ \\_ _| \\ | |',
    '| |  | | | | |_) | ||  \\| |',
    '| |__| |_| |  __/| || |\\  |',
    '|_____\\___/|_|  |___|_| \\_|',
  ].join('\n'),
  [
    ' _    _   _ ____ ___ _   _ ',
    '| |  | | | |  _ \\_ _| \\ | |',
    '| |  | | | | |_) | ||  \\| |',
    '| |__| |_| |  __/| || |\\  |',
    '|_____\\___/|_|  |___|_| \\_|',
  ].join('\n'),
]

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const PROMPT = '\x1b[38;5;245m>\x1b[0m '

/**
 * Returns a uniformly random element from the given array.
 *
 * @template T
 * @param {T[]} list - The array to pick from.
 * @returns {T} A random element.
 */
function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

/**
 * Prints the CLI usage help text to stdout, covering both command-line flags
 * and interactive slash commands.
 *
 * @returns {void}
 */
function printHelp() {
  console.log(
    [
      'Usage: lupin [options]',
      '',
      'Options:',
      '  --help                      Show this help and exit',
      '  --init                      Analyze workspace, write LUPIN.md, and exit',
      '  --context                   Print workspace context and exit',
      '  --task <prompt>             Run a single task non-interactively and exit',
      '  --model <name>              Override the Ollama model for this run',
      '',
      'Interactive commands:',
      '  /help                       Show this help',
      '  /exit                       Exit',
      '  /status                     Show model/workspace status',
      '  /context                    Show repo context and loaded instruction files',
      '  /init                       Analyze workspace and create/update LUPIN.md',
      '  /refresh                    Re-analyze workspace and update LUPIN.md if it exists',
      '  /model [name]               Get or set Ollama model',
      '  /health                     Check Ollama connectivity',
      '  /code <task>                Run a task explicitly',
      '  /debug                      Show tool calls, files, and token stats from last task',
      '  /files [regex]              List files (optional regex filter)',
      '  /read <path>                Read a file directly',
      '  /grep <pattern> [--path p]  Search text directly',
      '  /bash <command>             Run shell command directly',
      '',
      'All input runs as a coding task.',
    ].join('\n'),
  )
}

/**
 * Parses a `process.argv`-style argument vector into a structured flags object.
 * Supports `--help` / `-h`, `--init`, `--context`, `--task <value>`, and
 * `--model <value>`.
 *
 * @param {string[]} argv - The raw argument vector (typically `process.argv`).
 * @returns {{ help: boolean, init: boolean, context: boolean, task: string|null, model: string|null }}
 *   Parsed flags object.
 */
function parseArgv(argv) {
  const args = argv.slice(2)
  const result = {
    help: false,
    init: false,
    context: false,
    task: null,
    model: null,
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      result.help = true
    } else if (args[i] === '--init') {
      result.init = true
    } else if (args[i] === '--context') {
      result.context = true
    } else if (args[i] === '--task' && args[i + 1]) {
      result.task = args[++i]
    } else if (args[i] === '--model' && args[i + 1]) {
      result.model = args[++i]
    }
  }
  return result
}

/**
 * Strips a leading `"assistant>"` prefix (case-insensitive) from user input
 * and trims surrounding whitespace. Guards against accidental echo of the
 * REPL prompt being pasted back into the input.
 *
 * @param {string} text - Raw input string from the user.
 * @returns {string} Cleaned input string.
 */
function normalizeUserInput(text) {
  return String(text || '')
    .replace(/^\s*assistant>\s*/i, '')
    .trim()
}

/**
 * Formats a raw tool result payload into a human-readable string for direct
 * CLI display (i.e. outside the agentic loop, e.g. via `/read` or `/grep`).
 *
 * Handles the following result shapes:
 * - `{ files: string[] }` — prints one file path per line.
 * - `{ content: string, path?, truncated? }` — prints file content with an
 *   optional path header and truncation notice.
 * - `{ matches: string[] }` — prints one match per line.
 * - `{ stdout?: string, stderr?: string }` — prints command output.
 * - Anything else — pretty-printed JSON fallback.
 *
 * @param {{ ok: boolean, error?: string, result?: object } | undefined} payload
 *   The raw payload returned by `ToolRuntime.execute`.
 * @returns {string} Human-readable string ready to be passed to `console.log`.
 */
function renderDirectToolResult(payload) {
  if (!payload?.ok) {
    return `Tool error: ${payload?.error || 'unknown error'}`
  }
  const result = payload.result
  if (!result || typeof result !== 'object') {
    return JSON.stringify(payload, null, 2)
  }

  if (Array.isArray(result.files)) {
    if (result.files.length === 0) return 'No files found.'
    return result.files.join('\n')
  }
  if (typeof result.content === 'string') {
    const header = result.path ? `# ${result.path}\n` : ''
    const suffix = result.truncated ? '\n\n[truncated output]' : ''
    return `${header}${result.content}${suffix}`
  }
  if (Array.isArray(result.matches)) {
    if (result.matches.length === 0) return 'No matches found.'
    return result.matches.join('\n')
  }
  if (typeof result.stdout === 'string' || typeof result.stderr === 'string') {
    const out = String(result.stdout || '').trim()
    const err = String(result.stderr || '').trim()
    if (!out && !err) return '(command completed with no output)'
    return [out, err && `stderr:\n${err}`].filter(Boolean).join('\n')
  }

  return JSON.stringify(result, null, 2)
}

/**
 * Parses the argument string that follows a `/grep` slash command into a
 * structured object containing the search pattern and an optional path.
 *
 * Syntax: `<pattern> [--path <path>]`
 *
 * @param {string} raw - The raw text after `/grep ` has been stripped.
 * @returns {{ pattern: string, path: string } | { error: string }}
 *   On success: `{ pattern, path }` where `path` defaults to `'.'`.
 *   On failure: `{ error }` with a usage hint string.
 */
function parseGrepInput(raw) {
  const text = String(raw || '').trim()
  if (!text) return { error: 'Usage: /grep <pattern> [--path <path>]' }
  const marker = ' --path '
  const idx = text.indexOf(marker)
  if (idx === -1) {
    return { pattern: text, path: '.' }
  }
  const pattern = text.slice(0, idx).trim()
  const path = text.slice(idx + marker.length).trim() || '.'
  if (!pattern) return { error: 'Usage: /grep <pattern> [--path <path>]' }
  return { pattern, path }
}

/**
 * CLI entry point for Lupin. Responsibilities:
 * - Parses argv flags and handles `--help`, `--context`, `--init`, and
 *   `--task` non-interactive modes.
 * - Initializes all subsystems: `OllamaAdapter`, `ToolRuntime`, `SessionStore`,
 *   `QueryEngine`, and workspace context.
 * - Starts the interactive readline REPL loop and dispatches slash commands
 *   (`/help`, `/exit`, `/status`, `/context`, `/init`, `/refresh`, `/model`,
 *   `/health`, `/files`, `/read`, `/grep`, `/bash`, `/code`).
 * - For regular task input, runs `QueryEngine.runTask` with streaming callbacks,
 *   spinner feedback, edit diffs, and stats footer, then persists the session.
 *
 * @returns {Promise<void>} Resolves when the process is ready to exit (non-interactive
 *   modes) or never resolves (interactive REPL — process exits via `rl.close`).
 */
async function main() {
  const flags = parseArgv(process.argv)

  if (flags.help) {
    printHelp()
    process.exit(0)
  }

  const config = loadConfig()
  if (flags.model) {
    config.ollama.model = flags.model
  }
  const startupLogo = pickRandom(STARTUP_LOGOS)

  const model = new OllamaAdapter(config.ollama)
  const toolRuntime = new ToolRuntime({
    projectRoot: config.projectRoot,
    tools: [
      BashTool,
      FileBatchReadTool,
      FileDeleteTool,
      FileEditTool,
      FileReadTool,
      FileWriteTool,
      GlobTool,
      GrepTool,
      WebFetchTool,
      WebSearchTool,
    ],
    securityConfig: config.security,
    debug: config.debug,
  })
  const sessionStore = new SessionStore(APP_ROOT, config.projectRoot)
  await sessionStore.init()
  const workspaceContext = toolRuntime.getWorkspaceContext()
  let currentSnapshot = initWorkspace(config.projectRoot, workspaceContext)
  const queryEngine = new QueryEngine({
    modelAdapter: model,
    toolRuntime,
    maxSteps: config.agent.maxSteps,
    debug: config.debug,
    initSnapshot: currentSnapshot,
  })

  // --context: print workspace context and exit
  if (flags.context) {
    console.log(`Workspace: ${config.projectRoot}`)
    console.log(`Git root: ${workspaceContext.gitRoot || 'not detected'}`)
    console.log(`Markers: ${workspaceContext.markers.length ? workspaceContext.markers.join(', ') : 'none'}`)
    console.log(`README summary: ${workspaceContext.readmeSummary || 'not available'}`)
    console.log('Top-level entries:')
    for (const entry of workspaceContext.topLevel.slice(0, 16)) {
      console.log(`- ${entry}`)
    }
    console.log('Instruction files:')
    if (workspaceContext.instructionFiles?.length) {
      for (const file of workspaceContext.instructionFiles) {
        console.log(`- ${file.path}`)
      }
    } else {
      console.log('- none')
    }
    process.exit(0)
  }

  // --init: write LUPIN.md and exit
  if (flags.init) {
    const lupinMdPath = await writeOrRefreshLupinMd(config.projectRoot, currentSnapshot)
    sessionStore.setWorkspaceSnapshot(currentSnapshot)
    await sessionStore.save()
    console.log(`Initialized workspace instructions: ${lupinMdPath}`)
    console.log(formatWorkspaceSnapshot(currentSnapshot))
    process.exit(0)
  }

  // --task: run single task non-interactively and exit
  if (flags.task) {
    const history = sessionStore.getModelHistory(config.agent.maxHistory)
    const result = await queryEngine.runTask(flags.task, history)
    console.log(result.answer)
    sessionStore.appendWithMeta('user', flags.task, {
      kind: 'code',
      mode: 'code',
    })
    sessionStore.appendWithMeta('assistant', result.answer, {
      kind: 'code',
      mode: 'code',
    })
    await sessionStore.save()
    process.exit(0)
  }

  console.log(startupLogo)
  console.log('Lupin // local coding agent')
  console.log(`Workspace: ${config.projectRoot}`)
  console.log(`Git root: ${workspaceContext.gitRoot || 'not detected'}`)
  console.log(`Ollama: ${config.ollama.baseUrl} | model: ${config.ollama.model}`)
  console.log('Type /help to get started.')

  // Non-blocking startup healthcheck — warn immediately if Ollama is down
  model.healthcheck().then((ok) => {
    if (!ok) {
      console.log(`${C.yellow}⚠  Ollama unreachable at ${config.ollama.baseUrl}${C.reset}`)
      console.log(`${C.dim}   Run: ollama serve && ollama pull ${config.ollama.model}${C.reset}`)
    }
  }).catch(() => {})

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
  })
  let isClosed = false
  const safePrompt = () => {
    if (!isClosed) rl.prompt()
  }
  rl.on('close', () => {
    isClosed = true
  })
  safePrompt()

  let queue = Promise.resolve()
  let currentWorkspaceContext = workspaceContext
  let lastTaskResult = null
  let lupinMdProposalShown = false

  rl.on('line', (line) => {
    queue = queue
      .then(async () => {
        const input = normalizeUserInput(line)
        if (!input) {
          safePrompt()
          return
        }

        if (input === '/help') {
          printHelp()
          await sessionStore.save()
          safePrompt()
          return
        }

        if (input === '/exit' || input === '/quit') {
          await sessionStore.save()
          console.log('Session closed.')
          rl.close()
          return
        }

        if (input === '/status') {
          console.log(`Workspace: ${config.projectRoot}`)
          console.log(`Git root: ${currentWorkspaceContext.gitRoot || 'not detected'}`)
          console.log(`Ollama URL: ${model.baseUrl}`)
          console.log(`Model: ${model.model}`)
          console.log(`Max steps: ${config.agent.maxSteps}`)
          const snapshot = sessionStore.getWorkspaceSnapshot()
          if (snapshot) {
            console.log(formatWorkspaceSnapshot(snapshot))
          }
          await sessionStore.save()
          safePrompt()
          return
        }

        if (input === '/debug') {
          if (!lastTaskResult) {
            console.log('No task run yet this session.')
          } else {
            const r = lastTaskResult
            console.log(`Steps: ${r.steps}`)
            console.log(`Tools used: ${r.toolLog.length}`)
            if (r.toolLog.length > 0) {
              for (const entry of r.toolLog) {
                const argSummary = entry.args.path || entry.args.command?.slice(0, 40) || entry.args.query?.slice(0, 40) || entry.args.pattern || ''
                const status = entry.ok ? `${C.green}ok${C.reset}` : `${C.red}fail${C.reset}`
                console.log(`  step ${entry.step}: ${entry.tool}(${argSummary}) → ${status}`)
              }
            }
            if (r.inspectedFiles.length > 0) {
              console.log(`Inspected: ${r.inspectedFiles.join(', ')}`)
            }
            if (r.changedFiles.length > 0) {
              console.log(`Changed: ${r.changedFiles.join(', ')}`)
            }
            console.log(`Tokens: ↑${fmtTokens(r.tokenStats?.promptTokens ?? 0)} prompt  ↓${fmtTokens(r.tokenStats?.completionTokens ?? 0)} completion`)
          }
          safePrompt()
          return
        }

        if (input === '/context') {
          console.log(`Workspace: ${config.projectRoot}`)
          console.log(`Git root: ${currentWorkspaceContext.gitRoot || 'not detected'}`)
          console.log(`Markers: ${currentWorkspaceContext.markers.length ? currentWorkspaceContext.markers.join(', ') : 'none'}`)
          console.log(`README summary: ${currentWorkspaceContext.readmeSummary || 'not available'}`)
          console.log('Top-level entries:')
          for (const entry of currentWorkspaceContext.topLevel.slice(0, 16)) {
            console.log(`- ${entry}`)
          }
          console.log('Instruction files:')
          if (currentWorkspaceContext.instructionFiles?.length) {
            for (const file of currentWorkspaceContext.instructionFiles) {
              console.log(`- ${file.path}`)
            }
          } else {
            console.log('- none')
          }
          await sessionStore.save()
          safePrompt()
          return
        }

        if (input === '/init') {
          currentSnapshot = initWorkspace(config.projectRoot, currentWorkspaceContext)
          const lupinMdPath = await writeOrRefreshLupinMd(config.projectRoot, currentSnapshot)
          queryEngine.setSnapshot(currentSnapshot)
          sessionStore.setWorkspaceSnapshot(currentSnapshot)
          currentWorkspaceContext = toolRuntime.refreshWorkspaceContext()
          await sessionStore.save()
          console.log(`Initialized workspace instructions: ${lupinMdPath}`)
          console.log(formatWorkspaceSnapshot(currentSnapshot))
          safePrompt()
          return
        }

        if (input === '/refresh') {
          currentSnapshot = initWorkspace(config.projectRoot, currentWorkspaceContext)
          queryEngine.setSnapshot(currentSnapshot)
          const lupinMdPath = path.join(config.projectRoot, 'LUPIN.md')
          const lupinMdExists = fs.existsSync(lupinMdPath)
          if (lupinMdExists) {
            await writeOrRefreshLupinMd(config.projectRoot, currentSnapshot)
            currentWorkspaceContext = toolRuntime.refreshWorkspaceContext()
            await sessionStore.save()
            console.log(`Refreshed snapshot and updated ${lupinMdPath}`)
          } else {
            await sessionStore.save()
            console.log('Snapshot refreshed. Run /init to generate LUPIN.md.')
          }
          safePrompt()
          return
        }

        if (input.startsWith('/model')) {
          const nextModel = input.replace(/^\/model\s*/, '').trim()
          if (!nextModel) {
            console.log(`Current model: ${model.model}`)
          } else {
            model.setModel(nextModel)
            console.log(`Model set to: ${model.model}`)
          }
          await sessionStore.save()
          safePrompt()
          return
        }

        if (input === '/health') {
          const ok = await model.healthcheck()
          console.log(ok ? 'Ollama is reachable.' : 'Ollama is unreachable.')
          await sessionStore.save()
          safePrompt()
          return
        }

        if (input.startsWith('/files')) {
          const pattern = input.replace(/^\/files\s*/, '').trim()
          const payload = await toolRuntime.execute('GlobTool', {
            pattern: pattern || undefined,
          })
          console.log(renderDirectToolResult(payload))
          await sessionStore.save()
          safePrompt()
          return
        }

        if (input.startsWith('/read ')) {
          const filePath = input.replace(/^\/read\s+/, '').trim()
          if (!filePath) {
            console.log('Usage: /read <path>')
            await sessionStore.save()
            safePrompt()
            return
          }
          const payload = await toolRuntime.execute('FileReadTool', {
            path: filePath,
          })
          console.log(renderDirectToolResult(payload))
          await sessionStore.save()
          safePrompt()
          return
        }

        if (input.startsWith('/grep ')) {
          const parsed = parseGrepInput(input.replace(/^\/grep\s+/, ''))
          if (parsed.error) {
            console.log(parsed.error)
            await sessionStore.save()
            safePrompt()
            return
          }
          const payload = await toolRuntime.execute('GrepTool', {
            pattern: parsed.pattern,
            path: parsed.path,
          })
          console.log(renderDirectToolResult(payload))
          await sessionStore.save()
          safePrompt()
          return
        }

        if (input.startsWith('/bash ')) {
          const command = input.replace(/^\/bash\s+/, '').trim()
          if (!command) {
            console.log('Usage: /bash <command>')
            await sessionStore.save()
            safePrompt()
            return
          }
          const payload = await toolRuntime.execute('BashTool', { command })
          console.log(renderDirectToolResult(payload))
          await sessionStore.save()
          safePrompt()
          return
        }

        const task = input.startsWith('/code ') ? input.slice('/code '.length).trim() : input
        if (!task) {
          console.log('Usage: /code <task>')
          await sessionStore.save()
          safePrompt()
          return
        }

        const spinner = createSpinner()
        sessionStore.appendWithMeta('user', task, { kind: 'code' })
        const history = sessionStore.getModelHistory(config.agent.maxHistory)
        spinner.start('working')

        const taskStart = Date.now()
        let streamingActive = false
        let toolStepCount = 0

        const onFinalToken = (event) => {
          if (event.type === 'start') {
            spinner.stop()
            streamingActive = true
            process.stdout.write('\n')
          } else if (event.type === 'token') {
            process.stdout.write(event.value)
          }
        }

        const onToolCall = (toolName, args) => {
          if (!process.stdout.isTTY) return
          toolStepCount++
          const label = formatToolLabel(toolName, args)
          spinner.update(`${label} (${toolStepCount})`)
        }

        const onToolResult = (toolName, args, result) => {
          if (!result?.ok && process.stdout.isTTY) {
            spinner.stop()
            const errSnippet = String(result?.error || 'failed').split('\n')[0].slice(0, 80)
            console.log(`${C.red}  ✗ ${formatToolLabel(toolName, args)}: ${errSnippet}${C.reset}`)
            spinner.start('retrying')
            return
          }
          if (toolName === 'FileEditTool' || toolName === 'FileWriteTool') {
            spinner.stop()
            renderEditDiff(toolName, args, result)
            spinner.start(formatToolLabel(toolName, args))
          }
        }

        const taskResult = await queryEngine.runTask(task, history, {
          onFinalToken,
          onToolCall,
          onToolResult,
        })
        const elapsed = Date.now() - taskStart
        spinner.stop()

        lastTaskResult = taskResult
        const answer = taskResult.answer
        sessionStore.appendWithMeta('assistant', answer, { kind: 'code' })

        // Silently refresh snapshot when Lupin inspected files
        if (taskResult?.inspectedFiles?.length > 0) {
          currentSnapshot = initWorkspace(config.projectRoot, currentWorkspaceContext)
          queryEngine.setSnapshot(currentSnapshot)
        }

        if (streamingActive) {
          process.stdout.write('\n')
        } else {
          console.log(answer)
        }

        renderStatsLine(elapsed, taskResult.tokenStats)

        // Propose /init once per session when files were inspected and LUPIN.md exists
        if (
          !lupinMdProposalShown &&
          taskResult.inspectedFiles.length > 0 &&
          fs.existsSync(path.join(config.projectRoot, 'LUPIN.md'))
        ) {
          lupinMdProposalShown = true
          console.log(`${C.dim}  hint: files inspected — run /init to update LUPIN.md${C.reset}`)
        }
        await sessionStore.save()
        safePrompt()
      })
      .catch(async (error) => {
        // Ensure spinner is cleared on unexpected errors
        process.stdout.write('\r\x1b[2K\x1b[?25h')
        console.log(`Error: ${String(error?.message || error)}`)
        try {
          await sessionStore.save()
        } catch {}
        safePrompt()
      })
  })
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
