/** @module FileDeleteTool */

import fs from 'node:fs'
import { resolveInsideWorkspace, toWorkspaceRelative } from '../core/fsSafety.mjs'

/**
 * Tool that deletes a single file within the workspace boundary.
 * Refuses to operate on directories — callers must use BashTool with `rm -r` for that.
 *
 * @type {{ name: string, description: string, schema: object, run: Function }}
 */
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
  /**
   * Delete the file at the given workspace-relative path.
   *
   * @param {{ path: string }} args - Tool arguments.
   * @param {string} args.path - Workspace-relative path to the file to delete.
   * @param {{ projectRoot: string }} ctx - Runtime context supplied by ToolRuntime.
   * @returns {Promise<{ deleted: string }>} Workspace-relative path of the deleted file.
   * @throws {Error} If the resolved path points to a directory rather than a file.
   * @throws {Error} If the path escapes the workspace root (raised by resolveInsideWorkspace).
   * @throws {Error} If the file does not exist or cannot be removed.
   */
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
