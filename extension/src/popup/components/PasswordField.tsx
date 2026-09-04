import { useState } from "react";
import { webCrypto } from "@core/web/crypto.js";

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
      <input type={visible ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} required />
      <button type="button" className="icon-btn" onClick={() => setVisible((v) => !v)} title={visible ? "Hide" : "Show"}>
        {visible ? "🙈" : "👁"}
      </button>
      {allowGenerate && (
        <button
          type="button"
          className="icon-btn"
          title="Generate a random password"
          onClick={() => {
            onChange(webCrypto.generatePassword({ length: 20 }));
            setVisible(true);
          }}
        >
          🎲
        </button>
      )}
    </div>
  );
}
