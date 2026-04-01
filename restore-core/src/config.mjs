import path from 'node:path'

function resolveCliProjectRootArg(argv = process.argv.slice(2)) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || '').trim()
    if (!value) continue
    if (value === '--project-root' || value === '--workspace') {
      const next = String(argv[index + 1] || '').trim()
      if (next) return next
    }
    if (value.startsWith('--project-root=')) {
      return value.slice('--project-root='.length).trim()
    }
    if (value.startsWith('--workspace=')) {
      return value.slice('--workspace='.length).trim()
    }
  }
  return ''
}

function inferProjectRoot() {
  const cwd = process.cwd()
  const cliProjectRoot = resolveCliProjectRootArg()
  if (cliProjectRoot) {
    return path.resolve(cwd, cliProjectRoot)
  }

  const initCwd = String(process.env.INIT_CWD || '').trim()
  if (initCwd && initCwd !== cwd) {
    return path.resolve(initCwd)
  }

  if (path.basename(cwd) === 'restore-core') {
    return path.resolve(cwd, '..')
  }
  return cwd
}

export function loadConfig() {
  const defaultModeRaw = (process.env.AGENT_MODE || 'code').toLowerCase()
  const defaultMode =
    defaultModeRaw === 'chat' || defaultModeRaw === 'auto' ? defaultModeRaw : 'code'

  return {
    projectRoot: process.env.AGENT_PROJECT_ROOT || inferProjectRoot(),
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      model: process.env.OLLAMA_MODEL || 'llama3.2',
      timeoutMs: Number.parseInt(process.env.OLLAMA_TIMEOUT_MS || '20000', 10),
    },
    agent: {
      maxSteps: Number.parseInt(process.env.AGENT_MAX_STEPS || '14', 10),
      maxHistory: Number.parseInt(process.env.AGENT_MAX_HISTORY || '16', 10),
      defaultMode,
    },
    security: {
      denyDangerousBash: process.env.AGENT_DENY_DANGEROUS_BASH !== '0',
    },
    debug: process.env.DEBUG === '1',
  }
}
