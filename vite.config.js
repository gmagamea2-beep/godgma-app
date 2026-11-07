import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * 개발 서버 전용: GitHub 대신 로컬 godgma-data 폴더를 읽는다.
 * apply: 'serve' 라서 빌드 결과물에는 이 코드도, 데이터도 들어가지 않는다.
 */
function localDataPlugin() {
  return {
    name: 'godgma-local-data',
    apply: 'serve',
    configureServer(server) {
      const dir = resolve(process.env.GODGMA_DATA_DIR || join(HERE, '..', '..', 'godgma-data'));

      const listFiles = (base) => {
        const out = [];
        for (const name of readdirSync(base)) {
          if (name.startsWith('.')) continue;
          const full = join(base, name);
          if (statSync(full).isDirectory()) out.push(...listFiles(full));
          else out.push(full);
        }
        return out;
      };

      server.middlewares.use('/__local-data', (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          if (url.pathname === '/manifest') {
            const files = listFiles(dir).map((full) => {
              const sha = createHash('sha1').update(readFileSync(full)).digest('hex');
              return { path: relative(dir, full).split(sep).join('/'), sha };
            });
            const commitSha = createHash('sha1')
              .update(files.map((f) => f.path + f.sha).join('\n'))
              .digest('hex');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ commitSha, files }));
            return;
          }
          if (url.pathname === '/file') {
            const full = resolve(dir, url.searchParams.get('path') || '');
            if (!full.startsWith(dir + sep)) {
              res.statusCode = 400;
              res.end('bad path');
              return;
            }
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(readFileSync(full));
            return;
          }
          res.statusCode = 404;
          res.end('not found');
        } catch (e) {
          server.config.logger.error(`[godgma-local-data] ${e.message}`);
          res.statusCode = 500;
          res.end(String(e.message));
        }
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages(하위 경로)·Cloudflare Pages 어디에 올려도 동작하도록 상대 경로
  base: './',
  plugins: [
    localDataPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: '그마 설정집',
        short_name: '설정집',
        description: '그마 세계관 설정집 뷰어',
        lang: 'ko',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0e0e14',
        theme_color: '#0e0e14',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 앱 껍데기만 캐시한다. 설정 데이터는 IndexedDB 에 따로 저장하므로 GitHub API 응답은 캐시하지 않는다.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
});
