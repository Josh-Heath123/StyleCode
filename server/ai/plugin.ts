import type { Plugin } from 'vite';
import { createAiHandler } from './handler.ts';

/**
 * Adds the local AI routes (/api/ai/…) to Vite's dev server and to
 * `vite preview`, so AI works whichever way StyleCode is run on this
 * computer. A static copy of the built app on some other host has no such
 * routes, and the app treats AI as unavailable there.
 */
export function stylecodeAi(): Plugin {
  const handler = createAiHandler();
  const mount = (middlewares: { use: (path: string, fn: typeof handler) => void }) => middlewares.use('/api/ai', handler);
  return {
    name: 'stylecode-ai',
    configureServer(server) {
      mount(server.middlewares as never);
    },
    configurePreviewServer(server) {
      mount(server.middlewares as never);
    },
  };
}
