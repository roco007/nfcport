import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createPool } from "mysql2/promise";

const envPath = fileURLToPath(new URL("./.env", import.meta.url));
const envResult = loadEnv({ path: envPath });
if (envResult.error && envResult.error.code !== "ENOENT") {
  throw envResult.error;
}

const port = Number.parseInt(process.env.PORT || "3002", 10);
const host = process.env.HOST || "0.0.0.0";
let databasePool;
const maxRequestBodyBytes = 1024 * 1024;

function getUserName(url) {
  return url.searchParams.get("userName")?.trim() || "rc007";
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBodyBytes) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must contain valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function getDatabasePool() {
  const { MYSQL_HOST, MYSQL_PASSWORD, MYSQL_USER } = process.env;
  if (!MYSQL_HOST || !MYSQL_PASSWORD || !MYSQL_USER) {
    throw new Error("MYSQL_HOST, MYSQL_USER, and MYSQL_PASSWORD must be configured");
  }

  const mysqlPort = Number.parseInt(process.env.MYSQL_PORT || "18082", 10);
  if (!Number.isInteger(mysqlPort) || mysqlPort < 1 || mysqlPort > 65535) {
    throw new Error("MYSQL_PORT must be a valid TCP port");
  }

  databasePool ??= createPool({
    host: MYSQL_HOST,
    port: mysqlPort,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || "nfcPort",
    connectTimeout: 10000,
    waitForConnections: true,
    connectionLimit: 5,
  });

  return databasePool;
}

const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
      const userName = getUserName(url);
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

  if (request.method === "POST" && url.pathname === "/api/nfc-config") {
    try {
      const userName = getUserName(url);
      const config = await readJsonBody(request);
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Request body must be a JSON object" }));
        return;
      }

      const pool = getDatabasePool();
      const [existingRows] = await pool.execute(
        "SELECT 1 FROM `nfcPort`.`user_nfc_mapping` WHERE `user` = ? LIMIT 1",
        [userName],
      );
      const mapping = JSON.stringify(config);

      if (existingRows.length > 0) {
        await pool.execute(
          "UPDATE `nfcPort`.`user_nfc_mapping` SET `nfcTagMapping` = ? WHERE `user` = ?",
          [mapping, userName],
        );
      } else {
        await pool.execute(
          "INSERT INTO `nfcPort`.`user_nfc_mapping` (`user`, `nfcTagMapping`) VALUES (?, ?)",
          [userName, mapping],
        );
      }

      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, userName }));
    } catch (error) {
      const statusCode = error.statusCode || 500;
      if (statusCode === 500) {
        console.error("[backend] Failed to save NFC config:", error.message);
      }
      response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          error: statusCode === 500 ? "NFC configuration could not be saved" : error.message,
        }),
      );
    }
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, host, () => {
  console.log(`[backend] listening on http://${host}:${port}`);
});
