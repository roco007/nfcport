import { isIP } from "node:net";
import { z } from "zod";

export const serverMappingWriteSchema = z
  .object({
    id: z.number().int().positive().max(2_147_483_647).optional(),
    serverName: z.string().trim().min(1).max(255),
    ipAddress: z
      .string()
      .trim()
      .min(1)
      .max(45)
      .refine(
        (value) => !value.includes("%") && isIP(value) !== 0,
        "must be a literal IPv4 or IPv6 address",
      ),
  })
  .strict();

export type ServerMappingWrite = z.infer<typeof serverMappingWriteSchema>;
