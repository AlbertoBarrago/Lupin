#!/usr/bin/env node

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
import {
  formatWorkspaceSnapshot,
  initWorkspace,
  renderLupinMd,
} from './core/workspaceInit.mjs'

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

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

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
      '  /files [regex]              List files (optional regex filter)',
      '  /read <path>                Read a file directly',
      '  /grep <pattern> [--path p]  Search text directly',
      '  /bash <command>             Run shell command directly',
      '',
      'All input runs as a coding task.',
    ].join('\n'),
  )
}

function parseArgv(argv) {
  const args = argv.slice(2)
  const result = { help: false, init: false, context: false, task: null, model: null }
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

function normalizeUserInput(text) {
  return String(text || '')
    .replace(/^\s*assistant>\s*/i, '')
    .trim()
}

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
    tools: [BashTool, FileBatchReadTool, FileDeleteTool, FileEditTool, FileReadTool, FileWriteTool, GlobTool, GrepTool],
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
    sessionStore.appendWithMeta('user', flags.task, { kind: 'code', mode: 'code' })
    sessionStore.appendWithMeta('assistant', result.answer, { kind: 'code', mode: 'code' })
    await sessionStore.save()
    process.exit(0)
  }

  console.log(startupLogo)
  console.log('Lupin // local coding agent')
  console.log(`Workspace: ${config.projectRoot}`)
  console.log(`Git root: ${workspaceContext.gitRoot || 'not detected'}`)
  console.log(`Ollama: ${config.ollama.baseUrl} | model: ${config.ollama.model}`)
  console.log('Type /help to get started.')

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

  rl.on('line', line => {
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

        if (input === '/context') {
          console.log(`Workspace: ${config.projectRoot}`)
          console.log(`Git root: ${currentWorkspaceContext.gitRoot || 'not detected'}`)
          console.log(
            `Markers: ${
              currentWorkspaceContext.markers.length
                ? currentWorkspaceContext.markers.join(', ')
                : 'none'
            }`,
          )
          console.log(
            `README summary: ${currentWorkspaceContext.readmeSummary || 'not available'}`,
          )
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
          const payload = await toolRuntime.execute('FileReadTool', { path: filePath })
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
        const taskResult = await queryEngine.runTask(task, history)
        spinner.stop()
        const answer = taskResult.answer
        sessionStore.appendWithMeta('assistant', answer, { kind: 'code' })

        // Silently refresh snapshot when Lupin inspected files — keeps future prompts richer
        if (taskResult?.inspectedFiles?.length > 0) {
          currentSnapshot = initWorkspace(config.projectRoot, currentWorkspaceContext)
          queryEngine.setSnapshot(currentSnapshot)
        }

        console.log(answer)
        await sessionStore.save()
        safePrompt()
      })
      .catch(async error => {
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

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
