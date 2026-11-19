import { rm } from 'node:fs/promises'

/**
 * Removes a spec's temporary folder, waiting out `EBUSY`. On Windows a folder cannot be deleted while a process started in it (a stand-in CLI,
 * a spawned reader) is still exiting, and that failed a whole spec file after all its tests had passed. Only the async `rm` retries that error:
 * `rmSync` fails at once whatever `maxRetries` says (measured on Node 22). Up to about 5 s of waiting; on Linux and macOS it returns at once.
 */
export const removeTree = (path: string): Promise<void> => rm(path, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })
