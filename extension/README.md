# atpass (Firefox extension)

Autofills [atpass](../README.md) vault items into login forms. Manifest V3,
built with Vite, sharing all vault/crypto logic with the CLI and web app via
`../src/core`.

## Build & load

```bash
npm install          # from the repo root
npm run ext:build     # -> extension/dist
```

Then in Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on…"
3. Pick `extension/dist/manifest.json`

This lasts until Firefox restarts. For a persistent install you need a
signed `.xpi`:

```bash
npm run build   # inside extension/, or `npm run ext:build` from the root
npx web-ext sign --source-dir dist --api-key <AMO_KEY> --api-secret <AMO_SECRET>
```

which requires a (free) [addons.mozilla.org](https://addons.mozilla.org) API
key, and that you change `browser_specific_settings.gecko.id` in
[`public/manifest.json`](public/manifest.json) from the `atpass@example.invalid`
placeholder to an ID you own (any unique string in `name@domain` form, or a
UUID) before signing.

`npm run lint` runs Mozilla's own `web-ext lint` against `dist/` — do this
after any manifest or permissions change.

## How it works

- **Background script** (`src/background.ts`) is the only place that ever
  holds your decrypted vault key, in a module-level variable — never written
  to disk, never sent to the popup. It resumes your atproto session from
  `browser.storage.local` on startup and answers a small typed message
  protocol (see `src/lib/messages.ts`) from the popup.
- **Popup** (`src/popup/`) is a thin React UI: login/setup/unlock forms, a
  search + item list (titles/usernames/URLs only — passwords never reach the
  popup except when you're actively editing that specific item), and per-item
  Fill/Edit/Delete actions.
- **Filling** happens entirely in the background script: it decrypts the
  item, then runs `browser.scripting.executeScript` with a self-contained
  function against the active tab. That function finds the page's password
  field, the nearest preceding text/email field as the username, and sets
  both using the native input-value setter plus `input`/`change` events (so
  it works on React/Vue-controlled forms, not just plain HTML ones) — then
  focuses the password field so you can review before submitting. It never
  auto-submits the form.
- Because Firefox can suspend an idle background script (it's a
  non-persistent event page under MV3), the in-memory vault key doesn't
  survive indefinitely — if the extension's been idle a while, you'll be
  asked to unlock again. Your atproto session (in `browser.storage.local`)
  does survive, so that's the only re-prompt.

## Permissions

Only `storage`, `activeTab`, and `scripting` — no `<all_urls>` content
script running on every page, and no `host_permissions` for the PDS (its
XRPC endpoints already send CORS headers permissive enough for a browser
client to call directly, same as the web app). `activeTab` means the
extension only ever sees the tab you were on when you opened the popup and
clicked something, not your whole browsing history or other open tabs.

## Known limitations

- No form autodetection/overlay while browsing — you open the popup and
  click an item, rather than getting an inline "fill" icon in the field
  itself. Simpler and more private (nothing runs until you act), but less
  convenient than a full password-manager extension.
- Doesn't look inside iframes or shadow DOM for the password field.
- Same "not independently audited" caveat as the rest of atpass — see the
  root [README](../README.md#security-model--caveats).
