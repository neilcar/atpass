import { useState } from "react";
import { vault } from "../lib/vaultClient";
import type { Agent } from "../lib/vaultClient";

export function SetupVault({
  agent,
  onCreated,
  onLogout,
}: {
  agent: Agent;
  onCreated: (key: Uint8Array) => void;
  onLogout: () => void;
}) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw1.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (pw1 !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await vault.initVault(agent, pw1);
      const key = await vault.unlockVault(agent, pw1);
      onCreated(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1>Create your vault</h1>
      <p className="subtitle">
        No vault exists yet for <strong>{agent.session?.handle}</strong>. Choose a master password —
        it's separate from your atproto login and never leaves this device.
      </p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Master password
          <input
            type="password"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label>
          Confirm master password
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <p className="hint warning">
          If you lose this password, your vault items are unrecoverable — there is no reset.
        </p>
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create vault"}
        </button>
        <button type="button" className="secondary" onClick={onLogout}>
          Log out
        </button>
      </form>
    </div>
  );
}
