// =========================================================================
// XO Capture — dXO demo script (MFP Trading)
// =========================================================================
// v4.1 — selectors resolved against xo-capture src/App.jsx where possible.
// Visual walkthrough only. Ask-box / query interactions deferred.
//
// LOAD ORDER
//   This file is loaded unconditionally by index.html. It sets
//   window.DXO_SCRIPT. The dxo.js engine reads that global on load
//   (when ?dxo=1 triggers the engine to be injected).
//
// SCOPE NOTES
//   - Step 2 uses `navigate` (direct URL) rather than `find_case` to avoid
//     touching the engine's findCaseAndNavigate, which targets MFP's
//     /api/exceptions endpoint that xo-capture doesn't expose.
//     Replace {{MFP_TRADING_CLIENT_ID}} with the real client_id.
//   - Selectors prefixed with data-dxo are anchors added in this PR
//     (App.jsx). Selectors flagged // CONFIRM need DevTools verification
//     against the live UI.
//   - {{N_*}} counters and {{MFP_TRADING_CLIENT_ID}} are placeholders for
//     real seed-data / IDs Ken will fill in before recording.
// =========================================================================

window.DXO_SCRIPT = {
  meta: {
    name: "XO Capture — dXO walkthrough (MFP Trading)",
    estimated_duration_minutes: 6.7,
    demo_client: "MFP Trading",
    audience: ["go-to-market", "solutions-engineering"],
    version: "4.1.0",
    notes: "v4.1 ports against real xo-capture source — Vite app with src/App.jsx, no /api/exceptions endpoint.",
  },

  steps: [
    {
      id: "step-1-workload-state",
      title: "What XO Capture is doing right now",
      narration:
        "Before I show you any features, here's the state of the work. {{N_ENGAGEMENTS}} live client engagements. {{N_ENRICHED}} fully enriched. {{N_SHIPPED_SPECS}} have already shipped a prototype-spec.md to engineering. That's the loop you're about to see — capture, enrich, ship — running on real clients today. I'll narrow in on one of them, MFP Trading.",
      duration_seconds: 25,
      highlight: "[data-dxo='dashboard-header']",
      scroll: false,
    },
    {
      id: "step-2-results-page",
      title: "The Results page",
      narration:
        "MFP Trading. Open in front of you is the live Results page — the artefact your prospect actually receives. Citation-linked, so every claim traces back to its source document. URL not PDF, so when the corpus updates, the page updates with it. This replaces the deck-and-email loop your AEs run today.",
      duration_seconds: 50,
      navigate: "/clients/{{MFP_TRADING_CLIENT_ID}}/results",
      highlight: ".results-page, [data-dxo='results-page']",
      scroll: true,
    },
    {
      id: "step-3-deck-commercial",
      title: "The deck — the commercial story",
      narration:
        "Same content as the Results page, repackaged for the format your sponsor still forwards to their CFO. We move through it: opportunities — where MFP's revenue is leaking and where the upside sits. Problems — what's actually in the way. Streamline applications — the off-the-shelf products from our portfolio that fit, deployable in a sprint. XO applications — the bespoke builds where Streamline doesn't, the credit-exception POC for MFP being one. Every slide tied to the same enrichment run, so the deck and the Results page can never drift.",
      duration_seconds: 70,
      highlight: "[data-dxo='deck-preview']",
      scroll: true,
    },
    {
      id: "step-4-deck-architecture",
      title: "The architecture diagram",
      narration:
        "This is the slide that decides whether we win the deal. Both worlds composed — Streamline products on one side, XO bespoke builds on the other, MFP's existing stack underneath, the data flows drawn explicitly. A solutions engineer reads this in thirty seconds and knows whether the proposal is buildable. We don't hand-draw these. XO generates them from the corpus, and they stay consistent across the deck, the brief, and the prototype spec. Take a moment.",
      duration_seconds: 60,
      highlight: "[data-dxo='architecture-slide']",
      scroll: true,
    },
    {
      id: "step-5-brief",
      title: "The executive brief",
      narration:
        "Three pages, no jargon, the version their MD reads on the way to a board meeting. Same canonical narrative as the Results page and the deck, compressed.",
      duration_seconds: 30,
      highlight: "[data-dxo='brief-download']",
      scroll: true,
    },
    {
      id: "step-6-prototype-spec",
      title: "prototype-spec.md",
      narration:
        "And the artefact that changes the unit economics. prototype-spec.md is a structured engineering handoff — scope, success criteria, data contracts, integration points — pre-written by XO from everything in the corpus. Drops straight into a Claude Code or Cursor session and the build starts. For MFP, this spec took the credit-exception POC from concept to deployed code in a working week.",
      duration_seconds: 45,
      highlight: "[data-dxo='prototype-spec']",
      scroll: true,
    },
    {
      id: "step-7-enrichment",
      title: "Working backward — what's behind the artefacts",
      narration:
        "Now the evidence chain. Three panels worth knowing. Entities — every counterparty, instrument, exposure MFP touches. Key facts — extracted, deduplicated, ranked, each citation-linked. Anomalies — places where the corpus contradicts itself. Anomalies are usually the most valuable part, because that's where your next discovery question comes from. None of this is a black box.",
      duration_seconds: 45,
      navigate: "/clients/{{MFP_TRADING_CLIENT_ID}}/enrich",
      highlight: "[data-dxo='enrichment-results']",
      scroll: true,
    },
    {
      id: "step-8-data-sources",
      title: "Where the data comes from",
      narration:
        "Two layers. Organisational data — accounts, contacts, deals, ownership — synced from HubSpot. Configurable for Salesforce, Pipedrive, Dynamics, anything with a stable contract. You don't move CRMs to use XO. On top of the CRM spine, the document corpus — call transcripts, internal product docs, the existing risk policy, the client's last three quarterly reports for MFP. Every fact in every output above traces back to one of these sources.",
      duration_seconds: 55,
      highlight: "[data-dxo='data-sources']",
      scroll: true,
    },
    {
      id: "step-9-consequence-engine",
      title: "Why XO recommended this build",
      narration:
        "One last thing. On MFP's recommendation card, this panel — the Consequence Engine trace — shows the prior cases XO's reasoning drew from when it recommended building rather than buying off-the-shelf. Three prior cases, each with timestamps and outcomes. This is the moat. Generic LLM tools retrieve. XO reasons, and shows its work.",
      duration_seconds: 50,
      highlight: "[data-dxo='consequence-engine']",
      scroll: true,
    },
  ],
};
