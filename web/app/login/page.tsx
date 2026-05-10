"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login, register } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/warmup";

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = mode === "login" ? await login(email, password) : await register(email, password);
      // Brand new user → onboarding. Returning user with no range → onboarding too.
      if (!user.voice_low) router.replace("/warmup/onboarding");
      else router.replace(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm bg-paper border border-[var(--color-border-soft)] rounded-[28px] p-7">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-vocal)]">
          — {mode === "login" ? "welcome back" : "make an account"} —
        </div>
        <h1 className="mt-2 text-[34px] leading-none italic">
          {mode === "login" ? (
            <>Sign <em className="not-italic text-[var(--color-ink-muted)]">in.</em></>
          ) : (
            <>Begin <em className="not-italic text-[var(--color-ink-muted)]">here.</em></>
          )}
        </h1>
        <p className="mt-3 font-mono text-[11px] text-[var(--color-ink-muted)] leading-relaxed">
          email + password · no verification · no fuss
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-muted)]">email</span>
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-white border-0 border-b border-[var(--color-ink-faint)] focus:border-[var(--color-accent-vocal)] outline-none px-1 py-2 text-[16px] font-mono"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-muted)]">password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-white border-0 border-b border-[var(--color-ink-faint)] focus:border-[var(--color-accent-vocal)] outline-none px-1 py-2 text-[16px] font-mono"
            />
          </label>

          {error && (
            <div className="font-mono text-[11px] text-[var(--color-accent-warn)] mt-1">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[12px] uppercase tracking-[0.15em] py-4 rounded-pill disabled:opacity-50"
          >
            {busy ? "…" : mode === "login" ? "▸ sign in" : "▸ create account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
          className="mt-5 font-mono text-[11px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] tracking-[0.05em]"
        >
          — {mode === "login" ? "don't have an account? sign up" : "already have an account? sign in"}
        </button>
      </div>
    </main>
  );
}
