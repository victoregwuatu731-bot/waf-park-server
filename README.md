# Waf Park multiplayer server

This server matches the multiplayer protocol already present in the Waf Park HTML game. It supports room codes, shared player states, build synchronization, and **up to 100 connections in one room** (configurable downwards/up to 100).

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run:

   ```bash
   npm install
   npm start
   ```

3. The server listens on port `3000` by default. Health check: `http://localhost:3000/health`.
4. Open the Waf Park HTML game. Open **Multiplayer**, use server `localhost:3000`, then choose **Host Game**. Other players use the public server address and enter the four-character room code.

## Deploy publicly

Deploy this folder to a Node hosting service that supports long-lived WebSocket connections and exposes a public port. Set the start command to `npm start`. The platform's HTTPS endpoint should accept WebSockets (`wss://`) automatically.

Set environment variables:
- `MAX_PLAYERS=100` (default; hard cap 100)
- `PORT` is normally supplied by the host.

After deployment, use the host's public hostname in the game's Server field. If the host provides an HTTPS address, the game will use `wss://` automatically.

## Important notes for 100-player sessions

- This is a **relay server**, not a full authoritative physics server. The clients currently simulate movement and send their state to the room.
- 100 concurrent connections are supported by the room limit, but real-world performance depends on hosting CPU/network bandwidth and player devices. This game relays state at around 20 updates/second per player, so test with a load generator before a public event.
- Use a paid service or VPS for sustained sessions; free plans may sleep, cap bandwidth, or limit connections.
- Voice chat uses peer-to-peer WebRTC signaling carried in game state packets; users may need a TURN server if direct peer connectivity fails.
- This is an initial server implementation. Do not expose a public game to untrusted users without adding moderation, rate limits, authentication, and server-side validation.

## Protocol behavior

Host creates a room, server generates a 4-character code, players join, the host starts the game, and player/build state packets are relayed. Build pieces are retained in-memory while the room exists. Rooms are not persistent across server restarts.
