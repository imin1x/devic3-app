'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { normalizeMessage, eligibleMessages } = require('./lib/mail-otp');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8765);
const ROOT = __dirname;
const REQUEST_LIMIT = 16 * 1024;
const REMOTE_LIMIT = 2 * 1024 * 1024;
const RATE_LIMIT_COUNT = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
const STATIC_FILES = new Set(['D3vic3.html', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png']);
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

class SafeApiError extends Error {
  constructor(status, code, message) {
    super(message); this.status = status; this.code = code;
  }
}

function noStoreHeaders(extra = {}) {
  return { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', ...extra };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, noStoreHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }));
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > REQUEST_LIMIT) {
        settled = true;
        reject(new SafeApiError(413, 'REQUEST_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new SafeApiError(400, 'INVALID_JSON', 'Dữ liệu gửi lên không hợp lệ.')); }
    });
    req.on('error', (error) => { if (!settled) reject(error); });
  });
}

async function fetchJson(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > REMOTE_LIMIT) throw new SafeApiError(502, 'REMOTE_TOO_LARGE', 'Microsoft trả về dữ liệu quá lớn.');
    const text = await response.text();
    if (Buffer.byteLength(text) > REMOTE_LIMIT) throw new SafeApiError(502, 'REMOTE_TOO_LARGE', 'Microsoft trả về dữ liệu quá lớn.');
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { throw new SafeApiError(502, 'REMOTE_INVALID', 'Microsoft trả về dữ liệu không hợp lệ.'); }
    return { response, data };
  } catch (error) {
    if (error.name === 'AbortError') throw new SafeApiError(504, 'MICROSOFT_TIMEOUT', 'Microsoft phản hồi quá lâu. Hãy thử lại.');
    if (error instanceof SafeApiError) throw error;
    throw new SafeApiError(502, 'MICROSOFT_NETWORK', 'Không thể kết nối đến Microsoft. Hãy kiểm tra mạng rồi thử lại.');
  } finally { clearTimeout(timer); }
}

function validateOtpRequest(input) {
  const email = String(input?.email || '').trim();
  const refreshToken = String(input?.refreshToken || '').trim();
  const clientId = String(input?.clientId || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SafeApiError(400, 'EMAIL_REQUIRED', 'Email Outlook/Hotmail không hợp lệ.');
  if (!refreshToken || refreshToken.length > 8192) throw new SafeApiError(400, 'REFRESH_TOKEN_REQUIRED', 'Refresh Token Mail bị thiếu hoặc không hợp lệ.');
  if (!/^[0-9a-f-]{32,40}$/i.test(clientId)) throw new SafeApiError(400, 'CLIENT_ID_REQUIRED', 'Client ID Mail không hợp lệ.');
  return { email, refreshToken, clientId };
}

async function exchangeRefreshToken(fetchImpl, clientId, refreshToken) {
  const form = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'offline_access https://graph.microsoft.com/Mail.Read'
  });
  const { response, data } = await fetchJson(fetchImpl, 'https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form
  });
  if (!response.ok || !data.access_token) {
    const oauthError = String(data.error || '');
    if (oauthError === 'invalid_grant') {
      throw new SafeApiError(401, 'MICROSOFT_TOKEN_INVALID', 'Refresh Token đã hết hạn, bị thu hồi hoặc không thuộc Client ID này. Hãy tạo lại token với quyền Mail.Read.');
    }
    if (oauthError === 'invalid_client' || oauthError === 'unauthorized_client') {
      throw new SafeApiError(401, 'MICROSOFT_CLIENT_INVALID', 'Client ID không hợp lệ hoặc ứng dụng Microsoft chưa cho phép tài khoản cá nhân.');
    }
    if (oauthError === 'consent_required' || oauthError === 'interaction_required') {
      throw new SafeApiError(403, 'MICROSOFT_CONSENT_REQUIRED', 'Tài khoản chưa cấp quyền Mail.Read. Hãy đăng nhập và cấp quyền lại để tạo Refresh Token mới.');
    }
    throw new SafeApiError(401, 'MICROSOFT_AUTH_FAILED', 'Microsoft từ chối Refresh Token hoặc Client ID. Hãy kiểm tra lại cấu hình OAuth và quyền Mail.Read.');
  }
  return { accessToken: data.access_token, rotatedRefreshToken: data.refresh_token || null };
}

async function graphJson(fetchImpl, accessToken, pathname) {
  const { response, data } = await fetchJson(fetchImpl, `https://graph.microsoft.com/v1.0${pathname}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new SafeApiError(403, 'MAIL_READ_DENIED', 'Microsoft chưa cấp quyền Mail.Read cho tài khoản này.');
    throw new SafeApiError(502, 'GRAPH_FAILED', 'Không đọc được hộp thư Microsoft. Hãy thử lại sau.');
  }
  return data;
}

async function readLatestFacebookOtp(fetchImpl, rawInput, now = Date.now()) {
  const input = validateOtpRequest(rawInput);
  const auth = await exchangeRefreshToken(fetchImpl, input.clientId, input.refreshToken);
  try {
    const query = '?$top=25&$orderby=receivedDateTime%20desc&$select=id,subject,from,receivedDateTime,bodyPreview';
    const [inbox, junk] = await Promise.all([
      graphJson(fetchImpl, auth.accessToken, `/me/mailFolders/inbox/messages${query}`),
      graphJson(fetchImpl, auth.accessToken, `/me/mailFolders/junkemail/messages${query}`)
    ]);
    const rawMessages = [
      ...(Array.isArray(inbox.value) ? inbox.value.map((m) => ({ ...m, folder: 'inbox' })) : []),
      ...(Array.isArray(junk.value) ? junk.value.map((m) => ({ ...m, folder: 'junkemail' })) : [])
    ];
    const candidates = eligibleMessages(rawMessages.map((m) => normalizeMessage(m, m.folder)), now);
    let found = candidates.find((item) => item.otp) || null;

    if (!found) {
      for (const candidate of candidates.slice(0, 5)) {
        const full = await graphJson(fetchImpl, auth.accessToken, `/me/messages/${encodeURIComponent(candidate.id)}?$select=id,subject,from,receivedDateTime,body`);
        const normalized = normalizeMessage(full, candidate.folder);
        const eligible = eligibleMessages([normalized], now)[0];
        if (eligible?.otp) { found = eligible; break; }
      }
    }
    if (!found) {
      const error = new SafeApiError(404, 'OTP_NOT_FOUND', 'Không tìm thấy mã Facebook hợp lệ trong email chính thức ở 24 giờ gần đây.');
      error.rotatedRefreshToken = auth.rotatedRefreshToken;
      throw error;
    }
    return {
      otp: found.otp,
      email: input.email,
      sender: { name: found.fromName, address: found.from },
      subject: found.subject,
      receivedDateTime: found.receivedDateTime,
      rotatedRefreshToken: auth.rotatedRefreshToken
    };
  } catch (error) {
    if (auth.rotatedRefreshToken && !error.rotatedRefreshToken) error.rotatedRefreshToken = auth.rotatedRefreshToken;
    throw error;
  }
}

function createRateLimiter() {
  const calls = new Map();
  return (key, now = Date.now()) => {
    const recent = (calls.get(key) || []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_COUNT) { calls.set(key, recent); return false; }
    recent.push(now); calls.set(key, recent); return true;
  };
}

function createDevic3Server(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const allowCall = createRateLimiter();
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; connect-src 'self' https:; img-src 'self' data: blob: https:");
    try {
      const host = String(req.headers.host || '');
      const requestUrl = new URL(req.url, `http://${host || `${HOST}:${PORT}`}`);

      if (requestUrl.pathname === '/api/mail/otp') {
        if (req.method !== 'POST') return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Phương thức không được hỗ trợ.' });
        const origin = req.headers.origin;
        const fetchSite = String(req.headers['sec-fetch-site'] || '');
        let localHost = false;
        try { localHost = ['127.0.0.1', 'localhost'].includes(new URL(`http://${host}`).hostname); } catch {}
        let sameOrigin = !origin;
        try { if (origin) sameOrigin = new URL(origin).host === host; } catch { sameOrigin = false; }
        if (!localHost || !sameOrigin || fetchSite === 'cross-site') {
          return sendJson(res, 403, { code: 'CROSS_ORIGIN_BLOCKED', message: 'Yêu cầu khác nguồn đã bị chặn.' });
        }
        const remote = req.socket.remoteAddress || 'local';
        if (!allowCall(remote, options.now ? options.now() : Date.now())) {
          return sendJson(res, 429, { code: 'RATE_LIMITED', message: 'Bạn kiểm tra quá nhanh. Hãy đợi một phút rồi thử lại.' });
        }
        const input = await readJsonBody(req);
        const result = await readLatestFacebookOtp(fetchImpl, input, options.now ? options.now() : Date.now());
        return sendJson(res, 200, result);
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
    } catch (error) {
      const safe = error instanceof SafeApiError ? error : new SafeApiError(500, 'INTERNAL_ERROR', 'Đã xảy ra lỗi khi đọc OTP.');
      sendJson(res, safe.status, { code: safe.code, message: safe.message, ...(safe.rotatedRefreshToken ? { rotatedRefreshToken: safe.rotatedRefreshToken } : {}) });
    }
  });
}

if (require.main === module) {
  createDevic3Server().listen(PORT, HOST, () => {
    console.log(`Devic3 đang chạy cục bộ tại http://${HOST}:${PORT}/D3vic3.html`);
  });
}

module.exports = { createDevic3Server, readLatestFacebookOtp, validateOtpRequest };
