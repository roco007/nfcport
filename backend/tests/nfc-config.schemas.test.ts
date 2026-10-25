import { describe, expect, it } from "vitest";
import { createNfcConfigQuerySchema } from "../src/schemas/nfc-config.schemas.js";

describe("createNfcConfigQuerySchema", () => {
  it.each([undefined, "", "   "])(
    "uses the configured default for an omitted or empty userName",
    (userName) => {
      expect(createNfcConfigQuerySchema("rc007").parse({ userName })).toEqual({
        userName: "rc007",
      });
    },
  );

  it("continues to reject invalid user names and unknown query keys", () => {
    const schema = createNfcConfigQuerySchema("rc007");
    expect(schema.safeParse({ userName: "bad name" }).success).toBe(false);
    expect(
      schema.safeParse({ userName: "alice", extra: "value" }).success,
    ).toBe(false);
  });
});
