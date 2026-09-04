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
- Locally, only your atproto session tokens are cached (`~/.atpass/session.json`,
  `chmod 600`), so you don't have to log in every command. Nothing about the
  master password or vault key is ever written to disk.
- See [`lexicons/`](lexicons) for the formal schemas.

## Setup

```bash
npm install
npm run build
npm link   # optional: puts `atpass` on your PATH
```

Or run directly during development with `npm run dev -- <command>`.

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

## Security model & caveats

- **Threat model**: a malicious or compromised PDS operator, or anyone who
  can read your repo (it's public, like the rest of atproto), learns only
  that you have some number of vault items and roughly when they changed —
  never titles, usernames, passwords, URLs, or notes.
- **Not covered**: this tool doesn't protect you if your master password is
  weak/reused or if your local machine is compromised while you're using it.
  There's no local vault caching, so a network failure just fails the
  command — nothing is left half-written locally.
- The cached atproto session tokens in `~/.atpass/session.json` are bearer
  credentials for your atproto account's repo (read/write to all your atproto
  data), scoped by whatever an App Password grants. Treat that file like any
  other CLI auth token cache (e.g. `~/.aws/credentials`, `gh`'s config).
- The `xyz.atpass.*` NSIDs used here are an unregistered placeholder
  namespace for this project, not a domain you or anyone else owns — fine for
  personal use, but rename it to a domain you control before relying on it
  more broadly or publishing the lexicons.
- This has not been independently audited. Treat it as a working
  proof-of-concept, not a Bitwarden replacement, until it has been.

## Project layout

```
src/core/    atproto client, crypto (Argon2id + AES-256-GCM), vault logic — no I/O with the terminal
src/cli/     commander-based CLI on top of src/core
lexicons/    xyz.atpass.vault.{meta,item} record schemas
```

`src/core` has no CLI-specific code, so a future web/browser-extension client
can reuse it directly.
