import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import {
  DataIntegrityError,
  DependencyUnavailableError,
} from "../errors/app-error.js";

interface NfcConfigRow extends RowDataPacket {
  readonly nfcTagMapping: unknown;
}

interface MappingIndexRow extends RowDataPacket {
  readonly Key_name: string;
  readonly Non_unique: number;
  readonly Seq_in_index: number;
  readonly Column_name: string;
  readonly Sub_part: number | null;
}

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

export interface NfcConfigRepository {
  findByUserName(userName: string): Promise<unknown | null>;
  upsert(userName: string, config: unknown): Promise<void>;
  ping(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

function decodeMapping(value: unknown): unknown {
  const decodedValue = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  if (typeof decodedValue !== "string") return decodedValue;

  try {
    return JSON.parse(decodedValue) as unknown;
  } catch (cause) {
    throw new DataIntegrityError(cause);
  }
}

export class MySqlNfcConfigRepository implements NfcConfigRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly queryTimeoutMs: number,
  ) {}

  public async findByUserName(userName: string): Promise<unknown | null> {
    try {
      const [rows] = await this.pool.execute<NfcConfigRow[]>(
        {
          sql: "SELECT `nfcTagMapping` FROM `user_nfc_mapping` WHERE `user` = ? LIMIT 1",
          timeout: this.queryTimeoutMs,
        },
        [userName],
      );
      const row = rows[0];
      return row === undefined ? null : decodeMapping(row.nfcTagMapping);
    } catch (error) {
      if (error instanceof DataIntegrityError) throw error;
      throw new DependencyUnavailableError(error);
    }
  }

  public async upsert(userName: string, config: unknown): Promise<void> {
    const mapping = JSON.stringify(config);

    try {
      await this.pool.execute<ResultSetHeader>(
        {
          sql: `INSERT INTO \`user_nfc_mapping\` (\`user\`, \`nfcTagMapping\`)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE \`nfcTagMapping\` = ?`,
          timeout: this.queryTimeoutMs,
        },
        [userName, mapping, mapping],
      );
    } catch (error) {
      throw new DependencyUnavailableError(error);
    }
  }

  public async ping(timeoutMs = this.queryTimeoutMs): Promise<void> {
    try {
      // LIMIT 0 verifies the table and required columns without reading user data.
      await this.pool.query({
        sql: "SELECT `user`, `nfcTagMapping` FROM `user_nfc_mapping` LIMIT 0",
        timeout: timeoutMs,
      });
      const [indexes] = await this.pool.query<MappingIndexRow[]>({
        sql: "SHOW INDEX FROM `user_nfc_mapping`",
        timeout: timeoutMs,
      });
      if (!hasUniqueUserIndex(indexes)) {
        throw new Error(
          "user_nfc_mapping.user must have a full-column unique index",
        );
      }
    } catch (error) {
      throw new DependencyUnavailableError(error);
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
