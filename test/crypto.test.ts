import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeCrypto } from "../src/core/node/crypto.js";

const { newSalt, deriveVaultKey, encryptItem, decryptItem, makeVerifier, checkVerifier, rkeyForName, generatePassword } = nodeCrypto;

test("Argon2id derivation is deterministic for the same password/salt/params", async () => {
  const salt = newSalt();
  assert.equal(salt.length, 16);
  const params = { memoryCost: 65536, timeCost: 3, parallelism: 1 };
  const key1 = await deriveVaultKey("correct horse battery staple", salt, params);
  const key2 = await deriveVaultKey("correct horse battery staple", salt, params);
  assert.deepEqual(Buffer.from(key1), Buffer.from(key2));
  assert.equal(key1.length, 32);
});

test("AES-GCM encrypt/decrypt roundtrips and is AAD-bound to its record key", async () => {
  const salt = newSalt();
  const params = { memoryCost: 65536, timeCost: 3, parallelism: 1 };
  const key = await deriveVaultKey("correct horse battery staple", salt, params);
  const rkey = await rkeyForName("github.com");
  const payload = { title: "github.com", username: "alice", password: "s3cr3t!", url: "https://github.com" };
  const aad = `xyz.atpass.vault.item/${rkey}`;

  const { iv, ciphertext } = await encryptItem(key, payload, aad);
  const decrypted = await decryptItem(key, iv, ciphertext, aad);
  assert.deepEqual(decrypted, payload);

  const wrongKey = await deriveVaultKey("wrong password", salt, params);
  await assert.rejects(() => decryptItem(wrongKey, iv, ciphertext, aad));

  // Swapping which record this ciphertext claims to belong to must fail (AAD binding).
  await assert.rejects(() => decryptItem(key, iv, ciphertext, "xyz.atpass.vault.item/some-other-rkey"));
});

test("verifier detects a wrong master password without decrypting real data", async () => {
  const salt = newSalt();
  const params = { memoryCost: 65536, timeCost: 3, parallelism: 1 };
  const key = await deriveVaultKey("correct horse battery staple", salt, params);
  const wrongKey = await deriveVaultKey("wrong password", salt, params);
  const { iv, ciphertext } = await makeVerifier(key);
  assert.equal(await checkVerifier(key, iv, ciphertext), true);
  assert.equal(await checkVerifier(wrongKey, iv, ciphertext), false);
});

test("rkeyForName normalizes case/whitespace so lookups are name-insensitive", async () => {
  assert.equal(await rkeyForName("GitHub.com "), await rkeyForName("github.com"));
  assert.notEqual(await rkeyForName("github.com"), await rkeyForName("gitlab.com"));
});

test("generatePassword respects length and character-class options", () => {
  const pw = generatePassword({ length: 32 });
  assert.equal(pw.length, 32);

  const noSymbols = generatePassword({ length: 40, symbols: false });
  assert.equal(/^[A-Za-z0-9]+$/.test(noSymbols), true);
});
