// Guards the interop guarantee the web app and extension depend on: a vault
// item encrypted by one client's crypto adapter must decrypt correctly on
// another. Runs the browser adapter (Web Crypto API + hash-wasm) under Node,
// which supports both, so this needs no browser to run in CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeCrypto } from "../src/core/node/crypto.js";
import { webCrypto } from "../src/core/web/crypto.js";

const params = { memoryCost: 65536, timeCost: 3, parallelism: 1 };

test("Argon2id key derivation matches across the node and web crypto adapters", async () => {
  const salt = nodeCrypto.newSalt();
  const nodeKey = await nodeCrypto.deriveVaultKey("hunter2 master", salt, params);
  const webKey = await webCrypto.deriveVaultKey("hunter2 master", salt, params);
  assert.deepEqual(Buffer.from(nodeKey), Buffer.from(webKey));
});

test("items encrypted by one adapter decrypt correctly on the other", async () => {
  const salt = nodeCrypto.newSalt();
  const nodeKey = await nodeCrypto.deriveVaultKey("hunter2 master", salt, params);
  const webKey = await webCrypto.deriveVaultKey("hunter2 master", salt, params);
  const payload = { title: "github.com", username: "alice", password: "p@ss!" };
  const aad = "xyz.atpass.vault.item/abc";

  const encByNode = await nodeCrypto.encryptItem(nodeKey, payload, aad);
  assert.deepEqual(await webCrypto.decryptItem(webKey, encByNode.iv, encByNode.ciphertext, aad), payload);

  const encByWeb = await webCrypto.encryptItem(webKey, payload, aad);
  assert.deepEqual(await nodeCrypto.decryptItem(nodeKey, encByWeb.iv, encByWeb.ciphertext, aad), payload);
});

test("verifier and rkey derivation match across adapters", async () => {
  const salt = nodeCrypto.newSalt();
  const nodeKey = await nodeCrypto.deriveVaultKey("hunter2 master", salt, params);
  const webKey = await webCrypto.deriveVaultKey("hunter2 master", salt, params);

  const v = await nodeCrypto.makeVerifier(nodeKey);
  assert.equal(await webCrypto.checkVerifier(webKey, v.iv, v.ciphertext), true);

  assert.equal(await nodeCrypto.rkeyForName("GitHub.com"), await webCrypto.rkeyForName("github.com "));
});
