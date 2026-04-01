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
import { FileReadTool } from './tools/FileReadTool.mjs'
import { FileWriteTool } from './tools/FileWriteTool.mjs'
import { GlobTool } from './tools/GlobTool.mjs'
import { GrepTool } from './tools/GrepTool.mjs'
import {
  formatWorkspaceSnapshot,
  initWorkspace,
  renderLupinMd,
} from './core/workspaceInit.mjs'
import {
  ambientLine,
  applyAction,
  formatCompanionStatus,
  hatchCompanion,
  renameCompanion,
  setMuted,
  tickCompanion,
} from './mg/companion.mjs'

const STARTUP_LOGOS = [
  [
    ' _    _   _ ____ ___ _   _ ',
    '| |  | | | |  _ \\_ _| \\ | |',
    '| |  | | | | |_) | ||  \\| |',
    '| |__| |_| |  __/| || |\\  |',
    '|_____\\___/|_|  |___|_| \\_|',
  ].join('\n'),
  [
    ' _    _   _ ____ ___ _   _   CLI ',
    '| |  | | | |  _ \\_ _| \\ | | / _ \\',
    '| |  | | | | |_) | ||  \\| || | | |',
    '| |__| |_| |  __/| || |\\  || |_| |',
    '|_____\\___/|_|  |___|_| \\_| \\___/ ',
  ].join('\n'),
]

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function printHelp() {
  console.log(
    [
      'Commands:',
      '/help                       Show this help',
      '/exit                       Exit',
      '/status                     Show model/workspace status',
      '/context                    Show repo context and loaded instruction files',
      '/init                       Analyze workspace and create/update LUPIN.md',
      '/model [name]               Get or set Ollama model',
      '/health                     Check Ollama connectivity',
      '/mode [code|chat|auto]      Get or set interaction mode',
      '/ask <prompt>               Direct chat response (no tool loop)',
      '/code <task>                Run coding task (tool loop)',
      '/files [regex]              List files (optional regex filter)',
      '/read <path>                Read a file directly',
      '/grep <pattern> [--path p]  Search text directly',
      '/bash <command>             Run shell command directly',
      '/mg ...                     Buddy-like companion mode',
      '',
      'Default mode is code. Non-command input follows current mode.',
    ].join('\n'),
  )
}

function printMgHelp() {
  console.log(
    [
      'MG commands:',
      '/mg help                    Show this help',
      '/mg hatch <name>            Create your companion',
      '/mg status                  Show companion stats',
      '/mg feed                    Feed companion',
      '/mg play                    Play with companion',
      '/mg nap                     Recover companion energy',
      '/mg pet                     Give affection boost',
      '/mg rename <name>           Rename companion',
      '/mg mute on|off             Toggle ambient companion lines',
      '/mg say                     Force one ambient line',
    ].join('\n'),
  )
}

function detectCodingIntent(text) {
  const value = String(text || '').toLowerCase()
  return (
    value.includes('code') ||
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
    value.includes('python')
  )
}

async function runChatReply(model, sessionStore, prompt, maxHistory) {
  const history = sessionStore.getModelHistory(maxHistory)
  const messages = [
    {
      role: 'system',
      content:
        'You are a concise assistant in a coding CLI. Answer clearly and practically in the user language.',
    },
    ...history,
    { role: 'user', content: prompt },
  ]
  return model.chat(messages, { options: { temperature: 0.4 } })
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
  const config = loadConfig()
  const startupLogo = pickRandom(STARTUP_LOGOS)

  const model = new OllamaAdapter(config.ollama)
  const toolRuntime = new ToolRuntime({
    projectRoot: config.projectRoot,
    tools: [BashTool, FileReadTool, FileWriteTool, GlobTool, GrepTool],
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
    prompt: 'assistant> ',
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
        const input = String(line || '').trim()
        if (!input) {
          safePrompt()
          return
        }

        sessionStore.append('user', input)

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
          const mg = tickCompanion(sessionStore.getMgCompanion())
          sessionStore.setMgCompanion(mg)
          console.log(`MG: ${mg ? `${mg.name} (${mg.species}, lvl ${mg.level})` : 'not hatched'}`)
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
          const answer = await runChatReply(
            model,
            sessionStore,
            prompt,
            config.agent.maxHistory,
          )
          sessionStore.append('assistant', answer)
          const mgTicked = tickCompanion(sessionStore.getMgCompanion())
          sessionStore.setMgCompanion(mgTicked)
          await sessionStore.save()
          console.log(answer)
          const extra = ambientLine(sessionStore.getMgCompanion())
          if (extra && Math.random() < 0.35) {
            console.log(`[mg] ${extra}`)
          }
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

        if (input.startsWith('/mg')) {
          const raw = input.replace(/^\/mg\s*/, '').trim()
          const [sub, ...tail] = raw.split(/\s+/)
          const companion = tickCompanion(sessionStore.getMgCompanion())
          sessionStore.setMgCompanion(companion)

          if (!sub || sub === 'help') {
            printMgHelp()
            await sessionStore.save()
            safePrompt()
            return
          }

          if (sub === 'hatch') {
            const name = tail.join(' ').trim() || 'Lupin'
            const next = hatchCompanion(name, config.projectRoot)
            sessionStore.setMgCompanion(next)
            await sessionStore.save()
            console.log(
              `Companion hatched: ${next.name} the ${next.species} (${next.rarity})`,
            )
            safePrompt()
            return
          }

          if (sub === 'status') {
            console.log(formatCompanionStatus(companion))
            await sessionStore.save()
            safePrompt()
            return
          }

          if (sub === 'rename') {
            const nextName = tail.join(' ').trim()
            if (!nextName) {
              console.log('Usage: /mg rename <name>')
              await sessionStore.save()
              safePrompt()
              return
            }
            const renamed = renameCompanion(companion, nextName)
            sessionStore.setMgCompanion(renamed)
            await sessionStore.save()
            console.log(renamed ? `Renamed companion to ${renamed.name}.` : 'No companion to rename.')
            safePrompt()
            return
          }

          if (sub === 'mute') {
            const value = (tail[0] || '').toLowerCase()
            if (!['on', 'off'].includes(value)) {
              console.log('Usage: /mg mute on|off')
              await sessionStore.save()
              safePrompt()
              return
            }
            const muted = value === 'on'
            const updated = setMuted(companion, muted)
            sessionStore.setMgCompanion(updated)
            await sessionStore.save()
            console.log(updated ? `MG ambient lines ${muted ? 'muted' : 'enabled'}.` : 'No companion to mute.')
            safePrompt()
            return
          }

          if (sub === 'say') {
            const line = ambientLine(companion)
            if (!line) {
              console.log('No companion line available. Hatch first or unmute.')
            } else {
              console.log(`[mg] ${line}`)
            }
            await sessionStore.save()
            safePrompt()
            return
          }

          if (['feed', 'play', 'nap', 'pet'].includes(sub)) {
            const outcome = applyAction(companion, sub)
            sessionStore.setMgCompanion(outcome.companion)
            await sessionStore.save()
            console.log(outcome.message)
            if (outcome.companion) {
              console.log(formatCompanionStatus(outcome.companion))
            }
            safePrompt()
            return
          }

          console.log('Unknown /mg command. Run /mg help.')
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
          const history = sessionStore.getModelHistory(config.agent.maxHistory)
          const result = await queryEngine.runTask(task, history)
          answer = result.answer
        } else if (mode === 'chat') {
          answer = await runChatReply(model, sessionStore, task, config.agent.maxHistory)
        } else if (mode === 'auto') {
          if (detectCodingIntent(task)) {
            const history = sessionStore.getModelHistory(config.agent.maxHistory)
            const result = await queryEngine.runTask(task, history)
            answer = result.answer
          } else {
            answer = await runChatReply(model, sessionStore, task, config.agent.maxHistory)
          }
        } else {
          const history = sessionStore.getModelHistory(config.agent.maxHistory)
          const result = await queryEngine.runTask(task, history)
          answer = result.answer
        }

        sessionStore.append('assistant', answer)
        const mgTicked = tickCompanion(sessionStore.getMgCompanion())
        sessionStore.setMgCompanion(mgTicked)
        await sessionStore.save()
        console.log(answer)
        const extra = ambientLine(sessionStore.getMgCompanion())
        if (extra && Math.random() < 0.35) {
          console.log(`[mg] ${extra}`)
        }
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
