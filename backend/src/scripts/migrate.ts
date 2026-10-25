import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config as loadEnvironmentFile } from "dotenv";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import pino from "pino";
import { loadConfig } from "../config/env.js";
import { createMySqlPool } from "../db/mysql.js";
import { createLogger } from "../observability/logger.js";

interface LockRow extends RowDataPacket {
  readonly lockAcquired: 0 | 1 | null;
}

interface AppliedMigrationRow extends RowDataPacket {
  readonly checksum: string;
}

interface MappingIndexRow extends RowDataPacket {
  readonly Key_name: string;
  readonly Non_unique: number;
  readonly Seq_in_index: number;
  readonly Column_name: string;
  readonly Sub_part: number | null;
}

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

const migrations = [
  {
    id: "001_create_user_nfc_mapping",
    url: new URL(
      "../../migrations/001_create_user_nfc_mapping.sql",
      import.meta.url,
    ),
  },
  {
    id: "002_normalize_user_identifier",
    url: new URL(
      "../../migrations/002_normalize_user_identifier.sql",
      import.meta.url,
    ),
  },
  {
    id: "003_create_server_mapping",
    url: new URL(
      "../../migrations/003_create_server_mapping.sql",
      import.meta.url,
    ),
  },
] as const;

function hasUniqueUserIndex(rows: readonly MappingIndexRow[]): boolean {
  const indexes = new Map<string, MappingIndexRow[]>();
  for (const row of rows) {
    if (Number(row.Non_unique) !== 0) continue;
    const entries = indexes.get(row.Key_name) ?? [];
    entries.push(row);
    indexes.set(row.Key_name, entries);
  }

  return [...indexes.values()].some((entries) => {
    const ordered = [...entries].sort(
      (left, right) => Number(left.Seq_in_index) - Number(right.Seq_in_index),
    );
    return (
      ordered.length === 1 &&
      ordered[0]?.Column_name === "user" &&
      ordered[0].Sub_part === null
    );
  });
}

async function reconcileUniqueUserIndex(
  connection: PoolConnection,
  timeout: number,
): Promise<void> {
  const [indexes] = await connection.query<MappingIndexRow[]>({
    sql: "SHOW INDEX FROM `user_nfc_mapping`",
    timeout,
  });
  if (hasUniqueUserIndex(indexes)) return;

  // This intentionally fails when exact duplicate users exist. Silently
  // selecting one duplicate would risk discarding a real mapping.
  await connection.query({
    sql: "ALTER TABLE `user_nfc_mapping` ADD CONSTRAINT `uq_user_nfc_mapping_user` UNIQUE (`user`)",
    timeout,
  });
}

async function prepareUserIdentifierMigration(
  connection: PoolConnection,
  timeout: number,
  sql: string,
): Promise<string> {
  // Make ALTER reject lossy conversion even when the database's global mode is
  // permissive. This setting is scoped to the migration connection.
  await connection.query({
    sql: "SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'STRICT_ALL_TABLES')",
    timeout,
  });

  const [invalidRows] = await connection.query<CountRow[]>({
    sql: `SELECT COUNT(*) AS \`count\`
          FROM \`user_nfc_mapping\`
          WHERE \`user\` IS NULL
             OR CHAR_LENGTH(\`user\`) > 128
             OR \`user\` NOT REGEXP '^[A-Za-z0-9][A-Za-z0-9_.@-]*$'`,
    timeout,
  });
  if (Number(invalidRows[0]?.count ?? 0) > 0) {
    throw new Error(
      "Legacy user_nfc_mapping rows contain user identifiers that cannot be converted safely; clean them before migrating",
    );
  }

  const [duplicateRows] = await connection.query<CountRow[]>({
    sql: `SELECT COUNT(*) AS \`count\`
          FROM \`user_nfc_mapping\`
          GROUP BY BINARY \`user\`
          HAVING COUNT(*) > 1
          LIMIT 1`,
    timeout,
  });
  if (duplicateRows.length > 0) {
    throw new Error(
      "Legacy user_nfc_mapping rows contain duplicate user identifiers; resolve them before migrating",
    );
  }

  const [indexes] = await connection.query<MappingIndexRow[]>({
    sql: "SHOW INDEX FROM `user_nfc_mapping`",
    timeout,
  });
  if (hasUniqueUserIndex(indexes)) return sql;

  // Keep normalization and uniqueness in one atomic ALTER so a unique-key
  // failure cannot leave the identifier column partially migrated.
  return `${sql.trim()},
          ADD CONSTRAINT \`uq_user_nfc_mapping_user\` UNIQUE (\`user\`)`;
}

async function runMigrations(): Promise<void> {
  const environmentPath = fileURLToPath(new URL("../../.env", import.meta.url));
  const environmentResult = loadEnvironmentFile({
    path: environmentPath,
    override: false,
  });
  if (
    environmentResult.error !== undefined &&
    (environmentResult.error as NodeJS.ErrnoException).code !== "ENOENT"
  ) {
    throw environmentResult.error;
  }

  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createMySqlPool(config);
  let connection: PoolConnection | undefined;
  let lockHeld = false;

  try {
    connection = await pool.getConnection();
    const timeout = config.database.queryTimeoutMs;
    const [lockRows] = await connection.query<LockRow[]>({
      sql: "SELECT GET_LOCK('nfcport_schema_migrations', 30) AS `lockAcquired`",
      timeout,
    });
    if (lockRows[0]?.lockAcquired !== 1) {
      throw new Error("Could not acquire the database migration lock");
    }
    lockHeld = true;

    await connection.query({
      sql: `CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
              \`id\` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              \`checksum\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              \`appliedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB`,
      timeout,
    });

    for (const migration of migrations) {
      const sql = await readFile(migration.url, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const [rows] = await connection.execute<AppliedMigrationRow[]>(
        {
          sql: "SELECT `checksum` FROM `schema_migrations` WHERE `id` = ? LIMIT 1",
          timeout,
        },
        [migration.id],
      );

      const applied = rows[0];
      if (applied !== undefined) {
        if (applied.checksum !== checksum) {
          throw new Error(
            `Applied migration ${migration.id} no longer matches its checksum`,
          );
        }
        logger.info({ migration: migration.id }, "Migration already applied");
        continue;
      }

      const migrationSql =
        migration.id === "002_normalize_user_identifier"
          ? await prepareUserIdentifierMigration(connection, timeout, sql)
          : sql;
      await connection.query({ sql: migrationSql, timeout });
      await connection.execute(
        {
          sql: "INSERT INTO `schema_migrations` (`id`, `checksum`) VALUES (?, ?)",
          timeout,
        },
        [migration.id, checksum],
      );
      logger.info({ migration: migration.id }, "Migration applied");
    }

    // Legacy installations may already have the table, causing migration 001's
    // CREATE IF NOT EXISTS to be a no-op. Reconcile the invariant required by
    // INSERT ... ON DUPLICATE KEY and re-check it on every deployment.
    await reconcileUniqueUserIndex(connection, timeout);
  } finally {
    if (connection !== undefined) {
      if (lockHeld) {
        try {
          await connection.query({
            sql: "SELECT RELEASE_LOCK('nfcport_schema_migrations')",
            timeout: config.database.queryTimeoutMs,
          });
        } catch (error) {
          logger.warn({ err: error }, "Failed to release migration lock");
        }
      }
      connection.release();
    }
    await pool.end();
  }
}

const bootstrapLogger = pino({ level: "info" });
runMigrations().catch((error: unknown) => {
  bootstrapLogger.fatal({ err: error }, "Database migration failed");
  process.exitCode = 1;
});
