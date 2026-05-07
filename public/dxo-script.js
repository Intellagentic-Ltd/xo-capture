// =========================================================================
// XO Capture — dXO demo script
// =========================================================================
// v5.1 — 7 narrated beats in sales-voice. Throughlines: "signal from noise"
// (Aled Miles' framing) and "rapid deployment". Full tagline lands at close.
// Helper steps remain silent. Preflight is now VISIBLE (two short clicks)
// because the engine does not process meta.preflightClicks.
//
// LOAD ORDER
//   This file is loaded unconditionally by index.html. It sets
//   window.DXO_SCRIPT. The dxo.js engine reads that global on bootstrap.
//   Bootstrap is gated on the "Sign Out" sidebar text being present,
//   so the panel does not appear until the user is signed in.
//
// SCOPE NOTES
//   - Demo client is "Mayo Clinic" — change step-pre-mayo to swap.
//   - Preflight is visible (not silent). Two short clicks land the
//     operator on Mayo's Welcome page before the narrated walkthrough
//     begins. v5.0 attempted silent preflight via meta.preflightClicks;
//     dxo.js doesn't process that field, so v5.1 uses real steps.
//   - The 7 NARRATED steps (1, 4, 7, 10, 13, 16, 19) correspond directly
//     to Ken's 7 notes. Other steps are silent helpers (no narration,
//     short duration, click + scroll as needed).
//
// NOTE-TO-STEP MAP
//   Note 1  -> step-1-welcome           (signal from noise; first -> second meeting)
//   Note 2  -> step-4-deck              (the deck you'd love to walk in with)
//   Note 3  -> step-7-streamline-xo     (Streamline + XO; "your competition is guessing")
//   Note 4  -> step-10-architecture     (architecture; weeks not quarters)
//   Note 5  -> step-13-enrich           (Intellagentic Engine; signal vs noise)
//   Note 6  -> step-16-upload           (contextual data, any format)
//   Note 7  -> step-19-welcome-close    (tagline close)
//
// THROUGHLINES
//   * Signal from noise — Aled Miles' phrase. Lands hook -> engine -> close.
//   * Rapid deployment — "weeks not quarters". Lands deck -> architecture -> close.
//   * IntellagenticXO — the end of guesswork — full tagline lands ONCE,
//     at the very close, as the last words.
// =========================================================================
window.DXO_SCRIPT = {
  meta: {
    name: "XO Capture — dXO walkthrough (v5.1)",
    estimated_duration_minutes: 2.75,
    demo_client: "Mayo Clinic",
    audience: ["go-to-market", "solutions-engineering"],
    version: "5.1.0",
    notes: "v5.1: sales-voice rewrite of the 7 narrated beats. Throughlines: signal from noise (lands hook/engine/close) and rapid deployment (lands deck/architecture/close). Full tagline 'IntellagenticXO — the end of guesswork' lands once, at close. Visible preflight replaces v5.0's silent preflightClicks (engine doesn't support that field). Sum of step durations = 2m12s; estimated wall-clock ~2:30-3:00 with engine overhead.",
  },
  steps: [
    // ── PREFLIGHT (visible, silent) ───────────────────────────────────────
    {
      id: "step-pre-mayo",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "text:Mayo Clinic",
      click: true,
      click_delay_ms: 1200,
    },
    {
      id: "step-pre-welcome",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "text:Welcome",
      click: true,
      click_delay_ms: 1200,
    },
    // ── NOTE 1 ────────────────────────────────────────────────────────────
    {
      id: "step-1-welcome",
      title: "Welcome",
      narration:
        "Every prospect is a mountain of noise. CRM, news, transcripts, LinkedIn. XO Capture pulls the signal out. That's how you turn first meetings into second ones.",
      duration_seconds: 10,
      target: "text:Domain Expertise",
      scroll: true,
    },
    // ── helpers: navigate to Results ──────────────────────────────────────
    {
      id: "step-2-nav-results",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "text:Results",
      click: true,
      click_delay_ms: 1200,
    },
    {
      id: "step-3-results-settle",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "[data-dxo='results-page']",
      scroll: true,
    },
    // ── NOTE 2 ────────────────────────────────────────────────────────────
    {
      id: "step-4-deck",
      title: "The deck",
      narration:
        "The deck you'd love to walk in with. Their business, their pain, where you fit — already in slides. Three minutes ago this didn't exist. Now it's yours to send.",
      duration_seconds: 12,
      target: "text:Growth Deck",
      click: true,
      click_delay_ms: 1500,
      scroll: true,
    },
    // ── helpers: open Solutions, expand Streamline + XO cards ─────────────
    {
      id: "step-5-open-solutions",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "text:Solutions",
      click: true,
      click_delay_ms: 1200,
    },
    {
      id: "step-6-expand-streamline",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "#section-streamline",
      click: true,
      click_delay_ms: 1200,
    },
    // ── NOTE 3 ────────────────────────────────────────────────────────────
    {
      id: "step-7-streamline-xo",
      title: "Streamline and XO applications",
      narration:
        "Streamline runs the work. XO tells you who to call, what they care about, and how to open the conversation. Your competition is still guessing. You're not. That's the edge.",
      duration_seconds: 14,
      target: "#section-xo",
      click: true,
      click_delay_ms: 1500,
      scroll: true,
    },
    // ── helpers: get to architecture ──────────────────────────────────────
    {
      id: "step-8-nav-tech",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "text:Technical Section",
      click: true,
      click_delay_ms: 1200,
    },
    {
      id: "step-9-arch-settle",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "[data-dxo='architecture-slide']",
      scroll: true,
    },
    // ── NOTE 4 ────────────────────────────────────────────────────────────
    {
      id: "step-10-architecture",
      title: "The architecture diagram",
      narration:
        "You walk in knowing what they run, where the gaps are, and where you fit. Not guesses — the actual map. And from this map to deployed? Weeks, not quarters. That's not luck. That's leverage.",
      duration_seconds: 14,
      target: "[data-dxo='architecture-slide']",
      scroll: true,
    },
    // ── helpers: navigate to Enrich, open info modal ──────────────────────
    {
      id: "step-11-nav-enrich",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "text:Enrich",
      click: true,
      click_delay_ms: 1200,
    },
    {
      id: "step-12-enrich-info",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "[data-dxo='enrichment-results']",
      scroll: true,
    },
    // ── NOTE 5 ────────────────────────────────────────────────────────────
    {
      id: "step-13-enrich",
      title: "Data Enrichment",
      narration:
        "Behind all of it, the Intellagentic Engine. A week of research collapsed into minutes. It reads everything, throws away the noise, and hands you the signal. The unfair advantage you've been wishing for.",
      duration_seconds: 14,
      target: "[data-dxo='enrichment-results']",
      scroll: true,
    },
    // ── helpers: navigate to Your Data ────────────────────────────────────
    {
      id: "step-14-nav-your-data",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "text:Your Data",
      click: true,
      click_delay_ms: 1200,
    },
    {
      id: "step-15-your-data-settle",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "text:Upload",
      scroll: true,
    },
    // ── NOTE 6 ────────────────────────────────────────────────────────────
    {
      id: "step-16-upload",
      title: "Upload",
      narration:
        "Anything you've got. Call notes. Transcripts. That LinkedIn deep-dive you did at midnight. The Engine reads all of it. Nothing you've already learned gets wasted.",
      duration_seconds: 10,
      target: "text:Upload",
      scroll: true,
    },
    // ── helpers: back to Welcome ──────────────────────────────────────────
    {
      id: "step-17-nav-welcome",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "text:Welcome",
      click: true,
      click_delay_ms: 1200,
    },
    {
      id: "step-18-welcome-settle",
      title: "",
      narration: "",
      duration_seconds: 2,
      target: "text:Domain Expertise",
      scroll: true,
    },
    // ── NOTE 7 ────────────────────────────────────────────────────────────
    {
      id: "step-19-welcome-close",
      title: "IntellagenticXO — the end of guesswork",
      narration:
        "Back to where we started. Pick the prospect. Pick the engagement. Three minutes later you've got the deck, the architecture, the talking points, and the Engine ready to brief you for the call. No more drowning in noise. All signal. And what you sketch with them in the room? Live in weeks, not quarters. That's how you get the second meeting. And the third. IntellagenticXO — the end of guesswork.",
      duration_seconds: 30,
      target: "text:Domain Expertise",
      scroll: true,
    },
  ],
};
