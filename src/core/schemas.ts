import { z } from "zod";

// Runtime shapes of the records read back from the PDS. The PDS (or anyone on the path to it) controls these bytes, so
// they're parsed rather than cast. Lower bounds on the KDF params are enforced separately by assertKdfParams, so a
// weakened-but-well-formed record still surfaces as WeakKdfParamsError.

const datetime = z.string().datetime({ offset: true });

export const VaultMetaRecordSchema = z.object({
  $type: z.literal("xyz.atpass.vault.meta"),
  kdf: z.literal("argon2id"),
  salt: z.string(),
  kdfParams: z.object({
    memoryCost: z.number().int(),
    timeCost: z.number().int(),
    parallelism: z.number().int(),
  }),
  verifier: z.string(),
  verifierIv: z.string(),
  createdAt: datetime,
});

export const ItemRecordSchema = z.object({
  $type: z.literal("xyz.atpass.vault.item"),
  alg: z.literal("AES-256-GCM"),
  iv: z.string(),
  ciphertext: z.string(),
  createdAt: datetime,
  updatedAt: datetime.optional(),
});

export class SchemaValidationError extends Error {
  readonly details: z.ZodError;

  constructor(message: string, details: z.ZodError) {
    super(`${message}: ${details.issues.map((i) => `${i.path.join(".") || "(record)"} ${i.message}`).join("; ")}`);
    this.name = "SchemaValidationError";
    this.details = details;
  }
}

/** Parse `value` with `schema`, turning a ZodError into a SchemaValidationError carrying `message`. */
export function parseRecord<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SchemaValidationError(message, result.error);
  return result.data;
}
