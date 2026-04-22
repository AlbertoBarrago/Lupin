/**
 * @module permissions
 * @description Security policy enforcement for the tool runtime.
 * Classifies tool risk levels and blocks dangerous bash commands
 * before they reach the shell.
 */

/**
 * Regular-expression patterns that identify shell commands considered
 * too destructive to run without explicit operator approval.
 * Any `BashTool` invocation whose `command` string matches one of these
 * patterns will be denied when `denyDangerousBash` is enabled.
 *
 * @type {RegExp[]}
 */
const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+checkout\s+--\b/i,
  />\s*\/dev\/sd[a-z]/i,
]

/**
 * Returns a broad risk classification for a given tool name.
 *
 * | Risk level | Tools                                          |
 * |------------|------------------------------------------------|
 * | `LOW`      | `FileReadTool`, `GlobTool`, `GrepTool`         |
 * | `MEDIUM`   | `FileWriteTool`, `FileEditTool`, unknown tools |
 * | `HIGH`     | `BashTool`                                     |
 *
 * @param {string} toolName - The registered name of the tool being invoked.
 * @returns {'LOW' | 'MEDIUM' | 'HIGH'} The risk level assigned to the tool.
 */
export function classifyRisk(toolName) {
  if (
    toolName === 'FileReadTool' ||
    toolName === 'GlobTool' ||
    toolName === 'GrepTool'
  ) {
    return 'LOW'
  }
  if (toolName === 'FileWriteTool' || toolName === 'FileEditTool') {
    return 'MEDIUM'
  }
  if (toolName === 'BashTool') {
    return 'HIGH'
  }
  return 'MEDIUM'
}

/**
 * Evaluates whether a tool invocation is permitted under the active
 * security configuration.
 *
 * Currently the only enforced rule is: when `securityConfig.denyDangerousBash`
 * is `true`, any `BashTool` call whose `command` argument matches a pattern in
 * {@link DANGEROUS_BASH_PATTERNS} is rejected.
 *
 * @param {string} toolName - The registered name of the tool being invoked.
 * @param {Record<string, unknown>} args - The raw arguments passed to the tool.
 * @param {{ denyDangerousBash: boolean }} securityConfig - Security settings
 *   derived from the agent configuration (see `loadConfig`).
 * @returns {{ allowed: boolean, risk: 'LOW' | 'MEDIUM' | 'HIGH', reason?: string }}
 *   An object indicating whether execution is permitted, the assessed risk
 *   level, and an optional human-readable `reason` when `allowed` is `false`.
 */
export function enforcePolicy(toolName, args, securityConfig) {
  const risk = classifyRisk(toolName)
  if (toolName === 'BashTool' && securityConfig.denyDangerousBash) {
    const command = String(args?.command || '')
    const blocked = DANGEROUS_BASH_PATTERNS.find(pattern => pattern.test(command))
    if (blocked) {
      return {
        allowed: false,
        risk,
        reason: 'command blocked by security policy',
      }
    }
  }

  return { allowed: true, risk }
}
