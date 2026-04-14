function buildSnapshotSection(snapshot) {
  if (!snapshot) return null
  const parts = []
  if (snapshot.stacks?.length) parts.push(`Stack: ${snapshot.stacks.join(', ')}`)
  if (snapshot.frameworks?.length) parts.push(`Frameworks: ${snapshot.frameworks.join(', ')}`)
  if (snapshot.testFramework) parts.push(`Test framework: ${snapshot.testFramework}`)
  if (snapshot.packageManager) parts.push(`Package manager: ${snapshot.packageManager}`)
  if (snapshot.validationCommand) parts.push(`Verification command: \`${snapshot.validationCommand}\``)
  if (snapshot.entrypoints?.length) parts.push(`Entry files: ${snapshot.entrypoints.join(', ')}`)
  if (snapshot.hotspots?.length) parts.push(`Architectural hotspots: ${snapshot.hotspots.join(', ')}`)
  if (snapshot.scripts?.length) parts.push(`Scripts: ${snapshot.scripts.join(' | ')}`)
  if (snapshot.cicd?.length) parts.push(`CI/CD: ${snapshot.cicd.join(', ')}`)
  if (!parts.length) return null
  return 'Detected project shape:\n' + parts.join('\n')
}

export function buildSystemPrompt(tools, workspaceContext, snapshot = null) {
  const toolLines = tools
    .map(tool => `- ${tool.name}: ${tool.description} | args schema: ${JSON.stringify(tool.schema)}`)
    .join('\n')
  const workspaceLines = [
    `Workspace root: ${workspaceContext.projectRoot}`,
    `Git root: ${workspaceContext.gitRoot || 'not detected'}`,
    `Project markers: ${workspaceContext.markers.length ? workspaceContext.markers.join(', ') : 'none'}`,
    `README summary: ${workspaceContext.readmeSummary || 'not available'}`,
    'Top-level entries:',
    ...(workspaceContext.topLevel.length ? workspaceContext.topLevel : ['(no visible entries)']),
  ].join('\n')
  const instructionLines = workspaceContext.instructionFiles?.length
    ? workspaceContext.instructionFiles
        .map(file => `Instruction file (${file.path}):\n${file.content}`)
        .join('\n\n')
    : 'No workspace instruction files found.'

  const snapshotSection = buildSnapshotSection(snapshot)

  return [
    'You are Lupin, a coding agent running in a local CLI runtime.',
    'You can inspect and modify files via tools.',
    'You are strictly limited to the current workspace and must not talk about code you have not inspected here.',
    'If the user asks about the project, verify with GlobTool, GrepTool, FileReadTool, or BashTool before concluding.',
    'For implementation or bug-fix tasks, inspect relevant files before editing, then verify the result before the final answer.',
    'When discussing architecture or behavior, ground your answer in inspected files, commands, or explicit workspace instructions.',
    'Mirror the user language. Keep answers direct, precise, and practical.',
    'When uncertain, say what you inspected and what is still unknown.',
    'Respond ONLY with valid JSON.',
    'Allowed JSON shapes:',
    '- {"type":"tool_call","tool":"<toolName>","args":{...}}',
    '- {"type":"final","content":"<final answer for user>"}',
    'Do not include markdown or extra prose outside JSON.',
    'For repository inspection tasks, call a read/search tool first.',
    'Prefer using GlobTool, GrepTool, and FileReadTool before BashTool unless shell execution is genuinely the fastest path.',
    'When you need to read several files at once (e.g. all docs, all source files matching a pattern), use FileBatchReadTool instead of multiple FileReadTool calls.',
    'File deletion within the workspace is a normal operation. Use FileDeleteTool when the user asks to delete a file.',
    'Current workspace context:',
    workspaceLines,
    ...(snapshotSection ? [snapshotSection] : []),
    'Workspace instructions:',
    instructionLines,
    'Available tools:',
    toolLines,
  ].join('\n')
}
