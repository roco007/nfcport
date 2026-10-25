# NFC Port backend

A production-oriented TypeScript/Express service that reads and updates per-user NFC action mappings and a shared server directory in MySQL. It preserves the mobile app's existing `GET /api/nfc-config` contract while adding strict environment and query schemas, authenticated writes, secure defaults, structured logs, probes, graceful shutdown, and deterministic builds.

## Architecture

```text
backend/
├── src/
│   ├── config/          # Zod-validated environment configuration
│   ├── controllers/     # HTTP request/response orchestration
│   ├── db/              # MySQL pool construction and TLS
│   ├── errors/          # Safe application error hierarchy
│   ├── middleware/      # Auth, validation, limits, and error responses
│   ├── observability/   # Pino JSON logging and request IDs
│   ├── repositories/    # Parameterized MySQL queries
│   ├── routes/          # Health, NFC, and server directory routes
│   ├── schemas/         # Runtime query and server mapping schemas
│   ├── scripts/         # Checksum-verified migration runner
│   ├── services/        # Business logic
│   ├── app.ts           # Dependency-injected Express application
│   └── server.ts        # Bootstrap, timeouts, and graceful shutdown
├── migrations/          # Checksum-verified MySQL migrations
├── tests/               # Unit and HTTP integration tests
├── .env.example
└── Dockerfile           # Multi-stage, non-root image
```

The service is stateless. NFC configuration writes use a single `INSERT ... ON DUPLICATE KEY UPDATE`, removing the read-before-write race in the old implementation. The `user` column must remain a primary or unique key. Server mappings use an auto-incrementing `id` for inserts and exact-ID updates; server names do not have a uniqueness constraint. Both repositories share one MySQL pool, which is closed once during shutdown.

## Requirements

- Node.js 24.22.1+
- MySQL 8+ (or a compatible MySQL service with a JSON column)
- npm (bundled with Node.js)

## Local setup

1. Enter the service and install the locked dependencies:

   ```bash
   cd backend
   npm ci
   ```

2. On a fresh checkout, copy `.env.example` to `.env`. Do not overwrite an existing `.env` because it may contain real credentials.

   ```bash
   cp .env.example .env
   ```

3. Generate a write API key and place it in `ADMIN_API_KEY`:

   ```bash
   openssl rand -base64 48
   ```

4. Set the `MYSQL_*` values and exact browser origins in `CORS_ORIGINS`. Local MySQL may use `MYSQL_SSL_MODE=disabled`; production refuses to start unless it is `required`. Production also requires a DNS database hostname so mysql2 can verify the certificate identity.

5. Build, then run the checksum-verified migration against the database named by `MYSQL_DATABASE`:

   ```bash
   npm run build
   npm run migrate
   ```

   The migration runner takes a MySQL advisory lock, validates legacy user identifiers before changing their type, and enforces the unique key required by atomic upserts. It stops without lossy conversion if legacy identifiers or duplicates need manual cleanup.

   Migration `003_create_server_mapping` creates `server_mapping` only when absent, with `id INT AUTO_INCREMENT PRIMARY KEY`, `serverName VARCHAR(255) NOT NULL`, and `ipAddress VARCHAR(45) NOT NULL`. An existing table is left unchanged; it must already provide these columns. No existing server rows are modified by this migration.

6. Start the watch-mode server:

   ```bash
   npm run dev
   ```

The default address is `http://localhost:3002`. From the repository root, `pnpm dev:backend` runs the same watch-mode service.

The example configuration sets `HOST=0.0.0.0`, so the service also listens on the Mac's LAN interface. From another device on the same network, check `http://<Mac-LAN-IP>:3002/health` after starting the backend (for example, `http://192.168.0.105:3002/health`). If Expo web is opened at `http://<Mac-LAN-IP>:8081`, add that exact origin to `CORS_ORIGINS` in your local `.env`. Replace the example IP when the Mac's address changes. CORS does not grant write access; POST still requires `X-API-Key`.

## Verify, build, and run

```bash
npm run typecheck
npm test
npm run build
npm start
```

`npm start` and `npm run migrate` run compiled code from `dist/`, so run `npm run build` first outside Docker. Startup fails immediately if required configuration is missing, production TLS/CORS policy is unsafe, MySQL cannot be reached, or the required NFC configuration table/columns are missing. Run all migrations before deployment; server-directory requests report `503 DEPENDENCY_UNAVAILABLE` if their table is missing. Database reads and writes have driver-level deadlines, the pool queue is bounded, and shutdown has a hard deadline.

The committed `.env.example` explicitly sets local MySQL port `3306`. If `MYSQL_PORT` is omitted, the service retains the legacy deployment default `18082`; set it explicitly in every production environment. `DATABASE_QUERY_TIMEOUT_MS` bounds each read/write query independently of HTTP body-receive timeouts.

## HTTP API

All JSON errors use this stable shape and never include stack traces:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "requestId": "...",
    "details": []
  }
}
```

| Method     | Path                             | Purpose                                  | Authentication |
| ---------- | -------------------------------- | ---------------------------------------- | -------------- |
| `GET`      | `/health`                        | Process liveness; does not touch MySQL   | None           |
| `GET`      | `/ready`                         | MySQL readiness with a timeout           | None           |
| `GET`      | `/api/health`                    | Backward-compatible liveness alias       | None           |
| `GET`      | `/api/nfc-config?userName=rc007` | Stored JSON payload                      | See below      |
| `POST`     | `/api/nfc-config?userName=rc007` | Replace an opaque JSON payload           | `X-API-Key`    |
| `GET/POST` | `/api/v1/nfc-config`             | Versioned alias                          | Same as above  |
| `GET`      | `/api/server-mappings`           | List server IDs, names, and IP addresses | None           |
| `POST`     | `/api/server-mappings`           | Create a server or update one by ID      | `X-API-Key`    |
| `GET/POST` | `/api/v1/server-mappings`        | Versioned server-directory alias         | Same as above  |

If `userName` is omitted or empty, `DEFAULT_USER_NAME` (default `rc007`) is used. That one client-facing mapping is intentionally readable without credentials. Reading any other user's mapping requires `X-API-Key`; every write requires it. This prevents a caller-controlled `userName` from becoming object-level authorization.

User names and query keys remain strictly validated. NFC configuration POST bodies are accepted and stored as opaque JSON objects or arrays without application-specific shape validation or normalization. Requests must still use a supported JSON content type, contain syntactically valid JSON, remain within the configured body-size limit, and pass write authentication and rate limiting. Callers are responsible for sending a payload their consumers can understand.

Removing domain validation also removes the backend's URL and application-URI allowlist. An authenticated writer can store arbitrary action values, so downstream consumers must treat the payload as untrusted and enforce any schemes or actions they are willing to execute.

Read a mapping:

```bash
curl --get --data-urlencode 'userName=rc007' http://localhost:3002/api/nfc-config
```

Write a mapping:

```bash
curl --request POST 'http://localhost:3002/api/nfc-config?userName=rc007' \
  --header 'Content-Type: application/json' \
  --header "X-API-Key: $ADMIN_API_KEY" \
  --data @nfc-config.json
```

### Server directory

`GET /api/server-mappings` returns `{ "servers": [{ "id": 7, "serverName": "Office Mac", "ipAddress": "192.168.1.20" }] }`, ordered by ID. An empty table returns `{ "servers": [] }`. Reads are public, and successful reads and writes use `Cache-Control: no-store`.

`POST /api/server-mappings` accepts `{ "id"?: number, "serverName": string, "ipAddress": string }`. Both strings are trimmed. Names must contain 1–255 characters; addresses must be bare IPv4 or IPv6 literals of at most 45 characters, without a URL scheme, hostname, port, brackets, or zone suffix. IDs, when supplied, must be positive integers within MySQL's signed `INT` range. Other body fields are rejected.

Omit `id` to create a row (`201`). Include `id` to update only that row (`200`); a nonexistent ID returns `404 SERVER_MAPPING_NOT_FOUND` and does not create a record. Duplicate server names are allowed. Both write responses contain `{ "server": { "id": 7, "serverName": "Office Mac", "ipAddress": "192.168.1.20" } }`. Writes use the same `X-API-Key`, JSON content-type/body-size checks, and request limits as the NFC configuration API.

```bash
# Read saved servers.
curl 'http://localhost:3002/api/server-mappings'

# Create a server.
curl --request POST 'http://localhost:3002/api/server-mappings' \
  --header 'Content-Type: application/json' \
  --header "X-API-Key: $ADMIN_API_KEY" \
  --data '{"serverName":"Office Mac","ipAddress":"192.168.1.20"}'

# Update the ID returned by a previous create or list response.
curl --request POST 'http://localhost:3002/api/server-mappings' \
  --header 'Content-Type: application/json' \
  --header "X-API-Key: $ADMIN_API_KEY" \
  --data '{"id":7,"serverName":"Office Mac","ipAddress":"2001:db8::20"}'
```

## Container

Build from this directory:

```bash
docker build --tag nfcport-backend:2.0.0 .
```

Apply migrations with the same immutable image, then run the service:

```bash
docker run --rm --env-file .env.production \
  nfcport-backend:2.0.0 npm run migrate

docker run --rm --name nfcport-backend \
  --publish 3002:3002 \
  --env-file .env.production \
  nfcport-backend:2.0.0
```

The final image contains only production dependencies and compiled output, runs as the unprivileged `node` user, and has an OCI health check against `/health`. When MySQL is running on the Docker host, use a host-reachable database name such as `host.docker.internal` instead of `127.0.0.1`.

## Production notes

- Put TLS termination at the load balancer and keep verified TLS enabled from the service to MySQL.
- Set `TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies. Render uses `1` in `render.yaml`; use `0` for a directly exposed process.
- Browser CORS is an exact allowlist. Native/server callers without an `Origin` header are allowed.
- `X-API-Key` is intended for a trusted administrative client and must never be bundled in the Expo application. The current app can read the default mapping, but its end-user mapping editor must use identity-bound JWT authorization before it can write safely; otherwise the protected POST correctly returns `401`.
- The bundled rate limiter is per process. For multiple replicas, enforce a shared limit at the gateway or configure a Redis-backed `express-rate-limit` store.
- Pino emits one JSON object per log line and redacts API keys, authorization/cookie headers, and database credentials.
- Rotate `ADMIN_API_KEY` and database credentials through the hosting platform; never bake `.env` into an image.

The root `render.yaml` installs, builds, prunes development dependencies, runs `npm run migrate` as a pre-deploy command, starts `dist/server.js`, and uses the dependency-aware `/ready` endpoint for platform probes. Secret values are declared with `sync: false` or generated by Render. Render pre-deploy commands require a supported paid service plan.

## CI foundation

`.github/workflows/backend-ci.yml` runs the locked install, strict typecheck, test suite, production build, and Docker image build whenever backend files change. The test application uses dependency injection and an in-memory repository; repository tests separately assert that real mysql2 calls receive query deadlines. Add a disposable MySQL service in CI when you want migration/TLS integration coverage.
