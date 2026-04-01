import fs from 'node:fs'
import { resolveInsideWorkspace, toWorkspaceRelative } from '../core/fsSafety.mjs'

export const FileReadTool = {
  name: 'FileReadTool',
  description: 'Read a UTF-8 text file from workspace.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
    },
    required: ['path'],
  },
  async run(args, ctx) {
    const abs = resolveInsideWorkspace(ctx.projectRoot, args?.path)
    const content = await fs.promises.readFile(abs, 'utf8')
    const maxChars = 24000
    return {
      path: toWorkspaceRelative(ctx.projectRoot, abs),
      content: content.slice(0, maxChars),
      truncated: content.length > maxChars,
    }
  },
}
