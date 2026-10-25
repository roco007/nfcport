import { z } from "zod";

export interface ServerMapping {
  id: number;
  serverName: string;
  ipAddress: string;
}

export type ServerMappingInput = Omit<ServerMapping, "id"> & { id?: number };

const ipAddressSchema = z
  .string()
  .trim()
  .max(45)
  .pipe(z.union([z.ipv4(), z.ipv6()]));
const mappingInputSchema = z.object({
  id: z.number().int().positive().max(2_147_483_647).optional(),
  serverName: z.string().trim().min(1).max(255),
  ipAddress: ipAddressSchema,
});
const mappingSchema = mappingInputSchema.extend({
  id: z.number().int().positive().max(2_147_483_647),
});

export function normalizeServerMappingInput(
  input: ServerMappingInput,
): ServerMappingInput {
  const result = mappingInputSchema.safeParse(input);
  if (result.success) return result.data;
  const field = result.error.issues[0]?.path[0];
  if (field === "serverName")
    throw new Error("Enter a server name between 1 and 255 characters.");
  if (field === "ipAddress")
    throw new Error(
      "Enter a valid IPv4 or IPv6 IP address, without http:// or a port.",
    );
  throw new Error(
    "This server mapping has an invalid ID. Refresh the servers and try again.",
  );
}

export function parseServerMappingList(response: unknown): ServerMapping[] {
  const parsed = z
    .object({ servers: z.array(mappingSchema) })
    .safeParse(response);
  if (!parsed.success)
    throw new Error(
      "The server mappings response is invalid. Check the backend connection.",
    );
  return parsed.data.servers;
}

export function parseSavedServerMapping(response: unknown): ServerMapping {
  const parsed = z.object({ server: mappingSchema }).safeParse(response);
  if (!parsed.success)
    throw new Error(
      "The saved server response is invalid. Refresh before saving again.",
    );
  return parsed.data.server;
}

export function serverMappingBaseUrl(ipAddress: string): string {
  const parsed = ipAddressSchema.safeParse(ipAddress);
  if (!parsed.success)
    throw new Error(
      "Enter a valid IPv4 or IPv6 IP address, without http:// or a port.",
    );
  const host = parsed.data.includes(":") ? `[${parsed.data}]` : parsed.data;
  return `http://${host}:3001`;
}
