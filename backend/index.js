import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createPool } from "mysql2/promise";

const port = Number.parseInt(process.env.PORT || "3002", 10);
const host = process.env.HOST || "0.0.0.0";
let databasePool;

function getDatabasePool() {
  const { MYSQL_HOST, MYSQL_PASSWORD, MYSQL_USER } = process.env;
  if (!MYSQL_HOST || !MYSQL_PASSWORD || !MYSQL_USER) {
    throw new Error("MYSQL_HOST, MYSQL_USER, and MYSQL_PASSWORD must be configured");
  }

  databasePool ??= createPool({
    host: MYSQL_HOST,
    port: Number.parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || "nfcPort",
    ssl: {
      rejectUnauthorized: true,
      ca: process.env.MYSQL_SSL_CA_PATH
        ? readFileSync(process.env.MYSQL_SSL_CA_PATH, "utf8")
        : undefined,
    },
    waitForConnections: true,
    connectionLimit: 5,
  });

  return databasePool;
}

const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/api/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/nfc-config") {
    try {
      const userName = url.searchParams.get("userName")?.trim() || "rc007";
      const [rows] = await getDatabasePool().execute(
        "SELECT `nfcTagMapping` FROM `nfcPort`.`user_nfc_mapping` WHERE `user` = ? LIMIT 1",
        [userName],
      );
      const mapping = rows[0]?.nfcTagMapping;
      const config = typeof mapping === "string" ? JSON.parse(mapping) : mapping;
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "NFC configuration was not found" }));
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(config));
    } catch (error) {
      console.error("[backend] Failed to load NFC config:", error.message);
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "NFC configuration is unavailable" }));
    }
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, host, () => {
  console.log(`[backend] listening on http://${host}:${port}`);
});
