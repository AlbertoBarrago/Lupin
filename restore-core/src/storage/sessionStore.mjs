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
    mgCompanion: null,
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
        mgCompanion: parsed.mgCompanion ?? null,
      }
    } catch {
      this.state = defaultData()
      this.state.workspaceRoot = this.workspaceRoot
      await this.save()
    }
  }

  append(role, content) {
    this.state.conversation.push({
      role,
      content,
      at: new Date().toISOString(),
    })
    if (this.state.conversation.length > 400) {
      this.state.conversation = this.state.conversation.slice(-400)
    }
  }

  getMgCompanion() {
    return this.state.mgCompanion ?? null
  }

  getWorkspaceSnapshot() {
    return this.state.workspaceSnapshot ?? null
  }

  setWorkspaceSnapshot(value) {
    this.state.workspaceSnapshot = value ?? null
  }

  setMgCompanion(value) {
    this.state.mgCompanion = value ?? null
  }

  getModelHistory(limit = 16) {
    return this.state.conversation
      .filter(item => item.role === 'user' || item.role === 'assistant')
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
