/* 测试用本地静态服务器：提供项目文件，并接收测试页面 POST 的导出结果（写入 test/out/） */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8899;

fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png', '.rtf': 'application/rtf', '.doc': 'application/msword'
};

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.indexOf('/save/') === 0) {
    const name = path.basename(decodeURIComponent(req.url.slice('/save/'.length)));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        fs.writeFileSync(path.join(OUT, name), Buffer.concat(chunks));
        console.log('saved ' + name + ' (' + Buffer.concat(chunks).length + ' bytes)');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('saved ' + name);
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
    });
    return;
  }
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('test server: http://127.0.0.1:' + PORT + '/test/');
});
