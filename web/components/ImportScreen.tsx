"use client";

import { IconLink, IconUpload, IconBrandYoutube, IconArrowRight } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PhoneFrame } from "./ui/PhoneFrame";
import { submitYouTube, uploadTrack } from "@/lib/api";

export function ImportScreen({ recents }: { recents: { id: string; title: string; meta: string }[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function startYouTube() {
    if (!url.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { id } = await submitYouTube(url.trim(), { language });
      router.push(`/processing/${id}`);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  async function startUpload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const { id } = await uploadTrack(file, { language });
      router.push(`/processing/${id}`);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text);
    } catch {
      /* clipboard denied — ignore */
    }
  }

  return (
    <PhoneFrame>
      <div className="px-6 pt-6 pb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)] mb-2">
          New session
        </div>
        <div className="text-[32px] leading-[1.05] text-ink tracking-tight">
          Bring a song
          <br />
          <em className="text-[#5F5E5A]">to learn.</em>
        </div>
      </div>

      <div className="px-6 pt-2 space-y-2.5">
        <button
          type="button"
          onClick={pasteFromClipboard}
          className="w-full text-left bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-lg)] px-3.5 py-3.5 flex items-center gap-2.5 font-mono"
        >
          <IconLink size={18} className="text-[var(--color-ink-muted)]" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="youtube.com/watch?v=..."
            className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-[var(--color-ink-muted)] outline-none font-mono"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="text-[11px] text-[var(--color-accent-vocal)] tracking-[0.05em]">PASTE</span>
        </button>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] py-3.5 text-center"
          >
            <IconUpload size={22} className="mx-auto text-[#5F5E5A]" />
            <div className="font-mono text-[13px] text-ink mt-1">Audio file</div>
          </button>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] text-center font-mono text-[13px] text-ink appearance-none px-2"
          >
            <option value="en">en — Parakeet</option>
            <option value="ru">ru — GigaAM</option>
            <option value="es">es — Parakeet</option>
            <option value="fr">fr — Parakeet</option>
            <option value="de">de — Parakeet</option>
            <option value="it">it — Parakeet</option>
            <option value="pt">pt — Parakeet</option>
          </select>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) startUpload(f);
          }}
        />

        {url.trim() && (
          <button
            type="button"
            onClick={startYouTube}
            disabled={busy}
            className="w-full mt-1 bg-[var(--color-accent-vocal)] text-white rounded-[var(--radius-pill)] py-3 font-mono text-[12px] tracking-[0.08em] uppercase disabled:opacity-60"
          >
            {busy ? "queueing…" : "process"}
          </button>
        )}
        {err && <div className="font-mono text-[11px] text-[var(--color-accent-warn)]">{err}</div>}
      </div>

      {recents.length > 0 && (
        <div className="px-6 pt-6 pb-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)] mb-3">
            — recently in library
          </div>
          {recents.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => router.push(`/play/${r.id}`)}
              className="w-full flex items-center gap-3 py-2.5 border-t border-[var(--color-border-soft)] text-left"
            >
              <div className="w-10 h-10 rounded-md bg-[#D3D1C7] flex items-center justify-center text-[#444441]">
                <IconBrandYoutube size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[18px] text-ink leading-[1.1] truncate">{r.title}</div>
                <div className="font-mono text-[11px] text-[var(--color-ink-muted)]">{r.meta}</div>
              </div>
              <IconArrowRight size={16} className="text-[var(--color-ink-muted)]" />
            </button>
          ))}
        </div>
      )}

      <div className="px-6 py-7 text-center font-mono text-[10px] text-[var(--color-ink-muted)] tracking-[0.1em]">
        stems · lyrics · timing — ready in ~90 sec
      </div>
    </PhoneFrame>
  );
}
