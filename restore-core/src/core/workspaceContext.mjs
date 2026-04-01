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

  const instructionCandidates = ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']
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
    instructionFiles: instructionCandidates,
  }
}
