import type { GeneratePasswordOptions, ItemPayload } from "@core/types.js";
import type { VaultListEntry } from "@core/vault.js";

export interface StatusResponse {
  loggedIn: boolean;
  handle?: string;
  service?: string;
  hasVault: boolean;
  unlocked: boolean;
}

export type Request =
  | { type: "STATUS" }
  | { type: "LOGIN"; service: string; identifier: string; appPassword: string }
  | { type: "LOGOUT" }
  | { type: "INIT_VAULT"; masterPassword: string }
  | { type: "UNLOCK"; masterPassword: string }
  | { type: "LOCK" }
  | { type: "LIST_ITEMS" }
  | { type: "GET_ITEM"; title: string }
  | { type: "SAVE_ITEM"; payload: ItemPayload }
  | { type: "DELETE_ITEM"; title: string }
  | { type: "GENERATE_PASSWORD"; opts?: GeneratePasswordOptions }
  | { type: "FILL_ACTIVE_TAB"; title: string };

export type ResponseFor<R extends Request> = R extends { type: "STATUS" }
  ? StatusResponse
  : R extends { type: "LIST_ITEMS" }
    ? VaultListEntry[]
    : R extends { type: "GET_ITEM" }
      ? ItemPayload
      : R extends { type: "GENERATE_PASSWORD" }
        ? { password: string }
        : void;

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

/** Send a typed request to the background script and unwrap the reply, throwing on error. */
export async function sendToBackground<R extends Request>(req: R): Promise<ResponseFor<R>> {
  const reply = (await browser.runtime.sendMessage(req)) as Reply<ResponseFor<R>>;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
