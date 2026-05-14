/**
 * XO Platform - Deck Download Lambda (Node.js 20)
 * POST /results/{id}/deck — Generates branded 8-slide Growth Deck (.pptx)
 *
 * Architecture (synchronous — same pattern as xo-brief-download):
 *   1. Invoke xo-results Lambda to get analysis results
 *   2. assembleDeckData() maps analysis JSON to slide-ready data (pure JS, no AI)
 *   3. PptxGenJS builds 8 slides using the Intellagentic brand template
 *   4. Return base64 .pptx in JSON response
 */

const pptxgen = require("pptxgenjs");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const REGION = "eu-west-2";

// ── Brand Colours (no #) ──
const NAVY = "1B2A4A";
const BLUE = "2E75B6";
const RED = "C0392B";
const WHITE = "FFFFFF";
const LIGHT_BG = "EDF2F8";
const GREY = "555555";
const DARK_BG = "0F1419";
const CARD_BG = "1A2030";
const NEAR_WHITE = "F0F4F8";
const GREEN = "27AE60";

// ── Shadow Factories ──
const makeShadow = () => ({ type: "outer", blur: 8, offset: 3, angle: 135, color: "000000", opacity: 0.18 });
const makeCardShadow = () => ({ type: "outer", blur: 6, offset: 2, angle: 135, color: "000000", opacity: 0.25 });

// ── CORS ──
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

// ── Helper: strip markdown artifacts (**bold**, *italic*, leading "1. ", "Problem: " prefixes) ──
function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")  // strip ** and *
    .replace(/^#+\s+/gm, "")                    // strip ### headings
    .replace(/^(?:Problem|Workflow|Outcome|Solution|Issue):\s*/i, "")  // strip known prefixes
    .replace(/^\d+\.\s*/, "")                    // strip leading "1. "
    .trim();
}

// ── Helper: first sentence — skips "1." style numbering, finds real sentence end ──
function firstSentence(text, maxLen) {
  if (!text) return "";
  const cleaned = cleanText(text);
  // Match up to the first sentence-ending period that follows a word (not a number like "1.")
  const m = cleaned.match(/^((?:[^.!?\n]|\.(?=\d))+[.!?]?)/);
  let s = m ? m[1].trim() : cleaned.substring(0, 120).trim();
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen).replace(/\s+\S*$/, "");
  return s;
}

// ── Helper: truncate to N chars at word boundary (with ellipsis) ──
function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text || "";
  return text.substring(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

// ── Helper: truncate to N chars at word boundary (clean cut, no ellipsis) ──
function truncateClean(text, maxLen) {
  if (!text || text.length <= maxLen) return text || "";
  return text.substring(0, maxLen).replace(/\s+\S*$/, "");
}

// ── Helper: clean plan item — strip [Tags], strip after first colon, truncate to 60 ──
function cleanPlanItem(text) {
  let s = cleanText(text);
  s = s.replace(/\[.*?\]\s*/g, "");       // strip [XO Setup], [Streamline Setup], etc.
  s = s.replace(/:.*$/, "").trim();        // strip everything after first colon
  return truncateClean(s, 60);
}

// ── Helper: parse streamline_applications markdown into {title, desc} workflow objects ──
// Expected format: sections starting with "**N. Title**" or "**Title**" followed by lines like
// "Problem: ...", "Workflow: ...", "Outcome: ..."
function parseWorkflows(md, count) {
  if (!md) return [];
  const items = [];

  // Split on bold section headers: **1. Title** or **Title**
  const sections = md.split(/\*\*\d*\.?\s*/);
  for (const section of sections) {
    if (!section.trim()) continue;
    // The title is everything before the closing **
    const titleEnd = section.indexOf("**");
    if (titleEnd < 0) continue;
    const title = section.substring(0, titleEnd).trim();
    // Skip intro paragraphs (no title-like content or too long for a title)
    if (!title || title.length > 80 || title.includes("\n")) continue;

    const body = section.substring(titleEnd + 2).trim();
    // Extract a clean description: prefer "Workflow:" or "Outcome:" line, else first line
    let desc = "";
    const workflowLine = body.match(/(?:Workflow|Outcome|Solution):\s*(.+)/i);
    if (workflowLine) {
      desc = cleanText(workflowLine[1]);
    } else {
      const firstLine = body.split("\n").find(l => l.trim() && !l.trim().startsWith("Problem:"));
      desc = cleanText(firstLine || "");
    }

    items.push({ title: cleanText(title), desc: firstSentence(desc, 120) });
    if (items.length >= count) break;
  }

  // Pad with generic workflow titles if fewer found
  const generics = [
    { title: "Document Intelligence", desc: "Automated extraction and classification of operational documents" },
    { title: "Compliance Monitoring", desc: "Continuous scanning against regulatory requirements" },
    { title: "Decision Support", desc: "Evidence-based recommendations bounded by domain rules" },
    { title: "Workflow Automation", desc: "Protocol-driven task execution with audit trail" },
    { title: "Knowledge Capture", desc: "Encoding institutional expertise into reusable protocols" },
    { title: "Performance Analytics", desc: "Real-time operational dashboards for stakeholders" },
  ];
  while (items.length < count) {
    items.push(generics[items.length % generics.length]);
  }

  return items.slice(0, count);
}

// ── deriveShortLabel: produce a deck-friendly short label from a verbose engagement name ──
// Template title boxes are sized for short topic labels (~10-20 chars).
// Long descriptive engagement names ("Removing Bottlenecks - waiting for a human to notice")
// overflow every title and break adjectival body interpolations.
// Strategy: take the first segment before any em-dash/en-dash/colon/space-hyphen-space,
// cap to MAX_LABEL_CHARS by trimming on word boundaries.
const MAX_LABEL_CHARS = 22;
function deriveShortLabel(engagementName, industry) {
  if (!engagementName) return industry || "operations";
  const firstSegment = String(engagementName).split(/\s*[—–:]\s*|\s+-\s+/)[0].trim();
  if (firstSegment.length <= MAX_LABEL_CHARS) return firstSegment;
  const words = firstSegment.split(/\s+/);
  const acc = [];
  let len = 0;
  for (const w of words) {
    const next = len + (acc.length ? 1 : 0) + w.length;
    if (next > MAX_LABEL_CHARS) break;
    acc.push(w);
    len = next;
  }
  return acc.length > 0 ? acc.join(" ") : firstSegment.slice(0, MAX_LABEL_CHARS);
}

// ── assembleDeckData: pure JS mapping from analysis JSON to slide data ──
function assembleDeckData(results, engagementName) {
  const problems = results.problems || results.problems_identified || [];
  const plan = results.plan || results.action_plan || {};
  let planPhases = [];
  if (Array.isArray(plan)) planPhases = plan;
  else if (typeof plan === "object") planPhases = Object.entries(plan).map(([phase, actions]) => ({ phase, actions }));

  const clientName = results.company_name || "Client";
  const industry = results.industry || results.client_industry || "this domain";
  // Prefer an explicit short label (set by the capture form), fall back to derived label.
  // `scope` is used adjectivally on slides 3-8 — it MUST be short. The full `engagementName`
  // is only used on slide 1 (cover) where we auto-shrink the title font.
  const explicitShort = (results.engagement_short_label || "").trim();
  const scope = explicitShort || deriveShortLabel(engagementName, industry);
  const scopeCap = scope.charAt(0).toUpperCase() + scope.slice(1);
  const description = results.description || results.client_description || "";
  const contactName = results.client_contact || clientName;
  const bottomLine = results.bottom_line || "";
  const streamline = results.streamline_applications || "";
  const summary = results.summary || results.executive_summary || "";

  // Date
  let dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  if (results.analyzed_at) {
    try { dateStr = new Date(results.analyzed_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); } catch (e) {}
  }

  // Short name for slide titles
  const shortName = clientName.length > 20 ? clientName.split(/\s+/).slice(0, 2).join(" ") : clientName;

  // ── stats: 4 key metrics ──
  const highSev = problems.filter(p => (p.severity || "").toLowerCase() === "high").length;
  const medSev = problems.filter(p => (p.severity || "").toLowerCase() === "medium").length;
  const workflows = parseWorkflows(streamline, 6);
  const stats = [
    { num: String(problems.length), label: "Issues Identified", sub: `${highSev} high severity` },
    { num: highSev > 0 ? "HIGH" : medSev > 0 ? "MEDIUM" : "LOW", label: "Risk Level", sub: `${highSev} critical, ${medSev} moderate` },
    { num: String(workflows.length), label: "XO Workflows", sub: "Automated via Streamline" },
    { num: "21 days", label: "Proof of Concept", sub: "Capture → Prototype → Deploy" },
  ];

  // ── challenges: top 4 problems by severity ──
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...problems].sort((a, b) => (severityOrder[(a.severity || "low").toLowerCase()] || 3) - (severityOrder[(b.severity || "low").toLowerCase()] || 3));
  const challenges = sorted.slice(0, 4).map(p => ({
    title: truncateClean(cleanText(p.title || "Operational Gap"), 60),
    desc: firstSentence(p.evidence || p.description || p.recommendation || "", 150),
  }));

  // ── workflows: 6 {title, desc, accent} from streamline_applications ──
  const accentCycle = ["BLUE", "RED", "GREEN"];
  const workflowData = workflows.map((w, i) => ({
    title: truncate(w.title, 45),
    desc: truncate(w.desc, 120),
    accent: accentCycle[i % 3],
  }));

  // ── comparisons: 6 before/after pairs (max 60 chars each side) ──
  const comparisons = [];
  for (let i = 0; i < Math.min(6, Math.max(problems.length, workflows.length)); i++) {
    const prob = problems[i] || problems[problems.length - 1] || {};
    const wf = workflows[i] || workflows[workflows.length - 1] || {};
    comparisons.push({
      before: truncate(cleanText(prob.title || "Manual process with no audit trail"), 60),
      after: truncate(wf.title ? `Streamline + XO automates ${wf.title.toLowerCase()}` : "Protocol-driven automation with audit trail", 60),
    });
  }
  while (comparisons.length < 6) {
    comparisons.push({
      before: "Manual review with key-person dependency",
      after: "XO protocol-driven automation with audit trail",
    });
  }

  // ── phases: 3 weeks with 4 SHORT items each (max 80 chars per item) ──
  const phases = [];
  const weekTitles = ["Capture & Quick Wins", "Prototype & Validate", "Deploy & Decide"];
  for (let w = 0; w < 3; w++) {
    const pp = planPhases[w] || {};
    let items = [];
    if (Array.isArray(pp.actions)) {
      items = pp.actions.slice(0, 4).map(a => {
        const raw = typeof a === "string" ? a : a.action || a.description || a.title || String(a);
        return cleanPlanItem(raw);
      });
    } else if (typeof pp.actions === "string") {
      items = pp.actions.split(/[;\n]/).filter(s => s.trim()).slice(0, 4).map(s => cleanPlanItem(s));
    }
    const defaults = [
      [`Knowledge Abstraction — extract ${contactName}'s ${scope} expertise`, "Map current manual workflows", "Identify quick-win automations", "Baseline metrics for ROI measurement"],
      [`XO shadows live ${scope} operations — parallel run alongside manual process`, "Validate protocol accuracy with domain experts", "Iterate on constitutional safety rules", "Stakeholder review of prototype outputs"],
      [`Full ${scope} dashboard deployed to stakeholders`, "Operator training and handover", "Performance metrics vs baseline", "Evidence-based business case for full deployment"],
    ];
    while (items.length < 4) items.push(defaults[w][items.length]);
    phases.push({ week: `WEEK ${w + 1}`, title: cleanText(pp.phase || weekTitles[w]), items: items.slice(0, 4) });
  }

  // ── nextSteps ──
  const firstActions = planPhases[0]?.actions || [];
  const firstActionRaw = Array.isArray(firstActions) ? (typeof firstActions[0] === "string" ? firstActions[0] : firstActions[0]?.action || firstActions[0]?.description || "") : "";
  const firstAction = truncate(cleanText(firstActionRaw), 80);
  const nextSteps = [
    { num: "1", text: firstAction || `Share ${scope} operational data and system access for knowledge extraction` },
    { num: "2", text: `Week 1 quick win — first ${scope} workflow live within 7 days` },
    { num: "3", text: `21-day pilot — full ${scope} XO deployment to ${contactName}'s team` },
  ];

  // ── successMetric from bottom_line ──
  const successMetric = bottomLine
    ? truncate(firstSentence(bottomLine, 100), 100) + " Institutional knowledge encoded into protocol, not people."
    : "Key-person dependency resolved. Institutional knowledge encoded into protocol, not people.";

  // ── problemCallout ──
  const problemCallout = problems.length > 0
    ? `The cost of these ${problems.length} ${scope} gaps compounds as ${clientName} scales — each manual workaround adds latency, risk, and key-person dependency.`
    : `Operational ${scope} gaps compound as ${clientName} scales.`;

  // ── impactLine ──
  const impactLine = `Estimated ${problems.length > 3 ? "60" : "40"}% reduction in manual ${scope} operations as ${clientName} scales toward full deployment`;

  // ── Sector-specific text ──
  const constitutionalSafetyTitle = `Constitutional Safety — Why This Matters for ${shortName}'s ${scopeCap} Operations`;
  const constitutionalSafetyNote = `Within ${clientName}'s ${scope.toLowerCase()} workstream, a single unchecked decision can cascade into compliance failures, financial exposure, and reputational damage. XO's Two-Brain architecture (Actor + Critic), designed by Dr. Mabrouka Abuhmida, ensures every output is bounded by ${clientName}'s own domain rules — not advisory guidelines, but hard constitutional constraints with full audit trails.`;

  // ── OODA descriptions sector-specific (max 150 chars to fit 0.42h card) ──
  const oodaPhases = [
    { phase: "OBSERVE", desc: truncate(`24/7 sentinel scanning ${clientName}'s ${scope} data sources. Data gated by risk classification.`, 150) },
    { phase: "ORIENT", desc: truncate(`Mandatory decomposition — contextualises against ${scope} domain rules. Risks explicitly enumerated.`, 150) },
    { phase: "DECIDE", desc: truncate(`Executive framing — ranks actions, applies ${clientName}'s ${scope} governance rules. Post-governance validation.`, 150) },
    { phase: "ACT", desc: truncate(`Bounded execution via Streamline — ${contactName}'s ${scope} team authorises; system executes. Full audit trail.`, 150) },
  ];

  // Slide titles (4-7) use the SHORT label so they fit in fixed-size title boxes.
  // The full engagementName is only used on slide 1 (cover), which auto-shrinks its font.
  const hasLabel = Boolean(engagementName || explicitShort);
  return {
    title: engagementName ? `Operational Briefing:\nScaling ${clientName} — ${engagementName}` : `Operational Briefing:\nScaling ${clientName}`,
    contactLine: `Prepared for ${contactName}  |  ${dateStr}`,
    slideTitle: `Where ${shortName} Stands Today`,
    oodaTitle: shortName,
    shortLabel: scope,
    stats,
    challengeTitle: `The ${scopeCap} Challenge`,
    challenges,
    problemCallout,
    oodaPhases,
    maturityStart: `${shortName} starts at L1. You pull us forward as confidence builds.`,
    workflowTitle: hasLabel ? `${scopeCap} Workflows That Encode Institutional Knowledge` : "Workflows That Encode Institutional Knowledge",
    workflows: workflowData,
    beforeAfterTitle: hasLabel ? `${scopeCap}: From System of Record to System of Action` : "From System of Record to System of Action",
    comparisons: comparisons.slice(0, 6),
    impactLine,
    pocTitle: hasLabel ? `21-Day ${scopeCap} Proof of Concept` : "21-Day Proof of Concept",
    phases,
    nextSteps,
    successMetric,
    constitutionalSafetyTitle,
    constitutionalSafetyNote,
  };
}

// ── Slide Builders ──

function buildSlide1_Title(pres, data) {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  // Decorative corner shapes
  s.addShape(pres.shapes.RECTANGLE, { x: 6.5, y: 0, w: 3.5, h: 2.2, fill: { color: BLUE, transparency: 85 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 7.8, y: 0, w: 2.2, h: 1.2, fill: { color: RED, transparency: 85 } });

  // IntellagenticXO logo text
  s.addText([
    { text: "Intellagentic", options: { bold: true, color: WHITE, fontSize: 16 } },
    { text: "XO", options: { bold: true, color: RED, fontSize: 16 } },
  ], { x: 0.7, y: 0.5, w: 4, h: 0.5, margin: 0 });

  // Title — auto-shrink font by total length so verbose engagement names + long client
  // names don't overflow the 2.0in-tall title box and collide with the byline below.
  // At 36pt Georgia bold each line is ~0.55in, so the box fits ~3.5 lines.
  // Calibrated against: "Operational Briefing:\nScaling Hywel Dda University Health Board — Clinical Handoffs" (≈98 chars → 28pt).
  const titleStr = data.title || "";
  const titleLen = titleStr.length;
  const titleFontSize = titleLen > 90 ? 24 : titleLen > 65 ? 28 : titleLen > 50 ? 32 : 36;
  s.addText(titleStr, {
    x: 0.7, y: 1.5, w: 8, h: 2.0,
    fontSize: titleFontSize, fontFace: "Georgia", bold: true, color: WHITE,
    lineSpacingMultiple: 1.15, valign: "top", margin: 0,
  });



  // Red accent line
  s.addShape(pres.shapes.LINE, { x: 0.7, y: 3.8, w: 2.5, h: 0, line: { color: RED, width: 3 } });

  // Briefing positioning phrase
  s.addText("You are the domain experts. This is our take on status and next steps.", {
    x: 0.7, y: 3.95, w: 7, h: 0.4,
    fontSize: 12, fontFace: "Arial", italic: true, color: "B0BEC5", margin: 0,
  });

  // Contact + date
  s.addText(data.contactLine, {
    x: 0.7, y: 4.5, w: 6, h: 0.4,
    fontSize: 13, fontFace: "Arial", color: NEAR_WHITE, margin: 0,
  });

  // Confidential
  s.addText("CONFIDENTIAL", {
    x: 0.7, y: 5.1, w: 3, h: 0.35,
    fontSize: 10, fontFace: "Arial", italic: true, color: GREY,
  });
}

function buildSlide2_StatusChallenges(pres, data) {
  const s = pres.addSlide();
  s.background = { color: WHITE };

  // Slide number badge
  s.addShape(pres.shapes.OVAL, { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fill: { color: NAVY } });
  s.addText("01", { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fontSize: 12, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });

  // Slide title
  s.addText(data.slideTitle, {
    x: 1.15, y: 0.3, w: 7, h: 0.55,
    fontSize: 26, fontFace: "Georgia", bold: true, color: NAVY, margin: 0,
  });

  // 4 stat cards
  (data.stats || []).forEach((st, i) => {
    const cx = 0.5 + i * 2.3;
    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: 1.2, w: 2.1, h: 1.9, fill: { color: LIGHT_BG }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: 1.2, w: 2.1, h: 0.06, fill: { color: BLUE } });
    s.addText(st.num, { x: cx + 0.15, y: 1.4, w: 1.8, h: 0.65, fontSize: 28, fontFace: "Georgia", bold: true, color: NAVY, margin: 0 });
    s.addText(st.label, { x: cx + 0.15, y: 2.0, w: 1.8, h: 0.4, fontSize: 12, fontFace: "Arial", bold: true, color: BLUE, margin: 0 });
    s.addText(st.sub, { x: cx + 0.15, y: 2.35, w: 1.8, h: 0.55, fontSize: 9, fontFace: "Arial", color: GREY, margin: 0 });
  });

  // Challenge title
  s.addText(data.challengeTitle || "The Growth Challenge", {
    x: 0.5, y: 3.5, w: 4, h: 0.4,
    fontSize: 16, fontFace: "Georgia", bold: true, color: NAVY, margin: 0,
  });

  // 4 challenges in 2x2 grid
  (data.challenges || []).forEach((c, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = 0.5 + col * 4.6;
    const cy = 4.05 + row * 0.75;
    s.addShape(pres.shapes.OVAL, { x: cx, y: cy + 0.08, w: 0.12, h: 0.12, fill: { color: RED } });
    s.addText([
      { text: c.title + "  ", options: { bold: true, color: NAVY, fontSize: 10 } },
      { text: c.desc, options: { color: GREY, fontSize: 9 } },
    ], { x: cx + 0.22, y: cy, w: 4.2, h: 0.65, fontFace: "Arial", valign: "top", margin: 0 });
  });

  // Problem architecture callout (y:5.15, h:0.32 per PHP reference)
  if (data.problemCallout) {
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 5.15, w: 9, h: 0.32, fill: { color: "FFF3CD" } });
    s.addText(data.problemCallout, {
      x: 0.65, y: 5.15, w: 8.7, h: 0.32,
      fontSize: 9.5, fontFace: "Arial", italic: true, color: NAVY, valign: "middle", margin: 0,
    });
  }
}

function buildSlide3_ProtocolVsProbability(pres, data) {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  s.addShape(pres.shapes.OVAL, { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fill: { color: RED } });
  s.addText("02", { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fontSize: 12, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });

  s.addText("Protocol vs Probability", {
    x: 1.15, y: 0.3, w: 8, h: 0.55,
    fontSize: 26, fontFace: "Georgia", bold: true, color: WHITE, margin: 0,
  });

  // Comparison table — fixed content from the Orchestration Paradigm doc
  const tableRows = [
    ["", "Standard AI / LLMs", "The XO Executive"],
    ["Foundation", "Probability-based\n(statistical guessing)", "Protocol-based\n(codified domain rules)"],
    ["Engagement", 'Passive "Pull Model"\n(waits for a prompt)', 'Active "Command Loop"\n(24/7 scanning)'],
    ["Identity", "Conversational Assistant", "Sovereign Decision Engine"],
    ["Output", "High liability,\nprone to hallucinations", "Pre-compliant,\nevidence-bound"],
  ];

  s.addTable(tableRows, {
    x: 0.5, y: 1.05, w: 9, h: 2.8,
    fontSize: 10, fontFace: "Arial", color: NEAR_WHITE,
    colW: [1.8, 3.6, 3.6],
    border: { pt: 0.5, color: "334466" },
    rowH: [0.4, 0.6, 0.6, 0.5, 0.6],
    autoPage: false,
    newSlideStartY: 0,
    align: "left",
    valign: "middle",
  });

  // Header row overlay
  s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.05, w: 9, h: 0.4, fill: { color: BLUE } });
  s.addText("", { x: 0.5, y: 1.05, w: 1.8, h: 0.4, fontSize: 10, fontFace: "Arial", bold: true, color: WHITE, margin: 0 });
  s.addText("Standard AI / LLMs", { x: 2.3, y: 1.05, w: 3.6, h: 0.4, fontSize: 11, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
  s.addText([
    { text: "The XO", options: { bold: true, color: WHITE, fontSize: 11 } },
    { text: " Executive", options: { bold: true, color: WHITE, fontSize: 11 } },
  ], { x: 5.9, y: 1.05, w: 3.6, h: 0.4, align: "center", valign: "middle", margin: 0 });

  // Constitutional Safety callout
  s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 4.0, w: 9, h: 1.3, fill: { color: CARD_BG } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 4.0, w: 0.07, h: 1.3, fill: { color: RED } });

  s.addText([
    { text: data.constitutionalSafetyTitle || "Constitutional Safety \u2014 Designed by Dr. Mabrouka Abuhmida", options: { bold: true, color: WHITE, fontSize: 12 } },
  ], { x: 0.8, y: 4.05, w: 8.5, h: 0.35, margin: 0 });

  s.addText(data.constitutionalSafetyNote || "Brain 1 (Actor) generates the tactical plan. Brain 2 (Critic) evaluates every action against codified constitutional principles\u2014hard limits, not advisory constraints. Every output traceable to a specific rule, precedent, and evidence chain.", {
    x: 0.8, y: 4.4, w: 8.5, h: 0.8,
    fontSize: 9.5, fontFace: "Arial", color: "B0BEC5", valign: "top", margin: 0,
  });

  // Positioning line
  s.addText("Every other AI product guesses. We follow your rules.", {
    x: 0.5, y: 5.35, w: 9, h: 0.3,
    fontSize: 10, fontFace: "Arial", italic: true, color: BLUE, margin: 0, align: "center",
  });
}

function buildSlide4_OODALoop(pres, data) {
  const s = pres.addSlide();
  s.background = { color: WHITE };

  s.addShape(pres.shapes.OVAL, { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fill: { color: NAVY } });
  s.addText("03", { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fontSize: 12, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });

  // Use the SHORT label (not the full engagement name) so the title fits the 0.55in-tall box.
  const ooLabel = data.shortLabel || data.engagementName || "";
  s.addText(`The XO Command Loop for ${data.oodaTitle || "Client"}${ooLabel ? ` — ${ooLabel}` : ""}`, {
    x: 1.15, y: 0.3, w: 8, h: 0.55,
    fontSize: 26, fontFace: "Georgia", bold: true, color: NAVY, margin: 0,
  });

  const phaseColors = { OBSERVE: BLUE, ORIENT: NAVY, DECIDE: RED, ACT: GREEN };
  const phases = data.oodaPhases || [
    { phase: "OBSERVE", desc: "24/7 sentinel scanning of data sources. Data gated by risk classification before cognition." },
    { phase: "ORIENT", desc: "Mandatory decomposition \u2014 converts context into a decision space. Assumptions, options, and risks explicitly enumerated." },
    { phase: "DECIDE", desc: "Executive framing \u2014 ranks actions, applies governance rules. Post-governance validation checks justification." },
    { phase: "ACT", desc: "Bounded execution via Streamline \u2014 presents to operator to authorise. System executes; human governs." },
  ];

  phases.forEach((o, i) => {
    const cy = 1.1 + i * 0.9;
    const color = phaseColors[o.phase] || BLUE;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: cy, w: 9, h: 0.85, fill: { color: LIGHT_BG }, shadow: makeCardShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: cy, w: 0.07, h: 0.85, fill: { color } });
    s.addText(o.phase, { x: 0.8, y: cy + 0.08, w: 1.4, h: 0.35, fontSize: 16, fontFace: "Georgia", bold: true, color, margin: 0 });
    s.addText(o.desc, { x: 0.8, y: cy + 0.42, w: 8.5, h: 0.42, fontSize: 9, fontFace: "Arial", color: GREY, margin: 0 });
  });

  // L1-L4 maturity scale
  s.addText("Maturity Roadmap", {
    x: 0.5, y: 4.7, w: 9, h: 0.25,
    fontSize: 11, fontFace: "Arial", bold: true, color: NAVY, margin: 0,
  });
  s.addText("L1: Monitor  \u2192  L2: Recommend  \u2192  L3: Bounded Autonomy  \u2192  L4: Full Autonomous Operation", {
    x: 0.5, y: 4.95, w: 9, h: 0.25,
    fontSize: 9.5, fontFace: "Arial", color: BLUE, margin: 0,
  });
  s.addText(data.maturityStart || "Starts at L1. You pull us forward as confidence builds.", {
    x: 0.5, y: 5.2, w: 9, h: 0.22,
    fontSize: 8.5, fontFace: "Arial", italic: true, color: GREY, margin: 0,
  });
}

function buildSlide5_Workflows(pres, data) {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  s.addShape(pres.shapes.OVAL, { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fill: { color: RED } });
  s.addText("04", { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fontSize: 12, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });

  s.addText(data.workflowTitle || "Workflows That Encode Institutional Knowledge", {
    x: 1.15, y: 0.3, w: 8, h: 0.55,
    fontSize: 24, fontFace: "Georgia", bold: true, color: WHITE, margin: 0,
  });

  const accentMap = { BLUE, RED, GREEN };

  (data.workflows || []).forEach((w, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = 0.5 + col * 4.7;
    const cy = 1.1 + row * 1.45;
    const accent = accentMap[w.accent] || BLUE;

    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: cy, w: 4.4, h: 1.25, fill: { color: CARD_BG }, shadow: makeCardShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: cy, w: 4.4, h: 0.05, fill: { color: accent } });
    s.addText(w.title, { x: cx + 0.2, y: cy + 0.15, w: 4.0, h: 0.35, fontSize: 13, fontFace: "Arial", bold: true, color: WHITE, margin: 0 });
    s.addText(w.desc, { x: cx + 0.2, y: cy + 0.5, w: 4.0, h: 0.65, fontSize: 9.5, fontFace: "Arial", color: "B0BEC5", valign: "top", margin: 0 });
  });
}

function buildSlide6_BeforeAfter(pres, data) {
  const s = pres.addSlide();
  s.background = { color: WHITE };

  s.addShape(pres.shapes.OVAL, { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fill: { color: NAVY } });
  s.addText("05", { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fontSize: 12, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });

  s.addText(data.beforeAfterTitle || "From System of Record to System of Action", {
    x: 1.15, y: 0.3, w: 8, h: 0.55,
    fontSize: 26, fontFace: "Georgia", bold: true, color: NAVY, margin: 0,
  });

  // Column headers
  s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.1, w: 4.3, h: 0.45, fill: { color: GREY } });
  s.addText("SYSTEM OF RECORD", { x: 0.5, y: 1.1, w: 4.3, h: 0.45, fontSize: 12, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });

  s.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.1, w: 4.3, h: 0.45, fill: { color: BLUE } });
  s.addText("SYSTEM OF ACTION", { x: 5.2, y: 1.1, w: 4.3, h: 0.45, fontSize: 12, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });

  // Comparison rows
  (data.comparisons || []).forEach((c, i) => {
    const cy = 1.7 + i * 0.53;
    const bgColor = i % 2 === 0 ? LIGHT_BG : WHITE;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: cy, w: 4.3, h: 0.48, fill: { color: bgColor } });
    s.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: cy, w: 4.3, h: 0.48, fill: { color: bgColor } });
    s.addText(c.before, { x: 0.65, y: cy, w: 4.0, h: 0.48, fontSize: 9, fontFace: "Arial", color: GREY, valign: "middle", margin: 0 });
    s.addText(c.after, { x: 5.35, y: cy, w: 4.0, h: 0.48, fontSize: 9, fontFace: "Arial", color: NAVY, bold: true, valign: "middle", margin: 0 });
  });

  // Impact line
  if (data.impactLine) {
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 4.7, w: 9, h: 0.45, fill: { color: NAVY } });
    s.addText(data.impactLine, {
      x: 0.5, y: 4.7, w: 9, h: 0.45,
      fontSize: 11, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0,
    });
  }

  // Zero rip-and-replace note
  s.addText("XO sits on top of existing systems \u2014 zero rip-and-replace. Data-agnostic architecture.", {
    x: 0.5, y: 5.2, w: 9, h: 0.3,
    fontSize: 9, fontFace: "Arial", italic: true, color: BLUE, align: "center", margin: 0,
  });
}

function buildSlide7_POC(pres, data) {
  const s = pres.addSlide();
  s.background = { color: LIGHT_BG };

  s.addShape(pres.shapes.OVAL, { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fill: { color: NAVY } });
  s.addText("06", { x: 0.5, y: 0.35, w: 0.45, h: 0.45, fontSize: 12, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });

  s.addText(data.pocTitle || "21-Day Proof of Concept", {
    x: 1.15, y: 0.3, w: 8, h: 0.55,
    fontSize: 26, fontFace: "Georgia", bold: true, color: NAVY, margin: 0,
  });

  const phaseColors = [BLUE, NAVY, RED];
  const phases = data.phases || [];

  phases.forEach((p, i) => {
    const cx = 0.5 + i * 3.15;
    const color = phaseColors[i] || BLUE;

    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: 1.1, w: 2.95, h: 3.85, fill: { color: WHITE }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: 1.1, w: 2.95, h: 0.7, fill: { color } });
    s.addText(p.week, { x: cx + 0.15, y: 1.15, w: 2.65, h: 0.3, fontSize: 11, fontFace: "Arial", bold: true, color: WHITE, margin: 0, transparency: 20 });
    s.addText(p.title, { x: cx + 0.15, y: 1.42, w: 2.65, h: 0.3, fontSize: 12, fontFace: "Arial", bold: true, color: WHITE, margin: 0 });

    (p.items || []).forEach((item, j) => {
      const iy = 2.0 + j * 0.75;
      s.addShape(pres.shapes.OVAL, { x: cx + 0.15, y: iy - 0.04, w: 0.1, h: 0.1, fill: { color } });
      s.addText(item, { x: cx + 0.35, y: iy - 0.05, w: 2.4, h: 0.7, fontSize: 9, fontFace: "Arial", color: NAVY, valign: "top", margin: 0 });
    });
  });

  // Paywall footer
  s.addText("Weeks 1\u20132 are discovery. Commercial engagement begins at prototype sign-off.", {
    x: 0.5, y: 5.15, w: 9, h: 0.3,
    fontSize: 9, fontFace: "Arial", italic: true, color: GREY, align: "center", margin: 0,
  });
}

function buildSlide8_NextSteps(pres, data) {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  // Decorative shapes
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 3.5, w: 3.5, h: 2.2, fill: { color: BLUE, transparency: 85 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 4.5, w: 2.2, h: 1.2, fill: { color: RED, transparency: 85 } });

  // IntellagenticXO logo
  s.addText([
    { text: "Intellagentic", options: { bold: true, color: WHITE, fontSize: 16 } },
    { text: "XO", options: { bold: true, color: RED, fontSize: 16 } },
  ], { x: 0.7, y: 0.5, w: 4, h: 0.5, margin: 0 });

  s.addText("Next Steps", {
    x: 0.7, y: 1.3, w: 8, h: 0.7,
    fontSize: 36, fontFace: "Georgia", bold: true, color: WHITE, margin: 0,
  });

  s.addShape(pres.shapes.LINE, { x: 0.7, y: 2.1, w: 2.5, h: 0, line: { color: RED, width: 3 } });

  // 3 next steps
  (data.nextSteps || []).forEach((ns, i) => {
    const cy = 2.5 + i * 0.7;
    s.addShape(pres.shapes.OVAL, { x: 0.7, y: cy, w: 0.4, h: 0.4, fill: { color: RED } });
    s.addText(ns.num, { x: 0.7, y: cy, w: 0.4, h: 0.4, fontSize: 14, fontFace: "Arial", bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
    s.addText(ns.text, { x: 1.3, y: cy, w: 7.5, h: 0.4, fontSize: 13, fontFace: "Arial", color: NEAR_WHITE, valign: "middle", margin: 0 });
  });

  // Success metric
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 4.5, w: 8.6, h: 0.65, fill: { color: CARD_BG } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 4.5, w: 0.07, h: 0.65, fill: { color: GREEN } });
  s.addText([
    { text: "Success Metric: ", options: { bold: true, color: GREEN, fontSize: 11 } },
    { text: data.successMetric || "Institutional knowledge encoded into protocol, not people.", options: { color: NEAR_WHITE, fontSize: 11 } },
  ], { x: 1.0, y: 4.5, w: 8.1, h: 0.65, fontFace: "Arial", valign: "middle", margin: 0 });

  // Pricing strategy (y:5.25, h:0.28 with bg per PHP reference)
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 5.25, w: 8.6, h: 0.28, fill: { color: "E8F4F8" } });
  s.addText("XO is priced against the cost of the problem, not the cost of the technology.", {
    x: 0.7, y: 5.25, w: 8.6, h: 0.28,
    fontSize: 9, fontFace: "Arial", italic: true, color: BLUE, align: "center", valign: "middle", margin: 0,
  });

  // Contact (y:5.65 per PHP reference)
  s.addText("alan.moore@intellagentic.io   \u00B7   ken.scott@intellagentic.io", {
    x: 0.7, y: 5.65, w: 8, h: 0.3,
    fontSize: 10, fontFace: "Arial", color: "B0BEC5", margin: 0,
  });
}

// ── Draft Watermark Helper ──
function addDraftWatermark(slide, pres) {
  slide.addText("DRAFT", {
    x: 1.5, y: 1.5, w: 7, h: 3,
    fontSize: 72, fontFace: "Arial", color: "C0C0C0", bold: true,
    align: "center", valign: "middle", rotate: -30, transparency: 70,
  });
}

// ── Build Full Deck ──
function buildDeck(data, isDraft) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.author = "IntellagenticXO";
  pres.title = data.title || "IntellagenticXO Growth Deck";

  buildSlide1_Title(pres, data);
  buildSlide2_StatusChallenges(pres, data);
  buildSlide3_ProtocolVsProbability(pres, data);
  buildSlide4_OODALoop(pres, data);
  buildSlide5_Workflows(pres, data);
  buildSlide6_BeforeAfter(pres, data);
  buildSlide7_POC(pres, data);
  buildSlide8_NextSteps(pres, data);

  if (isDraft) {
    // Add DRAFT watermark to each slide - PptxGenJS exposes _slides array
    const slides = pres._slides || pres.slides || [];
    slides.forEach(s => addDraftWatermark(s, pres));
  }

  return pres;
}

// ── Lambda Handler (synchronous — same pattern as xo-brief-download) ──
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  try {
    const pathParams = event.pathParameters || {};
    const clientId = pathParams.id || "";
    if (!clientId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "client_id is required" }) };
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Use POST /results/{id}/deck" }) };
    }

    // Read engagement_id from request body or query params
    let engagementId = null;
    try { engagementId = JSON.parse(event.body || "{}").engagement_id || null; } catch(e) {}
    if (!engagementId) engagementId = (event.queryStringParameters || {}).engagement_id || null;

    // 1. Get analysis results
    const lambdaClient = new LambdaClient({ region: REGION });
    const queryParams = engagementId ? { engagement_id: engagementId } : null;
    const resultsResp = await lambdaClient.send(new InvokeCommand({
      FunctionName: "xo-results",
      Payload: JSON.stringify({
        httpMethod: "GET",
        path: `/results/${clientId}`,
        pathParameters: { id: clientId },
        queryStringParameters: queryParams,
        headers: event.headers || {},
      }),
    }));

    const resultsBody = JSON.parse(Buffer.from(resultsResp.Payload).toString());
    const results = JSON.parse(resultsBody.body);

    if (results.status !== "complete") {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Analysis not complete" }) };
    }

    // 2. Map analysis JSON → slide data (pure JS, no AI call)
    // `engagement_short_label` (optional) overrides the auto-derived short label used on slides 3-7.
    const engName = results.engagement_name || "";
    const slideData = assembleDeckData(results, engName);
    slideData.engagementName = engName;

    // 3. Build .pptx (draft watermark if not yet approved)
    const isDraft = !results.approved_at;
    const pres = buildDeck(slideData, isDraft);
    const buffer = await pres.write({ outputType: "nodebuffer" });

    const companyName = (results.company_name || "Client").replace(/\s+/g, "_");
    const engFileSuffix = results.engagement_name ? `_${results.engagement_name.replace(/\s+/g, "_")}` : "";
    const filename = `${companyName}${engFileSuffix}_XO_Growth_Deck.pptx`;

    // 4. Return base64 (same response shape as xo-brief-download)
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        filename,
        content_base64: buffer.toString("base64"),
        content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    };
  } catch (err) {
    console.error("Deck handler error:", err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Deck generation failed", details: err.message }) };
  }
};
