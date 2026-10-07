/** zxcvbn scores 0–4; 3 is "safely unguessable" (roughly 10^8+ guesses online, much more with our KDF offline). */
export const MIN_PASSWORD_SCORE = 3;

export interface PasswordStrength {
  valid: boolean;
  score: number;
  feedback: string;
}

export class WeakMasterPasswordError extends Error {
  readonly score: number;

  constructor(feedback: string, score: number) {
    super(feedback);
    this.name = "WeakMasterPasswordError";
    this.score = score;
  }
}

/** Account identifiers (DID, handle and its labels) that a strength check should treat as known to an attacker. */
export function accountUserInputs(did?: string, handle?: string): string[] {
  const inputs: string[] = [];
  if (did) inputs.push(did);
  if (handle) inputs.push(handle, ...handle.split("."));
  return inputs;
}

/**
 * Score a prospective master password. Runs entirely locally — the password is never sent anywhere.
 * `userInputs` (e.g. the account handle) are treated as easily guessed. zxcvbn's dictionaries are ~800 KB, so it's
 * loaded on first use rather than bundled into every page that imports the vault.
 */
export async function validatePasswordStrength(password: string, userInputs: string[] = []): Promise<PasswordStrength> {
  const { default: zxcvbn } = await import("zxcvbn");
  const result = zxcvbn(password, userInputs);
  const valid = result.score >= MIN_PASSWORD_SCORE;
  if (valid) return { valid, score: result.score, feedback: "" };
  const parts = [
    result.feedback.warning,
    ...result.feedback.suggestions,
  ].filter((s) => s.length > 0);
  const feedback = ["This master password is too easy to guess.", ...parts].join(" ");
  return { valid, score: result.score, feedback };
}
