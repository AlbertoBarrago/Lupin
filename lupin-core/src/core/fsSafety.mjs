/**
 * @module fsSafety
 * @description Filesystem safety utilities for constraining all path
 * operations to the workspace root. Prevents path-traversal attacks by
 * rejecting any resolved path that escapes the project root directory.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Resolves a (possibly relative) path and asserts it stays inside the workspace.
 *
 * @param {string} projectRoot - Absolute path to the workspace root.
 * @param {string} maybeRelativePath - Path supplied by the caller; may be
 *   relative (resolved against `projectRoot`) or absolute.
 * @returns {string} The resolved absolute path, guaranteed to be inside
 *   `projectRoot`.
 * @throws {Error} If `maybeRelativePath` is empty.
 * @throws {Error} If the resolved path escapes the workspace root.
 */
export function resolveInsideWorkspace(projectRoot, maybeRelativePath) {
  const raw = String(maybeRelativePath || "").trim();
  if (!raw) {
    throw new Error("missing path");
  }
  const abs = path.resolve(projectRoot, raw);
  const rel = path.relative(projectRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path outside workspace: ${raw}`);
  }
  return abs;
}

/**
 * Converts an absolute path to a path relative to the workspace root.
 *
 * @param {string} projectRoot - Absolute path to the workspace root.
 * @param {string} absPath - Absolute path to convert.
 * @returns {string} The path expressed relative to `projectRoot`.
 */
export function toWorkspaceRelative(projectRoot, absPath) {
  return path.relative(projectRoot, absPath);
}

/**
 * Checks whether a file or directory exists at the given absolute path.
 *
 * @param {string} absPath - Absolute path to test.
 * @returns {Promise<boolean>} `true` if the path is accessible, `false`
 *   otherwise.
 */
export async function fileExists(absPath) {
  try {
    await fs.promises.access(absPath);
    return true;
  } catch {
    return false;
  }
}
