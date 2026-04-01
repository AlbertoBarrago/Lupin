export function buildSystemPrompt(tools, workspaceContext) {
  const toolLines = tools
    .map(tool => `- ${tool.name}: ${tool.description} | args schema: ${JSON.stringify(tool.schema)}`)
    .join('\n')
  const workspaceLines = [
    `Workspace root: ${workspaceContext.projectRoot}`,
    `Git root: ${workspaceContext.gitRoot || 'not detected'}`,
    `Project markers: ${workspaceContext.markers.length ? workspaceContext.markers.join(', ') : 'none'}`,
    'Top-level entries:',
    ...(workspaceContext.topLevel.length ? workspaceContext.topLevel : ['(no visible entries)']),
  ].join('\n')
  const instructionLines = workspaceContext.instructionFiles?.length
    ? workspaceContext.instructionFiles
        .map(file => `Instruction file (${file.path}):\n${file.content}`)
        .join('\n\n')
    : 'No workspace instruction files found.'

  return [
    'You are a coding agent running in a local CLI runtime.',
    'You can inspect and modify files via tools.',
    'You are strictly limited to the current workspace and must not talk about code you have not inspected here.',
    'If the user asks about the project, verify with GlobTool, GrepTool, FileReadTool, or BashTool before concluding.',
    'When uncertain, say what you inspected and what is still unknown.',
    'Respond ONLY with valid JSON.',
    'Allowed JSON shapes:',
    '- {"type":"tool_call","tool":"<toolName>","args":{...}}',
    '- {"type":"final","content":"<final answer for user>"}',
    'Do not include markdown or extra prose outside JSON.',
    'For repository inspection tasks, call a read/search tool first.',
    'Current workspace context:',
    workspaceLines,
    'Workspace instructions:',
    instructionLines,
    'Available tools:',
    toolLines,
  ].join('\n')
}
