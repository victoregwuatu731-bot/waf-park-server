// Waf Park multiplayer WebSocket server
// Supports room codes, shared build pieces, player-state relays, and up to 100 players per room.
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = Math.min(100, Math.max(2, Number(process.env.MAX_PLAYERS || 100)));
const MAX_PAYLOAD = 4 * 1024 * 1024;
const rooms = new Map();
let nextPlayerId = 1;

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const body = JSON.stringify({ status: 'ok', service: 'Waf Park multiplayer', rooms: rooms.size, maxPlayersPerRoom: MAX_PLAYERS });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    return res.end(body);
  }
  res.writeHead(404); res.end('Not found');
});
const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(room, data, except = null) {
  const raw = JSON.stringify(data);
  for (const client of room.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) client.send(raw);
  }
}
function safeName(value) {
  return String(value || 'Pirate').replace(/[<>\\u0000-\\u001f]/g, '').slice(0, 28) || 'Pirate';
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function playerList(room) {
  return [...room.clients].filter(c => c.readyState === WebSocket.OPEN)
    .map(c => ({ id: c.playerId, name: c.playerName }));
}
function publishPlayers(room) { broadcast(room, { t: 'pl', list: playerList(room) }); }
function roomPacket(room, ws) {
  send(ws, {
    t: 'room', id: ws.playerId, host: ws.isHost ? 1 : 0, code: room.code,
    urls: [], builds: [...room.builds.values()], started: room.started ? 1 : 0
  });
  send(ws, { t: 'pl', list: playerList(room) });
}
function removeClient(ws) {
  const room = ws.room;
  if (!room) return;
  room.clients.delete(ws);
  ws.room = null;
  if (ws.isHost) {
    broadcast(room, { t: 'closed' });
    for (const c of room.clients) { c.room = null; try { c.close(1000, 'Host left'); } catch (_) {} }
    rooms.delete(room.code);
    return;
  }
  publishPlayers(room);
  if (room.clients.size === 0) rooms.delete(room.code);
}
function joinRoom(ws, room, name, isHost) {
  if (room.clients.size >= MAX_PLAYERS) return send(ws, { t: 'err', m: `Room is full (maximum ${MAX_PLAYERS} players).` });
  ws.room = room;
  ws.playerId = isHost ? 1 : nextPlayerId++;
  ws.playerName = safeName(name);
  ws.isHost = !!isHost;
  room.clients.add(ws);
  roomPacket(room, ws);
  publishPlayers(room);
}
function validRoomCode(code) { return /^[A-Z0-9]{4}$/.test(String(code || '').toUpperCase()); }

wss.on('connection', ws => {
  ws.room = null; ws.playerId = 0; ws.playerName = 'Pirate'; ws.isHost = false;
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return send(ws, { t: 'err', m: 'Invalid message.' }); }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'host') {
      if (ws.room) return send(ws, { t: 'err', m: 'You are already in a room.' });
      const code = makeCode();
      const room = { code, clients: new Set(), builds: new Map(), started: false };
      rooms.set(code, room);
      joinRoom(ws, room, msg.name, true);
      return;
    }
    if (msg.t === 'join') {
      if (ws.room) return send(ws, { t: 'err', m: 'You are already in a room.' });
      const code = String(msg.code || '').toUpperCase();
      if (!validRoomCode(code)) return send(ws, { t: 'err', m: 'Enter a valid 4-character room code.' });
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'err', m: 'Room not found. Ask the host to create it first.' });
      if (room.started) return send(ws, { t: 'err', m: 'That game has already started.' });
      return joinRoom(ws, room, msg.name, false);
    }
    const room = ws.room;
    if (!room) return send(ws, { t: 'err', m: 'Host or join a room first.' });
    if (msg.t === 'ping') return send(ws, { t: 'pong', ts: msg.ts });
    if (msg.t === 'go') {
      if (!ws.isHost) return send(ws, { t: 'err', m: 'Only the host can start the game.' });
      room.started = true;
      return broadcast(room, { t: 'go' });
    }
    if (msg.t === 'b') {
      if (typeof msg.k !== 'string' || msg.k.length > 180 || !msg.p || typeof msg.p !== 'object') return;
      const key = `${String(msg.o || 0)}:${msg.k}`;
      if (room.builds.size >= 12000 && !room.builds.has(key)) return send(ws, { t: 'err', m: 'Build limit reached for this room.' });
      const item = { o: Number(msg.o) || 0, k: msg.k, p: msg.p };
      room.builds.set(key, item);
      return broadcast(room, { t: 'b', ...item });
    }
    if (msg.t === 'd') {
      if (typeof msg.k !== 'string' || msg.k.length > 180) return;
      for (const [key, item] of room.builds) {
        if (item.k === msg.k && (msg.o == null || item.o === Number(msg.o))) room.builds.delete(key);
      }
      return broadcast(room, { t: 'd', k: msg.k });
    }
    if (msg.t === 's') {
      const packet = { ...msg, f: ws.playerId };
      delete packet.name;
      return broadcast(room, packet, ws);
    }
    if (msg.t === 'ed') return broadcast(room, msg, ws);
    // Any additional game protocol event is safely relayed to the room.
    if (['vc', 'emote', 'chat'].includes(msg.t)) return broadcast(room, { ...msg, f: ws.playerId }, ws);
  });
  ws.on('close', () => removeClient(ws));
  ws.on('error', () => removeClient(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Waf Park server listening on port ${PORT}; room limit ${MAX_PLAYERS}`);
});
