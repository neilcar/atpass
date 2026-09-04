import { useCallback, useEffect, useState } from "react";
import { sendToBackground } from "../../lib/messages";
import { siteMatches } from "../../lib/siteMatch";
import { ItemEditor } from "./ItemEditor";
import type { ItemPayload } from "@core/types.js";
import type { VaultListEntry } from "@core/vault.js";

type Mode = { kind: "list" } | { kind: "add" } | { kind: "edit"; item: ItemPayload };

const EMPTY_ITEM: ItemPayload = { title: "", password: "" };

export function VaultScreen({ handle, onLock, onLogout }: { handle?: string; onLock: () => void; onLogout: () => void }) {
  const [items, setItems] = useState<VaultListEntry[] | null>(null);
  const [tabUrl, setTabUrl] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await sendToBackground({ type: "LIST_ITEMS" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setTabUrl(tab?.url))
      .catch(() => {});
  }, [refresh]);

  async function handleFill(title: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await sendToBackground({ type: "FILL_ACTIVE_TAB", title });
      setNotice(`Filled "${title}".`);
      setTimeout(() => window.close(), 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(title: string) {
    setError(null);
    try {
      const item = await sendToBackground({ type: "GET_ITEM", title });
      setMode({ kind: "edit", item });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSave(payload: ItemPayload) {
    setBusy(true);
    setError(null);
    try {
      await sendToBackground({ type: "SAVE_ITEM", payload });
      await refresh();
      setMode({ kind: "list" });
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
      await sendToBackground({ type: "DELETE_ITEM", title });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    await sendToBackground({ type: "LOCK" });
    onLock();
  }

  async function handleLogout() {
    await sendToBackground({ type: "LOGOUT" });
    onLogout();
  }

  const all = (items ?? []).filter((it) => it.title.toLowerCase().includes(filter.toLowerCase()));
  const suggested = tabUrl ? all.filter((it) => siteMatches(it.url, tabUrl)) : [];
  const suggestedTitles = new Set(suggested.map((it) => it.title));
  const rest = all.filter((it) => !suggestedTitles.has(it.title));

  function renderItem(it: VaultListEntry) {
    return (
      <li key={it.title} className="item-row">
        <button type="button" className="item-main" onClick={() => handleFill(it.title)} disabled={busy} title="Fill into this page">
          <span className="item-title">{it.title}</span>
          {it.username && <span className="item-sub">{it.username}</span>}
        </button>
        <button type="button" className="icon-btn small" onClick={() => handleEdit(it.title)} title="Edit">
          ✎
        </button>
        <button type="button" className="icon-btn small" onClick={() => handleDelete(it.title)} title="Delete">
          🗑
        </button>
      </li>
    );
  }

  return (
    <div className="popup vault">
      <div className="sidebar-header">
        <strong className="handle">{handle}</strong>
        <div className="row">
          <button type="button" className="secondary small" onClick={handleLock}>
            Lock
          </button>
          <button type="button" className="secondary small" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {mode.kind === "list" && (
        <>
          <input type="search" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} className="search" />
          <button type="button" className="add-btn" onClick={() => setMode({ kind: "add" })}>
            + Add item
          </button>
          <div className="item-scroll">
            {items === null && <p className="muted">Loading…</p>}
            {items !== null && all.length === 0 && <p className="muted">No items</p>}
            {suggested.length > 0 && (
              <>
                <div className="section-label">This site</div>
                <ul className="item-list">{suggested.map(renderItem)}</ul>
              </>
            )}
            {rest.length > 0 && (
              <>
                {suggested.length > 0 && <div className="section-label">All items</div>}
                <ul className="item-list">{rest.map(renderItem)}</ul>
              </>
            )}
          </div>
        </>
      )}

      {mode.kind === "add" && (
        <>
          <h2>New item</h2>
          <ItemEditor initial={EMPTY_ITEM} isNew busy={busy} onSave={handleSave} onCancel={() => setMode({ kind: "list" })} />
        </>
      )}

      {mode.kind === "edit" && (
        <>
          <h2>Edit {mode.item.title}</h2>
          <ItemEditor initial={mode.item} isNew={false} busy={busy} onSave={handleSave} onCancel={() => setMode({ kind: "list" })} />
        </>
      )}
    </div>
  );
}
