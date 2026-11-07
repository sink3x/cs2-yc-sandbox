'use strict';
// Tiny HTTP helpers shared by the agent and the admin panel.
const MAX_BODY = 1 << 20;

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Тело запроса как Buffer (для загрузки файлов). */
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit + (16 << 20)) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      if (size <= limit) chunks.push(c); // чуть больше лимита дочитываем, чтобы ответить 413, а не оборвать соединение
    });
    req.on('end', () => (size > limit ? reject(Object.assign(new Error('body too large'), { status: 413 })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const text = await readBody(req);
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isObj ? JSON.stringify(body) : (body ?? '');
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

/** Route table helper: routes = [['GET', '/path/:id', handler]] ; handler(ctx) -> any (sent as JSON). */
function matchRoute(routes, method, pathname) {
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const names = [];
    const re = new RegExp('^' + pattern.replace(/:([A-Za-z]+)/g, (_x, n) => { names.push(n); return '([^/]+)'; }) + '$');
    const mm = re.exec(pathname);
    if (mm) return { handler, pattern, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(mm[i + 1])])) };
  }
  return null;
}

module.exports = { readBody, readRaw, readJsonBody, send, matchRoute };
