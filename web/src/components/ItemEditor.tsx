import { useState } from "react";
import { PasswordField } from "./PasswordField";
import type { ItemPayload } from "../lib/vaultClient";

export function ItemEditor({
  initial,
  isNew,
  busy,
  onSave,
  onCancel,
}: {
  initial: ItemPayload;
  isNew: boolean;
  busy: boolean;
  onSave: (payload: ItemPayload) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [username, setUsername] = useState(initial.username ?? "");
  const [password, setPassword] = useState(initial.password);
  const [url, setUrl] = useState(initial.url ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      title: title.trim(),
      username: username.trim() || undefined,
      password,
      url: url.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="form item-editor">
      <label>
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!isNew}
          required
          autoFocus={isNew}
        />
      </label>
      <label>
        Username
        <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <PasswordField value={password} onChange={setPassword} />
      </label>
      <label>
        URL
        <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
      </label>
      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
