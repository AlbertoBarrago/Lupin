import fs from 'node:fs'
import path from 'node:path'

function exists(projectRoot, name) {
  return fs.existsSync(path.join(projectRoot, name))
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function listDirNames(projectRoot) {
  try {
    return fs
      .readdirSync(projectRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

function listTopLevelFiles(projectRoot) {
  try {
    return fs
      .readdirSync(projectRoot, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

function hasFileExtension(projectRoot, extensions) {
  const queue = [projectRoot]
  while (queue.length > 0) {
    const current = queue.shift()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.idea') {
        continue
      }
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(fullPath)
        continue
      }
      if (extensions.some(extension => entry.name.endsWith(extension))) {
        return true
      }
    }
  }
  return false
}

function detectPackageManager(projectRoot) {
  if (exists(projectRoot, 'pnpm-lock.yaml')) return 'pnpm'
  if (exists(projectRoot, 'yarn.lock')) return 'yarn'
  if (exists(projectRoot, 'package-lock.json')) return 'npm'
  if (exists(projectRoot, 'bun.lockb') || exists(projectRoot, 'bun.lock')) return 'bun'
  return null
}

function detectStacks(projectRoot, packageJson) {
  const names = new Set([
    ...Object.keys(packageJson?.dependencies || {}),
    ...Object.keys(packageJson?.devDependencies || {}),
  ])
  const stacks = []

  if (exists(projectRoot, 'package.json')) stacks.push('node')
  if (exists(projectRoot, 'tsconfig.json')) stacks.push('typescript')
  if (!stacks.includes('typescript') && hasFileExtension(projectRoot, ['.ts', '.tsx'])) {
    stacks.push('typescript')
  }
  if (hasFileExtension(projectRoot, ['.tsx', '.jsx'])) {
    stacks.push('react-style-ui')
  }
  if (exists(projectRoot, 'pyproject.toml') || exists(projectRoot, 'requirements.txt')) stacks.push('python')
  if (exists(projectRoot, 'Cargo.toml')) stacks.push('rust')
  if (exists(projectRoot, 'go.mod')) stacks.push('go')
  if (names.has('next')) stacks.push('nextjs')
  if (names.has('react')) stacks.push('react')
  if (names.has('vite')) stacks.push('vite')
  if (names.has('express')) stacks.push('express')
  if (names.has('fastify')) stacks.push('fastify')
  if (names.has('vue')) stacks.push('vue')
  if (names.has('svelte')) stacks.push('svelte')

  return [...new Set(stacks)]
}

function collectEntryCandidates(projectRoot) {
  const candidates = [
    'package.json',
    'README.md',
    'src/index.ts',
    'src/index.tsx',
    'src/index.js',
    'src/index.jsx',
    'src/main.ts',
    'src/main.tsx',
    'src/main.js',
    'src/main.jsx',
    'src/App.tsx',
    'src/App.jsx',
    'app/page.tsx',
    'app/page.jsx',
    'pages/index.tsx',
    'pages/index.jsx',
    'server.js',
    'server.ts',
    'main.py',
    'manage.py',
    'Cargo.toml',
    'go.mod',
  ]

  return candidates.filter(relPath => exists(projectRoot, relPath)).slice(0, 12)
}

function collectTopLevelTypeScriptEntries(projectRoot) {
  return listTopLevelFiles(projectRoot)
    .filter(name => /\.(ts|tsx|js|jsx)$/.test(name))
    .slice(0, 12)
}

function summarizeScripts(packageJson) {
  const scripts = packageJson?.scripts || {}
  const interesting = ['dev', 'start', 'build', 'test', 'lint']
  return interesting
    .filter(name => typeof scripts[name] === 'string')
    .map(name => `${name}: ${scripts[name]}`)
}

function summarizeDirectories(projectRoot) {
  const known = ['src', 'app', 'pages', 'components', 'lib', 'server', 'api', 'tests', '__tests__']
  const present = new Set(listDirNames(projectRoot))
  return known.filter(name => present.has(name))
}

export function initWorkspace(projectRoot, workspaceContext) {
  const resolvedRoot = path.resolve(projectRoot)
  const packageJson = safeReadJson(path.join(resolvedRoot, 'package.json'))
  const entryCandidates = collectEntryCandidates(resolvedRoot)
  const topLevelEntries = collectTopLevelTypeScriptEntries(resolvedRoot)
  const snapshot = {
    createdAt: new Date().toISOString(),
    workspaceRoot: resolvedRoot,
    gitRoot: workspaceContext.gitRoot,
    packageManager: detectPackageManager(resolvedRoot),
    stacks: detectStacks(resolvedRoot, packageJson),
    entryCandidates: entryCandidates.length ? entryCandidates : topLevelEntries,
    keyDirectories: summarizeDirectories(resolvedRoot),
    scripts: summarizeScripts(packageJson),
    markers: workspaceContext.markers,
    topLevelEntries: workspaceContext.topLevel.slice(0, 12),
  }
  return snapshot
}

export function renderClaudeMd(snapshot) {
  const lines = [
    '# MELKY.md',
    '',
    'This file provides guidance to coding agents working in this repository.',
    '',
  ]

  if (snapshot.packageManager || snapshot.scripts.length) {
    lines.push('## Commands', '')
    if (snapshot.packageManager) {
      lines.push(`- Preferred package manager: \`${snapshot.packageManager}\``)
    }
    for (const script of snapshot.scripts) {
      lines.push(`- \`${script}\``)
    }
    lines.push('')
  }

  lines.push('## Project Shape', '')
  lines.push(
    `- Detected stack: ${snapshot.stacks.length ? snapshot.stacks.join(', ') : 'unknown'}`,
  )
  if (snapshot.keyDirectories.length) {
    lines.push(`- Key directories: ${snapshot.keyDirectories.join(', ')}`)
  }
  if (snapshot.entryCandidates.length) {
    lines.push(`- Likely entry files: ${snapshot.entryCandidates.join(', ')}`)
  }
  if (snapshot.markers.length) {
    lines.push(`- Important root markers: ${snapshot.markers.join(', ')}`)
  }
  if (snapshot.topLevelEntries.length) {
    lines.push(`- Top-level workspace view: ${snapshot.topLevelEntries.join(', ')}`)
  }
  lines.push('')

  lines.push('## Working Rules', '')
  lines.push('- Stay within the current workspace root unless explicitly asked otherwise.')
  lines.push('- Inspect files before making claims about implementation details.')
  lines.push('- Prefer repo-native scripts and conventions over generic defaults.')
  lines.push('- For architecture questions, start from entry files and top-level directories before diving into implementation details.')
  lines.push('')

  return lines.join('\n')
}

export function formatWorkspaceSnapshot(snapshot) {
  if (!snapshot) {
    return 'Workspace snapshot: not initialized'
  }

  const lines = [
    `Workspace snapshot: ${snapshot.workspaceRoot}`,
    `Initialized at: ${snapshot.createdAt}`,
    `Git root: ${snapshot.gitRoot || 'not detected'}`,
    `Package manager: ${snapshot.packageManager || 'unknown'}`,
    `Stacks: ${snapshot.stacks.length ? snapshot.stacks.join(', ') : 'none detected'}`,
    `Key directories: ${snapshot.keyDirectories.length ? snapshot.keyDirectories.join(', ') : 'none detected'}`,
    `Entry candidates: ${snapshot.entryCandidates.length ? snapshot.entryCandidates.join(', ') : 'none detected'}`,
    `Scripts: ${snapshot.scripts.length ? snapshot.scripts.join(' | ') : 'none detected'}`,
  ]

  return lines.join('\n')
}
