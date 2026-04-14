import fs from 'node:fs'
import path from 'node:path'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveInsideWorkspace, toWorkspaceRelative } from '../core/fsSafety.mjs'

const execFileAsync = promisify(execFileCb)

const MAX_CHARS_PER_FILE = 8000
const MAX_FILES = 20

export const FileBatchReadTool = {
  name: 'FileBatchReadTool',
  description:
    'Read multiple files at once using a glob/regex pattern. Returns all matching file contents in one call. Use this instead of multiple FileReadTool calls when you need to read several files (e.g. all markdown docs, all source files in a directory).',
  schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to match file paths (e.g. "\\.md$", "^docs/", "\\.(ts|js)$")',
      },
      max_files: {
        type: 'number',
        description: `Max files to read (default ${MAX_FILES})`,
      },
    },
    required: ['pattern'],
  },
  async run(args, ctx) {
    const pattern = String(args?.pattern || '').trim()
    if (!pattern) throw new Error('pattern is required')

    let regex
    try {
      regex = new RegExp(pattern)
    } catch {
      throw new Error(`invalid regex: ${pattern}`)
    }

    const limit = Math.min(Number(args?.max_files) || MAX_FILES, MAX_FILES)

    const { stdout } = await execFileAsync('rg', ['--files'], {
      cwd: ctx.projectRoot,
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    })

    const matched = String(stdout || '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .filter(f => regex.test(f))
      .slice(0, limit)

    if (matched.length === 0) {
      return { files: [], note: 'no files matched pattern' }
    }

    const results = await Promise.all(
      matched.map(async rel => {
        try {
          const abs = resolveInsideWorkspace(ctx.projectRoot, rel)
          const raw = await fs.promises.readFile(abs, 'utf8')
          const content = raw.slice(0, MAX_CHARS_PER_FILE)
          return {
            path: toWorkspaceRelative(ctx.projectRoot, abs),
            content,
            truncated: raw.length > MAX_CHARS_PER_FILE,
          }
        } catch (err) {
          return { path: rel, error: String(err?.message || err) }
        }
      }),
    )

    return { files: results }
  },
}
