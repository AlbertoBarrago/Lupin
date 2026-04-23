import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderLupinMd, formatWorkspaceSnapshot } from '../src/core/workspaceInit.mjs'

const baseSnapshot = {
  createdAt: '2026-01-01T00:00:00.000Z',
  workspaceRoot: '/tmp/my-project',
  gitRoot: '/tmp/my-project',
  repoName: 'my-project',
  packageManager: 'npm',
  stacks: ['node', 'typescript'],
  frameworks: ['Express'],
  testFramework: 'Vitest',
  cicd: ['GitHub Actions'],
  entrypoints: ['src/index.mjs'],
  hotspots: ['src/ (12 files)'],
  keyDirectories: ['src', 'tests'],
  scripts: ['dev: node src/index.mjs', 'test: vitest'],
  validationCommand: 'npm test',
  readmeSummary: 'A Node.js project.',
  markers: ['package.json', 'tsconfig.json'],
  topLevelEntries: ['[dir] src', '[file] package.json'],
}

test('renderLupinMd: includes repo name', () => {
  const md = renderLupinMd(baseSnapshot)
  assert.ok(md.includes('my-project'))
})

test('renderLupinMd: includes detected stacks', () => {
  const md = renderLupinMd(baseSnapshot)
  assert.ok(md.includes('node'))
  assert.ok(md.includes('typescript'))
})

test('renderLupinMd: includes test framework', () => {
  const md = renderLupinMd(baseSnapshot)
  assert.ok(md.includes('Vitest'))
})

test('renderLupinMd: includes validation command', () => {
  const md = renderLupinMd(baseSnapshot)
  assert.ok(md.includes('npm test'))
})

test('renderLupinMd: includes default Owner Preferences when no existing content', () => {
  const md = renderLupinMd(baseSnapshot, '')
  assert.ok(md.includes('## Owner Preferences'))
  assert.ok(md.includes('experienced engineer'))
})

test('renderLupinMd: preserves existing Owner Preferences section', () => {
  const existing = '## Owner Preferences\n\n- Custom rule here.\n'
  const md = renderLupinMd(baseSnapshot, existing)
  assert.ok(md.includes('Custom rule here.'))
  assert.ok(!md.includes('experienced engineer'))
})

test('formatWorkspaceSnapshot: returns non-empty string', () => {
  const s = formatWorkspaceSnapshot(baseSnapshot)
  assert.ok(typeof s === 'string')
  assert.ok(s.length > 0)
})

test('formatWorkspaceSnapshot: includes key fields', () => {
  const s = formatWorkspaceSnapshot(baseSnapshot)
  assert.ok(s.includes('my-project'))
  assert.ok(s.includes('npm'))
  assert.ok(s.includes('Vitest'))
})

test('formatWorkspaceSnapshot: handles null gracefully', () => {
  const s = formatWorkspaceSnapshot(null)
  assert.ok(s.includes('not initialized'))
})
