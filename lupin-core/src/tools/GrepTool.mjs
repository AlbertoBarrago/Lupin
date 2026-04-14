import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveInsideWorkspace, toWorkspaceRelative } from '../core/fsSafety.mjs'

const execFileAsync = promisify(execFileCb)

export const GrepTool = {
  name: 'GrepTool',
  description: 'Search text with ripgrep and return matched lines.',
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
    },
    required: ['pattern'],
  },
  async run(args, ctx) {
    const pattern = String(args?.pattern || '').trim()
    if (!pattern) {
      throw new Error('missing pattern')
    }

    const target = String(args?.path || '.').trim() || '.'
    const absTarget = resolveInsideWorkspace(ctx.projectRoot, target)
    const relTarget = toWorkspaceRelative(ctx.projectRoot, absTarget) || '.'

    try {
      const { stdout } = await execFileAsync('rg', ['-n', pattern, relTarget], {
        cwd: ctx.projectRoot,
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
      })
      const matches = String(stdout || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 400)
      return { count: matches.length, matches }
    } catch (error) {
      if (typeof error?.code === 'number' && error.code === 1) {
        return { count: 0, matches: [] }
      }
      throw error
    }
  },
}
