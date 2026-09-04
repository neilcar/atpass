import { useEffect, useState } from "react";
import { sendToBackground } from "../lib/messages";
import type { StatusResponse } from "../lib/messages";
import { LoginScreen } from "./components/LoginScreen";
import { SetupVault } from "./components/SetupVault";
import { UnlockVault } from "./components/UnlockVault";
import { VaultScreen } from "./components/VaultScreen";

export default function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus() {
    try {
      setStatus(await sendToBackground({ type: "STATUS" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  if (error) {
    return (
      <div className="popup screen">
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!status) {
    return <div className="popup screen">Loading…</div>;
  }

  if (!status.loggedIn) {
    return <LoginScreen onLoggedIn={refreshStatus} />;
  }
  if (!status.hasVault) {
    return <SetupVault handle={status.handle} onCreated={refreshStatus} onLogout={refreshStatus} />;
  }
  if (!status.unlocked) {
    return <UnlockVault handle={status.handle} onUnlocked={refreshStatus} onLogout={refreshStatus} />;
  }
  return <VaultScreen handle={status.handle} onLock={refreshStatus} onLogout={refreshStatus} />;
}
