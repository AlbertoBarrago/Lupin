import fs from 'node:fs'
import { resolveInsideWorkspace, toWorkspaceRelative } from '../core/fsSafety.mjs'

export const FileEditTool = {
  name: 'FileEditTool',
  description:
    'Edit part of an existing UTF-8 text file by replacing a unique string, optionally all matches.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      oldText: { type: 'string' },
      newText: { type: 'string' },
      replaceAll: { type: 'boolean' },
    },
    required: ['path', 'oldText', 'newText'],
  },
  async run(args, ctx) {
    const abs = resolveInsideWorkspace(ctx.projectRoot, args?.path)
    const oldText = String(args?.oldText ?? '')
    const newText = String(args?.newText ?? '')
    const replaceAll = Boolean(args?.replaceAll)

    if (!oldText) {
      throw new Error('oldText must not be empty')
    }

    const original = await fs.promises.readFile(abs, 'utf8')
    const occurrences = original.split(oldText).length - 1

    if (occurrences === 0) {
      throw new Error('oldText not found in file')
    }

    if (!replaceAll && occurrences > 1) {
      throw new Error('oldText is not unique; refine the match or set replaceAll=true')
    }

    const next = replaceAll
      ? original.split(oldText).join(newText)
      : original.replace(oldText, newText)

    if (next === original) {
      throw new Error('edit produced no changes')
    }

    await fs.promises.writeFile(abs, next, 'utf8')

    return {
      path: toWorkspaceRelative(ctx.projectRoot, abs),
      replacedOccurrences: replaceAll ? occurrences : 1,
      bytes: Buffer.byteLength(next),
    }
  },
}
