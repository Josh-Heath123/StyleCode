import { readFile, rename } from 'node:fs/promises';

/**
 * Error codes Windows gives when antivirus, search indexing or backup software
 * briefly holds the file being replaced. They usually clear within moments.
 */
const TRANSIENT = new Set(['EPERM', 'EBUSY']);

export interface RetryOptions {
  /** How many times to try in all. */
  attempts?: number;
  /** Wait before the first retry, doubled after each one. */
  delayMs?: number;
  /** For tests: the rename to use. */
  renameFile?: (from: string, to: string) => Promise<void>;
}

/**
 * Renames a file over another, retrying a few times when Windows reports the
 * target as busy (ADR-0006). Any other error, or the last failure, is thrown,
 * so the caller can report a failed save.
 */
export async function renameWithRetry(from: string, to: string, options: RetryOptions = {}): Promise<void> {
  // Six tries over about three seconds (0.1, 0.2, 0.4, 0.8 and 1.6 s between them).
  const { attempts = 6, delayMs = 100, renameFile = rename } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await renameFile(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || !code || !TRANSIENT.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
    }
  }
}

/**
 * Reads a file, retrying as `renameWithRetry` does when Windows reports it
 * busy, as it can while another request is renaming a new copy over it.
 */
export async function readWithRetry(
  path: string,
  options: { attempts?: number; delayMs?: number; readFile?: (path: string) => Promise<Buffer> } = {},
): Promise<Buffer> {
  const { attempts = 6, delayMs = 100, readFile: read = readFile } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await read(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || !code || !TRANSIENT.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
    }
  }
}
