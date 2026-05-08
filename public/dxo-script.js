// =========================================================================
// XO Capture — dXO demo script
// =========================================================================
// v5.3 — proper auto-advance edition. Fixes three v5.2 problems:
//   1. v5.2 forced 25 manual Next clicks because the engine had no auto-
//      advance. v5.3 uses the engine's new auto-advance (added in dxo.js
//      v5.2) so the demo plays through end-to-end with zero operator clicks.
//   2. v5.2 added two visible "preflight" steps to land on Mayo's Welcome
//      page. The engine actually DOES support meta.preflightClicks (silent,
//      pre-panel). v5.3 restores that — preflight runs invisibly before the
//      narrated demo begins.
//   3. v5.2 opener "Every prospect is a mountain of noise" was condescending
//      to the audience (sales reps don't experience prospects as noise —
//      they navigate complexity for a living). v5.3 opens by crediting the
//      rep's craft, then promises the constraint they actually feel: time.
//
// Throughlines (refined from v5.1/v5.2):
//   * Time / depth / context — opener credits the rep's craft, takes the
//     time constraint off the table.
//   * Signal vs. clutter — Aled Miles' framing. Lands at engine (note 5)
//     and close (note 7). Removed from opener (was punching down).
//   * Rapid deployment — "weeks not quarters". Lands at architecture and close.
//   * IntellagenticXO — the end of guesswork — full tagline at close, once.
//
// LOAD ORDER
//   This file is loaded unconditionally by index.html. Sets window.DXO_SCRIPT.
//   The dxo.js engine reads that global on bootstrap. Bootstrap is gated on
//   the "Sign Out" sidebar text being present.
//
// PREFLIGHT (silent — handled by engine via meta.preflightClicks):
//   1. Click "Mayo Clinic" in the All Clients list (selects engagement).
//   2. Click "Welcome" in the sub-nav (lands on Welcome page).
//   Engine fires both clicks invisibly with 1.5s settle gap, then panel
//   appears with step 1 already in correct visual state.
//
// NARRATED STEPS (7 beats — match Ken's 7 notes):
//   Note 1 -> step-1-welcome           (the rep's craft, time, the second meeting)
//   Note 2 -> step-2-deck              (the deck you'd love to walk in with)
//   Note 3 -> step-3-streamline-xo     (Streamline + XO; "your competition is guessing")
//   Note 4 -> step-4-architecture      (architecture; weeks not quarters)
//   Note 5 -> step-5-enrich            (Intellagentic Engine; signal vs noise)
//   Note 6 -> step-6-upload            (contextual data, any format)
//   Note 7 -> step-7-welcome-close     (tagline close)
//
// SILENT TRANSITIONS (between narrated beats — auto-advance, no operator clicks):
//   Each handles one click (nav button, expand toggle). 2.5s duration covers
//   1.2s click delay + 1.3s settle.
//
// ENGINE DEPENDENCIES (dxo.js v5.2):
//   * Auto-advance: each step auto-fires next() after duration_seconds.
//     Operator can still pause/manually-next; auto-advance respects pause state.
//   * `step.scrollToTop: true` → window.scrollTo(0,0) at step start.
//   * scrollIntoView default block: 'start' (was 'center'); targets land
//     at top of viewport, not middle.
//   * Empty title shows blank in panel (was "(untitled step)").
// =========================================================================
window.DXO_SCRIPT = {
  meta: {
    name: "XO Capture — dXO walkthrough (v5.3)",
    estimated_duration_minutes: 2.6,
    demo_client: "Mayo Clinic",
    audience: ["go-to-market", "solutions-engineering"],
    version: "5.3.0",
    notes: "v5.3: restores silent meta.preflightClicks (was missed in v5.1/5.2). 16 steps (7 narrated + 9 transitions) — all auto-advance via engine v5.2. Opener rewritten to credit the rep's craft (no longer punches down at 'noise'). Same downstream throughlines: signal/noise at engine + close, rapid deployment, IntellagenticXO tagline at close. Sum runtime 144s; ~2:30-3:00 wall clock with engine overhead.",
    preflightClicks: [
      "text:Mayo Clinic",
      "text:Welcome",
    ],
  },
  steps: [
    // ── NOTE 1 ──── Welcome (NARRATED, lands at top of Welcome page) ─────
    {
      id: "step-1-welcome",
      title: "Welcome",
      narration:
        "You know what makes a great first meeting. Time, depth, the right context walking in. XO Capture gives you all three — before your coffee's cold. That's how first meetings turn into second ones.",
      duration_seconds: 13,
      target: "text:Domain Expertise",
      scroll: true,
      scrollToTop: true,
    },
    // ── transition: navigate to Results page ──────────────────────────────
    {
      id: "t1-nav-results",
      title: "",
      narration: "",
      duration_seconds: 2.5,
      target: "text:Results",
      click: true,
      click_delay_ms: 1200,
    },
    // ── transition: expand the deck ──────────────────────────────────────
    {
      id: "t2-expand-deck",
      title: "",
      narration: "",
      duration_seconds: 2.5,
      target: "text:Growth Deck",
      click: true,
      click_delay_ms: 1200,
    },
    // ── NOTE 2 ──── The deck (NARRATED, target deck-preview at top) ──────
    {
      id: "step-2-deck",
      title: "The deck",
      narration:
        "The deck you'd love to walk in with. Their business, their pain, where you fit — already in slides. Three minutes ago this didn't exist. Now it's yours to send.",
      duration_seconds: 14,
      target: "[data-dxo='deck-preview']",
      scroll: true,
    },
    // ── transition: open Solutions section ────────────────────────────────
    {
      id: "t3-open-solutions",
      title: "",
      narration: "",
      duration_seconds: 2.5,
      target: "text:Solutions",
      click: true,
      click_delay_ms: 1200,
    },
    // ── transition: expand Streamline card ────────────────────────────────
    {
      id: "t4-expand-streamline",
      title: "",
      narration: "",
      duration_seconds: 2.5,
      target: "#section-streamline",
      click: true,
      click_delay_ms: 1200,
    },
    // ── transition: expand XO card ────────────────────────────────────────
    {
      id: "t5-expand-xo",
      title: "",
      narration: "",
      duration_seconds: 2.5,
      target: "#section-xo",
      click: true,
      click_delay_ms: 1200,
    },
    // ── NOTE 3 ──── Streamline + XO (NARRATED, lands at Streamline) ──────
    {
      id: "step-3-streamline-xo",
      title: "Streamline and XO applications",
      narration:
        "Streamline runs the work. XO tells you who to call, what they care about, and how to open the conversation. Your competition is still guessing. You're not. That's the edge.",
      duration_seconds: 16,
      target: "#section-streamline",
      scroll: true,
    },
    // ── transition: navigate to Technical Section ─────────────────────────
    {
      id: "t6-nav-tech",
      title: "",
      narration: "",
      duration_seconds: 2.5,
      target: "text:Technical Section",
      click: true,
      click_delay_ms: 1200,
    },
    // ── NOTE 4 ──── Architecture (NARRATED) ──────────────────────────────
    {
      id: "step-4-architecture",
      title: "The architecture diagram",
      narration:
        "You walk in knowing what they run, where the gaps are, and where you fit. Not guesses — the actual map. And from this map to deployed? Weeks, not quarters. That's not luck. That's leverage.",
      duration_seconds: 14,
      target: "[data-dxo='architecture-slide']",
      scroll: true,
    },
    // ── transition: navigate to Enrich ────────────────────────────────────
    {
      id: "t7-nav-enrich",
      title: "",
      narration: "",
      duration_seconds: 2.5,
      target: "text:Enrich",
      click: true,
      click_delay_ms: 1200,
    },
    // ── NOTE 5 ──── Engine / Enrichment (NARRATED) ───────────────────────
    {
      id: "step-5-enrich",
      title: "Data Enrichment",
      narration:
        "Behind all of it, the Intellagentic Engine. A week of research collapsed into minutes. It reads everything, throws away the noise, and hands you the signal. The unfair advantage you've been wishing for.",
      duration_seconds: 14,
      target: "[data-dxo='enrichment-results']",
      scroll: true,
    },
    // ── transition: navigate to Your Data ─────────────────────────────────
    {
      id: "t8-nav-your-data",
      title: "",
      narration: "",
      duration_seconds: 2.5,
      target: "text:Your Data",
      click: true,
      click_delay_ms: 1200,
    },
    // ── NOTE 6 ──── Upload (NARRATED) ────────────────────────────────────
    {
      id: "step-6-upload",
      title: "Upload",
      narration:
        "Anything you've got. Call notes. Transcripts. That LinkedIn deep-dive you did at midnight. The Engine reads all of it. Nothing you've already learned gets wasted.",
      duration_seconds: 12,
      target: "text:Upload",
      scroll: true,
    },
    // ── transition: back to Welcome ──────────────────────────────────────
    {
      id: "t9-nav-welcome",
      title: "",
      narration: "",
      duration_seconds: 2.5,
      target: "text:Welcome",
      click: true,
      click_delay_ms: 1200,
    },
    // ── NOTE 7 ──── Close (NARRATED, lands at top of Welcome) ────────────
    {
      id: "step-7-welcome-close",
      title: "IntellagenticXO — the end of guesswork",
      narration:
        "Back to where we started. Pick the prospect. Pick the engagement. Three minutes later you've got the deck, the architecture, the talking points, and the Engine ready to brief you for the call. No more drowning in noise. All signal. And what you sketch with them in the room? Live in weeks, not quarters. That's how you get the second meeting. And the third. IntellagenticXO — the end of guesswork.",
      duration_seconds: 30,
      target: "text:Domain Expertise",
      scroll: true,
      scrollToTop: true,
    },
  ],
};
