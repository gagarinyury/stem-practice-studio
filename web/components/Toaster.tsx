"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type ToastKind = "default" | "error" | "success";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) return { show: () => {} };
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, kind: ToastKind = "default") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-3 right-3 left-3 md:left-auto md:bottom-5 md:right-5 z-[100] flex flex-col items-end gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastPill key={t.id} toast={t} onDismiss={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastPill({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const color =
    toast.kind === "error"
      ? "border-[var(--color-accent-warn)] text-[var(--color-accent-warn)]"
      : toast.kind === "success"
      ? "border-[var(--color-accent-vocal)] text-[var(--color-accent-vocal)]"
      : "border-[var(--color-border-soft)] text-ink";
  return (
    <button
      type="button"
      onClick={onDismiss}
      className={`pointer-events-auto max-w-[360px] w-full md:w-auto rounded-lg border ${color} bg-[var(--color-surface)] shadow-lg px-4 py-3 font-mono text-[12px] text-left transition-all duration-200 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
    >
      {toast.message}
    </button>
  );
}
