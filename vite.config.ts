/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stylecodeAi } from './server/ai/plugin.ts';
import { stylecodeWorkspace } from './server/workspace/plugin.ts';

export default defineConfig({
  plugins: [react(), stylecodeAi(), stylecodeWorkspace()],
  // No CORS headers, from Vite or the local APIs: only StyleCode's own page may use /api (ADR-0008).
  server: { port: 5173, open: false, cors: false },
  preview: { cors: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
