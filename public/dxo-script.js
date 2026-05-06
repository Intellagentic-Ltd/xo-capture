// =========================================================================
// XO Capture — dXO demo script
// =========================================================================
// v4.4 — Mayo Clinic demo client, four-section spine.
// Visual walkthrough only. Ask-box / query interactions deferred.
//
// LOAD ORDER
//   This file is loaded unconditionally by index.html. It sets
//   window.DXO_SCRIPT. The dxo.js engine reads that global on bootstrap.
//   Bootstrap is gated on the dashboard-header anchor being present, so
//   the panel does not appear until the user is signed in.
//
// SCOPE NOTES
//   - xo-capture holds the active client in React state, not in URL.
//     Navigation is click-driven: click the demo client row to enter
//     the workspace, click sidebar items to switch tabs.
//   - Demo client is "Mayo Clinic" — substitute by editing this file
//     if a different client is preferred.
//   - Four content sections are the spine: Opportunities, Problems,
//     Streamline applications, XO applications. Each gets its own
//     highlight step. Section selectors use the engine's `text:`
//     prefix; if matching is unreliable, follow up by adding explicit
//     data-dxo anchors in App.jsx and switching the targets here.
//   - prototype-spec.md step removed per Ken (not part of the demo).
// =========================================================================

window.DXO_SCRIPT = {
  meta: {
    name: "XO Capture — dXO walkthrough",
    estimated_duration_minutes: 6.5,
    demo_client: "Mayo Clinic",
    audience: ["go-to-market", "solutions-engineering"],
    version: "4.4.0",
    notes: "v4.4: Mayo Clinic demo client; four-section spine; spec step removed; auth-gated bootstrap.",
  },

  steps: [
    {
      id: "step-1-state",
      title: "What XO Capture is doing right now",
      narration:
        "Before I show you any features, here's the state of the work. Real clients moving through the loop you're about to see — capture, enrich, ship. Let me drop into one.",
      duration_seconds: 12,
      target: "[data-dxo='dashboard-header']",
      scroll: false,
    },
    {
      id: "step-2-open-client",
      title: "Opening Mayo Clinic",
      narration:
        "Mayo Clinic.",
      duration_seconds: 4,
      target: "text:Mayo Clinic",
      click: true,
      click_delay_ms: 1500,
    },
    {
      id: "step-3-results-page",
      title: "The Results page",
      narration:
        "This is the live Results page — the artefact your prospect actually receives. Citation-linked, so every claim traces back to its source document. URL not PDF, so when the corpus updates, the page updates with it. This replaces the deck-and-email loop your AEs run today.",
      duration_seconds: 40,
      target: "[data-dxo='results-page']",
      scroll: true,
    },
    {
      id: "step-4-problems",
      title: "Problems",
      narration:
        "Start with what's actually in the way. The Problems section surfaces the structural gaps the analysis uncovered, ranked by severity, each linked to the evidence in the corpus. This is the part of the work your prospect already half-knows but hasn't put on a single page.",
      duration_seconds: 35,
      target: "text:Problems Identified",
      scroll: true,
    },
    {
      id: "step-5-opportunities",
      title: "Opportunities",
      narration:
        "Against those problems, the upside. Where the unblocked revenue is. Where the throughput is. Specific opportunities the prospect can act on, framed in their own language — not ours.",
      duration_seconds: 30,
      target: "text:Opportunities List",
      scroll: true,
    },
    {
      id: "step-6-streamline",
      title: "Streamline applications",
      narration:
        "First the off-the-shelf fits. Streamline applications — products from our portfolio that map directly onto the problems above, deployable in a sprint. No bespoke build, no integration risk, no waiting six months. The cheapest, fastest path to value.",
      duration_seconds: 40,
      target: "text:Streamline",
      scroll: true,
    },
    {
      id: "step-7-xo",
      title: "XO applications",
      narration:
        "Where Streamline doesn't reach, XO does. Bespoke builds, scoped to the exact problems on this page. Each one tied to evidence, each one with a deployment plan, each one buildable in days from the spec we generate. This is where the deal value compounds.",
      duration_seconds: 40,
      target: "text:XO",
      scroll: true,
    },
    {
      id: "step-8-deck",
      title: "The deck",
      narration:
        "Same content, repackaged for the format your sponsor still forwards to their CFO. Tied to the same enrichment run, so the deck and the Results page can never drift.",
      duration_seconds: 25,
      target: "[data-dxo='deck-preview']",
      scroll: true,
    },
    {
      id: "step-9-architecture",
      title: "The architecture diagram",
      narration:
        "The slide that decides whether we win the deal. Streamline products on one side, XO bespoke builds on the other, the prospect's existing stack underneath, data flows drawn explicitly. A solutions engineer reads this in thirty seconds and knows whether the proposal is buildable. We don't hand-draw these — XO generates them from the corpus.",
      duration_seconds: 45,
      target: "[data-dxo='architecture-slide']",
      scroll: true,
    },
    {
      id: "step-10-brief",
      title: "The executive brief",
      narration:
        "Three pages, no jargon — the version their MD reads on the way to a board meeting. Same canonical narrative, compressed.",
      duration_seconds: 25,
      target: "[data-dxo='brief-download']",
      scroll: true,
    },
    {
      id: "step-11-open-enrich",
      title: "Switching to Enrich",
      narration:
        "Now the evidence chain.",
      duration_seconds: 4,
      target: "text:Enrich",
      click: true,
      click_delay_ms: 1500,
    },
    {
      id: "step-12-enrichment",
      title: "What's behind the artefacts",
      narration:
        "Three panels worth knowing. Entities — every counterparty, instrument, exposure the prospect touches. Key facts — extracted, deduplicated, ranked, each citation-linked. Anomalies — places where the corpus contradicts itself. Anomalies are usually the most valuable, because that's where your next discovery question comes from. None of this is a black box.",
      duration_seconds: 45,
      target: "[data-dxo='enrichment-results']",
      scroll: true,
    },
    {
      id: "step-13-open-configuration",
      title: "Switching to Configuration",
      narration:
        "And one more layer beneath that — where the data comes from in the first place.",
      duration_seconds: 4,
      target: "text:Configuration",
      click: true,
      click_delay_ms: 1500,
    },
    {
      id: "step-14-data-sources",
      title: "Where the data comes from",
      narration:
        "Two layers. Organisational data — accounts, contacts, deals, ownership — synced from the prospect's CRM. HubSpot here; configurable for Salesforce, Pipedrive, Dynamics, anything with a stable contract. You don't move CRMs to use XO. On top of the CRM spine, the document corpus — call transcripts, internal product docs, policies, recent reports. Every fact in every output above traces back to one of these sources.",
      duration_seconds: 50,
      target: "[data-dxo='data-sources']",
      scroll: true,
    },
  ],
};
