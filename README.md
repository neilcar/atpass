# atpass

A password manager that stores your vault as end-to-end encrypted records in
your own [atproto](https://atproto.com) (Bluesky) PDS repo, instead of a
proprietary server. Your PDS operator only ever sees ciphertext.

## How it works

- Every vault item is one record in the `xyz.atpass.vault.item` collection of
  your atproto repo. The record key is `sha256(lowercase title)`, so items
  can be fetched directly by name without listing the whole vault or
  revealing titles in plaintext record keys.
- A single `xyz.atpass.vault.meta` record (rkey `self`) holds the Argon2id
  salt/parameters and an encrypted "verifier" used to check your master
  password locally — it contains no secrets and can't be used to derive your
  key without the password.
- Your **master password never leaves your machine** and is independent of
  your atproto login. It's run through Argon2id to derive a 256-bit key,
  which encrypts each item with AES-256-GCM (unique nonce per item, record
  key bound in as additional authenticated data so records can't be swapped).
- Locally, only your atproto session tokens are cached (`~/.atpass/session.json`
  for the CLI, `localStorage` for the web app), so you don't have to log in
  every time. Nothing about the master password or vault key is ever persisted.
- Both clients share one crypto core: Argon2id key derivation and AES-256-GCM
  encryption are implemented once for Node (`node:crypto` + `@node-rs/argon2`)
  and once for the browser (Web Crypto API + `hash-wasm`'s WASM argon2id),
  verified byte-for-byte interoperable — a vault item added from the CLI
  decrypts correctly in the web app and vice versa.
- See [`lexicons/`](lexicons) for the formal schemas.

## Setup

```bash
npm install
npm run build
npm link   # optional: puts `atpass` on your PATH
```

Or run directly during development with `npm run dev -- <command>`.

`npm test` runs the test suite (crypto roundtrips, the node/web crypto
adapters' cross-compatibility, and a full vault lifecycle against an
in-memory fake atproto repo).

### Releasing

[`.github/workflows/release.yml`](.github/workflows/release.yml) builds and
tests the CLI on Linux/macOS/Windows on every push and PR to `main`. Pushing
a tag matching `v*.*.*` (after the tag's version and `package.json`'s
`"version"` match) additionally packs it and attaches the tarball to a new
GitHub Release:

```bash
npm version patch   # or minor/major — bumps package.json and commits
git push && git push --tags
```

Not published to the npm registry by default (the package is
`"private": true`) — see the comment at the bottom of the workflow file for
what that would take to turn on.

## Usage

```bash
# Log in with an atproto App Password (create one at
# https://bsky.app/settings/app-passwords — never use your main password here).
# First login on a fresh account will offer to create your vault.
atpass login alice.bsky.social

# Add an item (prompts for the password, or generate one)
atpass add github.com --username alice --url https://github.com
atpass add example.com --username alice --generate --length 24

# Retrieve one
atpass get github.com
atpass get github.com --clip     # copies password only, clears clipboard after 20s

# List titles (no passwords)
atpass list

# Delete
atpass rm github.com

# Generate a password without touching the vault
atpass generate --length 32

atpass logout
```

Every command that reads or writes a vault item prompts for your master
password — it's never cached to disk. Deriving it uses Argon2id, so expect a
brief pause.

## Web app

A browser UI lives in [`web/`](web), sharing all vault/crypto logic with the
CLI via `src/core`.

```bash
npm run web:dev     # dev server at http://localhost:5173
npm run web:build   # production build to web/dist
```

It's a client-only static app: sign in with your handle + App Password (same
CORS-friendly `com.atproto.server.createSession` call the CLI uses), create
or unlock your vault with your master password, then add/view/edit/delete
items and generate passwords. Nothing is server-side — it talks directly to
your PDS from the browser, and the vault key lives only in memory for that
tab (lock or close the tab to clear it). Because the web crypto adapter and
the CLI's are wire-compatible, you can manage the same vault from either.

Not implemented yet: atproto OAuth (it uses handle + App Password like the
CLI, which is fine for a locally-run app but not for a publicly hosted one —
see caveats below).

## Firefox extension

A Manifest V3 extension in [`extension/`](extension) autofills vault items
into login forms, sharing the same `src/core` logic as the CLI and web app.

```bash
npm run ext:build   # -> extension/dist, load unpacked via about:debugging
```

To try it: open `about:debugging#/runtime/this-firefox` in Firefox, "Load
Temporary Add-on…", and pick `extension/dist/manifest.json`. (Temporary
add-ons are removed when Firefox closes — see `extension/README.md` for
permanent installation with `web-ext sign`.) Click the toolbar icon to sign
in, create/unlock your vault, then click any item to fill it into the active
tab's login form.

Design notes:
- **The derived vault key lives only in the background script's memory** —
  never sent to the popup, never persisted anywhere. The popup is a thin UI
  that messages the background script for every vault operation; only
  non-secret metadata (titles/usernames/URLs) comes back for the item list.
  Filling a page decrypts the item and injects it directly from the
  background script via `browser.scripting.executeScript`, without the
  plaintext ever passing through the popup.
- Firefox can suspend an idle background script (it's a non-persistent event
  page), which drops the in-memory key — you'll be asked to unlock again.
  That's the intended tradeoff for not persisting the key; it's not a bug.
- Minimal permissions: `storage` (session cache), `activeTab` + `scripting`
  (fill only the tab you're looking at, only when you click an item — no
  `<all_urls>` content script running on every page you visit). No
  `host_permissions` are declared for the PDS either, since its XRPC
  endpoints already send permissive CORS headers for browser clients (same
  as the web app).
- Filling uses the native input-value setter + dispatches `input`/`change`
  events, so it works on React/Vue-controlled login forms, not just plain
  HTML ones — verified against both in testing.

## Security model & caveats

- **Threat model**: a malicious or compromised PDS operator, or anyone who
  can read your repo (it's public, like the rest of atproto), learns only
  that you have some number of vault items and roughly when they changed —
  never titles, usernames, passwords, URLs, or notes.
- **Not covered**: this tool doesn't protect you if your master password is
  weak/reused or if your local machine is compromised while you're using it.
  There's no local vault caching, so a network failure just fails the
  command — nothing is left half-written locally.
- The cached atproto session tokens (`~/.atpass/session.json` for the CLI,
  `localStorage` for the web app, `browser.storage.local` for the extension)
  are bearer credentials for your atproto account's repo (read/write to all
  your atproto data), scoped by whatever an App Password grants. Treat the
  CLI's file like any other CLI auth token cache (e.g. `~/.aws/credentials`,
  `gh`'s config). In the web app, that means anything that can run JavaScript
  on the page (an XSS bug, a malicious browser extension) can steal the
  session — there's no server component to add defense in depth here, which
  is inherent to a client-only web app like this one. The extension's copy is
  isolated in its own storage area, out of reach of page JavaScript.
- Handle + App Password login (used by both clients) means the PDS momentarily
  sees your App Password over HTTPS at sign-in, same as any first-party
  atproto client. Full OAuth (see "Web app" above) would avoid that but isn't
  implemented yet.
- The `xyz.atpass.*` NSIDs used here are an unregistered placeholder
  namespace for this project, not a domain you or anyone else owns — fine for
  personal use, but rename it to a domain you control before relying on it
  more broadly or publishing the lexicons.
- This has not been independently audited. Treat it as a working
  proof-of-concept, not a Bitwarden replacement, until it has been.

## Project layout

```
src/core/
  types.ts       shared types + the CryptoAdapter interface every platform implements
  records.ts     platform-agnostic atproto record CRUD (no fs/os — safe for browser/extension bundles)
  vault.ts       vault logic (init/unlock/add/get/list/remove), takes a CryptoAdapter
  node/          Node crypto (node:crypto + @node-rs/argon2), session (fs-cached), used by the CLI
  web/           browser crypto (Web Crypto API + hash-wasm), session (localStorage), used by web/ and extension/
src/cli/         commander-based CLI on top of src/core/node
web/             Vite + React web app on top of src/core/web, aliased as @core
extension/       Firefox MV3 extension (background + popup) on top of src/core/web, aliased as @core
lexicons/        xyz.atpass.vault.{meta,item} record schemas
```

This is an npm workspace (root = CLI, `web/` and `extension/` as members) so
all three share a single installed copy of `@atproto/api` — needed for their
`Agent` types to line up, since TypeScript treats two separately-installed
copies of the same package as distinct types.
