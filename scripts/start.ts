/**
 * Starts StyleCode for client work (`npm start`):
 *
 *   node --experimental-strip-types scripts/start.ts
 *
 * Builds the app if the build is missing or older than the sources, then
 * serves it on this computer with the local AI and workspace servers, using
 * the real data folder (`~/StyleCode Data`, or STYLECODE_WORKSPACE). Closing
 * the terminal, or pressing Ctrl+C, stops it. `npm run dev` is for
 * developing StyleCode only, and uses a separate data folder.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILT = join(ROOT, 'dist', 'index.html');
/** What the built app is made from. The servers in server/ run from source, so they don't need a build. */
const SOURCES = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json'];

/** The newest modification time under a path, in milliseconds. */
function newest(path: string): number {
  if (!existsSync(path)) return 0;
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;
  let latest = stats.mtimeMs;
  for (const entry of readdirSync(path)) latest = Math.max(latest, newest(join(path, entry)));
  return latest;
}

export function needsBuild(): boolean {
  if (!existsSync(BUILT)) return true;
  const built = statSync(BUILT).mtimeMs;
  return SOURCES.some((source) => newest(join(ROOT, source)) > built);
}

async function main(): Promise<void> {
  if (needsBuild()) {
    console.log('Building StyleCode (this happens once after each update)...');
    await build({ root: ROOT, logLevel: 'error' });
  }
  const server = await preview({ root: ROOT, preview: { port: 4173, open: false } });
  console.log('\nStyleCode is running. Open it in your browser:');
  server.printUrls();
  console.log('\nKeep this window open while you work. Closing it, or pressing Ctrl+C, stops StyleCode.\n');
}

main().catch((error: unknown) => {
  // A refused data folder explains itself; anything else gets its message, not a stack trace.
  console.error(`\nStyleCode didn't start. ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
