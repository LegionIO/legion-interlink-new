import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import { branding } from './branding.config';

// ---------------------------------------------------------------------------
// Build a Vite `define` map from branding.config.ts so that every key is
// available as a compile-time constant in all three Electron build targets.
//
//   branding.productName  →  __BRAND_PRODUCT_NAME  (string literal at build time)
//   branding.appSlug      →  __BRAND_APP_SLUG
//   …etc.
// ---------------------------------------------------------------------------
function camelToScreamingSnake(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').toUpperCase();
}

const brandDefines: Record<string, string> = {};
for (const [key, value] of Object.entries(branding)) {
  brandDefines[`__BRAND_${camelToScreamingSnake(key)}`] = JSON.stringify(value);
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: brandDefines,
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define: brandDefines,
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts'),
        },
      },
    },
  },
  renderer: {
    root: 'src',
    plugins: [react()],
    define: brandDefines,
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()],
      },
    },
  },
});
