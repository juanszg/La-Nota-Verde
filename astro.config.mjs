import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { alphaTab } from '@coderline/alphatab-vite';

export default defineConfig({
  vite: {
    plugins: [...alphaTab(), tailwindcss()],
  },
});
