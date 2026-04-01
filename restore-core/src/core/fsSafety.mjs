import fs from 'node:fs'
import path from 'node:path'

export function resolveInsideWorkspace(projectRoot, maybeRelativePath) {
  const raw = String(maybeRelativePath || '').trim()
  if (!raw) {
    throw new Error('missing path')
  }
  const abs = path.resolve(projectRoot, raw)
  const rel = path.relative(projectRoot, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path outside workspace: ${raw}`)
  }
  return abs
}

export function toWorkspaceRelative(projectRoot, absPath) {
  return path.relative(projectRoot, absPath)
}

export async function fileExists(absPath) {
  try {
    await fs.promises.access(absPath)
    return true
  } catch {
    return false
  }
}
