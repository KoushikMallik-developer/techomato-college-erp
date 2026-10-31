import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Rules tests need the Firestore emulator and run through `npm run test:rules`.
  test: { environment: 'node', include: ['tests/**/*.test.js'], exclude: ['tests/rules/**', 'node_modules/**'] },
});
