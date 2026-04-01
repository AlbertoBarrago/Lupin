const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+checkout\s+--\b/i,
  />\s*\/dev\/sd[a-z]/i,
]

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
