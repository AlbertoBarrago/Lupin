import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execCb)

export const BashTool = {
  name: 'BashTool',
  description: 'Run a shell command in workspace root and capture stdout/stderr.',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
    },
    required: ['command'],
  },
  async run(args, ctx) {
    const command = String(args?.command || '').trim()
    if (!command) {
      throw new Error('missing command')
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.projectRoot,
        timeout: 20000,
        maxBuffer: 2 * 1024 * 1024,
        shell: '/bin/zsh',
      })
      return {
        exitCode: 0,
        stdout: String(stdout || '').slice(0, 16000),
        stderr: String(stderr || '').slice(0, 8000),
      }
    } catch (error) {
      return {
        exitCode: Number.isFinite(error?.code) ? error.code : 1,
        stdout: String(error?.stdout || '').slice(0, 16000),
        stderr: String(error?.stderr || error?.message || '').slice(0, 8000),
      }
    }
  },
}
