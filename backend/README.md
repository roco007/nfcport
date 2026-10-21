# NFC Port standalone backend

This folder contains the complete standalone backend service and its NFC action configuration. It has no package dependencies and does not use SQL.

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
- `GET /api/nfc-config`

Edit `nfc-config.json` to change tag serials and actions. Set `NFC_CONFIG_PATH` to use a config file elsewhere.
