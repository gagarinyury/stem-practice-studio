"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconX, IconVolume, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerSkipBack, IconPlayerSkipForward } from "@tabler/icons-react";
import { getProfile } from "@/lib/api";
import { logout, type AuthUser } from "@/lib/auth";
import { DAILY8 } from "@/lib/warmup/protocol";
import { pickRange, notesFor, type VoiceRange } from "@/lib/warmup/transpose";
import { ensureAudio, playStep, pianoNote, type AudioCleanup } from "@/lib/warmup/audio";

interface SessionResult {
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  stepsCompleted: number;
  stepsSkipped: number;
  language: string;
}

export default function Daily8Page() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [range, setRange] = useState<VoiceRange | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [remaining, setRemaining] = useState(DAILY8[0].duration);
  const [playing, setPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  const stepsCompletedRef = useRef(0);
  const stepsSkippedRef = useRef(0);
  const startedAtRef = useRef<number>(0);
  const cleanupRef = useRef<AudioCleanup | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Boot: fetch profile, init audio, start session.
  useEffect(() => {
    getProfile()
      .then(async (u) => {
        if (!u.voice_low) {
          router.replace("/warmup/onboarding");
          return;
        }
        setUser(u);
        setRange(pickRange(u));
        try {
          await ensureAudio();
          setAudioReady(true);
        } catch (e) {
          console.error("audio init failed", e);
          setAudioReady(true); // still allow the session to run silently
        }
      })
      .catch(() => {
        logout();
        router.replace("/login");
      });
  }, [router]);

  // Auto-start when audio is ready.
  useEffect(() => {
    if (!audioReady || !range) return;
    startedAtRef.current = Date.now();
    setPlaying(true);
  }, [audioReady, range]);

  function clearAudio() {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }

  function startStepAudio(idx: number) {
    if (!range) return;
    clearAudio();
    const step = DAILY8[idx];
    const notes = notesFor(step.key, range);
    cleanupRef.current = playStep(step.key, notes);
  }

  // Drive timer + audio start/stop based on `playing`.
  useEffect(() => {
    if (!playing || !range) {
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
      clearAudio();
      return;
    }
    startStepAudio(stepIdx);
    tickerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          stepsCompletedRef.current += 1;
          if (stepIdx < DAILY8.length - 1) {
            setStepIdx((i) => i + 1);
            return DAILY8[stepIdx + 1].duration;
          }
          finishSession();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
      tickerRef.current = null;
      clearAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stepIdx, range]);

  function finishSession() {
    if (!user) return;
    const durationSec = Math.round((Date.now() - startedAtRef.current) / 1000);
    const result: SessionResult = {
      startedAt: new Date(startedAtRef.current).toISOString(),
      finishedAt: new Date().toISOString(),
      durationSec,
      stepsCompleted: stepsCompletedRef.current,
      stepsSkipped: stepsSkippedRef.current,
      language: user.language || "English",
    };
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("warmup.lastResult", JSON.stringify(result));
    }
    setPlaying(false);
    clearAudio();
    router.replace("/warmup/session/daily8/done");
  }

  function onPrev() {
    if (stepIdx > 0) {
      setStepIdx((i) => i - 1);
      setRemaining(DAILY8[stepIdx - 1].duration);
    } else {
      setRemaining(DAILY8[0].duration);
    }
  }

  function onNext() {
    if (remaining > 0) stepsSkippedRef.current += 1;
    if (stepIdx < DAILY8.length - 1) {
      setStepIdx((i) => i + 1);
      setRemaining(DAILY8[stepIdx + 1].duration);
    } else {
      finishSession();
    }
  }

  function onClose() {
    setPlaying(false);
    clearAudio();
    router.replace("/warmup");
  }

  if (!user || !range) {
    return <main className="flex-1 flex items-center justify-center font-mono text-[11px] text-[var(--color-ink-muted)]">…</main>;
  }
  const step = DAILY8[stepIdx];
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-7 pb-7 max-w-sm mx-auto w-full">
      {/* Top bar */}
      <div className="w-full flex items-center justify-between">
        <button onClick={onClose} aria-label="close"><IconX size={22} /></button>
        <div className="font-mono text-[10px] text-[var(--color-ink-muted)] tracking-[0.1em]">{stepIdx + 1} of {DAILY8.length}</div>
        <IconVolume size={20} />
      </div>
      <div className="mt-4 w-full flex gap-1">
        {DAILY8.map((_, i) => (
          <div key={i} className="flex-1 h-[3px] rounded" style={{ background: i < stepIdx ? "var(--color-accent-vocal)" : i === stepIdx ? "rgba(83,74,183,0.55)" : "#D3D1C7" }} />
        ))}
      </div>

      {/* Title */}
      <div className="mt-7 text-center">
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-accent-vocal)]">{step.eyebrow}</div>
        <h1 className="mt-2 text-[30px] italic leading-tight" dangerouslySetInnerHTML={{ __html: step.title.replace(/<em>/g, '<em class="not-italic" style="color:var(--color-ink-muted)">') }} />
        <div className="mt-2 font-mono text-[11px] text-[var(--color-ink-muted)] leading-relaxed">{step.meta}</div>
      </div>

      {/* Visual */}
      <div className="mt-6 w-full bg-white border border-[var(--color-border-soft)] rounded-[12px] px-4 py-5 min-h-[200px] flex flex-col items-center justify-center">
        <Visual stepKey={step.key} range={range} active={playing} />
      </div>

      {/* Tip card */}
      <div className={`mt-4 w-full rounded-[10px] p-3 flex gap-2 items-start text-left ${
        step.tipTone === "warm" ? "bg-[#FAEEDA] text-[#633806]" : "bg-[#E1F5EE] text-[#04342C]"
      }`}>
        <span className="font-mono text-[9px] uppercase mt-1 opacity-70">i</span>
        <p className="text-[13px] italic leading-snug">{step.tip}</p>
      </div>

      {/* Timer */}
      <div className="mt-4 font-mono text-[22px] tabular-nums tracking-wider">{mm}:{ss}</div>

      {/* Controls */}
      <div className="mt-3 w-full flex items-center justify-between">
        <button onClick={onPrev} className="text-center" aria-label="prev">
          <IconPlayerSkipBack size={22} />
          <div className="font-mono text-[9px] text-[var(--color-ink-muted)] mt-1">prev</div>
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="w-16 h-16 rounded-full bg-[var(--color-ink)] text-[var(--color-paper)] flex items-center justify-center"
          aria-label={playing ? "pause" : "play"}
        >
          {playing ? <IconPlayerPauseFilled size={26} /> : <IconPlayerPlayFilled size={26} />}
        </button>
        <button onClick={onNext} className="text-center" aria-label="next">
          <IconPlayerSkipForward size={22} />
          <div className="font-mono text-[9px] text-[var(--color-ink)] mt-1">next</div>
        </button>
      </div>
      <div className="mt-3 font-mono text-[10px] text-[var(--color-ink-muted)] tracking-[0.05em]">— too much? tap &ldquo;next&rdquo; to skip</div>
    </main>
  );
}

/** Per-step visual. Inline for simplicity — each branch returns its own SVG/animation. */
function Visual({ stepKey, range, active }: { stepKey: string; range: VoiceRange; active: boolean }) {
  const notes = notesFor(stepKey, range);
  switch (stepKey) {
    case "release":
      return <BreathVisual />;
    case "sovt":
      return <SovtVisual note={notes.drone || "C3"} />;
    case "siren":
      return <SirenVisual low={notes.sirenLow || "A2"} high={notes.sirenHigh || "F4"} />;
    case "scale":
      return <ScaleVisual notes={notes.scale || []} active={active} />;
    case "swell":
      return <SwellVisual note={notes.swell || "D3"} />;
    case "stacc":
      return <StaccatoVisual notes={notes.arpeggio || []} active={active} />;
    case "cool":
      return <CoolVisual note={notes.cool || "D3"} />;
    default:
      return null;
  }
}

function BreathVisual() {
  return (
    <div className="flex flex-col items-center">
      <div
        className="w-32 h-32 rounded-full"
        style={{
          background: "radial-gradient(circle at 35% 30%, #EEEDFE, #CECBF6)",
          border: "0.5px solid #AFA9EC",
          animation: "warmupBreath 4.5s ease-in-out infinite",
        }}
      />
      <div className="mt-3 font-mono text-[11px] text-[var(--color-ink-muted)] tracking-[0.1em]">— breathe · 4s in · 4s out —</div>
      <style>{`@keyframes warmupBreath { 0%,100%{transform:scale(0.78);opacity:0.55;} 50%{transform:scale(1);opacity:1;} }`}</style>
    </div>
  );
}

function SovtVisual({ note }: { note: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex gap-5">
        <div className="w-16 h-16 rounded-[12px] bg-[#EEEDFE] border border-[#AFA9EC] flex items-center justify-center text-[#3C3489]">
          <div className="text-center">
            <div className="text-[10px] font-mono">lip</div><div className="text-[10px] font-mono">trill</div>
          </div>
        </div>
        <div className="w-16 h-16 rounded-[12px] bg-[var(--color-surface-muted)] border border-[var(--color-border-soft)] flex items-center justify-center">
          <div className="text-center">
            <div className="text-[10px] font-mono">straw</div>
          </div>
        </div>
      </div>
      <div className="mt-4 font-mono text-[11px] text-[#3C3489] bg-[#EEEDFE] rounded-pill px-3 py-1">hold on {note} · steady</div>
    </div>
  );
}

function SirenVisual({ low, high }: { low: string; high: string }) {
  return (
    <div className="w-full">
      <svg viewBox="0 0 320 170" className="w-full">
        <g fontFamily="DM Mono, monospace" fontSize="9" fill="#888780">
          <text x="6" y="22">{high}</text>
          <text x="6" y="142">{low}</text>
        </g>
        <g stroke="#D3D1C7" strokeWidth="0.5" strokeDasharray="2,3">
          <line x1="32" y1="20" x2="312" y2="20" />
          <line x1="32" y1="60" x2="312" y2="60" />
          <line x1="32" y1="100" x2="312" y2="100" />
          <line x1="32" y1="140" x2="312" y2="140" />
        </g>
        <rect x="32" y="40" width="280" height="80" fill="#EEEDFE" opacity="0.5" rx="3" />
        <path d="M 32,140 Q 172,10 312,140" stroke="#534AB7" strokeWidth="2.5" fill="none" strokeDasharray="4,4" opacity="0.55" />
        <path
          d="M 32,140 Q 172,10 312,140"
          stroke="#1D9E75"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="600"
          style={{ animation: "warmupSiren 6s linear infinite" }}
        />
      </svg>
      <div className="mt-2 font-mono text-[11px] text-center text-[#3C3489] bg-[#EEEDFE] rounded-pill inline-block px-3 py-1 mx-auto">{low} ↗ {high} ↘ {low}</div>
      <style>{`@keyframes warmupSiren { 0%{stroke-dashoffset:600;} 50%{stroke-dashoffset:0;} 100%{stroke-dashoffset:-600;} }`}</style>
    </div>
  );
}

function ScaleVisual({ notes, active }: { notes: string[]; active: boolean }) {
  const [hitIdx, setHitIdx] = useState<number | null>(null);
  const [vowel, setVowel] = useState("ah");
  const [resting, setResting] = useState(false);

  useEffect(() => {
    if (!active || notes.length === 0) return;
    const seq = [0, 1, 2, 3, 4, 3, 2, 1, 0];
    const restTicks = 4;
    const cycle = seq.length + restTicks;
    const vowels = ["ah", "ee", "oo"];
    let p = 0;
    let vIdx = 0;
    const id = setInterval(() => {
      const phase = p % cycle;
      if (phase < seq.length) {
        const i = seq[phase];
        setHitIdx(i);
        setResting(false);
        const n = notes[i];
        if (n) pianoNote(n, "8n");
      } else {
        setHitIdx(null);
        setResting(true);
      }
      p++;
      if (p % cycle === 0) {
        vIdx = (vIdx + 1) % vowels.length;
        setVowel(vowels[vIdx]);
      }
    }, 380);
    return () => clearInterval(id);
  }, [active, notes]);

  return (
    <div className="flex flex-col items-center w-full">
      <div className="flex flex-col gap-[6px] w-[80%]">
        {[4, 3, 2, 1, 0].map((idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className={`font-mono text-[10px] w-7 text-right ${hitIdx === idx ? "text-[#3C3489]" : "text-[var(--color-ink-muted)]"}`}>{notes[idx] || ""}</span>
            <div
              className="flex-1 h-[14px] rounded transition-all"
              style={{
                background: hitIdx === idx ? "#534AB7" : "#EEEDFE",
                opacity: hitIdx === idx ? 1 : 0.65,
                transform: hitIdx === idx ? "scaleX(1.04)" : "scaleX(1)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 font-mono text-[10px] text-[var(--color-ink-muted)] tracking-[0.1em] h-[14px]">{resting ? <span className="text-[var(--color-accent-success)]">— breathe —</span> : ""}</div>
      <div className="mt-2 text-[36px] italic">{vowel}</div>
    </div>
  );
}

function SwellVisual({ note }: { note: string }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="w-14 h-32 rounded-full origin-bottom"
        style={{
          background: "linear-gradient(180deg, #534AB7, #AFA9EC)",
          animation: "warmupSwell 6s ease-in-out infinite",
        }}
      />
      <div className="mt-4 font-mono text-[11px] text-[var(--color-ink-muted)] tracking-[0.1em]">— soft → loud → soft —</div>
      <div className="mt-2 font-mono text-[11px] text-[#3C3489] bg-[#EEEDFE] rounded-pill px-3 py-1">hold on {note}</div>
      <style>{`@keyframes warmupSwell { 0%,100%{transform:scaleY(0.25);opacity:0.4;} 50%{transform:scaleY(1);opacity:1;} }`}</style>
    </div>
  );
}

function StaccatoVisual({ notes, active }: { notes: string[]; active: boolean }) {
  const [hitIdx, setHitIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!active || notes.length === 0) return;
    const cycle = 4 + 3;
    let p = 0;
    const id = setInterval(() => {
      const phase = p % cycle;
      if (phase < 4) {
        setHitIdx(phase);
        const n = notes[phase];
        if (n) pianoNote(n, "16n");
      } else {
        setHitIdx(null);
      }
      p++;
    }, 380);
    return () => clearInterval(id);
  }, [active, notes]);

  return (
    <div className="flex flex-col items-center">
      <div className="flex gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-8 h-8 rounded-full transition-all"
            style={{
              background: hitIdx === i ? "#1D9E75" : "#EEEDFE",
              border: "0.5px solid #AFA9EC",
              transform: hitIdx === i ? "scale(1.25)" : "scale(1)",
              boxShadow: hitIdx === i ? "0 0 0 6px #E1F5EE" : "none",
            }}
          />
        ))}
      </div>
      <div className="mt-3 flex gap-4 font-mono text-[10px] text-[var(--color-ink-muted)]">
        {notes.map((n, i) => <span key={i} className="w-8 text-center">{n}</span>)}
      </div>
      <div className="mt-1 flex gap-4 font-mono text-[10px] text-[var(--color-ink-muted)] opacity-60">
        <span className="w-8 text-center">1</span><span className="w-8 text-center">3</span><span className="w-8 text-center">5</span><span className="w-8 text-center">8</span>
      </div>
    </div>
  );
}

function CoolVisual({ note }: { note: string }) {
  return (
    <div className="flex flex-col items-center w-full">
      <svg viewBox="0 0 280 60" className="w-[80%]">
        <path d="M 4 30 Q 24 18, 44 30 T 84 30 T 124 30 T 164 30 T 204 30 T 244 30 T 276 30" stroke="#AFA9EC" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
      <div className="mt-3 font-mono text-[11px] text-[var(--color-ink-muted)] tracking-[0.1em]">— hum · let it settle —</div>
      <div className="mt-2 font-mono text-[11px] text-[#3C3489] bg-[#EEEDFE] rounded-pill px-3 py-1">{note} · gentle</div>
    </div>
  );
}
