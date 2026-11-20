/**
 * Password policy (shared by the API and the forms).
 *
 * Follows the spirit of NIST SP 800-63B: length matters more than composition,
 * common and context-specific passwords are refused, and nothing expires on a
 * timer. For compatibility with existing accounts the original rule (a letter and
 * a digit) is kept.
 *
 *  - 8 to 72 bytes (bcrypt only uses the first 72 bytes)
 *  - at least one letter and one digit
 *  - not one of the most common passwords, and not a run of one character
 *  - must not contain the person's e-mail name or their name
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;

/** Most common passwords that would otherwise satisfy the rules (lower case). */
const COMMON = new Set([
  "password1", "password12", "password123", "password1234", "passw0rd", "passw0rd1", "p@ssw0rd", "p@ssword1", "pa55word", "pa55w0rd",
  "12345678a", "123456789a", "1234567890a", "a12345678", "a123456789", "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx", "zaq12wsx", "qwerty123",
  "qwerty1234", "qwertyuiop1", "asdf1234", "asdfgh123", "zxcvbnm123", "abc12345", "abcd1234", "abcde12345", "abc123456", "aa123456",
  "admin123", "admin1234", "administrator1", "root1234", "welcome1", "welcome123", "welcome2024", "welcome2025", "welcome2026",
  "letmein1", "letmein123", "iloveyou1", "iloveyou12", "monkey123", "dragon123", "master123", "sunshine1", "princess1", "football1",
  "baseball1", "superman1", "batman123", "trustno1!", "starwars1", "shadow123", "michael1", "computer1", "internet1", "changeme1",
  "changeme123", "default123", "test1234", "testing123", "user1234", "login123", "secret123", "summer2024", "summer2025", "winter2025",
  "india123", "india@123", "bharat123", "mumbai123", "delhi123", "logitrack1", "logitrack123", "fleet123", "driver123", "manager123",
]);

export interface PasswordContext {
  email?: string | null;
  name?: string | null;
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Problems with a password, as messages for the user. Empty when it is acceptable. */
export function passwordProblems(password: string, context: PasswordContext = {}): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN) problems.push(`Password must be at least ${PASSWORD_MIN} characters`);
  if (byteLength(password) > PASSWORD_MAX_BYTES) problems.push("Password is too long (72 bytes at most)");
  if (!/[A-Za-z]/.test(password)) problems.push("Password must contain a letter");
  if (!/\d/.test(password)) problems.push("Password must contain a number");
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) problems.push("This password is too common. Choose something less predictable");
  if (/^(.)\1+$/.test(password)) problems.push("Password cannot be a single repeated character");

  // Context words: the e-mail name and the full name (as one word), as NIST suggests for user names.
  const parts = [
    ...(context.email ? [context.email.split("@")[0]] : []),
    ...(context.name ? [context.name.replace(/\s+/g, "")] : []),
  ]
    .map((p) => p.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((p) => p.length >= 3);
  if (parts.some((p) => lower.includes(p))) problems.push("Password must not contain your name or e-mail address");
  return problems;
}

/**
 * Rough strength estimate for the meter in the UI: 0 (weak) to 4 (strong).
 * It rewards length and variety; it does not replace the rules above.
 */
export function passwordScore(password: string, context: PasswordContext = {}): 0 | 1 | 2 | 3 | 4 {
  if (!password || passwordProblems(password, context).length > 0) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  let score = 1;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (classes >= 3) score++;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}

export const STRENGTH_LABELS = ["Too weak", "Fair", "Good", "Strong", "Very strong"] as const;
