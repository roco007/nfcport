# NFC Port standalone backend

This folder contains the standalone backend service, which fetches NFC mappings from MySQL.

## Deploy on Render

The repository-root `render.yaml` explicitly configures this folder as a Node web service and starts `node index.js`. If configuring a Render Web Service manually, set **Root Directory** to `backend`, **Build Command** to `npm install`, and **Start Command** to `node index.js` (or `npm start`). Do not use `node expo-router/entry`; that is the mobile app's Expo entry point, not this service.

## Run

From the repository root:

```bash
cd backend
npm start
```

Or from the repository root with Node installed:

```bash
node backend/index.js
```

The server listens on `0.0.0.0:3002` by default. Change the port with `PORT=3000 npm start`; set `HOST=127.0.0.1` to restrict it to loopback. For a phone on the same network, use the computer's LAN IP and port `3002` in the app's Host URL setting.

## Endpoints

- `GET /api/health`
- `GET /api/nfc-config?userName=rc007` — returns the `nfcTagMapping` JSON for the given user. If `userName` is omitted or empty, it defaults to `rc007`.

The backend loads `backend/.env` on startup; variables already set by the hosting environment take precedence. Configure `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, and `MYSQL_PASSWORD` in that file or in the hosting environment. For the configured Aiven service, use port `18082`; it is also the backend default. `MYSQL_DATABASE` is optional and defaults to `nfcPort`. This backend does not enable TLS; the database service must allow non-TLS connections. Keep `.env` private and do not commit it.

For example, call `curl --get --data-urlencode 'userName=rc007' http://localhost:3002/api/nfc-config` after configuring the database environment variables.
