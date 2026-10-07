import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePasswordStrength, accountUserInputs, MIN_PASSWORD_SCORE } from "../src/core/passwordValidator.js";
import { createVault, WeakMasterPasswordError } from "../src/core/vault.js";
import { nodeCrypto } from "../src/core/node/crypto.js";

test("common and short passwords are rejected with feedback", async () => {
  for (const pw of ["password", "password123", "hunter2", "qwertyuiop", "12345678", "iloveyou1"]) {
    const r = await validatePasswordStrength(pw);
    assert.equal(r.valid, false, pw);
    assert.ok(r.score < MIN_PASSWORD_SCORE, pw);
    assert.match(r.feedback, /too easy to guess/, pw);
  }
});

test("long, uncommon passphrases are accepted", async () => {
  for (const pw of ["correct horse battery staple", "violet-ledger-orbit-canyon-41"]) {
    const r = await validatePasswordStrength(pw);
    assert.equal(r.valid, true, pw);
    assert.equal(r.feedback, "");
  }
});

test("passwords built from the account's own handle are penalised", async () => {
  const inputs = accountUserInputs("did:plc:faketest", "neilcarpenter.bsky.social");
  assert.equal((await validatePasswordStrength("neilcarpenter2026", inputs)).valid, false);
});

test("initVault refuses a weak master password before writing anything", async () => {
  let wrote = false;
  const agent = {
    assertDid: "did:plc:faketest",
    com: { atproto: { repo: {
      async getRecord() { const e: any = new Error("Could not locate record"); e.error = "RecordNotFound"; throw e; },
      async putRecord() { wrote = true; },
    } } },
  } as any;
  await assert.rejects(() => createVault(nodeCrypto).initVault(agent, "password123"), WeakMasterPasswordError);
  assert.equal(wrote, false);
});
