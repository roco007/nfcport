import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.NFC_CONFIG_PATH || path.join(directory, "nfc-config.json");
const port = Number.parseInt(process.env.PORT || "3002", 10);
const host = process.env.HOST || "0.0.0.0";

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
      const config = JSON.parse(await readFile(configPath, "utf8"));
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
  console.log(`[backend] config file: ${configPath}`);
});
