import { NotFoundError } from "../errors/app-error.js";
import type {
  ServerMapping,
  ServerMappingRepository,
} from "../repositories/server-mapping.repository.js";
import type { ServerMappingWrite } from "../schemas/server-mapping.schemas.js";

export class ServerMappingService {
  public constructor(private readonly repository: ServerMappingRepository) {}

  public async list(): Promise<ServerMapping[]> {
    return this.repository.list();
  }

  public async save(input: ServerMappingWrite): Promise<ServerMapping> {
    const values = { serverName: input.serverName, ipAddress: input.ipAddress };
    if (input.id === undefined) return this.repository.create(values);

    const server = await this.repository.update(input.id, values);
    if (server === null) {
      throw new NotFoundError(
        "Server mapping was not found",
        "SERVER_MAPPING_NOT_FOUND",
      );
    }
    return server;
  }
}
