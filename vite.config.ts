import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is served from https://<user>.github.io/house-modeler/
export default defineConfig({
  base: '/house-modeler/',
  plugins: [react()],
});
