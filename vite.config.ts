import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { createRoomServer } from './server/rooms.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// 開發模式專用：讓判定框編輯工具把匯出的檔案直接存進 public/assets/characters/<id>/
function editorSavePlugin(): Plugin {
  const MAX_BYTES = 32 * 1024 * 1024;
  return {
    name: 'editor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // 介面美術（血條框等）：/__editor/save/ui/<名稱>.png|json → public/assets/ui/
        const ui = req.url?.match(/^\/__editor\/save-ui\/([a-z0-9_-]{1,32}\.(?:png|json))$/);
        // 預告片錄製（trailer.html）：/__editor/save-frame/<片段>/<檔名> → art/trailer/frames/<片段>/
        const fr = req.url?.match(/^\/__editor\/save-frame\/([a-z0-9_-]{1,32})\/([a-z0-9_-]{1,32}\.(?:jpg|json))$/);
        if (fr && req.method === 'POST') {
          // 頁面重新整理時上傳可能被中斷：接住錯誤，不要讓整個開發伺服器當掉
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const dir = resolve(ROOT, 'art/trailer/frames', fr[1]);
            await mkdir(dir, { recursive: true });
            await writeFile(resolve(dir, fr[2]), Buffer.concat(chunks));
            res.end('ok');
          } catch {
            if (!res.writableEnded) { res.statusCode = 400; res.end('aborted'); }
          }
          return;
        }
        const m = ui ? null : req.url?.match(/^\/__editor\/save\/([a-z0-9_-]{1,32})\/(sheet\.png|data\.json)$/);
        if ((!m && !ui) || req.method !== 'POST') return next();
        const [, id, file] = m ?? ['', '', ui![1]];
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_BYTES) throw new Error('檔案太大');
            chunks.push(chunk as Buffer);
          }
          const body = Buffer.concat(chunks);
          if (file.endsWith('.json')) JSON.parse(body.toString('utf8'));
          const dir = ui ? resolve(ROOT, 'public/assets/ui') : resolve(ROOT, 'public/assets/characters', id);
          await mkdir(dir, { recursive: true });
          await writeFile(resolve(dir, file), body);
          res.statusCode = 200;
          res.end('ok');
        } catch (e) {
          res.statusCode = 400;
          res.end(String(e instanceof Error ? e.message : e));
        }
      });
    },
  };
}

// 開發模式：把配對伺服器掛在開發伺服器的 /ws（正式上線改用 server/index.mjs）
function signalingPlugin(): Plugin {
  return {
    name: 'signaling',
    apply: 'serve',
    configureServer(server) {
      const rooms = createRoomServer();
      const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
      wss.on('connection', (ws) => rooms.handle(ws));
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (req.url !== '/ws') return; // 其他（例如 Vite 熱更新）不處理
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      });
    },
  };
}

// 版本號：GitHub Actions 建置時用 commit 編號，本機開發顯示 dev
const APP_VERSION = `${(process.env.GITHUB_SHA ?? 'dev').slice(0, 7)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  // 相對路徑：發佈到 GitHub Pages 的子路徑（/儲存庫名稱/）也能正常載入
  base: './',
  plugins: [editorSavePlugin(), signalingPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(ROOT, 'index.html'),
        editor: resolve(ROOT, 'editor.html'),
      },
    },
  },
});
