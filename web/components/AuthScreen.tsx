"use client";

import { type FormEvent, useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { login, register, type User } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { LocaleSwitch } from "./LocaleSwitch";

interface Props {
  onAuth: (user: User) => void;
  compact?: boolean;
}

export function AuthScreen({ onAuth, compact }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite") || params.get("code");
    if (!invite) return;
    setInviteCode(invite);
    setMode("register");
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail || busy) return;
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = mode === "login"
        ? await login(normalizedEmail, password)
        : await register(normalizedEmail, password, inviteCode.trim() || undefined);
      onAuth(result.user);
    } catch (err) {
      setError(humanAuthError(err, t));
    } finally {
      setBusy(false);
    }
  }

  const Container = compact ? "div" : "main";
  return (
    <Container className={compact ? "text-ink" : "min-h-screen bg-[var(--color-paper)] text-ink flex items-center justify-center px-6"}>
      {!compact && (
        <div className="absolute top-4 right-4">
          <LocaleSwitch />
        </div>
      )}
      <div className={`w-full ${compact ? "" : "max-w-[360px]"}`}>
        {!compact && (
          <div className="mb-7">
            <div className="text-[42px] leading-none font-serif italic">stem studio</div>
            <div className="mt-2 font-mono text-[11px] tracking-[0.08em] text-[var(--color-ink-muted)]">
              STEMS · LOOPS · KARAOKE
            </div>
          </div>
        )}

        <div className={compact ? "p-1" : "rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-sm"}>
          <div className="mb-4 grid grid-cols-2 rounded-md bg-[var(--color-surface-muted)] p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded px-3 py-2 font-mono text-[11px] transition-colors ${mode === "login" ? "bg-[var(--color-surface)] text-ink shadow-sm" : "text-[var(--color-ink-muted)]"}`}
            >
              {t("auth.login")}
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded px-3 py-2 font-mono text-[11px] transition-colors ${mode === "register" ? "bg-[var(--color-surface)] text-ink shadow-sm" : "text-[var(--color-ink-muted)]"}`}
            >
              {t("auth.register")}
            </button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <div className="mb-1 font-mono text-[10px] tracking-[0.08em] text-[var(--color-ink-muted)]">
                EMAIL
              </div>
              <input
                type="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                autoComplete="email"
                className="w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-paper)] px-3 py-2.5 font-mono text-[13px] outline-none focus:border-[var(--color-accent-vocal)]"
              />
            </label>

            <label className="block">
              <div className="mb-1 font-mono text-[10px] tracking-[0.08em] text-[var(--color-ink-muted)]">
                {t("auth.password")}
              </div>
              <input
                type="password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-paper)] px-3 py-2.5 font-mono text-[13px] outline-none focus:border-[var(--color-accent-vocal)]"
              />
              <div className="mt-1 font-mono text-[10px] text-[var(--color-ink-faint)]">
                {t("auth.passwordHint")}
              </div>
            </label>

            {mode === "register" && inviteCode && (
              <label className="block">
                <div className="mb-1 font-mono text-[10px] tracking-[0.08em] text-[var(--color-ink-muted)]">
                  {t("auth.accessCode")}
                </div>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(ev) => setInviteCode(ev.target.value)}
                  autoComplete="one-time-code"
                  className="w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-paper)] px-3 py-2.5 font-mono text-[13px] outline-none focus:border-[var(--color-accent-vocal)]"
                />
              </label>
            )}

            {error && (
              <div className="rounded-md bg-[var(--color-accent-warn)]/10 px-3 py-2 font-mono text-[11px] text-[var(--color-accent-warn)]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !email.trim() || password.length < 8}
              className="w-full rounded-md bg-[var(--color-accent-vocal)] px-4 py-2.5 font-mono text-[12px] font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {busy && <IconLoader2 size={14} className="animate-spin" />}
              {mode === "login" ? t("auth.signIn") : t("auth.createAccount")}
            </button>
          </form>

          <div className="mt-4 border-t border-[var(--color-border-soft)] pt-3 font-mono text-[10px] leading-relaxed text-[var(--color-ink-muted)]">
            {showForgot ? (
              <span>
                {t("auth.forgotPasswordReveal")}{" "}
                <a className="text-[var(--color-accent-vocal)]" href="https://wa.me/33755209758">
                  +33 7 55 20 97 58
                </a>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-[var(--color-accent-vocal)] hover:underline"
              >
                {t("auth.forgotPassword")}
              </button>
            )}
          </div>
        </div>
      </div>
    </Container>
  );
}

function humanAuthError(err: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  const text = err instanceof Error ? err.message : String(err);
  if (text.includes("401")) return t("auth.invalidCredentials");
  if (text.includes("403")) return t("auth.invalidAccessCode");
  if (text.includes("503")) return t("auth.registrationTemporarilyClosed");
  if (text.includes("409")) return t("auth.emailAlreadyExists");
  if (text.includes("400")) return t("auth.checkEmailPassword");
  return text;
}
