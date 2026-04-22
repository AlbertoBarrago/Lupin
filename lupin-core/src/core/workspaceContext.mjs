/**
 * @module workspaceContext
 * @description Builds the workspace context object used to populate system prompts and
 * drive the `/init` command. Detects git root, framework markers, README summaries,
 * instruction files, and optionally preloads small workspaces for inline model inspection.
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * Reads a text file from disk, returning up to `maxChars` characters.
 * @param {string} filePath - Absolute or relative path to the file.
 * @param {number} [maxChars=12000] - Maximum number of characters to return.
 * @returns {string|null} File contents (possibly truncated), or `null` if the file cannot be read.
 */
function readTextFile(filePath, maxChars = 12000) {
  try {
    return fs.readFileSync(filePath, 'utf8').slice(0, maxChars)
  } catch {
    return null
  }
}

/**
 * Returns all top-level directory entries for the given project root.
 * @param {string} projectRoot - Path to the project root directory.
 * @returns {import('node:fs').Dirent[]} Array of directory entries, or an empty array on error.
 */
function readTopLevelEntries(projectRoot) {
  try {
    return fs.readdirSync(projectRoot, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * Extracts a short plain-text summary from the project README.
 * Tries `README.md`, `readme.md`, and `README` in order. Strips Markdown
 * heading markers, blockquote prefixes, image syntax, and link syntax before
 * returning the first few non-empty, non-heading lines joined into one string.
 * @param {string} projectRoot - Path to the project root directory.
 * @returns {string|null} A summary string up to 320 characters, or `null` if no README is found.
 */
function readReadmeSummary(projectRoot) {
  const candidates = ['README.md', 'readme.md', 'README']
  for (const name of candidates) {
    const content = readTextFile(path.join(projectRoot, name), 4000)
    if (!content) continue
    const lines = content
      .split('\n')
      .map(line => line.trim().replace(/^>\s*/, ''))
      .map(line => line.replace(/!\[[^\]]*]\([^)]+\)/g, ''))
      .map(line => line.replace(/\[([^\]]+)]\([^)]+\)/g, '$1'))
      .filter(Boolean)
      .filter(line => !line.startsWith('#'))
    if (lines.length > 0) {
      return lines
        .slice(0, 3)
        .join(' ')
        .slice(0, 320)
    }
  }
  return null
}

/**
 * Walks up the directory tree from `projectRoot` to find the nearest `.git` directory.
 * @param {string} projectRoot - Starting directory for the upward search.
 * @returns {string|null} Absolute path of the git root directory, or `null` if not found.
 */
function detectGitRoot(projectRoot) {
  let current = path.resolve(projectRoot)
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

/** Regex matching source file extensions that are eligible for workspace preloading. */
const SOURCE_EXTENSIONS = /\.(js|mjs|cjs|ts|tsx|jsx|html|css|scss|json|md|py|go|rs|rb|sh|yaml|yml|toml|env\.example)$/i

/** Set of directory names that are skipped entirely during workspace preload walks. */
const SKIP_PRELOAD = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'coverage', '.turbo'])

/** Maximum number of files collected during a single workspace preload pass. */
const PRELOAD_MAX_FILES = 20

/** Maximum total byte size (80 KB) of content collected during a workspace preload pass. */
const PRELOAD_MAX_BYTES = 80 * 1024 // 80KB total

/**
 * Recursively collects source files from the workspace up to hard size and count limits.
 * Returns `null` when the workspace is too large for inline preloading, signalling
 * that the model should inspect files individually instead.
 * @param {string} projectRoot - Root directory to scan.
 * @returns {{ path: string, content: string }[]|null} Array of objects with `path` (relative
 *   to `projectRoot`) and `content` fields, or `null` if the limits are exceeded or no
 *   eligible files are found.
 */
export function preloadWorkspaceFiles(projectRoot) {
  const files = []
  let totalBytes = 0

  /**
   * Recursively walks a directory, collecting eligible source files into the outer
   * `files` array. Stops early once `PRELOAD_MAX_FILES` or `PRELOAD_MAX_BYTES` is reached.
   * @param {string} dir - Absolute path of the directory to walk.
   */
  function walk(dir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (SKIP_PRELOAD.has(entry.name) || entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (SOURCE_EXTENSIONS.test(entry.name)) {
        try {
          const content = fs.readFileSync(abs, 'utf8')
          totalBytes += Buffer.byteLength(content)
          if (totalBytes > PRELOAD_MAX_BYTES) return
          files.push({ path: path.relative(projectRoot, abs), content })
          if (files.length >= PRELOAD_MAX_FILES) return
        } catch {}
      }
    }
  }

  walk(path.resolve(projectRoot))

  if (totalBytes > PRELOAD_MAX_BYTES || files.length >= PRELOAD_MAX_FILES) {
    return null // workspace too large — let model inspect normally
  }
  return files.length > 0 ? files : null
}

/**
 * Builds a snapshot of the workspace for injection into system prompts.
 * Collects the top-level directory listing, well-known framework marker files,
 * agent instruction files (e.g. `LUPIN.md`, `CLAUDE.md`), a README summary,
 * and the detected git root.
 * @param {string} projectRoot - Path to the project root directory.
 * @returns {{
 *   projectRoot: string,
 *   gitRoot: string|null,
 *   markers: string[],
 *   topLevel: string[],
 *   readmeSummary: string|null,
 *   instructionFiles: { path: string, content: string }[]
 * }} Workspace context object ready for use in system prompt construction.
 */
export function buildWorkspaceContext(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot)
  const entries = readTopLevelEntries(resolvedRoot)
  const topLevel = entries
    .slice(0, 24)
    .map(entry => `${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`)

  const signals = [
    'package.json',
    'tsconfig.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    'requirements.txt',
    'README.md',
  ].filter(name => fs.existsSync(path.join(resolvedRoot, name)))

  const instructionCandidates = ['LUPIN.md', 'MELKY.md', 'CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']
    .map(relPath => {
      const absPath = path.join(resolvedRoot, relPath)
      const content = readTextFile(absPath)
      if (!content) return null
      return { path: relPath, content }
    })
    .filter(Boolean)

  return {
    projectRoot: resolvedRoot,
    gitRoot: detectGitRoot(resolvedRoot),
    markers: signals,
    topLevel,
    readmeSummary: readReadmeSummary(resolvedRoot),
    instructionFiles: instructionCandidates,
  }
}
