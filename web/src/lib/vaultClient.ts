import { createVault } from "@core/vault.js";
import { webCrypto } from "@core/web/crypto.js";
import { getAgent, login, logout, DEFAULT_SERVICE } from "@core/web/session.js";
import type { AtpAgent } from "@atproto/api";

export const vault = createVault(webCrypto);
export const { generatePassword } = webCrypto;
export { getAgent, login, logout, DEFAULT_SERVICE };
// Everywhere in this app "Agent" means a logged-in AtpAgent (it has `.session`,
// `.did`, etc.) — the vault/records layer underneath only needs the narrower
// base `Agent` type from @atproto/api, which AtpAgent satisfies.
export type { AtpAgent as Agent };
export {
  WrongMasterPasswordError,
  VaultNotInitializedError,
  VaultAlreadyExistsError,
  ItemNotFoundError,
} from "@core/vault.js";
export type { VaultListEntry } from "@core/vault.js";
export type { ItemPayload } from "@core/types.js";
