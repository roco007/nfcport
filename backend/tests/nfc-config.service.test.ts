import { describe, expect, it } from "vitest";
import { NfcConfigService } from "../src/services/nfc-config.service.js";
import { InMemoryNfcConfigRepository } from "./helpers.js";

describe("NfcConfigService", () => {
  it("returns stored payloads without validation or normalization", async () => {
    const repository = new InMemoryNfcConfigRepository();
    const payload = {
      "aa-bb-cc-dd": [
        {
          arbitraryAction: "kept",
          obsolete: true,
        },
      ],
    };
    repository.records.set("legacy-user", payload);

    await expect(
      new NfcConfigService(repository).getForUser("legacy-user"),
    ).resolves.toEqual(payload);
  });

  it("returns stored JSON arrays unchanged", async () => {
    const repository = new InMemoryNfcConfigRepository();
    const payload = [{ opaque: true }, ["nested"]];
    repository.records.set("opaque-user", payload);

    await expect(
      new NfcConfigService(repository).getForUser("opaque-user"),
    ).resolves.toEqual(payload);
  });
});
