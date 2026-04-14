import fs from 'node:fs'
import path from 'node:path'

function readTextFile(filePath, maxChars = 12000) {
  try {
    return fs.readFileSync(filePath, 'utf8').slice(0, maxChars)
  } catch {
    return null
  }
}

function readTopLevelEntries(projectRoot) {
  try {
    return fs.readdirSync(projectRoot, { withFileTypes: true })
  } catch {
    return []
  }
}

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

const SOURCE_EXTENSIONS = /\.(js|mjs|cjs|ts|tsx|jsx|html|css|scss|json|md|py|go|rs|rb|sh|yaml|yml|toml|env\.example)$/i
const SKIP_PRELOAD = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'coverage', '.turbo'])
const PRELOAD_MAX_FILES = 20
const PRELOAD_MAX_BYTES = 80 * 1024 // 80KB total

export function preloadWorkspaceFiles(projectRoot) {
  const files = []
  let totalBytes = 0

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
