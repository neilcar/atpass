import type { AtpAgent } from "@atproto/api";
import { createVault, ItemNotFoundError } from "@core/vault.js";
import { webCrypto } from "@core/web/crypto.js";
import { getAgent as resumeAgent, login as doLogin, logout as doLogout, DEFAULT_SERVICE } from "./lib/extSession.js";
import type { LockReason, Request, Reply, StatusResponse } from "./lib/messages.js";

const vault = createVault(webCrypto);

// The derived vault key lives ONLY here, in the background script's memory —
// never sent to the popup, never persisted. If Firefox suspends this
// (idle) event page, the key is gone and the user re-unlocks; that's
// intentional, not a bug. It's also dropped after IDLE_LOCK_MS without a
// vault operation, and the unlock screen says which of the two happened.
let vaultKey: Uint8Array | null = null;
let cachedAgent: AtpAgent | null = null;

// Lock after this long without a vault operation, even if Firefox keeps the background page alive.
const IDLE_LOCK_MS = 5 * 60 * 1000;
// Set in storage.session while unlocked, so a background page that starts fresh can tell the user the vault was locked
// by a suspension rather than by them. storage.session lives in memory, is cleared on browser restart, and holds no secret.
const UNLOCKED_FLAG = "atpass.wasUnlocked";

let lockReason: LockReason | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function armIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void lock("idle").catch(() => {}), IDLE_LOCK_MS);
}

async function setUnlocked(key: Uint8Array): Promise<void> {
  if (vaultKey !== key) wipeKey();
  vaultKey = key;
  lockReason = null;
  armIdleTimer();
  await browser.storage.session.set({ [UNLOCKED_FLAG]: true });
}

/** Drop the vault key. `reason` is shown on the unlock screen; null means the user locked or logged out themselves. */
/** Zero the key bytes before dropping the reference, so they don't linger in memory until GC. */
function wipeKey(): void {
  vaultKey?.fill(0);
  vaultKey = null;
}

async function lock(reason: LockReason | null): Promise<void> {
  wipeKey();
  lockReason = reason;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  // Awaited so a STATUS right after a manual lock can't still see the flag and misreport it as a suspension.
  await browser.storage.session.remove(UNLOCKED_FLAG);
}

// Tail of the queue of operations using the key; see withKey.
let keyQueue: Promise<unknown> = Promise.resolve();

/**
 * Throw unless unlocked; otherwise count this as activity for the idle lock and run `fn` with a private copy of the key,
 * wiped when `fn` settles. The copy matters: a lock that fires mid-operation wipes vaultKey in place, and an operation
 * still holding that same buffer would go on to encrypt with an all-zero key. Operations run one at a time, so at most
 * one copy exists besides vaultKey itself; one that was queued when a lock fired fails rather than running.
 */
function withKey<T>(fn: (key: Uint8Array) => Promise<T>): Promise<T> {
  if (!vaultKey) return Promise.reject(new Error("Vault is locked."));
  armIdleTimer();
  const run = keyQueue.then(async () => {
    if (!vaultKey) throw new Error("Vault is locked.");
    const key = vaultKey.slice();
    try {
      return await fn(key);
    } finally {
      key.fill(0);
    }
  });
  keyQueue = run.catch(() => {});
  return run;
}

/** If a previous instance of this page was unlocked when it went away, this instance starts locked: say so once. */
async function detectSuspendedLock(): Promise<void> {
  if (vaultKey || lockReason) return;
  const stored = await browser.storage.session.get(UNLOCKED_FLAG);
  // Re-check after the await: an UNLOCK that finished meanwhile sets the same flag and must not be locked again.
  if (stored[UNLOCKED_FLAG] && !vaultKey && !lockReason) await lock("suspended");
}

// Firefox fires this before unloading an idle event page. The key would vanish with the page anyway; this makes it
// explicit. The storage.session flag is left set so the next instance can report the suspension.
browser.runtime.onSuspend.addListener(() => {
  wipeKey();
  if (idleTimer) clearTimeout(idleTimer);
});

async function getAgentOrThrow(): Promise<AtpAgent> {
  if (!cachedAgent) cachedAgent = await resumeAgent();
  if (!cachedAgent) throw new Error("Not logged in.");
  return cachedAgent;
}

async function status(): Promise<StatusResponse> {
  const agent = await resumeAgent();
  cachedAgent = agent;
  if (!agent) {
    await lock(null);
    return { loggedIn: false, hasVault: false, unlocked: false };
  }
  await detectSuspendedLock();
  const hasVault = await vault.hasVault(agent);
  return {
    loggedIn: true,
    handle: agent.session?.handle,
    service: agent.serviceUrl.toString(),
    hasVault,
    unlocked: vaultKey !== null,
    lockReason: vaultKey ? undefined : (lockReason ?? undefined),
  };
}

// Executed inside the target page by browser.scripting.executeScript — must be
// fully self-contained (no closures over anything in this module).
function fillCredentialsInPage(username: string | undefined, password: string): { filled: boolean; reason?: string } {
  function isVisible(el: Element): boolean {
    return (el as HTMLElement).offsetParent !== null;
  }
  function setNativeValue(el: HTMLInputElement, value: string): void {
    const proto = Object.getPrototypeOf(el) as HTMLInputElement;
    const desc = Object.getOwnPropertyDescriptor(proto, "value") ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    desc?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const passwordFields = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(isVisible);
  if (passwordFields.length === 0) {
    return { filled: false, reason: "No password field found on this page." };
  }
  const passwordField = passwordFields[0];
  const scope: ParentNode = passwordField.form ?? passwordField.closest("form") ?? document;
  const candidates = Array.from(
    scope.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"], input:not([type])'),
  ).filter(isVisible);

  let usernameField: HTMLInputElement | null = null;
  for (const c of candidates) {
    // eslint-disable-next-line no-bitwise
    if (c.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING) {
      usernameField = c;
    }
  }
  if (!usernameField && candidates.length > 0) usernameField = candidates[0];

  if (usernameField && username) setNativeValue(usernameField, username);
  setNativeValue(passwordField, password);
  passwordField.focus();
  return { filled: true };
}

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case "STATUS":
      return status();

    case "LOGIN": {
      cachedAgent = await doLogin(req.service || DEFAULT_SERVICE, req.identifier, req.appPassword);
      await lock(null);
      return;
    }

    case "LOGOUT": {
      await doLogout();
      cachedAgent = null;
      await lock(null);
      return;
    }

    case "INIT_VAULT": {
      const agent = await getAgentOrThrow();
      await vault.initVault(agent, req.masterPassword);
      await setUnlocked(await vault.unlockVault(agent, req.masterPassword));
      return;
    }

    case "UNLOCK": {
      const agent = await getAgentOrThrow();
      const key = await vault.unlockVault(agent, req.masterPassword, {
        onMigrationError: (err) => console.warn("atpass: Couldn't move vault items off title-hash record keys; will retry at the next unlock.", err),
      });
      await setUnlocked(key);
      return;
    }

    case "LOCK": {
      await lock(null);
      return;
    }

    case "LIST_ITEMS": {
      const agent = await getAgentOrThrow();
      return withKey((key) => vault.listItems(agent, key));
    }

    case "GET_ITEM": {
      const agent = await getAgentOrThrow();
      return withKey((key) => vault.getItem(agent, key, req.title));
    }

    case "SAVE_ITEM": {
      const agent = await getAgentOrThrow();
      await withKey((key) => vault.addItem(agent, key, req.payload));
      return;
    }

    case "DELETE_ITEM": {
      const agent = await getAgentOrThrow();
      await withKey((key) => vault.removeItem(agent, key, req.title));
      return;
    }

    case "GENERATE_PASSWORD": {
      return { password: webCrypto.generatePassword(req.opts) };
    }

    case "FILL_ACTIVE_TAB": {
      const agent = await getAgentOrThrow();
      let item;
      try {
        item = await withKey((key) => vault.getItem(agent, key, req.title));
      } catch (err) {
        if (err instanceof ItemNotFoundError) throw err;
        throw err;
      }
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab.");
      // @types/firefox-webext-browser types `func` as returning only void/undefined, but the
      // real MV3 API does return the function's result via InjectionResult.result — this cast
      // works around that typing gap, not a runtime one.
      const [result] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillCredentialsInPage as unknown as (...args: unknown[]) => void,
        args: [item.username, item.password],
      });
      const fillResult = result?.result as { filled: boolean; reason?: string } | undefined;
      if (!fillResult?.filled) {
        throw new Error(fillResult?.reason ?? "Couldn't fill this page.");
      }
      return;
    }
  }
}

browser.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  handle(req)
    .then((data) => sendResponse({ ok: true, data } satisfies Reply<unknown>))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Reply<unknown>));
  return true; // keep the message channel open for the async response
});
