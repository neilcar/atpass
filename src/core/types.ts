export interface KdfParams {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export const KDF_DEFAULTS: KdfParams = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

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
