'use strict';
/* Server statis kecil untuk pratinjau lokal: npm start → http://localhost:3000 (situs) dan /admin/ (CMS).
   Hanya melayani berkas; semua penyimpanan CMS tetap lewat GitHub API. Tanpa dependensi. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
const root = __dirname;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root + path.sep) || /(^|[\\/])\.(git|env)|node_modules|dev-server|tests[\\/]/.test(path.relative(root, file))) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Tidak ditemukan'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});
const port = Number(process.env.PORT) || 3000;
if (require.main === module) server.listen(port, '127.0.0.1', () => console.log(`Sadalan: http://localhost:${port}  ·  CMS: http://localhost:${port}/admin/`));
module.exports = server;
