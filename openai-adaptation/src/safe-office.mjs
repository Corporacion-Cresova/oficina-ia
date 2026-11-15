// Integration scaffold only. Does not import or execute upstream modules.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest();
const status = Object.freeze({ stage: 'manual-workspace', functionalOffice: false,
  inferenceConnected: false, externalActionsEnabled: false, paidApiEnabled: false,
  mode: 'manual-internal-tasks', persistence: 'local-json-atomic', timezone: 'America/Mazatlan' });

export function createOffice({ password, dataDir, publicOrigin = '', clock = () => new Date().toISOString() }) {
  if (typeof password !== 'string' || password.length < 16) throw new Error('OFFICE_PASSWORD_REQUIRED_MIN_16');
  if (!path.isAbsolute(dataDir || '')) throw new Error('ABSOLUTE_ISOLATED_DATA_DIR_REQUIRED');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dataDir).isSymbolicLink()) throw new Error('SYMLINK_DATA_DIR_NOT_ALLOWED');
  const dataFile = path.join(dataDir, 'manual-tasks.json');
  if (fs.existsSync(dataFile) && fs.lstatSync(dataFile).isSymbolicLink()) throw new Error('SYMLINK_DATA_FILE_NOT_ALLOWED');
  let tasks = [];
  if (fs.existsSync(dataFile)) {
    const stored = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (stored.schemaVersion !== 1 || !Array.isArray(stored.tasks)) throw new Error('INVALID_STORED_TASKS');
    if (stored.tasks.some(t => !t || typeof t.id !== 'string' || typeof t.title !== 'string' || !['manual-pending','manual-completed','cancelled'].includes(t.status) || t.executionEnabled !== false)) throw new Error('INVALID_STORED_TASKS');
    tasks = stored.tasks;
  }
  const persist = () => {
    const tmp = path.join(dataDir, `tasks-${randomUUID()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, tasks }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, dataFile);
  };
  const authorized = req => {
    const raw = req.headers.authorization || '';
    if (!raw.startsWith('Basic ')) return false;
    const credential = Buffer.from(raw.slice(6), 'base64').toString('utf8');
    return timingSafeEqual(digest(credential), digest(`jorge:${password}`));
  };
  const assets = new Map([['/', ['index.html','text/html; charset=utf-8']], ['/app.js',['app.js','text/javascript; charset=utf-8']], ['/style.css',['style.css','text/css; charset=utf-8']]]);
  const server = http.createServer(async (req, res) => {
    const send = (code, value) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/health' && req.method === 'GET') return send(200, { service: 'office-integration-scaffold', alive: true });
    if (!authorized(req)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Oficina Jorge", charset="UTF-8"');
      return send(401, { error: 'AUTHENTICATION_REQUIRED' });
    }
    const expectedHost = publicOrigin ? new URL(publicOrigin).host : `127.0.0.1:${server.address().port}`;
    if (req.headers.host !== expectedHost) return send(403, {error:'HOST_NOT_ALLOWED'});
    if (assets.has(req.url) && req.method === 'GET') {
      const [file,type] = assets.get(req.url);
      try { const content = fs.readFileSync(new URL('../ui/'+file,import.meta.url));
        res.writeHead(200, {'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(content);
      } catch {send(500,{error:'ASSET_UNAVAILABLE'});} return;
    }
    const allowedOrigin = publicOrigin || `http://${expectedHost}`;
    if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== allowedOrigin) return send(403,{error:'ORIGIN_NOT_ALLOWED'});
    const mutation = /^\/api\/tasks\/([a-f0-9-]+)\/(complete|cancel)$/.exec(req.url);
    if (mutation && req.method === 'POST') {
      if (req.headers['content-type'] !== 'application/json') return send(415,{error:'JSON_REQUIRED'});
      const task = tasks.find(t=>t.id===mutation[1]); if(!task)return send(404,{error:'TASK_NOT_FOUND'});
      if(task.status !== 'manual-pending')return send(200,{task});
      const previous = {...task}; task.status = mutation[2]==='complete'?'manual-completed':'cancelled';task.updatedAt=clock();
      try {persist();}catch {Object.assign(task,previous);delete task.updatedAt;return send(500,{error:'PERSISTENCE_FAILED'});}
      return send(200,{task});
    }
    if (req.method === 'GET' && req.url === '/api/status') return send(200, status);
    if (req.method === 'GET' && req.url === '/api/tasks') return send(200, { tasks });
    if (req.method === 'POST' && req.url === '/api/tasks') {
      if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'JSON_REQUIRED' });
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 16384) return send(413, { error: 'BODY_TOO_LARGE' });
        }
        const input = JSON.parse(body);
        if (Object.keys(input).some(k => !['title','key'].includes(k)) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500)
          return send(400, { error: 'TITLE_ONLY_REQUIRED_MAX_500' });
        if(input.key !== undefined && (typeof input.key !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.key)))return send(400,{error:'INVALID_KEY'});
        const existing=input.key && tasks.find(t=>t.key===input.key);
        if(existing)return existing.title===input.title.trim()?send(200,{task:existing}):send(409,{error:'IDEMPOTENCY_CONFLICT'});
        if(tasks.length>=1000)return send(409,{error:'TASK_LIMIT'});
        const task = { key:input.key, id: randomUUID(), title: input.title.trim(), status: 'manual-pending', createdAt: clock(), executionEnabled: false };
        tasks.push(task);
        try { persist(); } catch { tasks.pop(); return send(500, { error: 'PERSISTENCE_FAILED' }); }
        return send(201, { task });
      } catch { return send(400, { error: 'INVALID_JSON' }); }
    }
    return send(404, { error: 'NOT_AVAILABLE', ...status });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}
