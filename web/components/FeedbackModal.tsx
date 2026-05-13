"use client";

import { useState } from "react";
import { submitFeedback } from "@/lib/api";

interface Props {
  trackCount: number;
  onClose: () => void;
  onSubmitted: () => void;
}

export function FeedbackModal({ trackCount, onClose, onSubmitted }: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!rating && !message.trim()) {
      setError("Поставь оценку или напиши пару слов.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitFeedback({ rating, message });
      onSubmitted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 px-4">
      <section className="w-full max-w-[460px] rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-serif italic leading-tight text-[var(--color-ink)]">
              Как вам Stem Studio?
            </h2>
            <p className="mt-2 text-[13px] leading-5 text-[var(--color-ink-muted)]">
              Вы уже обработали {trackCount} {trackWord(trackCount)}. Напишите пару слов: что удобно, что мешает, чего не хватает.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md border border-[var(--color-border-soft)] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            Оценка
          </div>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRating(value)}
                className={`h-10 rounded-md border text-[14px] font-mono transition-colors ${
                  rating === value
                    ? "border-[var(--color-accent-vocal)] bg-[var(--color-accent-vocal)] text-white"
                    : "border-[var(--color-border-soft)] text-[var(--color-ink)] hover:border-[var(--color-accent-vocal)]"
                }`}
                aria-pressed={rating === value}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            Комментарий
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={4000}
            rows={5}
            className="w-full resize-none rounded-md border border-[var(--color-border-soft)] bg-[var(--color-paper)] px-3 py-2 text-[14px] leading-5 text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-accent-vocal)]"
            placeholder="Например: текст появился быстро, но неудобно выбирать фрагмент..."
          />
        </label>

        {error && (
          <div className="mt-3 rounded-md border border-[var(--color-accent-warn)]/40 bg-[var(--color-accent-warn)]/10 px-3 py-2 text-[12px] text-[var(--color-accent-warn)]">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[var(--color-border-soft)] px-4 py-2 text-[13px] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
          >
            Позже
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="rounded-md bg-[var(--color-ink)] px-4 py-2 text-[13px] text-[var(--color-paper)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Отправляем..." : "Отправить"}
          </button>
        </div>
      </section>
    </div>
  );
}

function trackWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "трек";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "трека";
  return "треков";
}
