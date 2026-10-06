export interface KdfParams {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

// Used for new vaults only; existing vaults keep the params stored in their meta record.
export const KDF_DEFAULTS: KdfParams = {
  memoryCost: 131072, // 128 MiB
  timeCost: 5,
  parallelism: 2,
};

/** Salt length for new vaults. Existing vaults keep their stored (16-byte) salt. */
export const SALT_LEN = 32;

// Floor for params read back from a vault's meta record, which the PDS (or
// anyone on the path to it) can rewrite. Kept separate from KDF_DEFAULTS so
// raising the defaults for new vaults later doesn't lock out existing ones.
export const KDF_MINIMUMS: Readonly<KdfParams> = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

export class WeakKdfParamsError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(
      `Vault key-derivation parameters (${fields.join(", ")}) are missing or below the required minimum ` +
        `(memoryCost ${KDF_MINIMUMS.memoryCost} KiB, timeCost ${KDF_MINIMUMS.timeCost}, parallelism ${KDF_MINIMUMS.parallelism}). ` +
        "The vault's metadata record may have been tampered with; refusing to derive a key from it.",
    );
    this.name = "WeakKdfParamsError";
    this.fields = fields;
  }
}

/** Throws WeakKdfParamsError unless every param is an integer at or above its minimum. Both crypto adapters and unlockVault call this, so the floor is identical on every platform. */
export function assertKdfParams(params: unknown): asserts params is KdfParams {
  const p = (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown>;
  const bad = (Object.keys(KDF_MINIMUMS) as (keyof KdfParams)[]).filter((field) => {
    const v = p[field];
    return typeof v !== "number" || !Number.isInteger(v) || v < KDF_MINIMUMS[field];
  });
  if (bad.length > 0) throw new WeakKdfParamsError(bad);
}

export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
}

/**
 * Everything the vault needs from a crypto backend. The Node implementation
 * (native `node:crypto` + `@node-rs/argon2`) and the browser implementation
 * (Web Crypto API + hash-wasm's argon2id) both satisfy this and are
 * byte-for-byte interoperable: same Argon2id parameters yield the same key,
 * and AES-256-GCM ciphertexts produced by one are decryptable by the other.
 * That's what lets a vault created with the CLI be opened in the web app.
 */
export interface CryptoAdapter {
  newSalt(): Uint8Array;
  deriveVaultKey(masterPassword: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array>;
  encryptItem(key: Uint8Array, payload: unknown, aad: string): Promise<EncryptedBlob>;
  decryptItem<T = unknown>(key: Uint8Array, iv: string, ciphertext: string, aad: string): Promise<T>;
  makeVerifier(key: Uint8Array): Promise<EncryptedBlob>;
  checkVerifier(key: Uint8Array, iv: string, ciphertext: string): Promise<boolean>;
  rkeyForName(name: string): Promise<string>;
  generatePassword(opts?: GeneratePasswordOptions): string;
}

export interface GeneratePasswordOptions {
  length?: number;
  upper?: boolean;
  lower?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeAmbiguous?: boolean;
}

export interface ItemPayload {
  title: string;
  username?: string;
  password: string;
  url?: string;
  notes?: string;
}
