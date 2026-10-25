import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { MySqlNfcConfigRepository } from "../src/repositories/nfc-config.repository.js";

function createPoolStub() {
  const execute = vi.fn();
  const query = vi.fn();
  const end = vi.fn().mockResolvedValue(undefined);

  return {
    execute,
    query,
    end,
    pool: { execute, query, end } as unknown as Pool,
  };
}

describe("MySqlNfcConfigRepository", () => {
  it("applies the configured driver timeout to reads and writes", async () => {
    const { pool, execute } = createPoolStub();
    execute
      .mockResolvedValueOnce([[{ nfcTagMapping: '{"tag":{}}' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const repository = new MySqlNfcConfigRepository(pool, 1_234);

    await expect(repository.findByUserName("alice")).resolves.toEqual({
      tag: {},
    });
    await repository.upsert("alice", { tag: {} });

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ timeout: 1_234 }),
      ["alice"],
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ timeout: 1_234 }),
      ["alice", '{"tag":{}}', '{"tag":{}}'],
    );
  });

  it("uses the readiness deadline for the schema probe", async () => {
    const { pool, query } = createPoolStub();
    query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([
      [
        {
          Key_name: "PRIMARY",
          Non_unique: 0,
          Seq_in_index: 1,
          Column_name: "user",
          Sub_part: null,
        },
      ],
      [],
    ]);
    const repository = new MySqlNfcConfigRepository(pool, 5_000);

    await repository.ping(250);

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sql: expect.stringContaining("user_nfc_mapping"),
        timeout: 250,
      }),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sql: expect.stringContaining("SHOW INDEX"),
        timeout: 250,
      }),
    );
  });

  it("rejects readiness when user mappings are not uniquely addressable", async () => {
    const { pool, query } = createPoolStub();
    query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([
      [
        {
          Key_name: "idx_user",
          Non_unique: 1,
          Seq_in_index: 1,
          Column_name: "user",
          Sub_part: null,
        },
      ],
      [],
    ]);
    const repository = new MySqlNfcConfigRepository(pool, 500);

    await expect(repository.ping()).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      statusCode: 503,
    });
  });
});
