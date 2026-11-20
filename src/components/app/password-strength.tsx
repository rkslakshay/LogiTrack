"use client";

import { passwordProblems, passwordScore, STRENGTH_LABELS, type PasswordContext } from "@/lib/password-policy";
import { cn } from "@/lib/utils";

const COLORS = ["bg-danger", "bg-warning", "bg-warning", "bg-success", "bg-success"] as const;

/**
 * Strength meter with the first unmet rule spelled out. Announced politely to
 * screen readers. The server applies the same rules; this is guidance only.
 */
export function PasswordStrength({ password, context, id }: { password: string; context?: PasswordContext; id?: string }) {
  if (!password) {
    return (
      <p id={id} className="mt-1 text-xs text-ink-3">
        At least 8 characters with a letter and a number. Longer is stronger; avoid common words and your name.
      </p>
    );
  }
  const score = passwordScore(password, context);
  const problem = passwordProblems(password, context)[0];
  return (
    <div id={id} className="mt-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full", i < Math.max(1, score) ? COLORS[score] : "bg-neutral-soft")} />
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-3">
        <span className="font-medium text-ink-2">{STRENGTH_LABELS[score]}</span>
        {problem ? ` · ${problem}` : score < 3 ? " · A longer password or a passphrase would be stronger" : ""}
      </p>
    </div>
  );
}
