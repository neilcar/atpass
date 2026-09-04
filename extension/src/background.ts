import type { AtpAgent } from "@atproto/api";
import { createVault, ItemNotFoundError } from "@core/vault.js";
import { webCrypto } from "@core/web/crypto.js";
import { getAgent as resumeAgent, login as doLogin, logout as doLogout, DEFAULT_SERVICE } from "./lib/extSession.js";
import type { Request, Reply, StatusResponse } from "./lib/messages.js";

const vault = createVault(webCrypto);

// The derived vault key lives ONLY here, in the background script's memory —
// never sent to the popup, never persisted. If Firefox suspends this
// (idle) event page, the key is gone and the user re-unlocks; that's
// intentional, not a bug.
let vaultKey: Uint8Array | null = null;
let cachedAgent: AtpAgent | null = null;

async function getAgentOrThrow(): Promise<AtpAgent> {
  if (!cachedAgent) cachedAgent = await resumeAgent();
  if (!cachedAgent) throw new Error("Not logged in.");
  return cachedAgent;
}

async function status(): Promise<StatusResponse> {
  const agent = await resumeAgent();
  cachedAgent = agent;
  if (!agent) {
    vaultKey = null;
    return { loggedIn: false, hasVault: false, unlocked: false };
  }
  const hasVault = await vault.hasVault(agent);
  return {
    loggedIn: true,
    handle: agent.session?.handle,
    service: agent.serviceUrl.toString(),
    hasVault,
    unlocked: vaultKey !== null,
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
      vaultKey = null;
      return;
    }

    case "LOGOUT": {
      await doLogout();
      cachedAgent = null;
      vaultKey = null;
      return;
    }

    case "INIT_VAULT": {
      const agent = await getAgentOrThrow();
      await vault.initVault(agent, req.masterPassword);
      vaultKey = await vault.unlockVault(agent, req.masterPassword);
      return;
    }

    case "UNLOCK": {
      const agent = await getAgentOrThrow();
      vaultKey = await vault.unlockVault(agent, req.masterPassword);
      return;
    }

    case "LOCK": {
      vaultKey = null;
      return;
    }

    case "LIST_ITEMS": {
      const agent = await getAgentOrThrow();
      if (!vaultKey) throw new Error("Vault is locked.");
      return vault.listItems(agent, vaultKey);
    }

    case "GET_ITEM": {
      const agent = await getAgentOrThrow();
      if (!vaultKey) throw new Error("Vault is locked.");
      return vault.getItem(agent, vaultKey, req.title);
    }

    case "SAVE_ITEM": {
      const agent = await getAgentOrThrow();
      if (!vaultKey) throw new Error("Vault is locked.");
      await vault.addItem(agent, vaultKey, req.payload);
      return;
    }

    case "DELETE_ITEM": {
      const agent = await getAgentOrThrow();
      await vault.removeItem(agent, req.title);
      return;
    }

    case "GENERATE_PASSWORD": {
      return { password: webCrypto.generatePassword(req.opts) };
    }

    case "FILL_ACTIVE_TAB": {
      const agent = await getAgentOrThrow();
      if (!vaultKey) throw new Error("Vault is locked.");
      let item;
      try {
        item = await vault.getItem(agent, vaultKey, req.title);
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
