import { useState } from "react";
import { sendToBackground } from "../../lib/messages";
import { DEFAULT_SERVICE } from "../../lib/extSession";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [service, setService] = useState(DEFAULT_SERVICE);
  const [handle, setHandle] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await sendToBackground({ type: "LOGIN", service, identifier: handle.trim(), appPassword });
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1>atpass</h1>
      <p className="subtitle">Your vault, stored in your own atproto repo.</p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Handle or DID
          <input type="text" placeholder="alice.bsky.social" value={handle} onChange={(e) => setHandle(e.target.value)} autoFocus required />
        </label>
        <label>
          App password
          <input
            type="password"
            placeholder="xxxx-xxxx-xxxx-xxxx"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            required
          />
        </label>
        <details className="advanced">
          <summary>PDS service</summary>
          <label>
            Service URL
            <input type="text" value={service} onChange={(e) => setService(e.target.value)} />
          </label>
        </details>
        <p className="hint">
          Use an{" "}
          <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer">
            App Password
          </a>
          , never your main account password.
        </p>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
