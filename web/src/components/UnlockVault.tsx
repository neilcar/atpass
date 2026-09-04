import { useState } from "react";
import { vault, WrongMasterPasswordError } from "../lib/vaultClient";
import type { Agent } from "../lib/vaultClient";

export function UnlockVault({
  agent,
  onUnlocked,
  onLogout,
}: {
  agent: Agent;
  onUnlocked: (key: Uint8Array) => void;
  onLogout: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const key = await vault.unlockVault(agent, password);
      onUnlocked(key);
    } catch (err) {
      if (err instanceof WrongMasterPasswordError) {
        setError("Incorrect master password.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1>Unlock vault</h1>
      <p className="subtitle">
        Signed in as <strong>{agent.session?.handle}</strong>
      </p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Master password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
        <button type="button" className="secondary" onClick={onLogout}>
          Log out
        </button>
      </form>
    </div>
  );
}
