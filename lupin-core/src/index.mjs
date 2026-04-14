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
import { GlobTool } from './tools/GlobTool.mjs'
import { GrepTool } from './tools/GrepTool.mjs'
import {
  formatWorkspaceSnapshot,
  initWorkspace,
  renderLupinMd,
} from './core/workspaceInit.mjs'

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
      '  /model [name]               Get or set Ollama model',
      '  /health                     Check Ollama connectivity',
      '  /mode [code|chat|auto]      Get or set interaction mode',
      '  /ask <prompt>               Direct chat response (no tool loop)',
      '  /code <task>                Run coding task (tool loop)',
      '  /files [regex]              List files (optional regex filter)',
      '  /read <path>                Read a file directly',
      '  /grep <pattern> [--path p]  Search text directly',
      '  /bash <command>             Run shell command directly',
      '',
      'Default mode is code. Non-command input follows current mode.',
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

function detectCodingIntent(text) {
  const value = String(text || '').toLowerCase()
  return (
    value.includes('code') ||
    value.includes('project') ||
    value.includes('repository') ||
    value.includes('repo') ||
    value.includes('codebase') ||
    value.includes('file') ||
    value.includes('refactor') ||
    value.includes('debug') ||
    value.includes('fix') ||
    value.includes('implement') ||
    value.includes('search in repo') ||
    value.includes('grep') ||
    value.includes('bash') ||
    value.includes('function') ||
    value.includes('class') ||
    value.includes('typescript') ||
    value.includes('javascript') ||
    value.includes('python') ||
    value.includes('interesting') ||
    value.includes('good project') ||
    value.includes('why is this')
  )
}

function normalizeUserInput(text) {
  return String(text || '')
    .replace(/^\s*assistant>\s*/i, '')
    .trim()
}

function detectGreetingLanguage(text) {
  const value = String(text || '').trim().toLowerCase()
  if (
    /^(ciao|salve|ehi|hey|hola|buond[iì]|buonasera|buongiorno)([!. ]|$)/i.test(value)
  ) {
    return 'it'
  }
  if (/^(hi|hello|hey|yo|sup)([!. ]|$)/i.test(value)) {
    return 'en'
  }
  return null
}

function buildGreetingReply(text) {
  const lang = detectGreetingLanguage(text)
  if (lang === 'it') return 'Ciao. Dimmi pure cosa ti serve.'
  if (lang === 'en') return 'Hey. Tell me what you need.'
  return null
}

async function runChatReply(model, sessionStore, prompt, maxHistory) {
  const history = sessionStore.getModelHistory(maxHistory, { kinds: ['chat'] })
  const messages = [
    {
      role: 'system',
      content:
        'You are Lupin in chat mode inside a coding CLI. Answer clearly, directly, and practically in the user language. Be natural and conversational, not robotic. For simple greetings or casual messages, reply warmly and continue the conversation with one useful follow-up. Do not roleplay as a game, menu, or interactive fiction system. Do not emit help menus unless the user explicitly asks for help with commands. Keep replies concise, but avoid flat one-liners that add no value.',
    },
    ...history,
    { role: 'user', content: prompt },
  ]
  return model.chat(messages, { options: { temperature: 0.55 } })
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
    tools: [BashTool, FileEditTool, FileReadTool, FileWriteTool, GlobTool, GrepTool],
    securityConfig: config.security,
    debug: config.debug,
  })
  const queryEngine = new QueryEngine({
    modelAdapter: model,
    toolRuntime,
    maxSteps: config.agent.maxSteps,
    debug: config.debug,
  })
  const sessionStore = new SessionStore(APP_ROOT, config.projectRoot)
  await sessionStore.init()
  const workspaceContext = toolRuntime.getWorkspaceContext()

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
    const snapshot = initWorkspace(config.projectRoot, workspaceContext)
    const lupinMdPath = path.join(config.projectRoot, 'LUPIN.md')
    let previousContent = ''
    try {
      previousContent = await fs.promises.readFile(lupinMdPath, 'utf8')
    } catch {}
    const lupinMdContent = renderLupinMd(snapshot, previousContent)
    await fs.promises.writeFile(lupinMdPath, lupinMdContent + '\n', 'utf8')
    sessionStore.setWorkspaceSnapshot(snapshot)
    await sessionStore.save()
    console.log(`Initialized workspace instructions: ${lupinMdPath}`)
    console.log(formatWorkspaceSnapshot(snapshot))
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
  console.log(`Mode: ${config.agent.defaultMode}`)
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
  let mode = config.agent.defaultMode
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
          console.log(`Mode: ${mode}`)
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
          const snapshot = initWorkspace(config.projectRoot, currentWorkspaceContext)
          const lupinMdPath = path.join(config.projectRoot, 'LUPIN.md')
          let previousContent = ''
          try {
            previousContent = await fs.promises.readFile(lupinMdPath, 'utf8')
          } catch {}
          const lupinMdContent = renderLupinMd(snapshot, previousContent)
          await fs.promises.writeFile(lupinMdPath, lupinMdContent + '\n', 'utf8')
          sessionStore.setWorkspaceSnapshot(snapshot)
          currentWorkspaceContext = toolRuntime.refreshWorkspaceContext()
          await sessionStore.save()
          console.log(`Initialized workspace instructions: ${lupinMdPath}`)
          console.log(formatWorkspaceSnapshot(snapshot))
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

        if (input.startsWith('/mode')) {
          const value = input.replace(/^\/mode\s*/, '').trim().toLowerCase()
          if (!value) {
            console.log(`Current mode: ${mode}`)
            await sessionStore.save()
            safePrompt()
            return
          }
          if (!['code', 'chat', 'auto'].includes(value)) {
            console.log('Usage: /mode [code|chat|auto]')
            await sessionStore.save()
            safePrompt()
            return
          }
          mode = value
          console.log(`Mode set to: ${mode}`)
          await sessionStore.save()
          safePrompt()
          return
        }

        if (input.startsWith('/ask ')) {
          const prompt = input.slice('/ask '.length).trim()
          if (!prompt) {
            console.log('Usage: /ask <prompt>')
            await sessionStore.save()
            safePrompt()
            return
          }
          sessionStore.appendWithMeta('user', prompt, { kind: 'chat', mode: 'chat' })
          const answer = await runChatReply(
            model,
            sessionStore,
            prompt,
            config.agent.maxHistory,
          )
          sessionStore.appendWithMeta('assistant', answer, { kind: 'chat', mode: 'chat' })
          await sessionStore.save()
          console.log(answer)
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

        let answer
        if (input.startsWith('/code ')) {
          sessionStore.appendWithMeta('user', task, { kind: 'code', mode: 'code' })
          const history = sessionStore.getModelHistory(config.agent.maxHistory)
          const result = await queryEngine.runTask(task, history)
          answer = result.answer
          sessionStore.appendWithMeta('assistant', answer, { kind: 'code', mode: 'code' })
        } else if (mode === 'chat') {
          sessionStore.appendWithMeta('user', task, { kind: 'chat', mode: 'chat' })
          answer =
            buildGreetingReply(task) ||
            (await runChatReply(model, sessionStore, task, config.agent.maxHistory))
          sessionStore.appendWithMeta('assistant', answer, { kind: 'chat', mode: 'chat' })
        } else if (mode === 'auto') {
          if (detectCodingIntent(task)) {
            sessionStore.appendWithMeta('user', task, { kind: 'code', mode: 'auto' })
            const history = sessionStore.getModelHistory(config.agent.maxHistory)
            const result = await queryEngine.runTask(task, history)
            answer = result.answer
            sessionStore.appendWithMeta('assistant', answer, { kind: 'code', mode: 'auto' })
          } else {
            sessionStore.appendWithMeta('user', task, { kind: 'chat', mode: 'auto' })
            answer =
              buildGreetingReply(task) ||
              (await runChatReply(model, sessionStore, task, config.agent.maxHistory))
            sessionStore.appendWithMeta('assistant', answer, { kind: 'chat', mode: 'auto' })
            }
        } else {
          const greetingReply = buildGreetingReply(task)
          if (greetingReply) {
            sessionStore.appendWithMeta('user', task, { kind: 'chat', mode: 'code' })
            answer = greetingReply
            sessionStore.appendWithMeta('assistant', answer, { kind: 'chat', mode: 'code' })
            } else {
            sessionStore.appendWithMeta('user', task, { kind: 'code', mode: 'code' })
            const history = sessionStore.getModelHistory(config.agent.maxHistory)
            const result = await queryEngine.runTask(task, history)
            answer = result.answer
            sessionStore.appendWithMeta('assistant', answer, { kind: 'code', mode: 'code' })
          }
        }
        console.log(answer)
        await sessionStore.save()
        safePrompt()
      })
      .catch(async error => {
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
