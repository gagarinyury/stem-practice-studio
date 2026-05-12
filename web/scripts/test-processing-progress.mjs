#!/usr/bin/env node
/**
 * Tests for /processing/[id] state machine:
 *   - SSE event reduces to stage transition (with pending → active via minSec)
 *   - Terminal "done"/"error" closes EventSource & fires onDone
 *   - Polling on getTrack catches status="done" → redirect when SSE races out
 *   - subscribeProgress contract: parses data, closes on terminal
 *
 *   node scripts/test-processing-progress.mjs
 */

let failures = 0;
function check(label, cond, info = "") {
  const tag = cond ? "✓" : "✗";
  console.log(`  ${tag} ${label}${info ? "  " + info : ""}`);
  if (!cond) failures++;
}

// ─── A. subscribeProgress contract (mock EventSource) ─────────────────
console.log("[A] subscribeProgress");
{
  // Mirror the implementation in web/lib/api.ts:
  function subscribeProgress(eventSource, onEvent, onDone) {
    eventSource.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data);
        onEvent(ev);
        if (ev.stage === "done" || ev.stage === "error") {
          onDone?.(ev);
          eventSource.close();
        }
      } catch { /* keepalive */ }
    };
    eventSource.onerror = () => {};
    return () => eventSource.close();
  }

  class MockES {
    constructor() { this.closed = false; }
    fire(data) { this.onmessage({ data }); }
    close() { this.closed = true; }
  }

  // events propagate
  {
    const es = new MockES();
    const seen = [];
    let doneSeen = null;
    subscribeProgress(es, (e) => seen.push(e), (e) => { doneSeen = e; });
    es.fire(JSON.stringify({ stage: "resolve_input", pct: 4 }));
    es.fire(JSON.stringify({ stage: "separate", pct: 70 }));
    check("intermediate events delivered", seen.length === 2);
    check("no onDone yet", doneSeen === null);
    check("connection still open", es.closed === false);
  }

  // terminal closes
  {
    const es = new MockES();
    let doneSeen = null;
    subscribeProgress(es, () => {}, (e) => { doneSeen = e; });
    es.fire(JSON.stringify({ stage: "done", pct: 100 }));
    check("done fires onDone", doneSeen && doneSeen.stage === "done");
    check("done closes ES", es.closed === true);
  }

  // keepalive comments don't crash
  {
    const es = new MockES();
    let saw = false;
    subscribeProgress(es, () => { saw = true; });
    es.fire(": keepalive");  // not valid JSON
    check("keepalive ignored", saw === false);
    check("ES still open", es.closed === false);
  }

  // error stage also terminal
  {
    const es = new MockES();
    let doneSeen = null;
    subscribeProgress(es, () => {}, (e) => { doneSeen = e; });
    es.fire(JSON.stringify({ stage: "error", message: "boom" }));
    check("error fires onDone", doneSeen && doneSeen.stage === "error");
    check("error closes ES", es.closed === true);
  }
}

// ─── B. Stage transition state machine (mirrors ProcessingScreen) ────
console.log("[B] stage transition");
{
  const STAGES = [
    { key: "resolve_input", startPct: 0,  endPct: 20 },
    { key: "separate",      startPct: 20, endPct: 70 },
    { key: "asr",           startPct: 70, endPct: 90 },
    { key: "lrclib",        startPct: 90, endPct: 95 },
    { key: "align",         startPct: 95, endPct: 99 },
  ];

  function nextStage(eventStage) {
    const idx = STAGES.findIndex((s) => s.key === eventStage);
    if (idx < 0) return null; // unknown stage (e.g. "identify", "manifest")
    return STAGES[idx + 1]?.key ?? STAGES[STAGES.length - 1].key;
  }

  check("resolve_input → separate",      nextStage("resolve_input") === "separate");
  check("separate → asr",                nextStage("separate") === "asr");
  check("asr → lrclib",                  nextStage("asr") === "lrclib");
  check("lrclib → align",                nextStage("lrclib") === "align");
  check("align stays on align (last)",   nextStage("align") === "align");
  check("identify (unknown) → null",     nextStage("identify") === null);
  check("manifest (unknown) → null",     nextStage("manifest") === null);
  check("done not in STAGES",            nextStage("done") === null);
}

// ─── C. Polling fallback decision ────────────────────────────────────
// Mirrors the polling logic in ProcessingScreen — given a fetched track,
// decide whether to redirect, error, or keep polling.
console.log("[C] polling decision");
{
  function pollDecision(track, preview) {
    if (track.status === "done" && !preview) return "redirect";
    if (track.status === "failed") return "error";
    return "continue";
  }

  check("done + !preview → redirect",
    pollDecision({ status: "done" }, false) === "redirect");
  check("done + preview → continue",
    pollDecision({ status: "done" }, true) === "continue");
  check("failed → error",
    pollDecision({ status: "failed" }, false) === "error");
  check("processing → continue",
    pollDecision({ status: "processing" }, false) === "continue");
  check("queued → continue",
    pollDecision({ status: "queued" }, false) === "continue");
}

// ─── D. Race scenario: SSE drops "done", polling rescues ─────────────
// Demonstrates the bug we fixed: backend race in events.py can swallow
// the terminal event. Without polling the page hangs forever; with
// polling we redirect at most ~5s after the track is done in DB.
console.log("[D] race scenario");
{
  function simulate({ sseDelivered, pollResults }) {
    // sseDelivered: array of stage events client actually received
    // pollResults: array of track.status values the poll observes over time
    let redirected = false;
    let error = false;

    for (const ev of sseDelivered) {
      if (ev.stage === "done") redirected = true;
      if (ev.stage === "error") error = true;
    }

    if (!redirected && !error) {
      for (const status of pollResults) {
        if (status === "done") { redirected = true; break; }
        if (status === "failed") { error = true; break; }
      }
    }
    return { redirected, error };
  }

  // happy path: SSE delivers done
  {
    const r = simulate({
      sseDelivered: [{ stage: "resolve_input" }, { stage: "separate" }, { stage: "done" }],
      pollResults: [],
    });
    check("SSE done delivered → redirect", r.redirected && !r.error);
  }

  // race: SSE never delivers done, polling sees done
  {
    const r = simulate({
      sseDelivered: [{ stage: "resolve_input" }],
      pollResults: ["processing", "processing", "done"],
    });
    check("SSE race, polling catches done", r.redirected && !r.error);
  }

  // total failure: neither SSE nor polling sees done → hangs forever (no redirect)
  {
    const r = simulate({
      sseDelivered: [{ stage: "resolve_input" }],
      pollResults: ["processing", "processing", "processing"],
    });
    check("genuine in-flight: no redirect", !r.redirected && !r.error);
  }

  // pipeline failed: polling catches failure
  {
    const r = simulate({
      sseDelivered: [{ stage: "resolve_input" }],
      pollResults: ["processing", "failed"],
    });
    check("polling catches failure", !r.redirected && r.error);
  }
}

console.log(`\nfailures: ${failures}`);
process.exit(failures > 0 ? 1 : 0);
