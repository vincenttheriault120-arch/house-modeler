import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset paths, so the same build works at the site root and in PR preview folders.
export default defineConfig({
  base: './',
  plugins: [react()],
});
