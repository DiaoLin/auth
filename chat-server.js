import express from 'express';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const router = express.Router();

/* ============================================================
 * 1. 鉴权中间件 (需传入 query)
 * ============================================================ */
export function requireDevice(query) {
  return function (req, res, next) {
    const authHeader = req.headers.authorization || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
    if (!token) return res.status(401).json({ error: '未授权' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    query(
      `SELECT device_name FROM whitelist_devices WHERE device_token = $1 AND revoked_at IS NULL AND (banned_at IS NULL OR (ban_until IS NOT NULL AND ban_until <= NOW())) LIMIT 1`,
      [tokenHash]
    ).then(r => {
      if (r.rows.length === 0) return res.status(401).json({ error: '设备无效或已被封禁' });
      req.deviceName = r.rows[0].device_name;
      next();
    }).catch(() => res.status(500).json({ error: '鉴权失败' }));
  };
}

/* ============================================================
 * 2. 依赖注入初始化函数
 * ============================================================ */

// 为了能在 Express Router 中使用外部的 query，我们需要通过闭包或中间件注入。
// 但是因为 server.js 在 app.use 时会调用 router，这里我们默认通过 req 传值，或者提供一个初始化函数。
// 最简单的方式：直接在路由挂载前，保证 query 已经在 req 上。
// 为了保持 server.js 的代码简洁，我们需要把 router 导出为函数，接收 query。

export function createChatRouter(query) {
  const router = express.Router();
  const requireDeviceMw = requireDevice(query);

  // 获取当前设备加入的所有聊天室
  router.get('/rooms', requireDeviceMw, async (req, res) => {
    try {
      const r = await query(
        `SELECT r.id, r.type, r.name, 
                (SELECT COUNT(*) FROM chat_messages m WHERE m.room_id = r.id) as msg_count
         FROM chat_rooms r
         JOIN chat_members m ON r.id = m.room_id
         WHERE m.device_name = $1
         ORDER BY r.created_at DESC`,
        [req.deviceName]
      );
      res.json({ rooms: r.rows });
    } catch (e) {
      res.status(500).json({ error: '获取聊天室失败' });
    }
  });

  // 获取特定聊天室的历史消息
  router.get('/rooms/:roomId/messages', requireDeviceMw, async (req, res) => {
    const { roomId } = req.params;
    try {
      const member = await query(`SELECT 1 FROM chat_members WHERE room_id = $1 AND device_name = $2`, [roomId, req.deviceName]);
      if (member.rows.length === 0) return res.status(403).json({ error: '无权访问此聊天室' });

      const r = await query(
        `SELECT id, sender_name, sender_alias, content, created_at 
         FROM chat_messages WHERE room_id = $1 ORDER BY created_at ASC LIMIT 100`,
        [roomId]
      );
      res.json({ messages: r.rows });
    } catch (e) {
      res.status(500).json({ error: '获取消息失败' });
    }
  });

  // 创建群组
  router.post('/rooms/group', requireDeviceMw, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '群组名不能为空' });

    try {
      const roomRes = await query(
        `INSERT INTO chat_rooms (type, name) VALUES ('group', $1) RETURNING id`,
        [name]
      );
      const roomId = roomRes.rows[0].id;
      await query(`INSERT INTO chat_members (room_id, device_name) VALUES ($1, $2)`, [roomId, req.deviceName]);
      res.json({ success: true, room_id: roomId });
    } catch (e) {
      res.status(500).json({ error: '创建群组失败' });
    }
  });

  // 发起私人聊天
  router.post('/rooms/private', requireDeviceMw, async (req, res) => {
    const { target_device } = req.body;
    if (!target_device) return res.status(400).json({ error: '目标设备名不能为空' });
    if (target_device === req.deviceName) return res.status(400).json({ error: '不能和自己私聊' });

    try {
      const target = await query(`SELECT 1 FROM whitelist_devices WHERE device_name = $1`, [target_device]);
      if (target.rows.length === 0) return res.status(404).json({ error: '目标设备不存在' });

      const existing = await query(
        `SELECT r.id FROM chat_rooms r
         JOIN chat_members m1 ON r.id = m1.room_id AND m1.device_name = $1
         JOIN chat_members m2 ON r.id = m2.room_id AND m2.device_name = $2
         WHERE r.type = 'private' LIMIT 1`,
        [req.deviceName, target_device]
      );

      if (existing.rows.length > 0) {
        return res.json({ success: true, room_id: existing.rows[0].id });
      }

      const roomRes = await query(`INSERT INTO chat_rooms (type) VALUES ('private') RETURNING id`);
      const roomId = roomRes.rows[0].id;
      
      await query(`INSERT INTO chat_members (room_id, device_name) VALUES ($1, $2), ($1, $3)`, [roomId, req.deviceName, target_device]);
      res.json({ success: true, room_id: roomId });
    } catch (e) {
      res.status(500).json({ error: '发起私聊失败' });
    }
  });

  // 获取/设置用户别名
  router.get('/alias', requireDeviceMw, async (req, res) => {
    try {
      const r = await query(`SELECT alias FROM device_profiles WHERE device_name = $1`, [req.deviceName]);
      res.json({ alias: r.rows.length > 0 ? r.rows[0].alias : req.deviceName });
    } catch (e) {
      res.status(500).json({ error: '获取别名失败' });
    }
  });

  router.post('/alias', requireDeviceMw, async (req, res) => {
    const { alias } = req.body;
    if (!alias || alias.trim() === '') return res.status(400).json({ error: '别名不能为空' });

    try {
      await query(
        `INSERT INTO device_profiles (device_name, alias) VALUES ($1, $2)
         ON CONFLICT (device_name) DO UPDATE SET alias = $2`,
        [req.deviceName, alias.trim()]
      );
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: '设置别名失败' });
    }
  });

  return router;
}

/* ============================================================
 * 3. WebSocket 服务器逻辑 (接收 server 和 query 作为参数)
 * ============================================================ */

export function initWebSocket(server, query) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/api/chat/ws') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    try {
      const r = await query(
        `SELECT device_name FROM whitelist_devices WHERE device_token = $1 AND revoked_at IS NULL AND (banned_at IS NULL OR (ban_until IS NOT NULL AND ban_until <= NOW())) LIMIT 1`,
        [tokenHash]
      );
      if (r.rows.length === 0) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const deviceName = r.rows[0].device_name;
      
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.deviceName = deviceName;
        wss.emit('connection', ws, request);
      });
    } catch (e) {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  const roomClients = new Map();

  wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'join') {
          const { roomId } = data;
          const member = await query(`SELECT 1 FROM chat_members WHERE room_id = $1 AND device_name = $2`, [roomId, ws.deviceName]);
          if (member.rows.length === 0) return;

          if (!roomClients.has(roomId)) roomClients.set(roomId, new Set());
          roomClients.get(roomId).add(ws);
          ws.currentRoomId = roomId;
        }

        if (data.type === 'message') {
          const { roomId, content } = data;
          if (ws.currentRoomId !== roomId) return;
          
          const profile = await query(`SELECT alias FROM device_profiles WHERE device_name = $1`, [ws.deviceName]);
          const alias = profile.rows.length > 0 ? profile.rows[0].alias : ws.deviceName;

          const msgRes = await query(
            `INSERT INTO chat_messages (room_id, sender_name, sender_alias, content) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
            [roomId, ws.deviceName, alias, content]
          );

          const msgPayload = {
            type: 'new_message',
            roomId,
            message: {
              id: msgRes.rows[0].id,
              sender_name: ws.deviceName,
              sender_alias: alias,
              content,
              created_at: msgRes.rows[0].created_at
            }
          };

          const clients = roomClients.get(roomId);
          if (clients) {
            for (const client of clients) {
              if (client.readyState === 1) {
                client.send(JSON.stringify(msgPayload));
              }
            }
          }
        }
      } catch (e) {
        console.error('WS Message Error:', e);
      }
    });

    ws.on('close', () => {
      if (ws.currentRoomId && roomClients.has(ws.currentRoomId)) {
        roomClients.get(ws.currentRoomId).delete(ws);
        if (roomClients.get(ws.currentRoomId).size === 0) {
          roomClients.delete(ws.currentRoomId);
        }
      }
    });
  });

  return wss;
}
