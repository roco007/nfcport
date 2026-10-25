import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { MySqlServerMappingRepository } from "../src/repositories/server-mapping.repository.js";

function createRepository() {
  const execute = vi.fn();
  const pool = { execute } as unknown as Pool;
  return { execute, repository: new MySqlServerMappingRepository(pool, 1_234) };
}

describe("MySqlServerMappingRepository", () => {
  it("lists only mapping columns in stable ID order with a query deadline", async () => {
    const { execute, repository } = createRepository();
    execute.mockResolvedValueOnce([
      [
        { id: 2, serverName: "Mac", ipAddress: "192.168.1.2" },
        { id: 4, serverName: "Mac", ipAddress: "2001:db8::4" },
      ],
      [],
    ]);
    await expect(repository.list()).resolves.toEqual([
      { id: 2, serverName: "Mac", ipAddress: "192.168.1.2" },
      { id: 4, serverName: "Mac", ipAddress: "2001:db8::4" },
    ]);
    expect(execute).toHaveBeenCalledWith({
      sql: "SELECT `id`, `serverName`, `ipAddress` FROM `server_mapping` ORDER BY `id`",
      timeout: 1_234,
    });
  });

  it("uses generated IDs and binds names and addresses as SQL parameters", async () => {
    const { execute, repository } = createRepository();
    execute.mockResolvedValueOnce([{ affectedRows: 1, insertId: 27 }, []]);
    const input = {
      serverName: "Mac'); DROP TABLE server_mapping; --",
      ipAddress: "192.168.1.27",
    };
    await expect(repository.create(input)).resolves.toEqual({
      id: 27,
      ...input,
    });
    expect(execute).toHaveBeenCalledWith(
      {
        sql: "INSERT INTO `server_mapping` (`serverName`, `ipAddress`) VALUES (?, ?)",
        timeout: 1_234,
      },
      [input.serverName, "192.168.1.27"],
    );
  });

  it("restricts updates to the supplied ID rather than the server name", async () => {
    const { execute, repository } = createRepository();
    execute.mockResolvedValueOnce([{ affectedRows: 1, changedRows: 1 }, []]);
    await expect(
      repository.update(7, { serverName: "Mac", ipAddress: "::1" }),
    ).resolves.toEqual({ id: 7, serverName: "Mac", ipAddress: "::1" });
    expect(execute).toHaveBeenCalledWith(
      {
        sql: "UPDATE `server_mapping` SET `serverName` = ?, `ipAddress` = ? WHERE `id` = ?",
        timeout: 1_234,
      },
      ["Mac", "::1", 7],
    );
  });

  it("keeps an unchanged existing row successful when MySQL reports zero changed rows", async () => {
    const { execute, repository } = createRepository();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0, changedRows: 0 }, []])
      .mockResolvedValueOnce([
        [{ id: 7, serverName: "Mac", ipAddress: "::1" }],
        [],
      ]);
    await expect(
      repository.update(7, { serverName: "Mac", ipAddress: "::1" }),
    ).resolves.toEqual({ id: 7, serverName: "Mac", ipAddress: "::1" });
    expect(execute).toHaveBeenNthCalledWith(
      2,
      {
        sql: "SELECT `id`, `serverName`, `ipAddress` FROM `server_mapping` WHERE `id` = ? LIMIT 1",
        timeout: 1_234,
      },
      [7],
    );
  });

  it("returns null for a missing update target without an insert", async () => {
    const { execute, repository } = createRepository();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0, changedRows: 0 }, []])
      .mockResolvedValueOnce([[], []]);
    await expect(
      repository.update(404, { serverName: "Missing", ipAddress: "::1" }),
    ).resolves.toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(
      execute.mock.calls.every(
        ([query]) => !String(query.sql).includes("INSERT"),
      ),
    ).toBe(true);
  });

  it.each(["list", "create", "update"] as const)(
    "normalizes %s database failures",
    async (operation) => {
      const { execute, repository } = createRepository();
      execute.mockRejectedValue(
        new Error("private database connection details"),
      );
      const input = { serverName: "Mac", ipAddress: "::1" };
      const result =
        operation === "list"
          ? repository.list()
          : operation === "create"
            ? repository.create(input)
            : repository.update(1, input);
      await expect(result).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        statusCode: 503,
        message: "A required dependency is temporarily unavailable",
      });
    },
  );
});
