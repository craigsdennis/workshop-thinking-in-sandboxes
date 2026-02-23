import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [cloudflare(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  }
});
