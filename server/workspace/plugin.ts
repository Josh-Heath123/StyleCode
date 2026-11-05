import type { Plugin } from 'vite';
import { claimDataFolder, prepareDataFolder, type WorkspaceMode } from './folder.ts';
import { createWorkspaceHandler } from './handler.ts';

/**
 * Adds the workspace routes (/api/workspace/…) to Vite's dev server and to
 * `vite preview`. The dev server (`npm run dev`) uses the development data
 * folder; the preview server (`npm start`) uses the real one. If the folder
 * can't be used (it is inside a git repository), the server refuses to start
 * and says why.
 *
 * A static copy of the built app (the GitHub Pages demo) has no such routes,
 * and the app opens on the editor there.
 */
export function stylecodeWorkspace(): Plugin {
  let root = process.cwd();
  const mount = (mode: WorkspaceMode, middlewares: { use: (path: string, fn: unknown) => void }) => {
    const folder = prepareDataFolder(mode, root);
    claimDataFolder(folder.path);
    middlewares.use('/api/workspace', createWorkspaceHandler(folder));
    const where = `StyleCode data folder: ${folder.path}`;
    console.log(
      folder.cloudService
        ? `${where}\n  Warning: ${folder.cloudService} seems to sync this folder, so client data leaves this computer.`
        : where,
    );
  };
  return {
    name: 'stylecode-workspace',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      // Vitest starts a Vite server too; unit tests make their own folders.
      if (process.env.VITEST) return;
      mount('development', server.middlewares as never);
    },
    configurePreviewServer(server) {
      mount('start', server.middlewares as never);
    },
  };
}
