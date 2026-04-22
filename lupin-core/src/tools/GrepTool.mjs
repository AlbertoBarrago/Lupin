/** @module GrepTool */

import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveInsideWorkspace, toWorkspaceRelative } from '../core/fsSafety.mjs'

const execFileAsync = promisify(execFileCb)

/**
 * Tool that searches file contents using ripgrep and returns matched lines.
 * Supports scoping the search to a specific workspace-relative path.
 * Results are capped at 400 matches.
 *
 * @type {{ name: string, description: string, schema: object, run: Function }}
 */
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
  /**
   * Execute a ripgrep search for `args.pattern` within the workspace, optionally
   * limited to the subtree at `args.path`.
   *
   * When ripgrep exits with code 1 (no matches found) the method returns an
   * empty result instead of throwing.
   *
   * @async
   * @param {{ pattern: string, path?: string }} args - Search arguments.
   * @param {string} args.pattern - Regex pattern forwarded to `rg`.
   * @param {string} [args.path='.'] - Workspace-relative path to scope the search.
   * @param {{ projectRoot: string }} ctx - Runtime context.
   * @param {string} ctx.projectRoot - Absolute path to the workspace root.
   * @returns {Promise<{ count: number, matches: string[] }>} Matched lines (at most 400).
   * @throws {Error} If `args.pattern` is empty or ripgrep fails for any reason
   *   other than a no-match exit code.
   */
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
