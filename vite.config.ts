/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stylecodeAi } from './server/ai/plugin.ts';

export default defineConfig({
  plugins: [react(), stylecodeAi()],
  server: { port: 5173, open: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
