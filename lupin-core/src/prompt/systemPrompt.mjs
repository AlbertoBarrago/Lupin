/** @module systemPrompt */

/**
 * Builds a human-readable "Project shape" section from a workspace snapshot.
 *
 * @param {object|null} snapshot - The workspace snapshot produced by workspaceInit.
 * @param {string[]}  [snapshot.stacks]           - Detected language/runtime stacks.
 * @param {string[]}  [snapshot.frameworks]        - Detected frameworks.
 * @param {string}    [snapshot.testFramework]     - Detected test framework name.
 * @param {string}    [snapshot.packageManager]    - Detected package manager (npm, pnpm, …).
 * @param {string}    [snapshot.validationCommand] - Command used to verify the build/tests.
 * @param {string[]}  [snapshot.entrypoints]       - Primary entry-point file paths.
 * @param {string[]}  [snapshot.hotspots]          - Frequently-touched file paths.
 * @param {string[]}  [snapshot.scripts]           - Notable package/task scripts.
 * @returns {string|null} A formatted multi-line string, or `null` when the snapshot
 *   is absent or yields no displayable fields.
 */
function buildSnapshotSection(snapshot) {
  if (!snapshot) return null;
  const parts = [];
  if (snapshot.stacks?.length)
    parts.push(`Stack: ${snapshot.stacks.join(", ")}`);
  if (snapshot.frameworks?.length)
    parts.push(`Frameworks: ${snapshot.frameworks.join(", ")}`);
  if (snapshot.testFramework)
    parts.push(`Test framework: ${snapshot.testFramework}`);
  if (snapshot.packageManager)
    parts.push(`Package manager: ${snapshot.packageManager}`);
  if (snapshot.validationCommand)
    parts.push(`Verify: \`${snapshot.validationCommand}\``);
  if (snapshot.entrypoints?.length)
    parts.push(`Entry files: ${snapshot.entrypoints.join(", ")}`);
  if (snapshot.hotspots?.length)
    parts.push(`Hotspots: ${snapshot.hotspots.join(", ")}`);
  if (snapshot.scripts?.length)
    parts.push(`Scripts: ${snapshot.scripts.join(" | ")}`);
  if (!parts.length) return null;
  return "Project shape:\n" + parts.join("\n");
}

/**
 * Builds a fenced-code-block section listing files that have already been
 * pre-loaded into the prompt, so the model knows it does not need to re-read them.
 *
 * @param {Array<{path: string, content: string}>|null|undefined} preloadedFiles
 *   Array of file objects with their paths and string contents.
 * @returns {string|null} A formatted multi-line string containing each file wrapped
 *   in a Markdown fenced block, or `null` when the array is empty or nullish.
 */
function buildPreloadSection(preloadedFiles) {
  if (!preloadedFiles?.length) return null;
  const lines = [
    "Current workspace files (already loaded — no need to read them again):",
  ];
  for (const f of preloadedFiles) {
    lines.push(`\n### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``);
  }
  return lines.join("\n");
}

/**
 * Assembles the full system prompt that is injected at the start of every task.
 *
 * The prompt includes:
 * - Agent identity and strict JSON-output rules
 * - Available tool catalogue with argument schemas
 * - Workspace metadata (root, git root, framework markers, README summary)
 * - Optional project-shape section derived from a saved snapshot
 * - Any instruction files found in the workspace (LUPIN.md, CLAUDE.md, etc.)
 * - Optional pre-loaded file contents
 *
 * @param {Array<{name: string, description: string, schema: object}>} tools
 *   The registered tools to advertise to the model.
 * @param {{
 *   projectRoot: string,
 *   gitRoot: string|null,
 *   markers: string[],
 *   readmeSummary: string|null,
 *   topLevel: string[],
 *   instructionFiles?: Array<{path: string, content: string}>
 * }} workspaceContext - Workspace metadata built by `workspaceContext.mjs`.
 * @param {object|null} [snapshot=null] - Optional workspace snapshot; passed to
 *   {@link buildSnapshotSection}.
 * @param {Array<{path: string, content: string}>|null} [preloadedFiles=null]
 *   Optional array of already-loaded files; passed to {@link buildPreloadSection}.
 * @returns {string} The complete system prompt as a single newline-joined string.
 */
export function buildSystemPrompt(
  tools,
  workspaceContext,
  snapshot = null,
  preloadedFiles = null,
) {
  const toolLines = tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description} | args: ${JSON.stringify(t.schema)}`,
    )
    .join("\n");

  const workspaceLines = [
    `Root: ${workspaceContext.projectRoot}`,
    `Git: ${workspaceContext.gitRoot || "none"}`,
    `Markers: ${workspaceContext.markers.length ? workspaceContext.markers.join(", ") : "none"}`,
    `README: ${workspaceContext.readmeSummary || "none"}`,
    "Top-level:",
    ...(workspaceContext.topLevel.length
      ? workspaceContext.topLevel
      : ["(empty)"]),
  ].join("\n");

  const instructionLines = workspaceContext.instructionFiles?.length
    ? workspaceContext.instructionFiles
        .map((f) => `[${f.path}]:\n${f.content}`)
        .join("\n\n")
    : "none";

  const snapshotSection = buildSnapshotSection(snapshot);
  const preloadSection = buildPreloadSection(preloadedFiles);

  return [
    "You are Lupin, a local coding agent. You work only inside the current workspace.",
    "Output ONLY valid JSON. No prose, no markdown outside JSON.",
    "",
    "ONLY two allowed output shapes:",
    '1. Tool call:   {"type":"tool_call","tool":"ToolName","args":{...}}',
    '2. Final answer: {"type":"final","content":"your answer here"}',
    "",
    "RULES:",
    "- Never output anything except one of the two JSON shapes above.",
    "- To read files: use FileReadTool or FileBatchReadTool (not bash cat).",
    '- To list files: use GlobTool with a regex pattern (e.g. "\\\\.js$" not "*.js").',
    "- To write a new file: use FileWriteTool.",
    "- To edit an existing file: use FileEditTool. PREFER line-range mode (lineStart+lineEnd+newText) — read the file first to get line numbers, then replace the exact line range. Fall back to oldText/newText only for single-line or trivial changes.",
    "- To delete a file: use FileDeleteTool.",
    "- To run a shell command: use BashTool.",
    "- To search the web: use WebSearchTool with a query. Returns titles, URLs, snippets.",
    "- To read a web page or article: use WebFetchTool with the full URL.",
    "- If a tool returns an error, fix the args and retry with a different approach.",
    "- Mirror the user language (Italian or English).",
    "",
    "Workspace:",
    workspaceLines,
    ...(snapshotSection ? ["", snapshotSection] : []),
    "",
    "Instructions:",
    instructionLines,
    ...(preloadSection ? ["", preloadSection] : []),
    "",
    "Tools:",
    toolLines,
  ].join("\n");
}
