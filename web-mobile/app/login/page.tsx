"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login, register, setUser } from "@/lib/auth";
import { patchProfile } from "@/lib/api";
import { getLanguage } from "@/lib/strings";
import { ScreenShell } from "@/components/ui/ScreenShell";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Label, ButtonText, MonoSmall, ErrorText } from "@/components/ui/text";
import { tokens } from "@/lib/design/tokens";
import { t } from "@/lib/strings";

const ty = tokens.typography;

function detectInitialMode(): "login" | "register" {
  if (typeof window === "undefined") return "login";
  try {
    return window.localStorage.getItem("auth.user") ? "login" : "register";
  } catch {
    return "register";
  }
}

export default function LoginPage() {
  return (
    <Suspense fallback={<ScreenShell variant="flow"><MonoSmall>{t.common.loading}</MonoSmall></ScreenShell>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/library";

  const [mode, setMode] = useState<"login" | "register">(detectInitialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await register(email, password);
        const lang = getLanguage();
        try {
          const updated = await patchProfile({ language: lang });
          setUser(updated);
        } catch {}
        router.replace("/library");
      } else {
        const user = await login(email, password);
        if (user.language) {
          try { window.localStorage.setItem("app.language", user.language); } catch {}
        }
        router.replace(next);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <ScreenShell variant="flow">
      <ScreenHeader
        eyebrow={isLogin ? t.login.eyebrowLogin : t.login.eyebrowRegister}
        title={isLogin ? t.login.titleLoginA : t.login.titleRegisterA}
        emphasis={isLogin ? t.login.titleLoginB : t.login.titleRegisterB}
        subtitle={t.login.subtitle}
      />

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <Label>{t.login.email}</Label>
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            suppressHydrationWarning
            className={`bg-transparent border-0 border-b border-[var(--color-ink-faint)] focus:border-[var(--color-accent-vocal)] outline-none px-1 py-3 transition-colors ${ty.inputText}`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <Label>{t.login.password}</Label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={isLogin ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            suppressHydrationWarning
            className={`bg-transparent border-0 border-b border-[var(--color-ink-faint)] focus:border-[var(--color-accent-vocal)] outline-none px-1 py-3 transition-colors ${ty.inputText}`}
          />
        </label>

        {error && <ErrorText className="mt-1">{error}</ErrorText>}

        <button
          type="submit"
          disabled={busy}
          className="mt-3 bg-[var(--color-ink)] text-[var(--color-paper)] py-5 rounded-pill disabled:opacity-50"
        >
          <ButtonText className="text-[var(--color-paper)]">
            {busy ? t.common.loading : isLogin ? t.login.signIn : t.login.createAccount}
          </ButtonText>
        </button>
      </form>

      <div className="flex flex-col items-center gap-3 mt-2">
        <MonoSmall>{isLogin ? t.login.noAccount : t.login.haveAccount}</MonoSmall>
        <button
          type="button"
          onClick={() => { setMode(isLogin ? "register" : "login"); setError(null); }}
          className="border border-[var(--color-ink)] rounded-pill px-6 py-4 w-full text-[var(--color-ink)]"
        >
          <ButtonText>
            {isLogin ? t.login.signUp : t.login.switchToSignIn}
          </ButtonText>
        </button>
      </div>
    </ScreenShell>
  );
}
