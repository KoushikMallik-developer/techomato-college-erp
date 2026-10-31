import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Share previews need an absolute image address. With VITE_SITE_URL set (https://your-domain), add the image and page tags.
const shareTags = (siteUrl) => ({
  name: 'share-tags',
  transformIndexHtml: () => (siteUrl ? [
    { tag: 'meta', attrs: { property: 'og:url', content: siteUrl } },
    { tag: 'meta', attrs: { property: 'og:image', content: `${siteUrl}/og-image.png` } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: `${siteUrl}/og-image.png` } },
  ] : []),
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), shareTags(loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL?.replace(/\/$/, ''))],
  // Rules tests need the Firestore emulator and run through `npm run test:rules`.
  test: { environment: 'node', include: ['tests/**/*.test.js'], exclude: ['tests/rules/**', 'node_modules/**'] },
}));
