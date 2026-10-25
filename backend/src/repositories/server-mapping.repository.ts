import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { DependencyUnavailableError } from "../errors/app-error.js";

export interface ServerMappingInput {
  readonly serverName: string;
  readonly ipAddress: string;
}

export interface ServerMapping extends ServerMappingInput {
  readonly id: number;
}

interface ServerMappingRow extends RowDataPacket, ServerMapping {}

export interface ServerMappingRepository {
  list(): Promise<ServerMapping[]>;
  create(input: ServerMappingInput): Promise<ServerMapping>;
  update(id: number, input: ServerMappingInput): Promise<ServerMapping | null>;
}

export class MySqlServerMappingRepository implements ServerMappingRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly queryTimeoutMs: number,
  ) {}

  public async list(): Promise<ServerMapping[]> {
    try {
      const [rows] = await this.pool.execute<ServerMappingRow[]>({
        sql: "SELECT `id`, `serverName`, `ipAddress` FROM `server_mapping` ORDER BY `id`",
        timeout: this.queryTimeoutMs,
      });
      return rows;
    } catch (error) {
      throw new DependencyUnavailableError(error);
    }
  }

  public async create(input: ServerMappingInput): Promise<ServerMapping> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        {
          sql: "INSERT INTO `server_mapping` (`serverName`, `ipAddress`) VALUES (?, ?)",
          timeout: this.queryTimeoutMs,
        },
        [input.serverName, input.ipAddress],
      );
      return { id: result.insertId, ...input };
    } catch (error) {
      throw new DependencyUnavailableError(error);
    }
  }

  public async update(
    id: number,
    input: ServerMappingInput,
  ): Promise<ServerMapping | null> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        {
          sql: "UPDATE `server_mapping` SET `serverName` = ?, `ipAddress` = ? WHERE `id` = ?",
          timeout: this.queryTimeoutMs,
        },
        [input.serverName, input.ipAddress, id],
      );
      if (result.affectedRows > 0) return { id, ...input };

      // MySQL can report zero affected rows for an unchanged value when the
      // client does not request FOUND_ROWS. Distinguish that from a missing ID.
      const [rows] = await this.pool.execute<ServerMappingRow[]>(
        {
          sql: "SELECT `id`, `serverName`, `ipAddress` FROM `server_mapping` WHERE `id` = ? LIMIT 1",
          timeout: this.queryTimeoutMs,
        },
        [id],
      );
      return rows[0] ?? null;
    } catch (error) {
      throw new DependencyUnavailableError(error);
    }
  }
}
