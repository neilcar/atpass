import { useEffect, useState } from "react";
import { getAgent, logout, vault } from "./lib/vaultClient";
import type { Agent } from "./lib/vaultClient";
import { LoginScreen } from "./components/LoginScreen";
import { SetupVault } from "./components/SetupVault";
import { UnlockVault } from "./components/UnlockVault";
import { VaultScreen } from "./components/VaultScreen";

type Stage =
  | { kind: "loading" }
  | { kind: "login" }
  | { kind: "setup"; agent: Agent }
  | { kind: "unlock"; agent: Agent }
  | { kind: "vault"; agent: Agent; key: Uint8Array };

export default function App() {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  useEffect(() => {
    (async () => {
      const agent = await getAgent();
      if (!agent) {
        setStage({ kind: "login" });
        return;
      }
      await routeAfterLogin(agent);
    })();
  }, []);

  async function routeAfterLogin(agent: Agent) {
    const has = await vault.hasVault(agent);
    setStage(has ? { kind: "unlock", agent } : { kind: "setup", agent });
  }

  function handleLogout() {
    logout();
    setStage({ kind: "login" });
  }

  return (
    <div className="app">
      {stage.kind === "loading" && <div className="screen">Loading…</div>}
      {stage.kind === "login" && <LoginScreen onLoggedIn={(agent) => routeAfterLogin(agent)} />}
      {stage.kind === "setup" && (
        <SetupVault
          agent={stage.agent}
          onCreated={(key) => setStage({ kind: "vault", agent: stage.agent, key })}
          onLogout={handleLogout}
        />
      )}
      {stage.kind === "unlock" && (
        <UnlockVault
          agent={stage.agent}
          onUnlocked={(key) => setStage({ kind: "vault", agent: stage.agent, key })}
          onLogout={handleLogout}
        />
      )}
      {stage.kind === "vault" && (
        <VaultScreen
          agent={stage.agent}
          vaultKey={stage.key}
          onLock={() => setStage({ kind: "unlock", agent: stage.agent })}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
