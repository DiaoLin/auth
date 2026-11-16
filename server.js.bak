/* ============================================================
 * 设备白名单系统 · 单文件后端
 * Express + PostgreSQL + SSE
 * ============================================================ */

import express from 'express';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';

/* ============================================================
 * 1. 配置（依赖环境变量，无硬编码敏感信息）
 * ============================================================ */

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const IS_PROD = NODE_ENV === 'production';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://devauth.us.ci';

// 必须通过环境变量提供 DATABASE_URL，否则无法启动
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('FATAL: 环境变量 DATABASE_URL 未设置，程序无法启动。');
  process.exit(1);
}

// 管理员凭据辅助函数
function decodeMaybeB64(s) {
  if (!s) return '';
  const v = String(s).trim();
  if (v.startsWith('B64:')) {
    try {
      return Buffer.from(v.slice(4), 'base64').toString('utf8').trim();
    } catch {
      return '';
    }
  }
  return v;
}

function pickPasswordHash(envVal) {
  const v = decodeMaybeB64(envVal);
  if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(v)) return v;
  return ''; // 无默认值
}

function pickSigningKey(envVal) {
  const v = decodeMaybeB64(envVal);
  if (/^[0-9a-f]{64}$/i.test(v)) return v;
  return ''; // 无默认值
}

const ADMIN_PASSWORD_HASH = pickPasswordHash(process.env.ADMIN_PASSWORD_HASH);
const ADMIN_SIGNING_KEY = pickSigningKey(process.env.ADMIN_SIGNING_KEY);
const ADMIN_COOKIE_NAME = 'admin_session';
const ADMIN_SESSION_TTL = 86400 * 7;

// 安全启动检查
if (!ADMIN_SIGNING_KEY) {
  console.warn('WARN: ADMIN_SIGNING_KEY 未设置，管理员登录与鉴权功能将不可用！');
}
if (!ADMIN_PASSWORD_HASH) {
  console.warn('WARN: ADMIN_PASSWORD_HASH 未设置，管理员登录功能将不可用！');
}

/* ============================================================
 * 2. 数据库
 * ============================================================ */

const { Pool } = pg;
const useSSL = /sslmode=require/i.test(DATABASE_URL);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[pg] idle client error', err);
});

function query(text, params) {
  return pool.query(text, params);
}

function getClient() {
  return pool.connect();
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whitelist_devices (
        id SERIAL PRIMARY KEY,
        req_id VARCHAR(10),
        device_name VARCHAR(100) NOT NULL,
        device_token CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        revoke_reason VARCHAR(255),
        banned_at TIMESTAMPTZ,
        ban_reason VARCHAR(255),
        ban_until TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_whitelist_token      ON whitelist_devices(device_token);
    CREATE INDEX IF NOT EXISTS idx_whitelist_revoked    ON whitelist_devices(revoked_at);
    CREATE INDEX IF NOT EXISTS idx_whitelist_banned     ON whitelist_devices(banned_at);
    CREATE INDEX IF NOT EXISTS idx_whitelist_ban_until  ON whitelist_devices(ban_until);
    CREATE INDEX IF NOT EXISTS idx_whitelist_dev_name   ON whitelist_devices(device_name);

    CREATE TABLE IF NOT EXISTS access_requests (
        id SERIAL PRIMARY KEY,
        poll_key CHAR(64) NOT NULL UNIQUE,
        device_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','approved','rejected')),
        reject_reason VARCHAR(255),
        device_id INTEGER,
        plain_token CHAR(64),
        token_fetched_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_requests_status   ON access_requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_dev_name ON access_requests(device_name);
  `);
}

/* ============================================================
 * 3. 工具函数
 * ============================================================ */

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Asia/Shanghai (UTC+8) 格式化 */
function formatDate(d) {
  if (d === null || d === undefined) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  const t = new Date(dt.getTime() + 8 * 3600 * 1000);
  const y  = t.getUTCFullYear();
  const mo = String(t.getUTCMonth() + 1).padStart(2, '0');
  const da = String(t.getUTCDate()).padStart(2, '0');
  const h  = String(t.getUTCHours()).padStart(2, '0');
  const mi = String(t.getUTCMinutes()).padStart(2, '0');
  const s  = String(t.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}:${s}`;
}

function rowIsBanned(row, at = new Date()) {
  if (!row || !row.banned_at) return false;
  if (row.ban_until && new Date(row.ban_until) <= at) return false;
  return true;
}

function serializeConflict(c) {
  return {
    id: c.id,
    expires_at: formatDate(c.expires_at),
    revoked_at: formatDate(c.revoked_at),
    banned_at: formatDate(c.banned_at),
    ban_reason: c.ban_reason,
    ban_until: formatDate(c.ban_until),
    created_at: formatDate(c.created_at),
    last_used_at: formatDate(c.last_used_at),
  };
}

/* ---------- Admin cookie ---------- */

function verifyAdminCookie(value) {
  if (!value || typeof value !== 'string') return false;
  if (!ADMIN_SIGNING_KEY) return false; // 无密钥直接拒绝
  const parts = value.split('.');
  if (parts.length !== 2) return false;
  const [exp, sig] = parts;
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto
    .createHmac('sha256', ADMIN_SIGNING_KEY)
    .update(exp)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function issueAdminCookie(res) {
  if (!ADMIN_SIGNING_KEY) return;
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL;
  const sig = crypto
    .createHmac('sha256', ADMIN_SIGNING_KEY)
    .update(String(exp))
    .digest('hex');
  res.cookie(ADMIN_COOKIE_NAME, `${exp}.${sig}`, {
    maxAge: ADMIN_SESSION_TTL * 1000,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: IS_PROD,
  });
}

function clearAdminCookie(res) {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: '/' });
}

function requireAdmin(req, res, next) {
  const cookie = req.cookies?.[ADMIN_COOKIE_NAME];
  if (!verifyAdminCookie(cookie)) {
    return res.status(401).json({ error: '未授权，请先登录' });
  }
  next();
}

/* ============================================================
 * 4. SSE 连接管理
 * ============================================================ */

const sseClients = new Map(); // 申请单的 SSE：pollKey -> Set<res>
const deviceSseClients = new Map(); // 设备的 SSE：tokenHash -> Set<res>

function addSseClient(pollKey, res) {
  let set = sseClients.get(pollKey);
  if (!set) {
    set = new Set();
    sseClients.set(pollKey, set);
  }
  set.add(res);
}

function removeSseClient(pollKey, res) {
  const set = sseClients.get(pollKey);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseClients.delete(pollKey);
}

function sendSseEvent(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {}
}

function sendToPollKey(pollKey, event, data) {
  const set = sseClients.get(pollKey);
  if (!set || set.size === 0) return 0;
  let n = 0;
  for (const res of set) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      n++;
    } catch (_) {}
  }
  return n;
}

/* ============================================================
 * 5. Express 应用
 * ============================================================ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// 跨域配置
app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true,
}));

app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

// 静态资源
app.use(
  express.static(path.join(__dirname, 'public'), {
    index: 'index.html',
    maxAge: 0,
  })
);

/* ============================================================
 * 5.1 申请：POST /api/request_access
 * ============================================================ */

app.post('/api/request_access', async (req, res) => {
  const action = String(req.body.action || '').trim();

  if (action === 'request') {
    const deviceName = String(req.body.device_name || '').trim();
    if (!deviceName) {
      return res.status(400).json({ error: '设备名称不能为空' });
    }
    if ([...deviceName].length > 100) {
      return res.status(400).json({ error: '设备名称不能超过100字符' });
    }

    try {
      const banned = await query(
        `SELECT ban_reason, ban_until FROM whitelist_devices
         WHERE device_name = $1
           AND banned_at IS NOT NULL
           AND (ban_until IS NULL OR ban_until > NOW())
         ORDER BY id DESC LIMIT 1`,
        [deviceName]
      );
      if (banned.rows.length > 0) {
        return res.status(403).json({
          banned: true,
          reason: banned.rows[0].ban_reason,
          ban_until: formatDate(banned.rows[0].ban_until),
        });
      }

      const existing = await query(
        `SELECT id, poll_key FROM access_requests
         WHERE device_name = $1 AND status = 'pending'
         ORDER BY id DESC LIMIT 1`,
        [deviceName]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        return res.json({
          success: true,
          request_id: row.id,
          poll_key: row.poll_key,
          session_id: row.poll_key,
        });
      }

      const pollKey = generateToken();
      const ins = await query(
        `INSERT INTO access_requests (poll_key, device_name, status, created_at)
         VALUES ($1, $2, 'pending', NOW())
         RETURNING id`,
        [pollKey, deviceName]
      );

      return res.json({
        success: true,
        request_id: ins.rows[0].id,
        poll_key: pollKey,
        session_id: pollKey,
      });
    } catch (e) {
      console.error('[request_access]', e);
      return res.status(500).json({ error: '申请失败，请稍后重试' });
    }
  }

  return res.status(400).json({ error: 'action 无效' });
});

/* ============================================================
 * 5.2 SSE：申请状态流 & 设备状态流
 * ============================================================ */

async function pushCurrentState(pollKey, requestId, res) {
  let row;
  if (requestId > 0) {
    const r = await query(
      `SELECT id, device_name, status, reject_reason, plain_token, token_fetched_at
       FROM access_requests WHERE id = $1 AND poll_key = $2 LIMIT 1`,
      [requestId, pollKey]
    );
    row = r.rows[0];
  } else {
    const r = await query(
      `SELECT id, device_name, status, reject_reason, plain_token, token_fetched_at
       FROM access_requests WHERE poll_key = $1 LIMIT 1`,
      [pollKey]
    );
    row = r.rows[0];
  }

  if (!row) {
    return sendSseEvent(res, 'failed', { error: '申请不存在' });
  }

  const banned = await query(
    `SELECT ban_reason, ban_until FROM whitelist_devices
     WHERE device_name = $1
       AND banned_at IS NOT NULL
       AND (ban_until IS NULL OR ban_until > NOW())
     ORDER BY id DESC LIMIT 1`,
    [row.device_name]
  );
  if (banned.rows.length > 0) {
    return sendSseEvent(res, 'banned', {
      status: 'banned',
      banned: true,
      reason: banned.rows[0].ban_reason,
      ban_until: formatDate(banned.rows[0].ban_until),
    });
  }

  if (row.status === 'approved' && row.plain_token) {
    if (!row.token_fetched_at) {
      await query(
        `UPDATE access_requests SET token_fetched_at = NOW() WHERE id = $1`,
        [row.id]
      );
      return sendSseEvent(res, 'approved', {
        status: 'approved',
        token: row.plain_token,
      });
    }
    if (new Date(row.token_fetched_at).getTime() > Date.now() - 60_000) {
      return sendSseEvent(res, 'approved', {
        status: 'approved',
        token: row.plain_token,
      });
    }
    await query(
      `UPDATE access_requests SET plain_token = NULL WHERE id = $1`,
      [row.id]
    );
    return sendSseEvent(res, 'expired', {
      status: 'approved',
      error: '令牌已过期，请重新申请',
    });
  }

  if (row.status === 'rejected') {
    return sendSseEvent(res, 'rejected', {
      status: 'rejected',
      reason: row.reject_reason,
    });
  }

  sendSseEvent(res, 'pending', { status: 'pending' });
}

app.get('/api/stream', async (req, res) => {
  const pollKey = String(req.query.poll_key || '');
  const requestId = parseInt(req.query.request_id, 10) || 0;

  if (!/^[0-9a-f]{64}$/.test(pollKey)) {
    return res.status(400).json({ error: '参数无效' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`retry: 5000\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25_000);

  function cleanup() {
    clearInterval(heartbeat);
    removeSseClient(pollKey, res);
  }

  res.on('close', cleanup);
  res.on('error', cleanup);

  addSseClient(pollKey, res);

  try {
    await pushCurrentState(pollKey, requestId, res);
  } catch (e) {
    console.error('[stream] initial push error', e);
    sendSseEvent(res, 'failed', { error: '查询失败' });
  }
});

app.get('/api/device_stream', async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).json({ error: 'token 无效' });

  const tokenHash = hashToken(token);

  try {
    const r = await query(
      `SELECT id, device_name FROM whitelist_devices WHERE device_token = $1 LIMIT 1`,
      [tokenHash]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: '设备不存在' });
    }
  } catch (e) {
    return res.status(500).json({ error: '查询失败' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`retry: 5000\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25_000);

  if (!deviceSseClients.has(tokenHash)) {
    deviceSseClients.set(tokenHash, new Set());
  }
  deviceSseClients.get(tokenHash).add(res);

  function cleanup() {
    clearInterval(heartbeat);
    const set = deviceSseClients.get(tokenHash);
    if (set) {
      set.delete(res);
      if (set.size === 0) deviceSseClients.delete(tokenHash);
    }
  }

  res.on('close', cleanup);
  res.on('error', cleanup);
});

/* ============================================================
 * 5.3 令牌校验：POST /api/check
 * ============================================================ */

app.post('/api/check', async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!token) return res.json({ valid: false });

  const tokenHash = hashToken(token);

  try {
    const r = await query(
      `SELECT id, device_name, expires_at, revoked_at, revoke_reason
       FROM whitelist_devices WHERE device_token = $1 LIMIT 1`,
      [tokenHash]
    );
    const row = r.rows[0];
    if (!row) return res.json({ valid: false });

    const banned = await query(
      `SELECT ban_reason, ban_until FROM whitelist_devices
       WHERE device_name = $1
         AND banned_at IS NOT NULL
         AND (ban_until IS NULL OR ban_until > NOW())
       ORDER BY id DESC LIMIT 1`,
      [row.device_name]
    );
    if (banned.rows.length > 0) {
      return res.json({
        valid: false,
        banned: true,
        reason: banned.rows[0].ban_reason,
        ban_until: formatDate(banned.rows[0].ban_until),
      });
    }

    if (row.revoked_at) {
      return res.json({
        valid: false,
        revoked: true,
        reason: row.revoke_reason,
      });
    }

    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return res.json({ valid: false, expired: true });
    }

    await query(
      `UPDATE whitelist_devices SET last_used_at = NOW() WHERE id = $1`,
      [row.id]
    );

    return res.json({ valid: true, device_name: row.device_name });
  } catch (e) {
    console.error('[check]', e);
    return res.status(500).json({ valid: false, error: '查询失败' });
  }
});

/* ============================================================
 * 5.4 管理员认证
 * ============================================================ */

function normalizeBcryptHash(h) {
  return String(h).replace(/^\$2y\$/, '$2a$');
}

app.post('/api/auth', async (req, res) => {
  const password = String(req.body.password || '');
  if (!password) return res.status(400).json({ error: '请输入密码' });

  if (!ADMIN_PASSWORD_HASH) {
    return res.status(500).json({ error: '服务器未配置管理员密码，无法登录' });
  }

  try {
    const ok = await bcrypt.compare(
      password,
      normalizeBcryptHash(ADMIN_PASSWORD_HASH)
    );
    if (!ok) {
      await new Promise((r) => setTimeout(r, 500));
      return res.status(401).json({ error: '密码错误' });
    }
    issueAdminCookie(res);
    return res.json({ success: true });
  } catch (e) {
    console.error('[auth]', e);
    return res.status(500).json({ error: '服务错误' });
  }
});

app.get('/api/auth_check', (req, res) => {
  const cookie = req.cookies?.[ADMIN_COOKIE_NAME];
  res.json({ logged_in: verifyAdminCookie(cookie) });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  clearAdminCookie(res);
  res.json({ success: true });
});

/* ============================================================
 * 5.5 管理端：全部走 requireAdmin
 * ============================================================ */

const adminRouter = express.Router();
adminRouter.use(requireAdmin);

adminRouter.get('/requests', async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status)
    ? req.query.status
    : 'pending';

  try {
    let rows;
    if (status === 'all') {
      const r = await query(
        `SELECT id, device_name, status, reject_reason, device_id, created_at, decided_at
         FROM access_requests ORDER BY id DESC`
      );
      rows = r.rows;
    } else {
      const r = await query(
        `SELECT id, device_name, status, reject_reason, device_id, created_at, decided_at
         FROM access_requests WHERE status = $1 ORDER BY id DESC`,
        [status]
      );
      rows = r.rows;
    }

    const requests = rows.map((x) => ({
      id: x.id,
      device_name: x.device_name,
      status: x.status,
      reject_reason: x.reject_reason,
      device_id: x.device_id,
      created_at: formatDate(x.created_at),
      decided_at: formatDate(x.decided_at),
    }));

    res.json({ requests });
  } catch (e) {
    console.error('[admin/requests GET]', e);
    res.status(500).json({ error: '查询失败' });
  }
});

adminRouter.post('/requests', async (req, res) => {
  const action = String(req.body.action || '').trim();
  const requestId = parseInt(req.body.request_id, 10) || 0;
  const conflictPolicy = String(req.body.conflict_policy || '').trim();

  if (requestId <= 0) return res.status(400).json({ error: 'request_id 无效' });

  if (action === 'preview') {
    try {
      const rq = await query(
        `SELECT id, device_name, status FROM access_requests WHERE id = $1 LIMIT 1`,
        [requestId]
      );
      const r = rq.rows[0];
      if (!r) return res.status(404).json({ error: '申请不存在' });
      if (r.status !== 'pending') return res.status(409).json({ error: '该申请已处理' });

      const cf = await query(
        `SELECT id, expires_at, revoked_at, banned_at, ban_reason, ban_until,
                created_at, last_used_at
         FROM whitelist_devices WHERE device_name = $1 ORDER BY id DESC`,
        [r.device_name]
      );

      for (const c of cf.rows) {
        if (rowIsBanned(c)) {
          return res.status(409).json({
            blocked: true,
            reason: c.ban_reason,
            message: '该设备名存在封禁记录，请先在设备列表中解封',
            conflicts: cf.rows.map(serializeConflict),
          });
        }
      }

      return res.json({
        success: true,
        device_name: r.device_name,
        conflicts: cf.rows.map(serializeConflict),
        need_decision: cf.rows.length > 0,
      });
    } catch (e) {
      console.error('[admin/requests preview]', e);
      return res.status(500).json({ error: '查询失败' });
    }
  }

  if (action === 'reject') {
    let reason = String(req.body.reason || '').trim();
    if ([...reason].length > 255) reason = [...reason].slice(0, 255).join('');
    const reasonValue = reason === '' ? null : reason;

    try {
      const rq = await query(
        `SELECT id, status FROM access_requests WHERE id = $1 LIMIT 1`,
        [requestId]
      );
      const r = rq.rows[0];
      if (!r) return res.status(404).json({ error: '申请不存在' });
      if (r.status !== 'pending') return res.status(409).json({ error: '该申请已处理' });

      const upd = await query(
        `UPDATE access_requests
         SET status = 'rejected', reject_reason = $1, decided_at = NOW()
         WHERE id = $2 AND status = 'pending'
         RETURNING poll_key`,
        [reasonValue, requestId]
      );
      if (upd.rowCount === 0) {
        return res.status(409).json({ error: '该申请已处理' });
      }

      sendToPollKey(upd.rows[0].poll_key, 'rejected', {
        status: 'rejected',
        reason: reasonValue,
      });

      return res.json({ success: true, message: '已拒绝' });
    } catch (e) {
      console.error('[admin/requests reject]', e);
      return res.status(500).json({ error: '操作失败，请稍后重试' });
    }
  }

  if (action === 'approve') {
    const expiryRaw = String(req.body.expiry || '').trim();
    if (expiryRaw === '') return res.status(400).json({ error: '缺少有效期参数' });

    let expiresAt;
    if (expiryRaw === 'noexp') {
      expiresAt = null;
    } else {
      if (!/^\d+$/.test(expiryRaw)) {
        return res.status(400).json({ error: '有效期参数无效' });
      }
      let days = parseInt(expiryRaw, 10);
      if (days < 1) days = 1;
      if (days > 3650) days = 3650;
      expiresAt = new Date(Date.now() + days * 86_400_000);
    }

    let client;
    try {
      client = await getClient();
      await client.query('BEGIN');

      const rq = await client.query(
        `SELECT id, device_name, status, poll_key
         FROM access_requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      const r = rq.rows[0];
      if (!r) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: '申请不存在' });
      }
      if (r.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: '该申请已处理' });
      }

      const cf = await client.query(
        `SELECT id, expires_at, revoked_at, banned_at, ban_reason, ban_until
         FROM whitelist_devices WHERE device_name = $1 ORDER BY id DESC`,
        [r.device_name]
      );

      for (const c of cf.rows) {
        if (rowIsBanned(c)) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            blocked: true,
            reason: c.ban_reason,
            message: '该设备名存在封禁记录，请先在设备列表中解封',
          });
        }
      }

      let policy = conflictPolicy;
      if (cf.rows.length > 0 && !['keep_all', 'keep_latest'].includes(policy)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '存在同名冲突，请指定 conflict_policy' });
      }
      if (!['keep_all', 'keep_latest'].includes(policy)) policy = 'keep_all';

      if (policy === 'keep_latest' && cf.rows.length > 0) {
        await client.query(
          `DELETE FROM whitelist_devices WHERE device_name = $1`,
          [r.device_name]
        );
      }

      let plainToken, tokenHash, tries = 0;
      for (;;) {
        plainToken = generateToken();
        tokenHash = hashToken(plainToken);
        const dup = await client.query(
          `SELECT 1 FROM whitelist_devices WHERE device_token = $1 LIMIT 1`,
          [tokenHash]
        );
        if (dup.rows.length === 0) break;
        if (++tries >= 5) {
          await client.query('ROLLBACK');
          return res.status(500).json({ error: '令牌生成冲突' });
        }
      }

      const ins = await client.query(
        `INSERT INTO whitelist_devices
         (req_id, device_name, device_token, expires_at, created_at, last_used_at)
         VALUES (NULL, $1, $2, $3, NOW(), NOW())
         RETURNING id`,
        [r.device_name, tokenHash, expiresAt]
      );
      const newDeviceId = ins.rows[0].id;

      const upd = await client.query(
        `UPDATE access_requests
         SET status = 'approved', device_id = $1, plain_token = $2, decided_at = NOW()
         WHERE id = $3 AND status = 'pending'`,
        [newDeviceId, plainToken, requestId]
      );
      if (upd.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: '该申请已处理' });
      }

      await client.query('COMMIT');

      sendToPollKey(r.poll_key, 'approved', {
        status: 'approved',
        token: plainToken,
      });

      return res.json({
        success: true,
        message: '已通过',
        device_id: newDeviceId,
        expires_at: formatDate(expiresAt),
      });
    } catch (e) {
      if (client) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      }
      console.error('[admin/requests approve]', e);
      return res.status(500).json({ error: '操作失败，请稍后重试' });
    } finally {
      if (client) client.release();
    }
  }

  return res.status(400).json({ error: 'action 无效' });
});

adminRouter.get('/devices', async (req, res) => {
  try {
    const r = await query(
      `SELECT d.id, d.device_name, d.created_at, d.last_used_at, d.expires_at,
              d.revoked_at, d.revoke_reason, d.banned_at, d.ban_reason, d.ban_until,
              (SELECT COUNT(*) FROM whitelist_devices b
               WHERE b.device_name = d.device_name
                 AND b.banned_at IS NOT NULL
                 AND (b.ban_until IS NULL OR b.ban_until > NOW())) AS any_banned
       FROM whitelist_devices d
       ORDER BY d.created_at DESC`
    );

    const nowMs = Date.now();
    const devices = r.rows.map((row) => {
      let status;
      if (Number(row.any_banned) > 0) status = '已封禁';
      else if (row.revoked_at) status = '已吊销';
      else if (row.expires_at && new Date(row.expires_at).getTime() < nowMs) status = '已过期';
      else status = '有效';

      return {
        id: row.id,
        device_name: row.device_name,
        created_at: formatDate(row.created_at),
        last_used_at: formatDate(row.last_used_at),
        expires_at: formatDate(row.expires_at),
        revoked_at: formatDate(row.revoked_at),
        revoke_reason: row.revoke_reason,
        banned_at: formatDate(row.banned_at),
        ban_reason: row.ban_reason,
        ban_until: formatDate(row.ban_until),
        status,
      };
    });

    res.json({ devices });
  } catch (e) {
    console.error('[admin/devices]', e);
    res.status(500).json({ error: '查询失败' });
  }
});

adminRouter.post('/revoke', async (req, res) => {
  const deviceId = parseInt(req.body.device_id, 10) || 0;
  let reason = String(req.body.reason || '').trim();
  if ([...reason].length > 255) reason = [...reason].slice(0, 255).join('');
  const reasonValue = reason === '' ? null : reason;

  if (deviceId <= 0) return res.status(400).json({ error: 'device_id 无效' });

  try {
    const r = await query(
      `SELECT device_token, banned_at, ban_until FROM whitelist_devices WHERE id = $1`,
      [deviceId]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: '设备不存在' });
    if (rowIsBanned(row)) {
      return res.status(403).json({ error: '设备已封禁，请先解封再吊销' });
    }

    const upd = await query(
      `UPDATE whitelist_devices
       SET revoked_at = NOW(), revoke_reason = $1
       WHERE id = $2 AND revoked_at IS NULL`,
      [reasonValue, deviceId]
    );
    if (upd.rowCount === 0) {
      return res.status(404).json({ error: '设备不存在或已处于吊销状态' });
    }

    const set = deviceSseClients.get(row.device_token);
    if (set) {
      for (const client of set) {
        try { client.write(`event: revoked\ndata: ${JSON.stringify({ reason: reasonValue })}\n\n`); } catch (_) {}
      }
    }

    res.json({ success: true, message: '设备已吊销' });
  } catch (e) {
    console.error('[admin/revoke]', e);
    res.status(500).json({ error: '吊销失败，请稍后重试' });
  }
});

adminRouter.post('/extend', async (req, res) => {
  const deviceId = parseInt(req.body.device_id, 10) || 0;
  const mode = String(req.body.mode || 'days');
  const days = parseInt(req.body.days, 10) || 0;
  const date = String(req.body.date || '').trim();

  if (deviceId <= 0) return res.status(400).json({ error: 'device_id 无效' });

  try {
    const r = await query(
      `SELECT id, expires_at, revoked_at, banned_at, ban_until
       FROM whitelist_devices WHERE id = $1`,
      [deviceId]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: '设备不存在' });
    if (rowIsBanned(row)) return res.status(403).json({ error: '设备已封禁，不能延期' });
    if (row.revoked_at) return res.status(403).json({ error: '设备已吊销，不能延期' });
    if (!row.expires_at && mode !== 'forever') {
      return res.status(400).json({ error: '该设备已永久有效，无需延期' });
    }

    let newExpires;
    if (mode === 'forever') {
      newExpires = null;
    } else if (mode === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: '日期格式无效，应为 YYYY-MM-DD' });
      }
      const dt = new Date(`${date}T23:59:59+08:00`);
      if (isNaN(dt.getTime())) {
        return res.status(400).json({ error: '日期格式无效' });
      }
      newExpires = dt;
    } else {
      if (days < 1 || days > 3650) {
        return res.status(400).json({ error: '天数需在 1-3650 之间' });
      }
      let base = Date.now();
      if (row.expires_at) {
        const orig = new Date(row.expires_at).getTime();
        if (orig > base) base = orig;
      }
      newExpires = new Date(base + days * 86_400_000);
    }

    const upd = await query(
      `UPDATE whitelist_devices SET expires_at = $1
       WHERE id = $2 AND revoked_at IS NULL
         AND (banned_at IS NULL OR (ban_until IS NOT NULL AND ban_until <= NOW()))`,
      [newExpires, deviceId]
    );
    if (upd.rowCount === 0) {
      return res.status(409).json({ error: '更新失败，设备可能已被吊销或封禁' });
    }

    res.json({
      success: true,
      expires_at: formatDate(newExpires),
      message: newExpires ? '已延期至 ' + formatDate(newExpires) : '已设为永久有效',
    });
  } catch (e) {
    console.error('[admin/extend]', e);
    res.status(500).json({ error: '更新失败，请稍后重试' });
  }
});

adminRouter.post('/ban', async (req, res) => {
  const deviceId = parseInt(req.body.device_id, 10) || 0;
  let reason = String(req.body.reason || '').trim();
  if ([...reason].length > 255) reason = [...reason].slice(0, 255).join('');
  const reasonValue = reason === '' ? null : reason;
  const mode = String(req.body.mode || 'forever');
  const days = parseInt(req.body.days, 10) || 0;

  if (deviceId <= 0) return res.status(400).json({ error: 'device_id 无效' });

  let banUntil = null;
  if (mode === 'temp') {
    if (days < 1 || days > 3650) {
      return res.status(400).json({ error: '临时封禁天数需在 1-3650 之间' });
    }
    banUntil = new Date(Date.now() + days * 86_400_000);
  }

  try {
    const r = await query(
      `SELECT id, device_name FROM whitelist_devices WHERE id = $1`,
      [deviceId]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: '设备不存在' });

    const upd = await query(
      `UPDATE whitelist_devices
       SET banned_at = NOW(), ban_reason = $1, ban_until = $2
       WHERE device_name = $3
         AND (banned_at IS NULL OR (ban_until IS NOT NULL AND ban_until <= NOW()))`,
      [reasonValue, banUntil, row.device_name]
    );

    if (upd.rowCount === 0) {
      return res.status(409).json({ error: '该设备名下的记录均已处于封禁状态' });
    }

    const pending = await query(
      `SELECT poll_key FROM access_requests
       WHERE device_name = $1 AND status = 'pending'`,
      [row.device_name]
    );
    for (const p of pending.rows) {
      sendToPollKey(p.poll_key, 'banned', {
        status: 'banned',
        banned: true,
        reason: reasonValue,
        ban_until: formatDate(banUntil),
      });
    }

    const tokens = await query(
      `SELECT device_token FROM whitelist_devices WHERE device_name = $1`,
      [row.device_name]
    );
    const banPayload = {
      reason: reasonValue,
      ban_until: formatDate(banUntil)
    };
    for (const t of tokens.rows) {
      const set = deviceSseClients.get(t.device_token);
      if (set) {
        for (const client of set) {
          try { client.write(`event: banned\ndata: ${JSON.stringify(banPayload)}\n\n`); } catch (_) {}
        }
      }
    }

    res.json({
      success: true,
      message: banUntil ? '设备已临时封禁至 ' + formatDate(banUntil) : '设备已永久封禁',
      affected: upd.rowCount,
      ban_until: formatDate(banUntil),
    });
  } catch (e) {
    console.error('[admin/ban]', e);
    res.status(500).json({ error: '封禁失败，请稍后重试' });
  }
});

adminRouter.post('/unban', async (req, res) => {
  const deviceId = parseInt(req.body.device_id, 10) || 0;
  if (deviceId <= 0) return res.status(400).json({ error: 'device_id 无效' });

  try {
    const r = await query(
      `SELECT id, device_name FROM whitelist_devices WHERE id = $1`,
      [deviceId]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: '设备不存在' });

    const upd = await query(
      `UPDATE whitelist_devices
       SET banned_at = NULL, ban_reason = NULL, ban_until = NULL
       WHERE device_name = $1 AND banned_at IS NOT NULL`,
      [row.device_name]
    );
    if (upd.rowCount === 0) {
      return res.status(404).json({ error: '该设备名下的记录均未处于封禁状态' });
    }

    res.json({ success: true, message: '设备已解封', affected: upd.rowCount });
  } catch (e) {
    console.error('[admin/unban]', e);
    res.status(500).json({ error: '解封失败，请稍后重试' });
  }
});

app.use('/api/admin', adminRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));

app.use((err, req, res, next) => {
  console.error('[server] error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器错误' });
});

async function main() {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

main().catch((e) => {
  console.error('Startup failed:', e);
  process.exit(1);
});