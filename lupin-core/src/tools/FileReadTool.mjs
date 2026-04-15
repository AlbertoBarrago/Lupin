import fs from 'node:fs'
import { resolveInsideWorkspace, toWorkspaceRelative } from '../core/fsSafety.mjs'

function addLineNumbers(content) {
  const lines = content.split('\n')
  const width = String(lines.length).length
  return lines.map((line, i) => `${String(i + 1).padStart(width)}: ${line}`).join('\n')
}

export const FileReadTool = {
  name: 'FileReadTool',
  description:
    'Read a UTF-8 text file from workspace. Returns content with line numbers prepended (e.g. " 1: code here"). Use line numbers to target FileEditTool line-range edits. Do not include the "N: " prefix when writing oldText.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
    },
    required: ['path'],
  },
  async run(args, ctx) {
    const abs = resolveInsideWorkspace(ctx.projectRoot, args?.path)
    const raw = await fs.promises.readFile(abs, 'utf8')
    const maxChars = 24000
    const truncated = raw.length > maxChars
    const sliced = raw.slice(0, maxChars)
    return {
      path: toWorkspaceRelative(ctx.projectRoot, abs),
      content: addLineNumbers(sliced),
      totalLines: raw.split('\n').length,
      truncated,
    }
  },
}
