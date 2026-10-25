import { z } from "zod";

const USER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.@-]*$/;

const userNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(USER_NAME_PATTERN, "contains unsupported characters");

export function createNfcConfigQuerySchema(defaultUserName: string) {
  return z
    .object({
      userName: z.preprocess(
        (value) =>
          typeof value === "string" && value.trim() === "" ? undefined : value,
        userNameSchema.optional(),
      ),
    })
    .strict()
    .transform(({ userName }) => ({ userName: userName ?? defaultUserName }));
}

export type NfcConfigQuery = z.infer<
  ReturnType<typeof createNfcConfigQuerySchema>
>;
