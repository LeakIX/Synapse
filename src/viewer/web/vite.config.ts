import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    // `bun run viewer` answers the JSON endpoints during development.
    proxy: {
      '/api': 'http://localhost:8090',
    },
  },
});
