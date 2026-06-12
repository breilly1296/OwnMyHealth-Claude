import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Derive the API origin from VITE_API_URL (e.g. https://api-staging.ownmyhealth.io
 * from https://api-staging.ownmyhealth.io/api/v1). Returns null when the value is
 * unset, relative, or non-http(s) — in those cases the CSP meta is left untouched.
 */
function apiOriginFromEnv(rawApiUrl: string | undefined): string | null {
  if (!rawApiUrl) return null;
  try {
    const url = new URL(rawApiUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Rewrite the connect-src directive of the CSP <meta> in index.html so each
 * build mode allows its own API origin (index.html ships the production origin
 * as the default; --mode staging must allow api-staging.ownmyhealth.io). The
 * rewrite is idempotent, and a null apiOrigin (VITE_API_URL unset/relative)
 * returns the html unchanged — so it is safe for both builds and the dev
 * server. Throws when apiOrigin is set but the meta tag can't be matched, so
 * formatting drift in index.html fails the build loudly instead of silently
 * shipping a CSP that blocks the API.
 *
 * Exported for unit testing (src/__tests__/build/rewriteCspConnectSrc.test.ts).
 */
export function rewriteCspConnectSrc(html: string, apiOrigin: string | null): string {
  if (!apiOrigin) return html;
  let replaced = false;
  // Anchor on the meta tag's http-equiv attribute so the prose mention of
  // connect-src in the HTML comment above the tag is not rewritten. Use a
  // replacer FUNCTION (not a replacement string) so '$'-sequences in apiOrigin
  // can never expand as substitution patterns.
  const rewritten = html.replace(
    /(http-equiv="Content-Security-Policy"[^>]*?connect-src)[^;"]*/,
    (_match, prefix: string) => {
      replaced = true;
      return `${prefix} 'self' ${apiOrigin}`;
    }
  );
  if (!replaced) {
    throw new Error(
      'csp-connect-src: failed to rewrite the connect-src directive of the ' +
        'Content-Security-Policy <meta> in index.html. The tag formatting has ' +
        'drifted from what rewriteCspConnectSrc() in vite.config.ts expects ' +
        '(http-equiv attribute before content, connect-src inside content). ' +
        'Fix the meta tag or update the regex — do not ship without the rewrite.'
    );
  }
  return rewritten;
}

/**
 * Applies rewriteCspConnectSrc to index.html in both builds and the dev
 * server (a local .env with VITE_API_URL=http://localhost:3001/... gets its
 * origin allowed in dev too; with no/relative VITE_API_URL it's a no-op).
 */
function cspConnectSrcPlugin(apiOrigin: string | null): Plugin {
  return {
    name: 'csp-connect-src',
    transformIndexHtml(html) {
      return rewriteCspConnectSrc(html, apiOrigin);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), cspConnectSrcPlugin(apiOriginFromEnv(loadEnv(mode, process.cwd()).VITE_API_URL))],
  base: './',
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // Only split heavy libraries that are lazy-loaded
        // React stays in the main bundle to avoid forwardRef issues
        manualChunks: (id) => {
          // PDF processing - only loaded when uploading/viewing PDFs
          if (id.includes('node_modules/pdfjs-dist/') ||
              id.includes('node_modules/jspdf/') ||
              id.includes('node_modules/pdf-lib/') ||
              id.includes('node_modules/html2canvas-pro/')) {
            return 'pdf';
          }

          // OCR - only loaded when OCR is needed
          if (id.includes('node_modules/tesseract.js/') ||
              id.includes('node_modules/tesseract.js-core/')) {
            return 'ocr';
          }

          // Charts - recharts and d3 dependencies (loaded when viewing trends/graphs)
          if (id.includes('node_modules/recharts/') ||
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-vendor/')) {
            return 'charts';
          }
        },
      },
    },
  },
}));
