import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFileCb)

function compileOptionalRegex(pattern) {
  const raw = String(pattern || '').trim()
  if (!raw) return null
  try {
    return new RegExp(raw)
  } catch (error) {
    throw new Error(`invalid regex pattern: ${String(error?.message || error)}`)
  }
}

export const GlobTool = {
  name: 'GlobTool',
  description: 'List workspace files and optionally filter by regex.',
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
    },
    required: [],
  },
  async run(args, ctx) {
    const regex = compileOptionalRegex(args?.pattern)
    const { stdout } = await execFileAsync('rg', ['--files'], {
      cwd: ctx.projectRoot,
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    })
    let files = String(stdout || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    if (regex) {
      files = files.filter(file => regex.test(file))
    }
    files = files.slice(0, 400)
    return {
      count: files.length,
      files,
    }
  },
}
