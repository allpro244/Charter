import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The big-world test (CLAUDE.md rule 6) asserts its own 60 second budget.
    // The timeout is above that so a slow run fails on the assertion, not the timer.
    testTimeout: 120_000,
  },
});
