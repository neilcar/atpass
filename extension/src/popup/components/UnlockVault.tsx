import { useState } from "react";
import { sendToBackground } from "../../lib/messages";
import type { LockReason } from "../../lib/messages";

const LOCK_NOTICES: Record<LockReason, string> = {
  idle: "Locked automatically after 5 minutes without vault activity.",
  suspended: "Locked because Firefox unloaded atpass's background page while it was idle.",
};

export function UnlockVault({
  handle,
  lockReason,
  onUnlocked,
  onLogout,
}: {
  handle?: string;
  lockReason?: LockReason;
  onUnlocked: () => void;
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
      await sendToBackground({ type: "UNLOCK", masterPassword: password });
      onUnlocked();
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await sendToBackground({ type: "LOGOUT" });
    onLogout();
  }

  return (
    <div className="screen">
      <h1>Unlock vault</h1>
      <p className="subtitle">
        Signed in as <strong>{handle}</strong>
      </p>
      {lockReason && <p className="hint">{LOCK_NOTICES[lockReason]}</p>}
      <form onSubmit={handleSubmit} className="form">
        <label>
          Master password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
        <button type="button" className="secondary" onClick={handleLogout}>
          Log out
        </button>
      </form>
    </div>
  );
}
