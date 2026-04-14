import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DATA_DIR_NAME = '.data'
const WORKSPACES_DIR_NAME = 'workspaces'

function toWorkspaceKey(workspaceRoot) {
  const normalized = path.resolve(String(workspaceRoot || '.'))
  return crypto.createHash('sha1').update(normalized).digest('hex')
}

function defaultData() {
  return {
    createdAt: new Date().toISOString(),
    workspaceRoot: null,
    workspaceSnapshot: null,
    conversation: [],
  }
}

export class SessionStore {
  constructor(projectDir, workspaceRoot) {
    this.projectDir = projectDir
    this.workspaceRoot = path.resolve(String(workspaceRoot || projectDir))
    this.dataDir = path.join(projectDir, DATA_DIR_NAME)
    this.workspacesDir = path.join(this.dataDir, WORKSPACES_DIR_NAME)
    this.filePath = path.join(this.workspacesDir, `${toWorkspaceKey(this.workspaceRoot)}.json`)
    this.state = defaultData()
  }

  async init() {
    await fs.promises.mkdir(this.workspacesDir, { recursive: true })
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      this.state = {
        createdAt: parsed.createdAt || new Date().toISOString(),
        workspaceRoot: parsed.workspaceRoot || this.workspaceRoot,
        workspaceSnapshot: parsed.workspaceSnapshot ?? null,
        conversation: Array.isArray(parsed.conversation) ? parsed.conversation : [],
      }
    } catch {
      this.state = defaultData()
      this.state.workspaceRoot = this.workspaceRoot
      await this.save()
    }
  }

  append(role, content) {
    this.appendWithMeta(role, content, {})
  }

  appendWithMeta(role, content, meta = {}) {
    this.state.conversation.push({
      role,
      content,
      kind: meta.kind || 'generic',
      mode: meta.mode || null,
      at: new Date().toISOString(),
    })
    if (this.state.conversation.length > 400) {
      this.state.conversation = this.state.conversation.slice(-400)
    }
  }

  getWorkspaceSnapshot() {
    return this.state.workspaceSnapshot ?? null
  }

  setWorkspaceSnapshot(value) {
    this.state.workspaceSnapshot = value ?? null
  }

  getModelHistory(limit = 16, options = {}) {
    const allowedKinds = Array.isArray(options.kinds) && options.kinds.length
      ? new Set(options.kinds)
      : null

    return this.state.conversation
      .filter(item => item.role === 'user' || item.role === 'assistant')
      .filter(item => {
        if (!allowedKinds) return true
        return allowedKinds.has(item.kind || 'generic')
      })
      .slice(-limit)
      .map(item => ({
        role: item.role,
        content: item.content,
      }))
  }

  async save() {
    await fs.promises.writeFile(
      this.filePath,
      JSON.stringify(this.state, null, 2) + '\n',
      'utf8',
    )
  }
}
