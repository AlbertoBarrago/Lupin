import fs from 'node:fs'
import path from 'node:path'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.idea', '.vscode', 'dist', 'build', '.next', '.nuxt', '__pycache__', '.cache', 'coverage', '.turbo'])

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

function readTextFile(filePath, maxChars = 12000) {
  try {
    return fs.readFileSync(filePath, 'utf8').slice(0, maxChars)
  } catch {
    return null
  }
}

function listDirEntries(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

function listTopLevelFiles(projectRoot) {
  return listDirEntries(projectRoot)
    .filter(e => e.isFile())
    .map(e => e.name)
}

function detectPackageManager(projectRoot) {
  if (exists(projectRoot, 'pnpm-lock.yaml')) return 'pnpm'
  if (exists(projectRoot, 'bun.lockb') || exists(projectRoot, 'bun.lock')) return 'bun'
  if (exists(projectRoot, 'yarn.lock')) return 'yarn'
  if (exists(projectRoot, 'package-lock.json')) return 'npm'
  return null
}

function detectStacks(projectRoot, packageJson) {
  const names = new Set([
    ...Object.keys(packageJson?.dependencies || {}),
    ...Object.keys(packageJson?.devDependencies || {}),
  ])
  const stacks = []

  if (exists(projectRoot, 'package.json')) stacks.push('node')
  if (exists(projectRoot, 'tsconfig.json') || names.has('typescript')) stacks.push('typescript')
  if (!stacks.includes('typescript') && hasSourceFiles(projectRoot, ['.ts', '.tsx'])) stacks.push('typescript')
  if (hasSourceFiles(projectRoot, ['.tsx', '.jsx'])) stacks.push('react-style-ui')
  if (exists(projectRoot, 'pyproject.toml') || exists(projectRoot, 'requirements.txt')) stacks.push('python')
  if (exists(projectRoot, 'Cargo.toml')) stacks.push('rust')
  if (exists(projectRoot, 'go.mod')) stacks.push('go')
  if (names.has('react') || names.has('react-dom')) stacks.push('react')
  if (names.has('vue')) stacks.push('vue')
  if (names.has('svelte')) stacks.push('svelte')

  return [...new Set(stacks)]
}

function hasSourceFiles(projectRoot, extensions) {
  const queue = [projectRoot]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const entry of listDirEntries(current)) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.isDirectory()) {
        queue.push(path.join(current, entry.name))
        continue
      }
      if (extensions.some(ext => entry.name.endsWith(ext))) return true
    }
  }
  return false
}

function detectFrameworks(projectRoot, packageJson) {
  const names = new Set([
    ...Object.keys(packageJson?.dependencies || {}),
    ...Object.keys(packageJson?.devDependencies || {}),
  ])
  const frameworks = []

  // JS frameworks — config file takes priority over package.json dep
  const configSignals = [
    ['next.config.js', 'next.config.ts', 'next.config.mjs'],
    ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'],
    ['astro.config.mjs', 'astro.config.ts'],
    ['svelte.config.js', 'svelte.config.ts'],
    ['nuxt.config.js', 'nuxt.config.ts'],
    ['angular.json'],
    ['nest-cli.json'],
    ['remix.config.js', 'remix.config.ts'],
    ['gatsby-config.js', 'gatsby-config.ts'],
  ]
  const frameworkNames = ['Next.js', 'Vite', 'Astro', 'Svelte', 'Nuxt', 'Angular', 'NestJS', 'Remix', 'Gatsby']
  for (let i = 0; i < configSignals.length; i++) {
    if (configSignals[i].some(f => exists(projectRoot, f))) {
      frameworks.push(frameworkNames[i])
    }
  }

  // Fallback to package.json deps
  if (!frameworks.includes('Next.js') && names.has('next')) frameworks.push('Next.js')
  if (!frameworks.includes('Vite') && names.has('vite')) frameworks.push('Vite')
  if (!frameworks.includes('NestJS') && (names.has('@nestjs/core') || names.has('@nestjs/common'))) frameworks.push('NestJS')
  if (names.has('express')) frameworks.push('Express')
  if (names.has('fastify')) frameworks.push('Fastify')
  if (names.has('hono')) frameworks.push('Hono')
  if (names.has('elysia')) frameworks.push('Elysia')

  // Python frameworks
  const pyproject = readTextFile(path.join(projectRoot, 'pyproject.toml'))
  const requirements = readTextFile(path.join(projectRoot, 'requirements.txt'))
  const combined = `${pyproject || ''}\n${requirements || ''}`.toLowerCase()
  if (combined.includes('fastapi')) frameworks.push('FastAPI')
  if (combined.includes('django')) frameworks.push('Django')
  if (combined.includes('flask')) frameworks.push('Flask')
  if (exists(projectRoot, 'manage.py') && !frameworks.includes('Django')) frameworks.push('Django')

  // Infrastructure signals
  if (exists(projectRoot, 'docker-compose.yml') || exists(projectRoot, 'docker-compose.yaml')) frameworks.push('Docker Compose')
  if (exists(projectRoot, 'Dockerfile')) frameworks.push('Docker')
  if (exists(projectRoot, 'Makefile')) frameworks.push('Make')

  return [...new Set(frameworks)]
}

function detectTestFramework(projectRoot, packageJson) {
  const names = new Set([
    ...Object.keys(packageJson?.dependencies || {}),
    ...Object.keys(packageJson?.devDependencies || {}),
  ])

  // Config file wins
  if (['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs'].some(f => exists(projectRoot, f))) return 'Vitest'
  if (['jest.config.js', 'jest.config.ts', 'jest.config.cjs', 'jest.config.mjs'].some(f => exists(projectRoot, f))) return 'Jest'
  if (exists(projectRoot, 'pytest.ini') || exists(projectRoot, 'conftest.py')) return 'pytest'
  if (exists(projectRoot, 'phpunit.xml') || exists(projectRoot, 'phpunit.xml.dist')) return 'PHPUnit'
  if (exists(projectRoot, 'cargo.toml') || exists(projectRoot, 'Cargo.toml')) {
    const cargo = readTextFile(path.join(projectRoot, 'Cargo.toml')) || ''
    if (cargo.includes('[dev-dependencies]') || cargo.includes('[[test]]')) return 'cargo test'
  }

  // Fall back to deps
  if (names.has('vitest')) return 'Vitest'
  if (names.has('jest') || names.has('@jest/core')) return 'Jest'
  if (names.has('mocha')) return 'Mocha'
  if (names.has('ava')) return 'AVA'
  if (names.has('tap')) return 'tap'

  // Go
  if (exists(projectRoot, 'go.mod')) return 'go test'

  return null
}

function detectCiCd(projectRoot) {
  const systems = []
  if (exists(projectRoot, '.github/workflows')) systems.push('GitHub Actions')
  if (exists(projectRoot, '.gitlab-ci.yml')) systems.push('GitLab CI')
  if (exists(projectRoot, '.circleci/config.yml')) systems.push('CircleCI')
  if (exists(projectRoot, 'Jenkinsfile')) systems.push('Jenkins')
  if (exists(projectRoot, '.travis.yml')) systems.push('Travis CI')
  if (exists(projectRoot, 'bitbucket-pipelines.yml')) systems.push('Bitbucket Pipelines')
  if (exists(projectRoot, 'turbo.json') || exists(projectRoot, '.turbo')) systems.push('Turborepo')
  if (exists(projectRoot, 'nx.json')) systems.push('Nx')
  return systems
}

function detectEntrypoints(projectRoot, packageJson) {
  const results = new Set()

  // bin field in package.json
  const bin = packageJson?.bin
  if (typeof bin === 'string') results.add(bin)
  else if (bin && typeof bin === 'object') {
    for (const v of Object.values(bin)) results.add(v)
  }

  // main/module fields
  if (packageJson?.main) results.add(packageJson.main)
  if (packageJson?.module) results.add(packageJson.module)

  // Common entrypoint patterns in root and src/
  const searchDirs = [projectRoot, path.join(projectRoot, 'src')]
  const entryNames = ['index', 'main', 'app', 'server', 'cli', 'start']
  const entryExts = ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.py']

  for (const dir of searchDirs) {
    for (const name of entryNames) {
      for (const ext of entryExts) {
        const rel = path.relative(projectRoot, path.join(dir, name + ext))
        if (exists(projectRoot, rel)) results.add(rel)
      }
    }
  }

  // Fallback: root-level TS/JS files
  if (results.size === 0) {
    for (const name of listTopLevelFiles(projectRoot)) {
      if (/\.(ts|tsx|mjs|js|jsx)$/.test(name)) results.add(name)
    }
  }

  // Filter to files that actually exist and trim to 10
  return [...results]
    .filter(p => {
      try { return exists(projectRoot, p) } catch { return false }
    })
    .slice(0, 10)
}

function detectArchitecturalHotspots(projectRoot) {
  // Count source files per top-level directory, return the top ones
  const topDirs = listDirEntries(projectRoot)
    .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name))
    .map(e => e.name)

  const counts = topDirs.map(dir => {
    const count = countSourceFiles(path.join(projectRoot, dir), 0)
    return { dir, count }
  })

  return counts
    .filter(({ count }) => count > 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map(({ dir, count }) => `${dir}/ (${count} files)`)
}

function countSourceFiles(dirPath, depth) {
  if (depth > 4) return 0
  let count = 0
  for (const entry of listDirEntries(dirPath)) {
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.isDirectory()) {
      count += countSourceFiles(path.join(dirPath, entry.name), depth + 1)
    } else if (/\.(ts|tsx|js|jsx|mjs|py|go|rs|rb|php|java|kt|swift)$/.test(entry.name)) {
      count++
    }
  }
  return count
}

function detectKeyDirectories(projectRoot) {
  return listDirEntries(projectRoot)
    .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
    .map(e => e.name)
}

function summarizeScripts(packageJson) {
  const scripts = packageJson?.scripts || {}
  const interesting = ['dev', 'start', 'build', 'test', 'lint', 'typecheck', 'check', 'format']
  return interesting
    .filter(name => typeof scripts[name] === 'string')
    .map(name => `${name}: ${scripts[name]}`)
}

function detectRepoName(projectRoot, packageJson, workspaceContext) {
  if (typeof packageJson?.name === 'string' && packageJson.name.trim()) {
    return packageJson.name.trim()
  }
  if (workspaceContext.gitRoot) return path.basename(workspaceContext.gitRoot)
  return path.basename(projectRoot)
}

function summarizeReadme(projectRoot) {
  const content = readTextFile(path.join(projectRoot, 'README.md'), 5000)
  if (!content) return null
  const lines = content
    .split('\n')
    .map(line => line.trim().replace(/^>\s*/, ''))
    .map(line => line.replace(/!\[[^\]]*]\([^)]+\)/g, ''))
    .map(line => line.replace(/\[([^\]]+)]\([^)]+\)/g, '$1'))
    .filter(Boolean)
    .filter(line => !line.startsWith('#'))
  if (lines.length === 0) return null
  return lines.slice(0, 3).join(' ').slice(0, 320)
}

function detectValidationCommand(packageManager, scripts) {
  const scriptMap = new Map(
    scripts.map(line => {
      const idx = line.indexOf(':')
      if (idx === -1) return [line, '']
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
    }),
  )
  const runner = packageManager || 'npm'
  const run = name =>
    runner === 'npm' ? `npm run ${name}` : `${runner} ${name === 'test' ? 'test' : `run ${name}`}`

  if (scriptMap.has('typecheck') && scriptMap.has('test')) return `${run('typecheck')} && ${run('test')}`
  if (scriptMap.has('lint') && scriptMap.has('test')) return `${run('lint')} && ${run('test')}`
  if (scriptMap.has('check')) return run('check')
  if (scriptMap.has('test')) return run('test')
  if (scriptMap.has('lint')) return run('lint')
  if (scriptMap.has('build')) return run('build')
  return null
}

function extractManualSection(existingContent) {
  const content = String(existingContent || '')
  const marker = '## Owner Preferences'
  const index = content.indexOf(marker)
  if (index === -1) {
    return [
      '## Owner Preferences',
      '',
      '- Preferred response language: mirror the user, Italian or English.',
      '- Treat the owner as an experienced engineer; avoid beginner explanations.',
      '- Prefer clean code with pragmatism, not abstraction theater.',
      '- Be direct and sincere; avoid corporate or politically correct fluff.',
      '- Optimize for precision, repo awareness, and concrete tradeoff reasoning.',
    ].join('\n')
  }
  return content.slice(index).trim()
}

export function initWorkspace(projectRoot, workspaceContext) {
  const resolvedRoot = path.resolve(projectRoot)
  const packageJson = safeReadJson(path.join(resolvedRoot, 'package.json'))
  const scripts = summarizeScripts(packageJson)
  const packageManager = detectPackageManager(resolvedRoot)

  const snapshot = {
    createdAt: new Date().toISOString(),
    workspaceRoot: resolvedRoot,
    gitRoot: workspaceContext.gitRoot,
    repoName: detectRepoName(resolvedRoot, packageJson, workspaceContext),
    packageManager,
    stacks: detectStacks(resolvedRoot, packageJson),
    frameworks: detectFrameworks(resolvedRoot, packageJson),
    testFramework: detectTestFramework(resolvedRoot, packageJson),
    cicd: detectCiCd(resolvedRoot),
    entrypoints: detectEntrypoints(resolvedRoot, packageJson),
    hotspots: detectArchitecturalHotspots(resolvedRoot),
    keyDirectories: detectKeyDirectories(resolvedRoot),
    scripts,
    validationCommand: detectValidationCommand(packageManager, scripts),
    readmeSummary: summarizeReadme(resolvedRoot),
    markers: workspaceContext.markers,
    topLevelEntries: workspaceContext.topLevel.slice(0, 16),
  }
  return snapshot
}

export function renderLupinMd(snapshot, existingContent = '') {
  const manualSection = extractManualSection(existingContent)
  const lines = [
    '# LUPIN.md',
    '',
    'This file provides guidance to Lupin and other coding agents working in this repository.',
    '',
    '## Workspace Identity',
    '',
    `- Repository name: ${snapshot.repoName || 'unknown'}`,
    `- Workspace root: ${snapshot.workspaceRoot}`,
    `- Git root: ${snapshot.gitRoot || 'not detected'}`,
    '',
  ]

  lines.push('## Project Shape', '')
  lines.push(`- Detected stack: ${snapshot.stacks.length ? snapshot.stacks.join(', ') : 'unknown'}`)
  if (snapshot.frameworks.length) {
    lines.push(`- Frameworks: ${snapshot.frameworks.join(', ')}`)
  }
  if (snapshot.testFramework) {
    lines.push(`- Test framework: ${snapshot.testFramework}`)
  }
  if (snapshot.cicd.length) {
    lines.push(`- CI/CD: ${snapshot.cicd.join(', ')}`)
  }
  if (snapshot.readmeSummary) {
    lines.push(`- README summary: ${snapshot.readmeSummary}`)
  }
  if (snapshot.keyDirectories.length) {
    lines.push(`- Key directories: ${snapshot.keyDirectories.join(', ')}`)
  }
  if (snapshot.entrypoints.length) {
    lines.push(`- Likely entry files: ${snapshot.entrypoints.join(', ')}`)
  }
  if (snapshot.hotspots.length) {
    lines.push(`- Architectural hotspots: ${snapshot.hotspots.join(', ')}`)
  }
  if (snapshot.markers.length) {
    lines.push(`- Important root markers: ${snapshot.markers.join(', ')}`)
  }
  lines.push('')

  if (snapshot.packageManager || snapshot.scripts.length || snapshot.validationCommand) {
    lines.push('## Commands', '')
    if (snapshot.packageManager) {
      lines.push(`- Package manager: \`${snapshot.packageManager}\``)
    }
    if (snapshot.validationCommand) {
      lines.push(`- Verification: \`${snapshot.validationCommand}\``)
    }
    for (const script of snapshot.scripts) {
      lines.push(`- \`${script}\``)
    }
    lines.push('')
  }

  lines.push('## Working Rules', '')
  lines.push('- Stay within the current workspace root unless explicitly asked otherwise.')
  lines.push('- Inspect files before making claims about implementation details.')
  lines.push('- Prefer repo-native scripts and conventions over generic defaults.')
  lines.push('- For architecture questions, start from entry files and hotspots before diving into implementation details.')
  lines.push('- Before finishing code changes, mention what files changed and whether verification was run.')
  lines.push('')
  lines.push(manualSection, '')

  return lines.join('\n')
}

export function formatWorkspaceSnapshot(snapshot) {
  if (!snapshot) return 'Workspace snapshot: not initialized'

  const lines = [
    `Workspace snapshot: ${snapshot.workspaceRoot}`,
    `Initialized at: ${snapshot.createdAt}`,
    `Repo name: ${snapshot.repoName || 'unknown'}`,
    `Git root: ${snapshot.gitRoot || 'not detected'}`,
    `Package manager: ${snapshot.packageManager || 'not detected'}`,
    `Stacks: ${snapshot.stacks.length ? snapshot.stacks.join(', ') : 'none detected'}`,
    `Frameworks: ${snapshot.frameworks?.length ? snapshot.frameworks.join(', ') : 'none detected'}`,
    `Test framework: ${snapshot.testFramework || 'not detected'}`,
    `CI/CD: ${snapshot.cicd?.length ? snapshot.cicd.join(', ') : 'none detected'}`,
    `Verification: ${snapshot.validationCommand || 'not detected'}`,
    `Entrypoints: ${snapshot.entrypoints?.length ? snapshot.entrypoints.join(', ') : 'none detected'}`,
    `Hotspots: ${snapshot.hotspots?.length ? snapshot.hotspots.join(', ') : 'none detected'}`,
    `Key directories: ${snapshot.keyDirectories?.length ? snapshot.keyDirectories.join(', ') : 'none detected'}`,
    `Scripts: ${snapshot.scripts.length ? snapshot.scripts.join(' | ') : 'none detected'}`,
  ]

  return lines.join('\n')
}
