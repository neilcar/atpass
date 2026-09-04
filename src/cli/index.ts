#!/usr/bin/env node
import { Command } from "commander";
import prompts from "prompts";
import clipboardy from "clipboardy";
import type { AtpAgent } from "@atproto/api";
import { getAgent, login as atpLogin, logout as atpLogout, DEFAULT_SERVICE } from "../core/node/session.js";
import { getVaultMeta } from "../core/records.js";
import { createVault, WrongMasterPasswordError, VaultNotInitializedError, ItemNotFoundError } from "../core/vault.js";
import { nodeCrypto } from "../core/node/crypto.js";
import { loadSession } from "../core/node/config.js";

const { generatePassword } = nodeCrypto;
const { initVault, unlockVault, addItem, getItem, removeItem, listItems } = createVault(nodeCrypto);

const program = new Command();
program.name("atpass").description("A password manager stored as encrypted records in your atproto (Bluesky) PDS repo.").version("0.1.0");

function fail(message: string): never {
  console.error(`atpass: ${message}`);
  process.exit(1);
}

async function promptMasterPassword(message = "Master password"): Promise<string> {
  const res = await prompts({ type: "password", name: "value", message });
  if (typeof res.value !== "string" || res.value.length === 0) fail("master password is required");
  return res.value as string;
}

/** Get an authenticated agent + unlocked vault key, prompting for the master password. */
async function unlock(): Promise<{ agent: AtpAgent; key: Uint8Array }> {
  const agent = await getAgent();
  const masterPassword = await promptMasterPassword();
  try {
    const key = await unlockVault(agent, masterPassword);
    return { agent, key };
  } catch (err) {
    if (err instanceof WrongMasterPasswordError) fail("incorrect master password");
    if (err instanceof VaultNotInitializedError) fail("no vault yet — run `atpass init` first");
    throw err;
  }
}

program
  .command("login")
  .description("Log in to an atproto PDS with a handle and app password")
  .argument("[handle]", "your handle or DID, e.g. alice.bsky.social")
  .option("--service <url>", "PDS service URL", DEFAULT_SERVICE)
  .action(async (handleArg: string | undefined, opts: { service: string }) => {
    const handle =
      handleArg ?? (await prompts({ type: "text", name: "value", message: "Handle or DID" })).value;
    if (!handle) fail("handle is required");
    console.log(
      "Use an App Password, not your main account password: https://bsky.app/settings/app-passwords",
    );
    const { password } = await prompts({ type: "password", name: "password", message: "App password" });
    if (!password) fail("app password is required");
    const agent = await atpLogin(opts.service, handle, password);
    console.log(`Logged in as ${agent.session?.handle ?? handle} (${agent.assertDid})`);

    const meta = await getVaultMeta(agent);
    if (!meta) {
      console.log("No vault found on this account yet.");
      const { doInit } = await prompts({
        type: "confirm",
        name: "doInit",
        message: "Create one now?",
        initial: true,
      });
      if (doInit) {
        const pw1 = await promptMasterPassword("New master password");
        const pw2 = await promptMasterPassword("Confirm master password");
        if (pw1 !== pw2) fail("master passwords did not match");
        await initVault(agent, pw1);
        console.log("Vault created. This master password is never sent anywhere — don't lose it.");
      }
    }
  });

program
  .command("logout")
  .description("Forget the locally stored atproto session")
  .action(async () => {
    await atpLogout();
    console.log("Logged out.");
  });

program
  .command("whoami")
  .description("Show the currently logged-in account")
  .action(async () => {
    const stored = await loadSession();
    if (!stored) fail("not logged in");
    console.log(`${stored.session.handle} (${stored.session.did})`);
    console.log(`Service: ${stored.service}`);
  });

program
  .command("init")
  .description("Create a vault on the currently logged-in account")
  .action(async () => {
    const agent = await getAgent();
    const pw1 = await promptMasterPassword("New master password");
    const pw2 = await promptMasterPassword("Confirm master password");
    if (pw1 !== pw2) fail("master passwords did not match");
    await initVault(agent, pw1);
    console.log("Vault created.");
  });

program
  .command("add")
  .description("Add or update a vault item")
  .argument("<title>", "name of the item, e.g. 'github.com'")
  .option("-u, --username <username>", "username or email")
  .option("--url <url>", "site URL")
  .option("-n, --notes <notes>", "free-form notes")
  .option("-g, --generate", "generate a random password instead of prompting")
  .option("-l, --length <n>", "generated password length", "20")
  .action(
    async (
      title: string,
      opts: { username?: string; url?: string; notes?: string; generate?: boolean; length: string },
    ) => {
      const { agent, key } = await unlock();
      let password: string;
      if (opts.generate) {
        password = generatePassword({ length: Number(opts.length) });
        console.log(`Generated password: ${password}`);
      } else {
        const res = await prompts({ type: "password", name: "value", message: "Password" });
        if (typeof res.value !== "string" || res.value.length === 0) fail("password is required");
        password = res.value;
      }
      await addItem(agent, key, {
        title,
        username: opts.username,
        password,
        url: opts.url,
        notes: opts.notes,
      });
      console.log(`Saved "${title}".`);
    },
  );

program
  .command("get")
  .description("Retrieve a vault item")
  .argument("<title>", "name of the item")
  .option("-c, --clip", "copy the password to the clipboard instead of printing it")
  .action(async (title: string, opts: { clip?: boolean }) => {
    const { agent, key } = await unlock();
    let item;
    try {
      item = await getItem(agent, key, title);
    } catch (err) {
      if (err instanceof ItemNotFoundError) fail(err.message);
      throw err;
    }
    console.log(`Title:    ${item.title}`);
    if (item.username) console.log(`Username: ${item.username}`);
    if (item.url) console.log(`URL:      ${item.url}`);
    if (item.notes) console.log(`Notes:    ${item.notes}`);
    if (opts.clip) {
      await clipboardy.write(item.password);
      console.log("Password: (copied to clipboard, clearing in 20s)");
      setTimeout(() => {
        clipboardy.write("").finally(() => process.exit(0));
      }, 20000);
    } else {
      console.log(`Password: ${item.password}`);
    }
  });

program
  .command("list")
  .alias("ls")
  .description("List vault item titles (no passwords)")
  .action(async () => {
    const { agent, key } = await unlock();
    const items = await listItems(agent, key);
    if (items.length === 0) {
      console.log("(vault is empty)");
      return;
    }
    for (const it of items) {
      const bits = [it.title];
      if (it.username) bits.push(`<${it.username}>`);
      if (it.url) bits.push(it.url);
      console.log(bits.join("  "));
    }
  });

program
  .command("rm")
  .description("Delete a vault item")
  .argument("<title>", "name of the item")
  .option("-y, --yes", "skip confirmation")
  .action(async (title: string, opts: { yes?: boolean }) => {
    const agent = await getAgent();
    if (!opts.yes) {
      const { ok } = await prompts({ type: "confirm", name: "ok", message: `Delete "${title}"?`, initial: false });
      if (!ok) return;
    }
    try {
      await removeItem(agent, title);
    } catch (err) {
      if (err instanceof ItemNotFoundError) fail(err.message);
      throw err;
    }
    console.log(`Deleted "${title}".`);
  });

program
  .command("generate")
  .alias("gen")
  .description("Generate a random password (does not touch the vault)")
  .option("-l, --length <n>", "length", "20")
  .option("--no-symbols", "exclude symbols")
  .option("--no-digits", "exclude digits")
  .option("--no-upper", "exclude uppercase letters")
  .option("-c, --clip", "copy to clipboard instead of printing")
  .action(async (opts: { length: string; symbols: boolean; digits: boolean; upper: boolean; clip?: boolean }) => {
    const password = generatePassword({
      length: Number(opts.length),
      symbols: opts.symbols,
      digits: opts.digits,
      upper: opts.upper,
    });
    if (opts.clip) {
      await clipboardy.write(password);
      console.log("(copied to clipboard, clearing in 20s)");
      setTimeout(() => {
        clipboardy.write("").finally(() => process.exit(0));
      }, 20000);
    } else {
      console.log(password);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  fail(err?.message ?? String(err));
});
