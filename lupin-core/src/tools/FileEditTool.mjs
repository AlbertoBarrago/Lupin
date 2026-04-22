/** @module FileEditTool */

import fs from 'node:fs'
import { resolveInsideWorkspace, toWorkspaceRelative } from '../core/fsSafety.mjs'

/**
 * Replaces a contiguous range of lines in a file with new text.
 *
 * @async
 * @param {string} abs - Absolute path to the file to edit.
 * @param {number} lineStart - 1-indexed first line to replace (inclusive).
 * @param {number} lineEnd - 1-indexed last line to replace (inclusive).
 * @param {string} newText - Replacement text (may contain newlines).
 * @returns {Promise<{replacedLines: number, newLines: number}>} Counts of replaced and inserted lines.
 * @throws {Error} If `lineStart` or `lineEnd` are out of range, or if the edit produces no changes.
 */
async function applyLineRangeEdit(abs, lineStart, lineEnd, newText) {
  const raw = await fs.promises.readFile(abs, 'utf8')
  const lines = raw.split('\n')
  const total = lines.length
  const start = Number(lineStart)
  const end = Number(lineEnd)

  if (!Number.isInteger(start) || start < 1 || start > total) {
    throw new Error(`lineStart ${start} out of range (file has ${total} lines)`)
  }
  if (!Number.isInteger(end) || end < start || end > total) {
    throw new Error(`lineEnd ${end} out of range (must be >= lineStart and <= ${total})`)
  }

  const replacement = String(newText ?? '').split('\n')
  const next = [
    ...lines.slice(0, start - 1),
    ...replacement,
    ...lines.slice(end),
  ].join('\n')

  if (next === raw) throw new Error('edit produced no changes')
  await fs.promises.writeFile(abs, next, 'utf8')
  return { replacedLines: end - start + 1, newLines: replacement.length }
}

/**
 * Replaces occurrences of an exact string match within a file.
 *
 * @async
 * @param {string} abs - Absolute path to the file to edit.
 * @param {string} oldText - The exact string to search for (must match character-for-character).
 * @param {string} newText - The replacement string.
 * @param {boolean} replaceAll - When `true`, all occurrences are replaced; when `false`, only
 *   the first occurrence is replaced and the function throws if there is more than one match.
 * @returns {Promise<{replacedOccurrences: number}>} The number of occurrences that were replaced.
 * @throws {Error} If `oldText` is not found, if it is not unique and `replaceAll` is `false`,
 *   or if the edit produces no changes.
 */
async function applyTextEdit(abs, oldText, newText, replaceAll) {
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

  if (next === original) throw new Error('edit produced no changes')
  await fs.promises.writeFile(abs, next, 'utf8')
  return { replacedOccurrences: replaceAll ? occurrences : 1 }
}

/**
 * Tool that edits an existing UTF-8 file in one of two modes:
 *
 * 1. **LINE-RANGE** (preferred): provide `lineStart`, `lineEnd`, and `newText` to replace
 *    those lines. Use after `FileReadTool` to obtain exact line numbers.
 * 2. **TEXT-MATCH**: provide `oldText` and `newText` to replace an exact string match.
 *    `oldText` must match character-for-character, including all whitespace.
 *
 * @type {{
 *   name: string,
 *   description: string,
 *   schema: object,
 *   run: (args: object, ctx: {projectRoot: string}) => Promise<{path: string, bytes: number}>
 * }}
 */
export const FileEditTool = {
  name: 'FileEditTool',
  description:
    'Edit an existing UTF-8 file. Two modes: ' +
    '(1) LINE-RANGE (preferred): provide lineStart + lineEnd + newText — replaces those lines. Use after FileReadTool to get exact line numbers. ' +
    '(2) TEXT-MATCH: provide oldText + newText — replaces exact string match. oldText must match character-for-character including whitespace.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      lineStart: { type: 'number', description: '1-indexed first line to replace (inclusive)' },
      lineEnd: { type: 'number', description: '1-indexed last line to replace (inclusive)' },
      oldText: { type: 'string' },
      newText: { type: 'string' },
      replaceAll: { type: 'boolean' },
    },
    required: ['path', 'newText'],
  },
  /**
   * Executes the file edit using whichever mode is indicated by the supplied arguments.
   *
   * @async
   * @param {object} args - Tool arguments.
   * @param {string} args.path - Workspace-relative path to the file.
   * @param {string} args.newText - Replacement text.
   * @param {number} [args.lineStart] - 1-indexed first line to replace (LINE-RANGE mode).
   * @param {number} [args.lineEnd] - 1-indexed last line to replace (LINE-RANGE mode).
   * @param {string} [args.oldText] - Exact string to replace (TEXT-MATCH mode).
   * @param {boolean} [args.replaceAll] - Replace all occurrences in TEXT-MATCH mode.
   * @param {{projectRoot: string}} ctx - Execution context providing the workspace root.
   * @returns {Promise<{path: string, bytes: number}>} Result object with the workspace-relative
   *   path and final file size in bytes, merged with mode-specific edit metadata.
   * @throws {Error} If neither a valid line range nor `oldText` is provided, or if the
   *   underlying edit operation fails.
   */
  async run(args, ctx) {
    const abs = resolveInsideWorkspace(ctx.projectRoot, args?.path)
    const newText = String(args?.newText ?? '')

    let editInfo
    if (args?.lineStart != null && args?.lineEnd != null) {
      editInfo = await applyLineRangeEdit(abs, args.lineStart, args.lineEnd, newText)
    } else {
      const oldText = String(args?.oldText ?? '')
      if (!oldText) throw new Error('provide either lineStart+lineEnd or oldText')
      editInfo = await applyTextEdit(abs, oldText, newText, Boolean(args?.replaceAll))
    }

    const written = await fs.promises.readFile(abs, 'utf8')
    return {
      path: toWorkspaceRelative(ctx.projectRoot, abs),
      ...editInfo,
      bytes: Buffer.byteLength(written),
    }
  },
}
