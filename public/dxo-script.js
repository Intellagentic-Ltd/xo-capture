// =========================================================================
// XO Capture — dXO demo script (MFP Trading)
// =========================================================================
// v4.3 — selectors resolved against xo-capture src/App.jsx.
// Visual walkthrough only. Ask-box / query interactions deferred.
//
// LOAD ORDER
//   This file is loaded unconditionally by index.html. It sets
//   window.DXO_SCRIPT. The dxo.js engine reads that global on load
//   (when ?dxo=1 triggers the engine to be injected).
//
// SCOPE NOTES
//   - xo-capture holds the active client in React state, not in the URL
//     path. `navigate: "/clients/<id>/results"` does NOT resolve to a
//     route — the app falls back to the welcome screen. v4.2 dropped the
//     navigate field on every step that previously relied on it and
//     replaced it with click-driven prep steps:
//       * click the MFP Trading row to enter that client's workspace
//         (Results is the default tab on entry)
//       * click Enrich / Configuration in the sidebar to switch tabs
//   - Selectors prefixed with `data-dxo` are anchors in src/App.jsx
//     (added in PR #61). Sidebar / row targets use the engine's `text:`
//     prefix, which finds the smallest element containing the text.
//   - v4.3 swaps generic narration phrases for real specifics from
//     MFP Trading's executive summary: $4.5B daily FX volume, Asian
//     session expansion, the Francois/Lisa two-person pyramid, the
//     $50K-$100K per-event cost, the five exception types Lisa Murphy
//     defined on April 10, 2026.
//   - Engagement / enrichment counts are intentionally absent from
//     narration — they are not the point of the demo and dating them
//     locks the script to a baseline.
// =========================================================================

window.DXO_SCRIPT = {
  meta: {
    name: "XO Capture — dXO walkthrough (MFP Trading)",
    estimated_duration_minutes: 6.8,
    demo_client: "MFP Trading",
    audience: ["go-to-market", "solutions-engineering"],
    version: "4.3.0",
    notes: "v4.3: click-driven nav + real MFP specifics in narration; engagement counts removed.",
  },

  steps: [
    {
      id: "step-1-workload-state",
      title: "What XO Capture is doing right now",
      narration:
        "Before I show you any features, here's the state of the work. Real clients running the loop you're about to see — capture, enrich, ship. I'll narrow in on one of them, MFP Trading.",
      duration_seconds: 12,
      target: "[data-dxo='dashboard-header']",
      scroll: false,
    },
    {
      id: "step-1b-open-mfp",
      title: "Opening MFP Trading",
      narration:
        "Let me drop into MFP Trading.",
      duration_seconds: 5,
      target: "text:MFP Trading",
      click: true,
      click_delay_ms: 1500,
    },
    {
      id: "step-2-results-page",
      title: "The Results page",
      narration:
        "MFP Trading. Open in front of you is the live Results page — the artefact your prospect actually receives. Citation-linked, so every claim traces back to its source document. URL not PDF, so when the corpus updates, the page updates with it. This replaces the deck-and-email loop your AEs run today.",
      duration_seconds: 50,
      target: "[data-dxo='results-page']",
      scroll: true,
    },
    {
      id: "step-3-deck-commercial",
      title: "The deck — the commercial story",
      narration:
        "Same content as the Results page, repackaged for the format your sponsor still forwards to their CFO. Opportunities — Asian session expansion, blocked today because $4.5 billion in daily FX volume runs through a two-person trade support pyramid. Problems — Francois Nembrini and Lisa Murphy fielding every high-risk escalation personally, where one mismanaged timeout, DSU, or credit alert costs fifty to a hundred thousand dollars in seconds. Streamline applications — the off-the-shelf products from our portfolio that fit, deployable in a sprint. XO applications — the bespoke builds where Streamline doesn't, the credit-exception POC for MFP being one of five. Every slide tied to the same enrichment run, so the deck and the Results page can never drift.",
      duration_seconds: 75,
      target: "[data-dxo='deck-preview']",
      scroll: true,
    },
    {
      id: "step-4-deck-architecture",
      title: "The architecture diagram",
      narration:
        "This is the slide that decides whether we win the deal. Both worlds composed — Streamline products on one side, XO bespoke builds on the other, MFP's existing stack underneath, the data flows drawn explicitly. A solutions engineer reads this in thirty seconds and knows whether the proposal is buildable. We don't hand-draw these. XO generates them from the corpus, and they stay consistent across the deck, the brief, and the prototype spec. Take a moment.",
      duration_seconds: 60,
      target: "[data-dxo='architecture-slide']",
      scroll: true,
    },
    {
      id: "step-5-brief",
      title: "The executive brief",
      narration:
        "Three pages, no jargon, the version their MD reads on the way to a board meeting. Same canonical narrative as the Results page and the deck, compressed.",
      duration_seconds: 30,
      target: "[data-dxo='brief-download']",
      scroll: true,
    },
    {
      id: "step-6-prototype-spec",
      title: "prototype-spec.md",
      narration:
        "And the artefact that changes the unit economics. prototype-spec.md is a structured engineering handoff — scope, success criteria, data contracts, integration points — pre-written by XO from everything in the corpus. Drops straight into a Claude Code or Cursor session and the build starts. For MFP, this spec took the credit-exception POC from concept to deployed code in a working week.",
      duration_seconds: 45,
      target: "[data-dxo='prototype-spec']",
      scroll: true,
    },
    {
      id: "step-6b-open-enrich",
      title: "Switching to Enrich",
      narration:
        "Now the evidence chain behind all of that.",
      duration_seconds: 5,
      target: "text:Enrich",
      click: true,
      click_delay_ms: 1500,
    },
    {
      id: "step-7-enrichment",
      title: "Working backward — what's behind the artefacts",
      narration:
        "Three panels worth knowing. Entities — every counterparty, instrument, exposure MFP touches, including the five exception types Lisa Murphy defined on April 10: credit alerts, timeouts, DSUs, unapproved counterparty trades, unreported trades. Key facts — extracted, deduplicated, ranked, each citation-linked. Anomalies — places where the corpus contradicts itself. Anomalies are usually the most valuable part, because that's where your next discovery question comes from. None of this is a black box.",
      duration_seconds: 50,
      target: "[data-dxo='enrichment-results']",
      scroll: true,
    },
    {
      id: "step-7b-open-configuration",
      title: "Switching to Configuration",
      narration:
        "And one more layer beneath that — where the data comes from in the first place.",
      duration_seconds: 5,
      target: "text:Configuration",
      click: true,
      click_delay_ms: 1500,
    },
    {
      id: "step-8-data-sources",
      title: "Where the data comes from",
      narration:
        "Two layers. Organisational data — accounts, contacts, deals, ownership — synced from HubSpot. Configurable for Salesforce, Pipedrive, Dynamics, anything with a stable contract. You don't move CRMs to use XO. On top of the CRM spine, the document corpus — call transcripts, internal product docs, the existing risk policy, the client's last three quarterly reports for MFP. Every fact in every output above traces back to one of these sources.",
      duration_seconds: 55,
      target: "[data-dxo='data-sources']",
      scroll: true,
    },
  ],
};
