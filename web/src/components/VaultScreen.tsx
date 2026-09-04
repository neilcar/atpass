import { useCallback, useEffect, useState } from "react";
import { vault, ItemNotFoundError } from "../lib/vaultClient";
import type { Agent, ItemPayload, VaultListEntry } from "../lib/vaultClient";
import { ItemEditor } from "./ItemEditor";
import { copyToClipboard } from "./PasswordField";

type Mode = { kind: "list" } | { kind: "view"; item: ItemPayload } | { kind: "add" } | { kind: "edit"; item: ItemPayload };

const EMPTY_ITEM: ItemPayload = { title: "", password: "" };

export function VaultScreen({ agent, vaultKey, onLock, onLogout }: { agent: Agent; vaultKey: Uint8Array; onLock: () => void; onLogout: () => void }) {
  const [items, setItems] = useState<VaultListEntry[] | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await vault.listItems(agent, vaultKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [agent, vaultKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function openItem(title: string) {
    setError(null);
    try {
      const item = await vault.getItem(agent, vaultKey, title);
      setMode({ kind: "view", item });
    } catch (err) {
      if (err instanceof ItemNotFoundError) setError(err.message);
      else setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSave(payload: ItemPayload) {
    setBusy(true);
    setError(null);
    try {
      await vault.addItem(agent, vaultKey, payload);
      await refresh();
      setMode({ kind: "view", item: payload });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(title: string) {
    if (!confirm(`Delete "${title}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await vault.removeItem(agent, title);
      await refresh();
      setMode({ kind: "list" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(password: string) {
    setError(null);
    try {
      await copyToClipboard(password);
      setCopyNotice("Copied — clearing in 20s");
      setTimeout(() => setCopyNotice(null), 20000);
    } catch (err) {
      setError(
        `Couldn't copy to clipboard: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const filtered = (items ?? []).filter((it) => it.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="vault-layout">
      <aside className="vault-sidebar">
        <div className="sidebar-header">
          <strong>{agent.session?.handle}</strong>
          <div className="row">
            <button type="button" className="secondary small" onClick={onLock}>
              Lock
            </button>
            <button type="button" className="secondary small" onClick={onLogout}>
              Log out
            </button>
          </div>
        </div>
        <input
          type="search"
          placeholder="Search…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="search"
        />
        <button type="button" className="add-btn" onClick={() => setMode({ kind: "add" })}>
          + Add item
        </button>
        <ul className="item-list">
          {items === null && <li className="muted">Loading…</li>}
          {items !== null && filtered.length === 0 && <li className="muted">No items</li>}
          {filtered.map((it) => (
            <li key={it.title}>
              <button type="button" className="item-row" onClick={() => openItem(it.title)}>
                <span className="item-title">{it.title}</span>
                {it.username && <span className="item-sub">{it.username}</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="vault-main">
        {error && <p className="error">{error}</p>}
        {copyNotice && <p className="notice">{copyNotice}</p>}

        {mode.kind === "list" && <p className="muted">Select an item, or add a new one.</p>}

        {mode.kind === "add" && (
          <>
            <h2>New item</h2>
            <ItemEditor
              initial={EMPTY_ITEM}
              isNew
              busy={busy}
              onSave={handleSave}
              onCancel={() => setMode({ kind: "list" })}
            />
          </>
        )}

        {mode.kind === "edit" && (
          <>
            <h2>Edit {mode.item.title}</h2>
            <ItemEditor
              initial={mode.item}
              isNew={false}
              busy={busy}
              onSave={handleSave}
              onCancel={() => setMode({ kind: "view", item: mode.item })}
            />
          </>
        )}

        {mode.kind === "view" && (
          <div className="item-detail">
            <h2>{mode.item.title}</h2>
            {mode.item.username && (
              <div className="field">
                <span className="field-label">Username</span>
                <span className="field-value">{mode.item.username}</span>
              </div>
            )}
            <div className="field">
              <span className="field-label">Password</span>
              <span className="field-value password-value">{"•".repeat(Math.min(mode.item.password.length, 16))}</span>
              <button type="button" className="icon-btn" onClick={() => handleCopy(mode.item.password)} title="Copy password">
                📋
              </button>
            </div>
            {mode.item.url && (
              <div className="field">
                <span className="field-label">URL</span>
                <a href={mode.item.url} target="_blank" rel="noreferrer" className="field-value">
                  {mode.item.url}
                </a>
              </div>
            )}
            {mode.item.notes && (
              <div className="field">
                <span className="field-label">Notes</span>
                <span className="field-value notes">{mode.item.notes}</span>
              </div>
            )}
            <div className="row">
              <button type="button" onClick={() => setMode({ kind: "edit", item: mode.item })}>
                Edit
              </button>
              <button type="button" className="danger" onClick={() => handleDelete(mode.item.title)} disabled={busy}>
                Delete
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
