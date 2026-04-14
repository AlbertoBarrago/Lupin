import fs from 'node:fs'
import { resolveInsideWorkspace, toWorkspaceRelative } from '../core/fsSafety.mjs'

export const FileDeleteTool = {
  name: 'FileDeleteTool',
  description: 'Delete a file within the workspace. Cannot delete directories.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path to the file to delete' },
    },
    required: ['path'],
  },
  async run(args, ctx) {
    const abs = resolveInsideWorkspace(ctx.projectRoot, args?.path)
    const stat = await fs.promises.stat(abs)
    if (stat.isDirectory()) {
      throw new Error(`${args.path} is a directory — use BashTool with rm -r for directories`)
    }
    await fs.promises.unlink(abs)
    return { deleted: toWorkspaceRelative(ctx.projectRoot, abs) }
  },
}
