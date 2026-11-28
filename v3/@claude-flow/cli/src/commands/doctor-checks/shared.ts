/**
 * Shared types and the command runner for the doctor checks.
 * Split out of commands/doctor.ts (#4773).
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';

// Promisified exec with proper shell and env inheritance for cross-platform support
const execAsync = promisify(exec);
export const execFileAsync = promisify(execFile);

/**
 * Execute command asynchronously with proper environment inheritance
 * Critical for Windows where PATH may not be inherited properly
 */
export async function runCommand(command: string, timeoutMs: number = 5000): Promise<string> {
  const { stdout } = await execAsync(command, {
    encoding: 'utf8' as BufferEncoding,
    timeout: timeoutMs,
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', // Use proper shell per platform
    env: { ...process.env }, // Explicitly inherit full environment
    windowsHide: true, // Hide window on Windows
  });
  return (stdout as string).trim();
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}
