import { enforcePolicy } from './permissions.mjs'
import { buildWorkspaceContext } from './workspaceContext.mjs'

export class ToolRuntime {
  constructor({ projectRoot, tools, securityConfig, debug = false }) {
    this.projectRoot = projectRoot
    this.tools = new Map(tools.map(tool => [tool.name, tool]))
    this.securityConfig = securityConfig
    this.debug = debug
    this.workspaceContext = buildWorkspaceContext(projectRoot)
  }

  listTools() {
    return [...this.tools.values()].map(tool => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    }))
  }

  getWorkspaceContext() {
    return this.workspaceContext
  }

  async execute(toolName, args = {}) {
    const tool = this.tools.get(toolName)
    if (!tool) {
      return { ok: false, error: `unknown tool: ${toolName}` }
    }

    const policy = enforcePolicy(toolName, args, this.securityConfig)
    if (!policy.allowed) {
      return {
        ok: false,
        error: policy.reason || 'blocked by policy',
        risk: policy.risk,
      }
    }

    try {
      const result = await tool.run(args, {
        projectRoot: this.projectRoot,
      })
      return {
        ok: true,
        tool: toolName,
        risk: policy.risk,
        result,
      }
    } catch (error) {
      return {
        ok: false,
        tool: toolName,
        risk: policy.risk,
        error: String(error?.message || error),
      }
    }
  }
}
