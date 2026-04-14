function buildSnapshotSection(snapshot) {
  if (!snapshot) return null
  const parts = []
  if (snapshot.stacks?.length) parts.push(`Stack: ${snapshot.stacks.join(', ')}`)
  if (snapshot.frameworks?.length) parts.push(`Frameworks: ${snapshot.frameworks.join(', ')}`)
  if (snapshot.testFramework) parts.push(`Test framework: ${snapshot.testFramework}`)
  if (snapshot.packageManager) parts.push(`Package manager: ${snapshot.packageManager}`)
  if (snapshot.validationCommand) parts.push(`Verify: \`${snapshot.validationCommand}\``)
  if (snapshot.entrypoints?.length) parts.push(`Entry files: ${snapshot.entrypoints.join(', ')}`)
  if (snapshot.hotspots?.length) parts.push(`Hotspots: ${snapshot.hotspots.join(', ')}`)
  if (snapshot.scripts?.length) parts.push(`Scripts: ${snapshot.scripts.join(' | ')}`)
  if (!parts.length) return null
  return 'Project shape:\n' + parts.join('\n')
}

function buildPreloadSection(preloadedFiles) {
  if (!preloadedFiles?.length) return null
  const lines = ['Current workspace files (already loaded — no need to read them again):']
  for (const f of preloadedFiles) {
    lines.push(`\n### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
  }
  return lines.join('\n')
}

export function buildSystemPrompt(tools, workspaceContext, snapshot = null, preloadedFiles = null) {
  const toolLines = tools
    .map(t => `- ${t.name}: ${t.description} | args: ${JSON.stringify(t.schema)}`)
    .join('\n')

  const workspaceLines = [
    `Root: ${workspaceContext.projectRoot}`,
    `Git: ${workspaceContext.gitRoot || 'none'}`,
    `Markers: ${workspaceContext.markers.length ? workspaceContext.markers.join(', ') : 'none'}`,
    `README: ${workspaceContext.readmeSummary || 'none'}`,
    'Top-level:',
    ...(workspaceContext.topLevel.length ? workspaceContext.topLevel : ['(empty)']),
  ].join('\n')

  const instructionLines = workspaceContext.instructionFiles?.length
    ? workspaceContext.instructionFiles
        .map(f => `[${f.path}]:\n${f.content}`)
        .join('\n\n')
    : 'none'

  const snapshotSection = buildSnapshotSection(snapshot)
  const preloadSection = buildPreloadSection(preloadedFiles)

  return [
    'You are Lupin, a local coding agent. You work only inside the current workspace.',
    'Output ONLY valid JSON. No prose, no markdown outside JSON.',
    '',
    'ONLY two allowed output shapes:',
    '1. Tool call:   {"type":"tool_call","tool":"ToolName","args":{...}}',
    '2. Final answer: {"type":"final","content":"your answer here"}',
    '',
    'RULES:',
    '- Never output anything except one of the two JSON shapes above.',
    '- To read files: use FileReadTool or FileBatchReadTool (not bash cat).',
    '- To list files: use GlobTool with a regex pattern (e.g. "\\\\.js$" not "*.js").',
    '- To write a new file: use FileWriteTool.',
    '- To edit an existing file: use FileEditTool.',
    '- To delete a file: use FileDeleteTool.',
    '- To run a shell command: use BashTool.',
    '- If a tool returns an error, fix the args and retry with a different approach.',
    '- Mirror the user language (Italian or English).',
    '',
    'Workspace:',
    workspaceLines,
    ...(snapshotSection ? ['', snapshotSection] : []),
    '',
    'Instructions:',
    instructionLines,
    ...(preloadSection ? ['', preloadSection] : []),
    '',
    'Tools:',
    toolLines,
  ].join('\n')
}
