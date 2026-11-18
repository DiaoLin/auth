import express from 'express';
import crypto from 'node:crypto';

const MAX_SAVE_SIZE = 10 * 1024 * 1024;

export async function initCloudSavesDb(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS pvz_cloud_saves (
      device_name VARCHAR(100) NOT NULL,
      slot SMALLINT NOT NULL CHECK (slot IN (1, 2)),
      name VARCHAR(40) NOT NULL,
      save_data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (device_name, slot)
    )
  `);
}

export function createCloudSavesRouter(query) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ error: '请先登录设备' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    try {
      const result = await query(
        `SELECT device_name FROM whitelist_devices
         WHERE device_token = $1 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
           AND (banned_at IS NULL OR (ban_until IS NOT NULL AND ban_until <= NOW()))
         LIMIT 1`,
        [tokenHash]
      );
      if (!result.rows[0]) return res.status(401).json({ error: '设备无效、已过期或已被封禁' });
      req.deviceName = result.rows[0].device_name;
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const result = await query(
        `SELECT slot, name, updated_at, octet_length(save_data) AS size_bytes
         FROM pvz_cloud_saves WHERE device_name = $1 ORDER BY slot`,
        [req.deviceName]
      );
      const saves = new Map(result.rows.map((row) => [row.slot, row]));
      res.json({
        slots: [1, 2].map((slot) => {
          const save = saves.get(slot);
          return save
            ? { slot, name: save.name, updated_at: save.updated_at, size_bytes: Number(save.size_bytes) }
            : { slot, name: null, updated_at: null, size_bytes: 0 };
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  router.put('/:slot', express.raw({ type: 'application/octet-stream', limit: MAX_SAVE_SIZE }), async (req, res, next) => {
    const slot = Number(req.params.slot);
    const name = String(req.query.name || '').trim();
    if (![1, 2].includes(slot)) return res.status(400).json({ error: '槽位无效' });
    if (!name || [...name].length > 40) return res.status(400).json({ error: '名称须为 1 至 40 个字符' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: '存档内容不能为空' });
    try {
      const result = await query(
        `INSERT INTO pvz_cloud_saves (device_name, slot, name, save_data, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (device_name, slot)
         DO UPDATE SET name = EXCLUDED.name, save_data = EXCLUDED.save_data, updated_at = NOW()
         RETURNING slot, name, updated_at`,
        [req.deviceName, slot, name, req.body]
      );
      res.json({ success: true, save: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slot', async (req, res, next) => {
    const slot = Number(req.params.slot);
    if (![1, 2].includes(slot)) return res.status(400).json({ error: '槽位无效' });
    try {
      const result = await query(
        `SELECT name, save_data FROM pvz_cloud_saves WHERE device_name = $1 AND slot = $2`,
        [req.deviceName, slot]
      );
      if (!result.rows[0]) return res.status(404).json({ error: '云存档不存在' });
      res.type('application/octet-stream').send(result.rows[0].save_data);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:slot', async (req, res, next) => {
    const slot = Number(req.params.slot);
    const name = String(req.body.name || '').trim();
    if (![1, 2].includes(slot)) return res.status(400).json({ error: '槽位无效' });
    if (!name || [...name].length > 40) return res.status(400).json({ error: '名称须为 1 至 40 个字符' });
    try {
      const result = await query(
        `UPDATE pvz_cloud_saves SET name = $1 WHERE device_name = $2 AND slot = $3
         RETURNING slot, name, updated_at`,
        [name, req.deviceName, slot]
      );
      if (!result.rows[0]) return res.status(404).json({ error: '云存档不存在' });
      res.json({ success: true, save: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:slot', async (req, res, next) => {
    const slot = Number(req.params.slot);
    if (![1, 2].includes(slot)) return res.status(400).json({ error: '槽位无效' });
    try {
      const result = await query(
        `DELETE FROM pvz_cloud_saves WHERE device_name = $1 AND slot = $2`,
        [req.deviceName, slot]
      );
      if (!result.rowCount) return res.status(404).json({ error: '云存档不存在' });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '云存档不能超过 10 MiB' });
    next(error);
  });

  return router;
}
