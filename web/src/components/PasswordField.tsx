import { useState } from "react";
import { generatePassword } from "../lib/vaultClient";

export function PasswordField({
  value,
  onChange,
  allowGenerate = true,
}: {
  value: string;
  onChange: (v: string) => void;
  allowGenerate?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-field">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
      <button type="button" className="icon-btn" onClick={() => setVisible((v) => !v)} title={visible ? "Hide" : "Show"}>
        {visible ? "🙈" : "👁"}
      </button>
      {allowGenerate && (
        <button
          type="button"
          className="icon-btn"
          title="Generate a random password"
          onClick={() => {
            onChange(generatePassword({ length: 20 }));
            setVisible(true);
          }}
        >
          🎲
        </button>
      )}
    </div>
  );
}

export async function copyToClipboard(text: string, clearAfterMs = 20000): Promise<void> {
  await navigator.clipboard.writeText(text);
  setTimeout(() => {
    navigator.clipboard.writeText("").catch(() => {});
  }, clearAfterMs);
}
