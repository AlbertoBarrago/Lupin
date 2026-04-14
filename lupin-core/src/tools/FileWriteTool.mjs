import fs from 'node:fs'
import path from 'node:path'
import { resolveInsideWorkspace, toWorkspaceRelative } from '../core/fsSafety.mjs'

export const FileWriteTool = {
  name: 'FileWriteTool',
  description: 'Write a UTF-8 text file within workspace.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  async run(args, ctx) {
    const abs = resolveInsideWorkspace(ctx.projectRoot, args?.path)
    const content = String(args?.content ?? '')
    await fs.promises.mkdir(path.dirname(abs), { recursive: true })
    await fs.promises.writeFile(abs, content, 'utf8')
    return {
      path: toWorkspaceRelative(ctx.projectRoot, abs),
      bytes: Buffer.byteLength(content),
    }
  },
}
