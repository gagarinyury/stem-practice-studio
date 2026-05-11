"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Diagnostic overlay. Three independent signals:
 *   - "react useEffect": ticks if useEffect runs at all (React alive + mounted)
 *   - "native click": ticks if document-level click event fires (iOS gesture
 *     pipeline emits click, React just isn't catching it)
 *   - "vanilla AEL": ticks if addEventListener on a button fires (proves
 *     plain DOM listener works regardless of React)
 * Plus the 6 React-event-strategy buttons.
 */
export function TapTestBar() {
  const [c, setC] = useState({
    btn: 0, div: 0, ptr: 0, tch: 0, css: 0, a: 0,
    useEffectTick: 0, nativeClick: 0, vanillaAEL: 0,
  });
  const bump = (k: keyof typeof c) => setC((s) => ({ ...s, [k]: s[k] + 1 }));
  const cRef = useRef(c);
  cRef.current = c;
  const vanillaBtnRef = useRef<HTMLButtonElement>(null);

  // (1) Does useEffect even run? If this stays at 0, React never hydrated.
  useEffect(() => {
    setC((s) => ({ ...s, useEffectTick: s.useEffectTick + 1 }));
  }, []);

  // (2) Native document-level click listener — does iOS dispatch click at all?
  useEffect(() => {
    function onDocClick() {
      setC((s) => ({ ...s, nativeClick: s.nativeClick + 1 }));
    }
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, []);

  // (3) Vanilla addEventListener directly on a button — bypasses React.
  useEffect(() => {
    const b = vanillaBtnRef.current;
    if (!b) return;
    function onClick() {
      setC((s) => ({ ...s, vanillaAEL: s.vanillaAEL + 1 }));
    }
    b.addEventListener("click", onClick);
    return () => b.removeEventListener("click", onClick);
  }, []);

  return (
    <div
      className="fixed left-2 right-2 z-[99999] flex flex-col gap-1 rounded-md bg-black/90 p-2 font-mono text-[10px] text-white"
      style={{ top: "max(8px, env(safe-area-inset-top, 0px))" }}
    >
      <div className="flex gap-2 opacity-80">
        <span>useEffect: {c.useEffectTick}</span>
        <span>native click: {c.nativeClick}</span>
        <span>vanilla AEL: {c.vanillaAEL}</span>
      </div>
      <button
        ref={vanillaBtnRef}
        type="button"
        className="rounded bg-red-500/70 px-2 py-2 text-left"
      >
        VANILLA addEventListener button — tap me first
      </button>
      <div className="grid grid-cols-3 gap-1">
        <button type="button" onClick={() => bump("btn")} className="rounded bg-white/15 px-2 py-2">
          1. onClick: {c.btn}
        </button>
        <div role="button" onClick={() => bump("div")} className="rounded bg-white/15 px-2 py-2 text-center">
          2. div onClick: {c.div}
        </div>
        <button type="button" onPointerUp={() => bump("ptr")} className="rounded bg-white/15 px-2 py-2">
          3. onPointerUp: {c.ptr}
        </button>
        <button type="button" onTouchEnd={() => bump("tch")} className="rounded bg-white/15 px-2 py-2">
          4. onTouchEnd: {c.tch}
        </button>
        <button type="button" onClick={() => bump("css")} style={{ cursor: "pointer" }} className="rounded bg-white/15 px-2 py-2">
          5. inline cursor: {c.css}
        </button>
        <a href="#" onClick={(e) => { e.preventDefault(); bump("a"); }} className="rounded bg-white/15 px-2 py-2 text-center">
          6. anchor: {c.a}
        </a>
      </div>
    </div>
  );
}
