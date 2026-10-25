import { NotFoundError } from "../errors/app-error.js";
import type { NfcConfigRepository } from "../repositories/nfc-config.repository.js";

export class NfcConfigService {
  public constructor(private readonly repository: NfcConfigRepository) {}

  public async getForUser(userName: string): Promise<unknown> {
    const storedConfig = await this.repository.findByUserName(userName);
    if (storedConfig === null) {
      throw new NotFoundError(
        "NFC configuration was not found",
        "NFC_CONFIG_NOT_FOUND",
      );
    }

    return storedConfig;
  }

  public async replaceForUser(
    userName: string,
    config: unknown,
  ): Promise<void> {
    await this.repository.upsert(userName, config);
  }
}
