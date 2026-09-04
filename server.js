'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8765);
const ROOT = __dirname;
const STATIC_FILES = new Set(['D3vic3.html', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png']);
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

function noStoreHeaders(extra = {}) {
  return { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', ...extra };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, noStoreHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }));
  res.end(body);
}

async function fetchPublicIp(fetchImpl) {
  const sources = [
    { url: 'https://api.ipify.org?format=json', family: 4, read: async (response) => (await response.json()).ip },
    { url: 'https://ipv4.icanhazip.com/', family: 4, read: async (response) => (await response.text()).trim() },
    { url: 'https://api64.ipify.org?format=json', family: 0, read: async (response) => (await response.json()).ip },
    { url: 'https://www.cloudflare.com/cdn-cgi/trace', family: 0, read: async (response) => ((await response.text()).match(/^ip=(.+)$/m) || [])[1] }
  ];
  for (const source of sources) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl(source.url, { signal: controller.signal, headers: { Accept: 'application/json,text/plain' } });
      if (!response.ok) continue;
      const ip = String(await source.read(response) || '').trim();
      const family = net.isIP(ip);
      if (family && (!source.family || family === source.family)) return ip;
    } catch {}
    finally { clearTimeout(timer); }
  }
  return null;
}

function createDevic3Server(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; connect-src 'self' https:; img-src 'self' data: blob: https:");
    try {
      const host = String(req.headers.host || '');
      const requestUrl = new URL(req.url, `http://${host || `${HOST}:${PORT}`}`);

      if (requestUrl.pathname === '/devic3-network-status') {
        if (req.method !== 'GET') return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Phương thức không được hỗ trợ.' });
        const ip = await fetchPublicIp(fetchImpl);
        return sendJson(res, 200, { online: Boolean(ip), ip });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      const name = requestUrl.pathname === '/' ? 'D3vic3.html' : decodeURIComponent(requestUrl.pathname.slice(1));
      if (!STATIC_FILES.has(name)) { res.writeHead(404); return res.end('Not found'); }
      fs.readFile(path.join(ROOT, name), (error, data) => {
        if (error) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        if (req.method === 'HEAD') return res.end();
        res.end(data);
      });
    } catch {
      sendJson(res, 500, { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi máy chủ.' });
    }
  });
}

if (require.main === module) {
  createDevic3Server().listen(PORT, HOST, () => {
    console.log(`Devic3 đang chạy cục bộ tại http://${HOST}:${PORT}/D3vic3.html`);
  });
}

module.exports = { createDevic3Server, fetchPublicIp };
