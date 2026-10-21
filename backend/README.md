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

Configure the MySQL connection with `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, and `MYSQL_PASSWORD`. `MYSQL_DATABASE` is optional and defaults to `nfcPort`. The backend uses TLS with certificate validation; set `MYSQL_SSL_CA_PATH` to the trusted CA certificate file if the database provider requires a custom CA.

For example, call `curl 'http://localhost:3002/api/nfc-config?userName=rc007'` after configuring the database environment variables.
