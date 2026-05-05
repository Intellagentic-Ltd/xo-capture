# XO CAPTURE - PROJECT STATUS

**Date:** April 27, 2026
**Project:** XO Capture - Rapid Deployment
**Author:** Ken Scott, Co-Founder & President, Intellagentic
**Status:** Deployed & Operational (v2.49)
**CloudFront URL:** https://d36la414u58rw5.cloudfront.net
**Repository:** https://github.com/intellagentic/xo-capture

---

## ARCHITECTURE DIAGRAMS

### 1. System Architecture

```
+-------------------+
|      Browser      |
| (Desktop / Mobile)|
+--------+----------+
         |
         | HTTPS (JWT in Authorization header)
         |
+--------v----------+         +----------------------------------+
|    CloudFront      |         |       API Gateway (REST)         |
|  EWNDD7ESKAW33     |         |  2t9mg17baj.execute-api          |
+--------+----------+         |    .us-west-1.amazonaws          |
         |                     +--+----+----+----+----+----+--+--+
         |                        |    |    |    |    |    |  |
         v                        |    |    |    |    |    |  |
+------------------+              |    |    |    |    |    |  |
| S3: xo-prototype |              |    |    |    |    |    |  |
|    -frontend     |              |    |    |    |    |    |  |
| (index.html,     |              |    |    |    |    |    |  |
|  JS, CSS, logos) |              |    |    |    |    |    |  |
+------------------+              |    |    |    |    |    |  |
                                  v    v    v    v    v    v  v
  +---------+ +--------+ +-------+ +------+ +------+ +------+ +--------+
  |xo-auth  | |xo-     | |xo-    | |xo-   | |xo-   | |xo-  | |xo-     |
  | Lambda  | |clients | |upload | |enrich| |results| |btns | |gdrive  |
  |Python   | |Lambda  | |Lambda | |Lambda| |Lambda | |     | |import  |
  |  3.11   | |        | |       | |      | |       | |     | |Lambda  |
  +----+----+ +---+----+ +---+---+ +--+---+ +--+----+ +--+--+ +---+----+
       |          |           |        |        |         |         |
       |          |           |        v        |         |         v
       |          |           | +----------+    |         |  +-----------+
       |          |           | |Claude    |    |         |  |Google     |
       |          |           | |Opus 4.5  |    |         |  |Drive API  |
       |          |           | |or Sonnet |    |         |  |(OAuth2 +  |
       |          |           | |(user sel)|    |         |  | files)    |
       |          |           | +----+-----+    |         |  +-----+-----+
       |          |           |      |          |         |        |
       v          v           v      v          v         v        v
  +----------------------------------------------------------+
  |              S3: xo-client-data                          |
  |  {client_id}/                                            |
  |    +-- uploads/        (raw files)                       |
  |    +-- extracted/      (parsed text)                     |
  |    +-- results/        (analysis.json)                   |
  +----------------------------------------------------------+
       |          |           |      |          |          |
       v          v           v      v          v          v
  +----------------------------------------------------------+
  |         RDS PostgreSQL 15 (xo_quickstart)                |
  |  db.t3.micro | xo-quickstart-db.xxxxx.rds.amazonaws.com |
  |                                                          |
  |  Tables: users, clients, uploads, enrichments,           |
  |     skills, buttons, partners, client_tokens,            |
  |     system_config                                        |
  +----------------------------------------------------------+
```

### 2. Frontend Component Tree

```
App (root)
|
+-- InvitePage (if pathname === '/invite') — public, no auth
|     +-- Dark gradient background (0a0a0f → 1a1a2e → 0a0a0f)
|     +-- XO red logo box + "Capture" header
|     +-- "Invitation" heading (42px, light weight, letter-spaced)
|     +-- Tagline: "XO clears the path. You decide. Streamline Acts."
|     +-- Countdown timer (4 boxes: Days/Hrs/Min/Sec → March 16 2026 10AM PST)
|     +-- "Something is coming." italic text
|     +-- Glass-morphism form card (first name, email, company)
|     +-- Submit → POST /invite → confirmation with CheckCircle
|     +-- "Launch XO Capture" button (magic link URL)
|     +-- Intellagentic logo footer
|
+-- LoginScreen (if !isLoggedIn)
|     +-- Header bar (same as main app: XO logo box, "Rapid Deployment", Intellagentic logo)
|     +-- "Welcome" heading (uppercase, letter-spaced, subtle gray)
|     +-- Google Sign-In button (via Google Identity Services library)
|     +-- "or" divider
|     +-- "Sign in with email instead" link (toggles to email/password form)
|     +-- [Email form] Email field (Mail icon) + Password field (Lock icon) + "Continue" button
|     +-- Forgot Password? link + Reset Password expandable form
|     +-- Error banner (AlertTriangle, red)
|     +-- Google OAuth admin/partner login → dashboard; client login → single-client workspace
|     +-- Magic link token URL (?token=X) → auto-validates → client workspace
|
+-- [Authenticated App] (if isLoggedIn)
|
+-- Header
|     +-- Hamburger Menu Button
|     +-- XO Logo Box
|     +-- Title (desktop: "XO Capture" / mobile: "Rapid Prototype")
|     +-- Subtitle: "Client Dashboard" (on dashboard) or company name (in workspace)
|     +-- Intellagentic Logo (right)
|
+-- Sidebar (slide-out, 220px)
|     +-- All Clients / My Clients  (Building2 icon) -- admin + partner, navigates to dashboard
|     +-- ---divider---  -- admin + partner
|     +-- Welcome        (Home icon)
|     +-- Sources        (FolderOpen icon)
|     +-- Enrich         (Sparkles icon)
|     +-- Results        (FileText icon)
|     +-- Skills         (Database icon)
|     +-- ---divider---
|     +-- Configuration  (Settings icon)
|     +-- Branding       (Image icon) -- workspace only (hidden on dashboard)
|     +-- Theme Toggle   (Sun/Moon)
|     +-- Sign Out       (LogOut icon, red)
|
+-- DashboardScreen (admin + partner, currentScreen === 'dashboard')
|     +-- Header: "All Clients (N)" (admin) / "My Clients (N)" (partner) + "+ New Client" button
|     +-- Partner filter dropdown (admin only) + Industry filter + Search
|     +-- Grid of client cards (auto-fill, min 300px)
|     |     +-- Client icon (32px, or letter fallback) + Company name (bold) + chevron right
|     |     +-- Industry badge (pill)
|     |     +-- Source count (FolderOpen icon) + enrichment status badge
|     |     +-- Last enriched date (if available)
|     +-- Click card → enters workspace scoped to that client
|     +-- "+ New Client" → opens CompanyInfoModal → creates client → enters workspace
|     +-- Empty state: "No clients yet" + "Create First Client" button
|     +-- Loading state: spinner
|     +-- Error state: retry button
|
+-- CompanyInfoModal
|     +-- Company Name *
|     +-- Website URL (with external link icon)
|     +-- Contacts (expandable multi-entry cards)
|     +-- Addresses (expandable multi-entry cards)
|     +-- Industry/Vertical
|     +-- Channel Partner (admin only, dropdown)
|     +-- Intellagentic Lead (admin only, checkbox)
|     +-- Current Business Description (textarea)
|     +-- Future Plans (textarea)
|     +-- Pain Points (multi-entry, add/remove)
|     +-- ---divider---
|     +-- Client Branding (logo + icon upload, thumbnail previews)
|
+-- Screen Router (currentScreen state)
      |
      +-- UploadScreen ("Welcome")
      |     +-- Step Card 1: Domain Expertise  --> opens CompanyInfoModal
      |     +-- Step Card 2: Raw Data          --> drag-and-drop file zone
      |     |     +-- Sources Strip (5 connector pills)
      |     |     |     +-- Upload (red, active)
      |     |     |     +-- Google Drive (blue when connected, triggers OAuth or file picker)
      |     |     |     +-- NotebookLM (grayed out)
      |     |     |     +-- Dropbox (grayed out)
      |     |     |     +-- OneDrive (grayed out)
      |     |     +-- Google Drive File Picker Modal
      |     |           +-- Header (HardDrive icon, title, close)
      |     |           +-- Back button (folder navigation)
      |     |           +-- File list (folders + files, checkable)
      |     |           +-- Footer (selection count, Import Files button)
      |     +-- Step Card 3: Intellagentic Growth  --> upload trigger
      |     +-- Action Buttons Row (from configButtons)
      |     +-- Founder Quotes (Alan Moore, Ken Scott)
      |
      +-- EnrichScreen
      |     +-- Model Badge (purple Opus / blue Sonnet)
      |     +-- Start Enrichment Button
      |     +-- Progress Tracker (5 stages)
      |
      +-- ResultsScreen
      |     +-- XO Summary for Client (red gradient header, bullet points — client-facing, no tech jargon)
      |     +-- Executive Summary
      |     +-- Bottom Line (red accent callout)
      |     +-- Problems (expandable, severity badges)
      |     +-- Proposed Architecture (ASCII diagram)
      |     +-- Data Schema (expandable tables)
      |     +-- 7/14/21 Action Plan
      |     +-- Sources
      |
      +-- SkillsScreen
      |     +-- Skills List
      |     +-- AddSkillModal (name, content, upload .md)
      |
      +-- ConfigurationScreen
      |     +-- AI Model Selector (radio cards)
      |     |     +-- Claude Opus 4.5 (default, best analysis)
      |     |     +-- Claude Sonnet 4.5 (faster, cheaper)
      |     +-- Theme Toggle (light/dark)
      |     +-- Streamline Webhook (workspace only)
      |     |     +-- "Send to Streamline" toggle (default OFF, per-client)
      |     |     +-- Webhook URL (read-only display)
      |     |     +-- Manual override note
      |     +-- Configure Buttons (drag-and-drop, inline edit)
      |     |     +-- Button Card (grip, icon, label, URL, actions)
      |     |     +-- Inline Editor (label, URL, color grid, icon grid)
      |     |     +-- "+ Add Button"
      |     +-- Live Preview Panel
      |
      +-- BrandingScreen (workspace only)
      |     +-- Company Logo card (drop zone, preview, replace)
      |     +-- Company Icon card (drop zone, preview, replace)
      |     +-- Preview section (header logo mockup, dashboard card icon mockup)
      |
      +-- PartnersScreen (admin only)
      |     +-- Partner list (name, primary contact, industry)
      |     +-- Add/Edit/Delete partner CRUD
      |     +-- Partner form: Name, Website (with link icon), Industry, Description, Future Plans, Pain Points (multi-entry), Contacts, Addresses, Notes
      |
      +-- ShareLinkModal (admin + partner, from dashboard row or workspace header)
            +-- Magic link URL display (or "No link generated")
            +-- Copy to clipboard button
            +-- Generate / Regenerate button
            +-- Revoke button
            +-- Expiry date display
```

### 3. S3 Folder Structure (per client)

```
xo-client-data/
|
+-- client_1709251234_a1b2c3d4/
|     |
|     +-- metadata.json
|     |     {
|     |       "client_id": "client_1709251234_a1b2c3d4",
|     |       "company_name": "Acme Waste Management",
|     |       "website": "https://acme-waste.com",
|     |       "contact_name": "John Doe",
|     |       "contact_title": "CEO",
|     |       "contact_linkedin": "https://linkedin.com/in/johndoe",
|     |       "industry": "Waste Management",
|     |       "description": "Regional waste collection service",
|     |       "pain_point": "Route optimization is killing our margins",
|     |       "created_at": "2026-03-01T00:00:00.000000",
|     |       "status": "active"
|     |     }
|     |
|     +-- uploads/
|     |     +-- customers.csv
|     |     +-- routes.xlsx
|     |     +-- contract.pdf
|     |     +-- meeting-notes.mp3
|     |
|     +-- branding/
|     |     +-- logo.png              (company logo, overwrites on re-upload)
|     |     +-- icon.png              (company icon, overwrites on re-upload)
|     |
|     +-- extracted/                  (future: parsed text output)
|     |     +-- customers.txt
|     |     +-- meeting-notes_transcript.txt
|     |
|     +-- skills/
|     |     +-- waste-management-analysis.md
|     |     +-- route-optimization.md
|     |
|     +-- results/
|           +-- analysis.json         (Claude output: summary, problems,
|                                      schema, plan, sources)
|
+-- client_1709259876_e5f6g7h8/
      +-- ...
```

### 4. Data Flow Diagram (3-step partner journey)

```
STEP 1: NEW PARTNER                    STEP 2: UPLOAD FILES
========================               ========================

+------------------+                   +------------------+
| CompanyInfoModal |                   | Drag-and-Drop    |
| - name *         |                   | File Zone        |
| - website        |                   | (15 file types)  |
| - contact info   |                   +--------+---------+
| - industry       |                            |
| - description    |                            v
| - pain point     |                   +------------------+
+--------+---------+                   | POST /upload     |
         |                             | { client_id,     |
         v                             |   files: [...] } |
+------------------+                   +--------+---------+
| POST /clients    |                            |
| { company_name,  |                            v
|   website,       |                   +------------------+
|   contactName,   |                   | S3 Presigned URL |
|   painPoint, ... }|                  | PUT direct to S3 |
+--------+---------+                   +--------+---------+
         |                                      |
         v                                      v
+------------------+                   +------------------+
| xo-clients       |                   | xo-client-data/  |
| Lambda           |                   |  {id}/uploads/   |
| - generate id    |                   |  +-- file1.csv   |
| - create folders |                   |  +-- file2.pdf   |
| - write metadata |                   +------------------+
+--------+---------+
         |
         v
+------------------+
| xo-client-data/  |
|  {id}/           |
|  +-- metadata.json
|  +-- uploads/    |
|  +-- extracted/  |
|  +-- results/    |
+------------------+


STEP 3: ENRICH + RESULTS
========================

+------------------+         +------------------+
| Click "Start     |         | xo-enrich Lambda |
|  Enrichment"     |         |                  |
+--------+---------+         | 1. Read metadata |
         |                   |    (+ pain point)|
         v                   | 2. List uploads/ |
+------------------+         | 3. Extract text  |
| POST /enrich     |-------->|    (CSV/PDF/XLSX)|
| { client_id }    |         | 4. Read skills/  |
+------------------+         | 5. Build prompt  |
                             |    (pain point = |
                             |     PRIORITY #1) |
                             +--------+---------+
                                      |
                                      v
                             +------------------+
                             | Claude Opus 4.5  |
                             | (or Sonnet 4.5)  |
                             | - exec summary   |
                             | - problems (3-5) |
                             | - data schema    |
                             | - 7/14/21 plan  |
                             | - sources        |
                             +--------+---------+
                                      |
                                      v
                             +------------------+
                             | S3: {id}/results/|
                             |  analysis.json   |
                             +--------+---------+
                                      |
         +----------------------------+
         |
         v
+------------------+         +------------------+
| GET /results/{id}|-------->| xo-results       |
|  (poll every 2s) |         | Lambda           |
+------------------+         | - read analysis  |
                             |   .json from S3  |
         +-------------------|                  |
         |                   +------------------+
         v
+------------------+
| ResultsScreen    |
| - Summary        |
| - Problems       |
| - Schema         |
| - Action Plan    |
| - Sources        |
+------------------+
```

### 5. API Gateway Route Map

```
+---------------------------------------------------------------+
|  API Gateway: xo-api                                          |
|  Base: https://2t9mg17baj.execute-api.us-west-1.amazonaws.com |
|  Stage: /prod                                                 |
+---------------------------------------------------------------+
|                                                               |
|  Method   Path             Lambda        Purpose              |
|  ------   ----             ------        -------              |
|  POST     /clients         xo-clients    Create new partner   |
|                                          - validate name      |
|                                          - generate client_id |
|                                          - create S3 folders  |
|                                          - write metadata.json|
|                                            (incl. pain_point) |
|                                                               |
|  POST     /upload          xo-upload     Get presigned URLs   |
|                                          - validate client_id |
|                                          - generate PUT URLs  |
|                                          - 1 hour expiry      |
|                                                               |
|  POST     /enrich          xo-enrich     Trigger AI analysis  |
|                                          - read metadata      |
|                                          - extract file text  |
|                                          - load skills (.md)  |
|                                          - select model (Opus |
|                                            or Sonnet per user)|
|                                          - call Claude API    |
|                                          - prioritize pain pt |
|                                          - write results JSON |
|                                                               |
|  GET      /results/{id}    xo-results    Fetch analysis       |
|                                          - read analysis.json |
|                                          - return JSON or     |
|                                            {status:processing}|
|                                                               |
|  POST     /auth/google     xo-auth       Google OAuth login    |
|                                          - verify ID token     |
|                                          - DB role check       |
|                                          - admin seed fallback |
|                                          - client contact match|
|                                          - upsert user         |
|                                          - return JWT w/ role  |
|                                                               |
|  PUT      /auth/preferences xo-auth      Update user prefs     |
|                                          (model selection)     |
|                                                               |
|  POST     /auth/token      xo-auth      Validate magic link   |
|                                          - check client_tokens |
|                                          - issue client JWT    |
|                                                               |
|  POST     /auth/magic-link xo-auth      Generate magic link   |
|                                          (admin/partner only)  |
|                                                               |
|  GET      /auth/magic-link xo-auth      Get existing link     |
|                                          (admin/partner only)  |
|                                                               |
|  DELETE   /auth/magic-link xo-auth      Revoke magic link     |
|                                          (admin/partner only)  |
|                                                               |
|  GET      /clients/list   xo-clients    List all clients      |
|                                          - source count        |
|                                          - enrichment status   |
|                                          - last enrichment date|
|                                                               |
|  GET      /gdrive/auth-url xo-gdrive-    Get OAuth consent URL |
|                            import                              |
|                                                               |
|  POST     /gdrive/callback xo-gdrive-   Exchange auth code    |
|                            import        for tokens            |
|                                                               |
|  GET      /gdrive/files   xo-gdrive-    List Drive files      |
|                            import        (folder navigation)   |
|                                                               |
|  POST     /gdrive/import  xo-gdrive-    Download Drive files  |
|                            import        to S3                 |
|                                                               |
|  OPTIONS  (all paths)      (built-in)    CORS preflight       |
|                                          - Allow-Origin: *    |
|                                          - Allow-Headers:     |
|                                            Content-Type       |
+---------------------------------------------------------------+

Request/Response Flow:

  Browser                API Gateway              Lambda              S3
    |                        |                      |                  |
    |-- POST /clients ------>|-- invoke ----------->|                  |
    |                        |                      |-- put metadata ->|
    |                        |                      |-- put folders -->|
    |<-- { client_id } ------|<-- return -----------|                  |
    |                        |                      |                  |
    |-- POST /upload ------->|-- invoke ----------->|                  |
    |                        |                      |-- check meta -->|
    |<-- { upload_urls } ----|<-- presigned URLs ---|                  |
    |                        |                      |                  |
    |-- PUT (presigned) -----|--------------------------------------------->|
    |                        |                      |                  |
    |-- POST /enrich ------->|-- invoke ----------->|                  |
    |                        |                      |-- read meta --->|
    |                        |                      |-- read uploads->|
    |                        |                      |-- read skills ->|
    |                        |                      |-- Claude API    |
    |                        |                      |-- put results ->|
    |<-- { status } ---------|<-- return -----------|                  |
    |                        |                      |                  |
    |-- GET /results/{id} -->|-- invoke ----------->|                  |
    |                        |                      |-- read results->|
    |<-- { analysis } -------|<-- return -----------|                  |
```

---

## FRONTEND

**Framework:** React 18.2.0 + Vite 5.4.14
**Deployment:** S3 static hosting + CloudFront CDN
**Build:** Production optimized bundle (~226 KB JS, 6.8 KB CSS, 37 KB logos)

### Components Structure

```
src/
  App.jsx          -- Main application component
    - LoginScreen             (Invitation branding, single form, auto-create/login)
    - Hamburger Sidebar       (Navigation: Welcome, Sources, Enrich, Results, Skills, Configuration, Branding (workspace only), theme toggle -- all always clickable)
    - CompanyInfoModal        (Partner information form - 8 fields, creates client on save)
    - UploadScreen            (3-step journey with founder quotes, Step 2 links to Sources)
    - SourcesScreen           (Source Library + Add Sources — file CRUD, toggle, replace, delete)
    - EnrichScreen            (AI processing with progress tracking)
    - ResultsScreen           (Analysis display with expandable sections)
    - SkillsScreen            (Skills management - list, add, edit, delete)
    - AddSkillModal           (Skill creation/editing modal)
    - ConfigurationScreen     (Theme toggle, Streamline webhook toggle, AI model, button config, live preview)

  assets/
    - logo-light.png          (White logo for dark backgrounds, 26px header)
    - logo-dark.png           (Dark logo for light backgrounds)

  index.css        -- Global styles and theme tokens
  main.jsx         -- React entry point
```

### Five-Screen Flow

1. **Welcome / Upload Screen** (3-step journey layout with founder testimonials)
   - Header: Hamburger menu (left), XO logo, title, Intellagentic logo (right)
   - Step 1: Domain Expertise -- inline Organization Profile form (name, website w/ link icon, industry, current business description, future plans, multi-entry pain points, contacts, addresses)
   - Step 2: Raw Data -- Compact source count summary with "Manage Sources" link (or "Add Sources" if empty)
     - Sources managed on dedicated Sources screen (see below)
   - Step 3: Intelligent Growth -- Preview of analysis output (grayed until steps 1&2 complete)
   - "Continue to Enrichment" button (replaces "Upload & Continue" — files already uploaded via Sources)

2. **Sources Screen** (NotebookLM-style Source Library)
   - **Top panel — Source Library**: File list with card rows, summary bar (X active · Y total · Z MB)
     - Each card: file type icon, filename, version badge (v2/v3), source pill (Local red / Google Drive blue), file size, date
     - Active/inactive toggle (ToggleLeft/ToggleRight) — dims inactive cards
     - Kebab menu (MoreVertical): Replace, Delete
     - Delete confirmation modal overlay
     - Replace triggers file picker, creates new version with parent_upload_id link
     - Empty state matching Skills screen pattern
   - **Bottom panel — Add Sources**: Drag-and-drop zone with immediate upload on drop
     - Sources strip: Upload (active), Google Drive (OAuth popup), NotebookLM/Dropbox/OneDrive (grayed out)
     - Google Drive file picker modal (moved from UploadScreen)
     - Pending files list with progress indicators
   - Requires clientId (shows "Complete Domain Expertise first" message if missing)
   - Action Buttons Row: Configurable buttons between step cards and quotes (Enrich, Skills by default)
     - Clickable: internal routes navigate, external URLs open in new tab
     - Managed via Configuration screen, rendered with hex colors and glow shadows
   - Founder Quotes: Two editorial pull quotes side-by-side (Alan Moore & Ken Scott)
   - Compact layout: All steps + quotes fit on screen without scrolling (220px card height)

2. **Enrich Screen**
   - Model badge shows current AI model (purple for Opus, blue for Sonnet)
   - "Start Enrichment" button triggers /enrich Lambda with selected model
   - Real-time progress tracking (5 stages: extract, transcribe, research, analyze, complete)
   - Lambda reads skills from S3 and injects into Claude prompt
   - Auto-navigates to results when complete

3. **Results Screen**
   - Executive Summary
   - Problems Identified (expandable cards with severity badges)
   - Proposed Data Schema (expandable tables with column details)
   - 7/14/21 Day Action Plan
   - Data Sources (client data, web enrichment, AI analysis)

4. **Skills Screen** (new)
   - List of domain-specific skills (markdown files from S3)
   - "+ Add Skill" button opens modal
   - Modal: skill name, markdown content (monospace textarea), or upload .md file
   - Each skill can be edited or deleted
   - Skills injected into Claude prompt during enrichment
   - Empty state: "No skills yet. Add your first skill to enhance AI analysis."

5. **Configuration Screen** (fully functional)
   - **AI Model selector**: Radio-button cards for Claude Opus 4.5 (default) and Sonnet 4.5
     - Selection saved per-user to PostgreSQL via PUT /auth/preferences
     - Opus card: purple accent, "Best analysis quality" description
     - Sonnet card: blue accent, "Faster responses, lower cost" description
   - Theme toggle: working light/dark mode with localStorage persistence
   - Configure Buttons: Surgical Trays reference pattern with drag-and-drop reorder
     - Each button card: grip handle, colored icon circle, name, color/icon label, URL, edit/copy/delete icons
     - Inline editing: label, URL, 8-color grid selector with checkmarks, icon grid (30+ icons)
     - "+ Add Button" creates new button and opens inline editor
   - Live Preview: right-side panel renders buttons exactly as they appear on Welcome page
   - Buttons stored in PostgreSQL via /buttons API, synced on login and save
   - Action buttons on Welcome page are clickable:
     - Internal routes (/enrich, /skills, etc.) navigate to that screen
     - External URLs (https://...) open in new tab

### CSS Architecture

**Theme:** Dark header (#1a1a2e), light/dark body via CSS variables, red accent (#dc2626)

**Theme System (CSS Variables):**
- `:root` (light): --bg-body: #f0f0f0, --bg-card: #ffffff, --text-primary: #1a1a1a
- `[data-theme="dark"]`: --bg-body: #0d1117, --bg-card: #161b22, --text-primary: #c9d1d9
- Variables cover: body, cards, inputs, borders, text, shadows, scrollbar
- Theme persisted to localStorage (key: xo-theme), applied via data-theme attribute on body
- Toggle accessible from Configuration screen and hamburger sidebar

**Key Styles:**
- Dark cards with numbered step circles (48px) - compact 220px height
- Horizontal layout: 3 cards in one row, tightly spaced (0.75rem gap)
- Founder quotes: Editorial pull quotes with 3.5rem red quotation marks
- Hamburger sidebar: 280px width, slide-out from left with dark background
- All content fits on screen without scrolling (standard laptop viewport)
- Mobile responsive: cards and quotes stack vertically at <768px
- Mobile header: "XO Capture" swaps to "Rapid Prototype" at ≤768px, version badge hidden
- Touch-friendly buttons: min 44px height
- Modal: full-width on mobile with scrollable body
- Button config cards: slideIn/fadeIn animations, card-hover/btn-hover transitions

---

## AWS INFRASTRUCTURE

### S3 Buckets

**1. xo-prototype-frontend** (us-west-1)
- Purpose: Static website hosting for React app
- Public access: Enabled for CloudFront origin
- Website endpoint: http://xo-prototype-frontend.s3-website-us-west-1.amazonaws.com
- CORS: Configured for API calls
- Files: index.html, assets/index-*.js, assets/index-*.css

**2. xo-client-data** (us-west-1)
- Purpose: Client document storage and analysis results
- Public access: Blocked (private bucket)
- CORS: Enabled for presigned URL uploads
- Structure: See "S3 Folder Structure" section below

### CloudFront Distribution

**Distribution ID:** EWNDD7ESKAW33
**Domain:** d36la414u58rw5.cloudfront.net
**Origin:** xo-prototype-frontend.s3-website-us-west-1.amazonaws.com
**Protocol:** HTTP -> HTTPS redirect
**Cache:** Default 24 hours, gzip compression enabled
**Error Pages:** 404 -> /index.html (for SPA routing)

### API Gateway

**Name:** xo-api
**Type:** REST API
**Region:** us-west-1
**Stage:** prod
**Base URL:** https://2t9mg17baj.execute-api.us-west-1.amazonaws.com/prod
**CORS:** Enabled on all methods

**Resources:**
- /auth/login (POST) -- authenticate or auto-create user, return JWT + preferred_model
- /auth/google (POST) -- Google OAuth login for admin users (verify ID token, check allowed list)
- /auth/register (POST) -- explicit user registration
- /auth/reset-password (POST) -- reset password (no email verification)
- /auth/preferences (PUT) -- update user preferences (model selection)
- /clients (GET/POST/PUT)
- /clients/list (GET) -- list all clients for user with source count + enrichment stats
- /upload (POST)
- /upload/branding (GET/POST) -- presigned URLs for client logo/icon branding assets
- /enrich (POST)
- /results/{id} (GET)
- /buttons (GET) -- fetch user's buttons
- /buttons/sync (PUT) -- full replace user's buttons
- /gdrive/auth-url (GET) -- Google OAuth consent URL
- /gdrive/callback (POST) -- exchange auth code for tokens
- /gdrive/files (GET) -- list Google Drive files
- /gdrive/import (POST) -- import Drive files to S3

### Lambda Functions

**IAM Role:** xo-lambda-role
- S3 full access to xo-client-data bucket
- CloudWatch Logs write permissions
- Lambda basic execution role

**Functions:** See "Lambda Functions" section below

### RDS PostgreSQL

**Instance:** xo-quickstart-db
**Engine:** PostgreSQL 15
**Class:** db.t3.micro
**Storage:** 20 GB gp3
**Database:** xo_quickstart
**Region:** us-west-1
**Publicly Accessible:** Yes (prototype -- strong password is primary defense)

**Schema (6 tables):**

```
+----------+       +----------+       +----------+
|  users   |<------+  clients |<------+  uploads |
+----------+  1:N  +----------+  1:N  +----------+
| id (PK)  |       | id (PK)  |       | id (PK)  |
| email    |       | user_id  |       | client_id|
| pass_hash|       | company  |       | filename |
| name     |       | website  |       | file_type|
| created  |       | contact* |       | s3_key   |
| gdrive_  |       | industry |       | source   |
|  refresh |       | descript |       | uploaded |
| gdrive_  |       |          |       +----------+
|  conn_at |       |          |
| preferred|       |          |
|  _model  |       |          |
+-----+----+       |          |
      |            | pain_pt  |
      |            | s3_folder|       +----------+
      |            | logo_s3_ |<------+ enrichmts|
      |            |  key     |  1:N  +----------+
      |            | icon_s3_ |
      |            |  key     |
      |            | strmline |
      |            |  _wh_en  |
      |            | 5 new DB |
      |            |  columns |
      |            | status   |       | id (PK)  |
      |            | created  |       | client_id|
      |            | updated  |       | status   |
      |            +-----+----+       | started  |
      |                  |            | completed|
      |                  |            | results  |
      |            +-----v----+       |  _s3_key |
      |            |  skills  |       +----------+
      |            +----------+
      |            | id (PK)  |
      |            | client_id|
      |            | name     |
      |            | content  |
      |            | s3_key   |
      |            | created  |
      |            +----------+
      |
+-----v----+
|  buttons |
+----------+
| id (PK)  |
| user_id  |
| name     |
| icon     |
| color    |
| url      |
| sort_ord |
+----------+
```

### Auth Flow

```
Browser                          API Gateway                Lambda (xo-auth)            PostgreSQL
  |                                  |                            |                        |
  |  POST /auth/login                |                            |                        |
  |  {email, password}               |                            |                        |
  |--------------------------------->|--------------------------->|                        |
  |                                  |                            |  SELECT WHERE email    |
  |                                  |                            |----------------------->|
  |                                  |                            |                        |
  |                                  |                     +------+------+                 |
  |                                  |                     | User found? |                 |
  |                                  |                     +------+------+                 |
  |                                  |                        YES |  NO                    |
  |                                  |               +------------+------------+           |
  |                                  |               |                         |           |
  |                                  |         bcrypt.checkpw()         INSERT new user    |
  |                                  |               |                  (name from email)  |
  |                                  |          pass? |                        |---------->|
  |                                  |           YES  |  NO                    |           |
  |                                  |            |   |                        |           |
  |                                  |    JWT token  401              JWT token (201)      |
  |                                  |    + user     error           + user                |
  |<---------------------------------|<----------(200)               |                     |
  |                                  |                              |                     |
  |  localStorage.setItem(token)     |                              |                     |
  |  onLogin(user, token)            |                              |                     |
```

**5 New DB-Only Columns (no UI yet):**
- `survival_metric_1`, `survival_metric_2` (TEXT)
- `ai_persona` (TEXT)
- `strategic_objective` (TEXT)
- `tone_mode` (VARCHAR 50)

**Schema file:** backend/schema.sql
**Seed script:** backend/seed.py (creates admin user + default buttons)
**Config script:** backend/set-db-config.sh (sets DATABASE_URL + JWT_SECRET on all Lambdas)

### Lambda Layer

**Name:** xo-psycopg2
**Contents:** psycopg2, PyJWT, bcrypt (compiled for Amazon Linux 2023 / Python 3.11)
**Attached to:** All 7 Lambdas

---

## API ENDPOINTS

**Authentication:** All endpoints except POST /auth/login, /auth/register, /auth/reset-password, and POST /invite require a JWT Bearer token in the Authorization header.

### POST /auth/login

**Purpose:** Authenticate user and return JWT token. **Auto-creates account** if email doesn't exist.
**Lambda:** xo-auth

**Behavior:**
- If email exists → verify password with bcrypt → return JWT (200)
- If email doesn't exist → create account (name derived from email) → return JWT (201)
- Password must be at least 8 characters for new accounts

**Request:**
```json
{
  "email": "ken.scott@intellagentic.io",
  "password": "XOquickstart2026!"
}
```

**Response (200 existing user / 201 new user):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "ken.scott@intellagentic.io",
    "name": "Ken Scott",
    "preferred_model": "claude-opus-4-5-20250529"
  }
}
```

---

### POST /auth/register

**Purpose:** Explicit user registration (kept for API compatibility; login auto-creates)
**Lambda:** xo-auth

**Request:**
```json
{
  "email": "user@company.com",
  "password": "securepassword",
  "name": "Jane Smith"
}
```

**Response (201):**
```json
{
  "token": "eyJ...",
  "user": { "id": "uuid", "email": "user@company.com", "name": "Jane Smith" }
}
```

**Errors:** 409 if email already exists, 400 if password < 8 characters

---

### POST /auth/reset-password

**Purpose:** Reset user password (prototype: no email verification)
**Lambda:** xo-auth

**Request:**
```json
{
  "email": "ken.scott@intellagentic.io",
  "new_password": "NewSecurePass123"
}
```

**Response (200):**
```json
{"message": "Password reset successfully"}
```

**Errors:** 404 if email not found, 400 if password < 8 characters

---

### PUT /auth/preferences

**Purpose:** Update user preferences (model selection). Requires JWT auth.
**Lambda:** xo-auth

**Request:**
```json
{
  "preferred_model": "claude-opus-4-5-20250529"
}
```

**Allowed models:** `claude-opus-4-5-20250529`, `claude-sonnet-4-20250514`

**Response (200):**
```json
{"preferred_model": "claude-opus-4-5-20250529"}
```

**Errors:** 401 if unauthorized, 400 if invalid model

---

### GET /buttons

**Purpose:** Fetch all buttons for the authenticated user
**Lambda:** xo-buttons

**Response:**
```json
{
  "buttons": [
    {"id": "uuid", "label": "Enrich", "icon": "Sparkles", "color": "#22c55e", "url": "/enrich", "sort_order": 0}
  ]
}
```

---

### PUT /buttons/sync

**Purpose:** Full replace of user's buttons
**Lambda:** xo-buttons

**Request:**
```json
{
  "buttons": [
    {"label": "Enrich", "icon": "Sparkles", "color": "#22c55e", "url": "/enrich", "sort_order": 0}
  ]
}
```

**Response:**
```json
{"status": "synced", "count": 1}
```

---

### GET /gdrive/auth-url

**Purpose:** Get Google OAuth2 consent URL for popup-based authorization
**Lambda:** xo-gdrive-import

**Response (200):**
```json
{
  "auth_url": "https://accounts.google.com/o/oauth2/auth?client_id=...&redirect_uri=...&scope=drive.readonly&access_type=offline&prompt=consent"
}
```

---

### POST /gdrive/callback

**Purpose:** Exchange Google auth code for tokens, store refresh token in DB
**Lambda:** xo-gdrive-import

**Request:**
```json
{
  "code": "4/0AY0e-g7..."
}
```

**Response (200):**
```json
{"connected": true}
```

---

### GET /gdrive/files

**Purpose:** List files in user's Google Drive with folder navigation
**Lambda:** xo-gdrive-import

**Query Params:** `folder_id` (default: `root`)

**Response (200):**
```json
{
  "files": [
    {"id": "abc123", "name": "Reports", "mimeType": "application/vnd.google-apps.folder", "isFolder": true, "isGoogleDoc": false},
    {"id": "def456", "name": "Q4 Analysis.pdf", "mimeType": "application/pdf", "size": 245000, "modifiedTime": "2026-02-28T10:00:00Z", "isFolder": false, "isGoogleDoc": false}
  ],
  "folder_id": "root"
}
```

---

### POST /gdrive/import

**Purpose:** Download selected files from Google Drive and upload to S3
**Lambda:** xo-gdrive-import

**Request:**
```json
{
  "file_ids": ["def456", "ghi789"],
  "client_id": "uuid-of-client"
}
```

**Response (200):**
```json
{
  "imported": 2,
  "files": [
    {"id": "uuid", "name": "Q4 Analysis.pdf", "type": "application/pdf", "s3_key": "s3_folder/uploads/Q4 Analysis.pdf", "source": "google_drive"}
  ]
}
```

---

### POST /clients

**Purpose:** Create new client and S3 folder structure
**Lambda:** xo-clients

**Request:**
```json
{
  "company_name": "Acme Waste Management",
  "website": "https://acme-waste.com",
  "contactName": "John Doe",
  "contactTitle": "CEO",
  "contactLinkedIn": "https://linkedin.com/in/johndoe",
  "industry": "Waste Management",
  "description": "Regional waste collection service",
  "painPoint": "Route optimization is killing our margins"
}
```

**Response:**
```json
{
  "client_id": "client_1709251234_a1b2c3d4",
  "status": "created"
}
```

**Sample curl:**
```bash
curl -X POST https://2t9mg17baj.execute-api.us-west-1.amazonaws.com/prod/clients \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "Acme Waste Management",
    "description": "Regional waste collection service",
    "painPoint": "Route optimization is killing our margins"
  }'
```

---

### POST /upload

**Purpose:** Generate presigned S3 URLs for direct file upload
**Lambda:** xo-upload

**Request:**
```json
{
  "client_id": "client_1709251234_a1b2c3d4",
  "files": [
    {"name": "customers.csv", "type": "text/csv"},
    {"name": "recording.mp3", "type": "audio/mpeg"}
  ]
}
```

**Response:**
```json
{
  "upload_urls": [
    "https://xo-client-data.s3.amazonaws.com/client_1709251234_a1b2c3d4/uploads/customers.csv?...",
    "https://xo-client-data.s3.amazonaws.com/client_1709251234_a1b2c3d4/uploads/recording.mp3?..."
  ]
}
```

**Sample curl:**
```bash
curl -X POST https://2t9mg17baj.execute-api.us-west-1.amazonaws.com/prod/upload \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "client_1709251234_a1b2c3d4",
    "files": [{"name": "customers.csv", "type": "text/csv"}]
  }'
```

---

### POST /enrich

**Purpose:** Trigger AI analysis of uploaded documents
**Lambda:** xo-enrich

**Request:**
```json
{
  "client_id": "client_1709251234_a1b2c3d4",
  "model": "claude-opus-4-5-20250529"
}
```

**Response:**
```json
{
  "job_id": "client_1709251234_a1b2c3d4",
  "status": "complete"
}
```

**Sample curl:**
```bash
curl -X POST https://2t9mg17baj.execute-api.us-west-1.amazonaws.com/prod/enrich \
  -H "Content-Type: application/json" \
  -d '{"client_id": "client_1709251234_a1b2c3d4"}'
```

---

### GET /results/{id}

**Purpose:** Retrieve analysis results for a client
**Lambda:** xo-results

**Request:** GET /results/client_1709251234_a1b2c3d4

**Response:**
```json
{
  "status": "complete",
  "summary": "Executive summary...",
  "problems": [
    {
      "title": "Route Optimization Inefficiency",
      "severity": "high",
      "evidence": "Evidence from data...",
      "recommendation": "Implement route optimization..."
    }
  ],
  "schema": {
    "tables": [
      {
        "name": "customers",
        "purpose": "Commercial client master data",
        "columns": [
          {"name": "customer_id", "type": "UUID", "description": "Unique identifier"}
        ]
      }
    ]
  },
  "plan": [
    {
      "phase": "30-day",
      "actions": ["action 1", "action 2"]
    }
  ],
  "sources": [
    {"type": "client_data", "reference": "customers.csv (2,487 records)"}
  ]
}
```

**Sample curl:**
```bash
curl https://2t9mg17baj.execute-api.us-west-1.amazonaws.com/prod/results/client_1709251234_a1b2c3d4
```

---

## S3 FOLDER STRUCTURE

**Bucket:** xo-client-data

**Per-client layout:**
```
{client_id}/
  |
  +-- uploads/              <- Original files uploaded by user
  |     +-- customers.csv
  |     +-- recording.mp3
  |     +-- invoice_data.xlsx
  |
  +-- extracted/            <- Text extracted from files (future use)
  |     +-- customers.txt
  |     +-- recording_transcript.txt
  |
  +-- skills/               <- Domain-specific skills/instructions (markdown)
  |     +-- waste-management-analysis.md
  |     +-- route-optimization.md
  |
  +-- results/              <- Analysis output from Claude
  |     +-- analysis.json
  |
  +-- metadata.json         <- Client information and timestamps
```

**metadata.json structure:**
```json
{
  "client_id": "client_1709251234_a1b2c3d4",
  "company_name": "Acme Waste Management",
  "website": "https://acme-waste.com",
  "contact_name": "John Doe",
  "contact_title": "CEO",
  "contact_linkedin": "https://linkedin.com/in/johndoe",
  "industry": "Waste Management",
  "description": "Regional waste collection service",
  "pain_point": "Route optimization is killing our margins",
  "created_at": "2026-03-01T00:00:00.000000",
  "status": "active"
}
```

---

## LAMBDA FUNCTIONS

All Lambdas require JWT auth (except /auth/login). Auth is provided by `auth_helper.py` (shared module copied into each deploy package). All Lambdas use the `xo-psycopg2` Lambda layer for PostgreSQL, JWT, and bcrypt support. 7 Lambdas total.

**Common Environment Variables (all Lambdas):**
- BUCKET_NAME: xo-client-data
- DATABASE_URL: postgresql://xo_admin:PASSWORD@HOST:5432/xo_quickstart
- JWT_SECRET: (256-bit random secret)

### xo-auth

**Runtime:** Python 3.11
**Memory:** 256 MB
**Timeout:** 30 seconds
**Handler:** lambda_function.lambda_handler

**What it does:**
1. Routes by path: /auth/google, /auth/login, /auth/register, /auth/reset-password, /auth/preferences
2. POST /auth/google: **Google OAuth login** -- verify ID token via Google tokeninfo endpoint, check email against ALLOWED_EMAILS list (4 admin emails), upsert user (sentinel password_hash blocks password login), return JWT with `is_admin=true`
3. POST /auth/login: **Auto-create flow** -- if email exists, verify bcrypt password; if not, create new user (is_admin=false)
4. POST /auth/register: Explicit registration with optional name field
5. POST /auth/reset-password: Updates bcrypt hash directly (prototype, no email verification)
6. PUT /auth/preferences: Update user preferences (preferred_model) -- requires JWT auth
7. Returns JWT (24h expiry, HS256) with user_id, email, name, is_admin
8. Login response includes preferred_model + is_admin flag
9. Name auto-derived from email prefix for auto-created accounts (e.g., ken.scott → Ken Scott)

**Admin Emails (ALLOWED_EMAILS):** alan.moore@intellagentic.io, ken.scott@intellagentic.io, rs@multiversant.com, vn@multiversant.com
**Env Vars:** DATABASE_URL, JWT_SECRET, BUCKET_NAME, ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID

**File:** backend/lambdas/auth/lambda_function.py

---

### xo-clients

**Runtime:** Python 3.11
**Memory:** 256 MB
**Timeout:** 30 seconds
**Handler:** lambda_function.lambda_handler

**What it does (method router with 4 handlers):**

1. **GET /clients/list** — List all clients for user with stats (admin dashboard)
   - Returns: company_name, industry, client_id, source_count, enrichment_status, enrichment_date
   - Subqueries: COUNT active uploads, latest enrichment status/date
   - Ordered by updated_at DESC

2. **GET /clients?client_id=X** — Fetch existing client data
   - If client_id provided, fetch by s3_folder; otherwise fetch most recent for user
   - Returns all fields: company_name, website, contactName, contactTitle, contactLinkedIn, industry, description, painPoint, client_id, timestamps

3. **POST /clients** — Create new client
   - Validates company_name, generates unique client_id: `client_{timestamp}_{md5hash}`
   - Creates S3 folder structure: uploads/, extracted/, results/
   - Generates client-config.md in S3, copies default skill template
   - INSERT INTO clients + skills tables
   - Returns client_id (S3 folder) + id (DB UUID)

4. **PUT /clients** — Update existing client
   - Requires client_id in body
   - Updates all fields + updated_at timestamp
   - Regenerates client-config.md in S3

**File:** backend/lambdas/clients/lambda_function.py

---

### xo-upload

**Runtime:** Python 3.11
**Memory:** 256 MB
**Timeout:** 30 seconds
**Handler:** lambda_function.lambda_handler

**What it does (method router with 7 handlers):**

1. **POST /upload** — Original presigned URL flow (auth + client validation)
   - Generates presigned PUT URLs for each file (1 hour expiry)
   - INSERT INTO uploads with file_size column
   - Returns upload_urls + upload_ids

2. **GET /uploads?client_id=X** — List all sources for a client
   - Returns non-deleted uploads ordered by uploaded_at DESC
   - Includes: id, filename, file_type, s3_key, uploaded_at, source, status, file_size, version, parent_upload_id, replaced_at

3. **DELETE /uploads/{id}** — Soft-delete upload
   - Sets status='deleted' in DB
   - Deletes object from S3

4. **PUT /uploads/{id}/toggle** — Toggle active/inactive
   - Flips status between 'active' and 'inactive'

5. **POST /uploads/{id}/replace** — Upload new version
   - Marks parent as status='replaced', replaced_at=NOW()
   - Creates new record with version+1 and parent_upload_id
   - Returns presigned URL for new file

6. **POST /upload/branding** — Generate presigned PUT URL for client logo or icon
   - Accepts: client_id, file_type ("logo" or "icon"), content_type, file_extension
   - Validates ownership, generates S3 key: `{client_id}/branding/{file_type}.{ext}` (overwrites previous)
   - Updates `logo_s3_key` or `icon_s3_key` in clients table
   - Returns: upload_url, s3_key

7. **GET /upload/branding?client_id=X** — Get presigned GET URLs for viewing logo/icon
   - Fetches logo_s3_key and icon_s3_key from clients table
   - Generates presigned GET URLs (1 hour expiry) for each non-null key
   - Returns: logo_url, icon_url, logo_s3_key, icon_s3_key

**File:** backend/lambdas/upload/lambda_function.py

---

### xo-enrich

**Runtime:** Python 3.11
**Memory:** 512 MB
**Timeout:** 300 seconds (5 minutes)
**Handler:** lambda_function.lambda_handler

**Additional Environment Variables:**
- ANTHROPIC_API_KEY: sk-ant-... (set via set-api-key.sh)

**Dependencies:**
- anthropic==0.40.0
- pypdf==5.1.0
- openpyxl==3.1.2

**What it does:**
1. **Auth check** (JWT required)
2. **Reads client metadata from PostgreSQL** (replaces S3 metadata.json)
3. **INSERT INTO enrichments** (status='processing') before analysis
4. **Reads skills from DB** (with S3 fallback for s3_key-only skills)
5. Extracts text from uploaded files in S3:
   - CSV: Parse with csv module, include header + 10 sample rows
   - PDF: Extract text with pypdf (first 10 pages)
   - Excel: Extract with openpyxl (all sheets, first 10 rows each)
   - TXT: Read directly
6. **Model selection**: reads model from request body, falls back to user's DB preference, defaults to Opus 4.5
   - Allowed models: claude-opus-4-5-20250529 (default), claude-sonnet-4-20250514
7. Sends extracted text + company info + pain point to Claude API (using selected model)
8. Uses "First Party Trick" prompt for MBA-level analysis
9. If pain_point present: injects PRIORITY instruction
10. Writes analysis.json to {client_id}/results/ in S3
11. **UPDATE enrichments** (status='complete', results_s3_key)
12. On error: UPDATE enrichments (status='error')

**File:** backend/lambdas/enrich/lambda_function.py
**Deploy:** backend/lambdas/enrich/deploy-enrich.sh

---

### xo-results

**Runtime:** Python 3.11
**Memory:** 256 MB
**Timeout:** 10 seconds
**Handler:** lambda_function.lambda_handler

**What it does:**
1. **Auth check** (JWT required)
2. **Checks enrichments table** for latest status (processing/complete/error)
3. If complete: reads results_s3_key from DB, fetches analysis.json from S3
4. If processing: returns {"status": "processing"}
5. Fallback: direct S3 check if no enrichment record exists

**File:** backend/lambdas/results/lambda_function.py

---

### xo-buttons (NEW)

**Runtime:** Python 3.11
**Memory:** 256 MB
**Timeout:** 30 seconds
**Handler:** lambda_function.lambda_handler

**What it does:**
1. **Auth check** (JWT required)
2. GET /buttons: Returns all buttons for user, ordered by sort_order
3. PUT /buttons/sync: Deletes all user's buttons, inserts new set (full replace)

**File:** backend/lambdas/buttons/lambda_function.py

---

### xo-gdrive-import (NEW)

**Runtime:** Python 3.11
**Memory:** 512 MB
**Timeout:** 120 seconds
**Handler:** lambda_function.lambda_handler

**Additional Environment Variables:**
- GOOGLE_CLIENT_ID: OAuth 2.0 client ID
- GOOGLE_CLIENT_SECRET: OAuth 2.0 client secret
- GOOGLE_REDIRECT_URI: https://d36la414u58rw5.cloudfront.net

**Dependencies:**
- google-auth==2.27.0
- google-auth-oauthlib==1.2.0
- google-api-python-client==2.114.0

**What it does:**
1. **Auth check** (JWT required on all routes)
2. GET /gdrive/auth-url: Generates Google OAuth2 consent URL (offline access, drive.readonly scope)
3. POST /gdrive/callback: Exchanges authorization code for tokens, stores refresh_token in users table
4. GET /gdrive/files: Lists files in user's Google Drive (supports folder_id query param for navigation)
   - Returns folders and files with metadata (name, mimeType, size, modifiedTime)
   - Identifies Google Docs types for export (Docs→PDF, Sheets→CSV, Slides→PDF)
5. POST /gdrive/import: Downloads selected files from Drive, uploads to S3, records in uploads table
   - Google Docs exported automatically (Docs/Slides→PDF, Sheets→CSV)
   - Verifies client ownership before importing (WHERE s3_folder + user_id match)
   - Records each file with `source = 'google_drive'` in uploads table

**OAuth Flow:**
- Frontend opens Google consent URL in popup window
- User authorizes drive.readonly access
- Popup redirects back to CloudFront origin with auth code
- Parent window reads code from popup URL, closes popup
- Frontend sends code to POST /gdrive/callback
- Lambda exchanges code for refresh token, stores in users.google_drive_refresh_token

**File:** backend/lambdas/gdrive/lambda_function.py
**Deploy:** backend/lambdas/gdrive/deploy-gdrive.sh

---

## CLAUDE API INTEGRATION

**Default Model:** claude-sonnet-4-5-20250929 (user-selectable)
**Available Models:** claude-opus-4-6 (best), claude-sonnet-4-5-20250929 (default), claude-haiku-4-5-20251001 (fastest)
**Max Tokens:** 8000
**Temperature:** 0.7
**Model Selection:** Per-user preference stored in PostgreSQL, sent in /enrich request body

### Prompt Structure

**"First Party Trick" Analysis Prompt:**

```
You are an MBA-level business analyst conducting a First Party Trick analysis.
You have been given access to internal documents from a company. Analyze this
business and provide strategic insights.

COMPANY INFORMATION:
Company Name: {company_name}
Company Website: {website}
Primary Contact: {contact_name} ({contact_title})
Contact LinkedIn: {contact_linkedin}
Industry: {industry}
Description: {description}

CLIENT DATA (Uploaded Documents):
{extracted_text_from_files}

TASK:
Analyze this business like an MBA analyst presenting on Monday morning. Provide:

1. EXECUTIVE SUMMARY: 2-3 paragraph overview of the business, operations, and
   financial indicators based on the data provided.

2. PROBLEMS IDENTIFIED: Top 3-5 critical business problems. For each problem:
   - Title (clear, specific)
   - Severity (high/medium/low)
   - Evidence (specific data points from documents)
   - Recommendation (actionable solution)

3. PROPOSED DATA SCHEMA: Design a database schema to manage this business. Include:
   - 3-5 core tables
   - For each table: name, purpose, key columns (name, type, description)
   - Relationships between tables

4. 7/14/21 DAY ACTION PLAN:
   - 7-day: Build and demo -- prototype the solution to the primary pain point, get it on screen, show it live
   - 14-day: Validate and connect -- incorporate feedback, validate data connections, prepare for real deployment
   - 21-day: Deploy or decide -- go live with the solution or make the build/buy decision

OUTPUT FORMAT:
Return ONLY valid JSON in this exact structure:
{
  "status": "complete",
  "summary": "...",
  "problems": [...],
  "schema": {...},
  "plan": [...],
  "sources": [...]
}
```

**Response Parsing:**
- Strips markdown code fences if present (```json ... ```)
- Parses JSON response
- Adds metadata: analyzed_at timestamp, analyzed_files list
- Handles errors gracefully, returns error status if Claude call fails

---

## DEPLOYMENT PROCESS

### Frontend Deployment

**Build:**
```bash
cd /Users/ken_macair_2025/Desktop/xo-prototype
npm run build
```

**Deploy to S3:**
```bash
aws s3 sync dist/ s3://xo-prototype-frontend/ --delete --region us-west-1
```

**Invalidate CloudFront cache:**
```bash
aws cloudfront create-invalidation \
  --distribution-id EWNDD7ESKAW33 \
  --paths "/*"
```

**Complete flow:**
```bash
npm run build && \
aws s3 sync dist/ s3://xo-prototype-frontend/ --delete --region us-west-1 && \
aws cloudfront create-invalidation --distribution-id EWNDD7ESKAW33 --paths "/*"
```

---

### Backend Lambda Deployment

**xo-clients Lambda:**
```bash
cd backend/lambdas/clients
zip -r function.zip lambda_function.py
aws lambda update-function-code \
  --function-name xo-clients \
  --zip-file fileb://function.zip \
  --region us-west-1
```

**xo-upload Lambda:**
```bash
cd backend/lambdas/upload
zip -r function.zip lambda_function.py
aws lambda update-function-code \
  --function-name xo-upload \
  --zip-file fileb://function.zip \
  --region us-west-1
```

**xo-gdrive-import Lambda (with dependencies):**
```bash
cd backend/lambdas/gdrive
./deploy-gdrive.sh
aws lambda update-function-code \
  --function-name xo-gdrive-import \
  --zip-file fileb://function.zip \
  --region us-west-1
```

**xo-enrich Lambda (with dependencies):**
```bash
cd backend/lambdas/enrich
./deploy-enrich.sh
aws lambda update-function-code \
  --function-name xo-enrich \
  --zip-file fileb://function.zip \
  --region us-west-1
```

**xo-results Lambda:**
```bash
cd backend/lambdas/results
zip -r function.zip lambda_function.py
aws lambda update-function-code \
  --function-name xo-results \
  --zip-file fileb://function.zip \
  --region us-west-1
```

**Set Anthropic API Key:**
```bash
cd backend
./set-api-key.sh YOUR_ANTHROPIC_API_KEY
```

---

## FILE TYPES SUPPORTED

**Documents:**
- CSV (.csv)
- Text (.txt)
- PDF (.pdf)
- Word (.doc, .docx)
- Excel (.xls, .xlsx)
- PowerPoint (.ppt, .pptx)

**Data:**
- JSON (.json)
- XML (.xml)

**Archives:**
- ZIP (.zip)

**Audio:**
- MP3 (.mp3)
- WAV (.wav)
- M4A (.m4a)
- AAC (.aac)

**Total:** 15 file type extensions supported

**Frontend validation:** Both MIME type and file extension checking
**Backend extraction:** CSV, PDF, Excel, TXT currently implemented
**Pending:** Word, PowerPoint, JSON, XML, ZIP, Audio transcription

---

## BUILD HISTORY

**Session Date:** March 3, 2026
**Build Count:** 53 completed builds

**Build Order:**

1. **Project Scaffold** (Step 1)
   - Vite + React 18 setup
   - Base CSS adapted from Surgical Trays reference
   - Color scheme: Dark header (#1a1a2e), light body (#f0f0f0), red accent (#dc2626)
   - Header component with XO branding

2. **Upload Screen** (Step 2)
   - Company information form (name, description)
   - File upload with drag-and-drop
   - File list with remove buttons
   - Upload progress tracking

3. **Audio File Support**
   - Added MP3, WAV, M4A, AAC to supported types
   - Audio icon in file list

4. **Backend Infrastructure** (Step 3-5)
   - S3 bucket: xo-client-data
   - IAM role: xo-lambda-role with S3 permissions
   - Lambda: xo-clients (create client folders)
   - Lambda: xo-upload (presigned URLs)
   - API Gateway: xo-api with CORS
   - Tested end-to-end file upload to S3

5. **Enrich Lambda** (Step 6)
   - Lambda: xo-enrich with Claude API integration
   - Dependencies: anthropic, pypdf, openpyxl
   - Text extraction for CSV, PDF, Excel
   - "First Party Trick" prompt implementation
   - Lambda: xo-results to fetch analysis
   - set-api-key.sh helper script

6. **Frontend API Integration**
   - Connected upload screen to /clients and /upload endpoints
   - Real S3 uploads via presigned URLs
   - Enrich screen with progress tracking
   - Results screen with expandable sections

7. **Company Info Modal** (Step 7)
   - Added enrichment fields: website, contact name, contact title, LinkedIn, industry
   - Modal pattern from reference
   - Stored all fields in metadata.json
   - Updated /enrich Lambda to use enrichment context in Claude prompt

8. **Upload Screen Redesign** (Step 8)
   - Journey-based 3-step visual experience
   - Dark cards on light background
   - Numbered red circles (48px)
   - Embedded drop zone and "New Partner" button within steps
   - Step completion logic with visual feedback

9. **Upload Screen Fixes** (Step 9)
   - Corrected step order: Domain Expertise (1), Raw Data (2), Growth (3)
   - Compact horizontal layout (260px min-height cards)
   - Removed duplicate Domain Expertise card
   - Fixed card numbering
   - All three cards fit on screen without scrolling

10. **Branding Update**
    - Changed "XO Platform" to "XO Quickstart" (later renamed to "XO Capture" in v1.23)
    - Subtitle: "Rapid Prototype"
    - Updated index.html title tag

11. **Expanded File Types**
    - Added: .doc, .docx, .txt, .ppt, .pptx, .json, .xml, .zip
    - Updated drop zone label: "CSV, Excel, Word, PDF, Audio, and more"
    - Total 15 file extensions supported

12. **Mobile Responsive Design**
    - Cards stack vertically on <768px screens
    - Modal adapts to mobile width
    - Touch-friendly buttons (min 44px)
    - Scrollable modal body on mobile

13. **CloudFront Deployment**
    - Created S3 bucket: xo-prototype-frontend
    - Created CloudFront distribution: EWNDD7ESKAW33
    - Deployed production build
    - Public URL: https://d36la414u58rw5.cloudfront.net

14. **Git & GitHub**
    - Initialized git repository
    - Created .gitignore (excludes secrets, node_modules, dist)
    - Created GitHub repo: intellagentic/xo-capture (originally xo-quickstart)
    - Pushed initial commit with full codebase

15. **Hamburger Menu Sidebar** (Session 2 - Feb 28, 2026)
    - Added Menu icon to header (top-left)
    - Slide-out sidebar panel from left (280px width, dark background)
    - Navigation menu items: Upload, Enrich, Results, Configuration
    - Active state highlighting with red accent
    - Close on outside click or X button

16. **Configuration Screen** (Shell Implementation)
    - Theme toggle: Sun/Moon icon with toggle switch (non-functional UI)
    - Configure Buttons section: draggable-looking cards with grip icons
    - Action icons: Copy, Edit, Delete per button card
    - Live Preview section: real-time button rendering preview
    - "+ Add Button" functionality placeholder

17. **Founder Quote Strip**
    - Added two editorial pull quotes below step cards
    - Alan Moore quote: "I wasn't leading. I was typing at 6:00 AM..."
    - Ken Scott quote: "We're business operators first, not technologists..."
    - Large decorative quotation marks (3.5rem, red, Georgia serif)
    - Side-by-side on desktop, stacked on mobile
    - Clean magazine/editorial aesthetic

18. **Intellagentic Logos**
    - Added logo-light.png to header (far right, 26px height)
    - Added logo-dark.png to assets (initially used in footer, later removed)
    - Logos imported as React assets

19. **Vertical Spacing Optimization**
    - Reduced step card height: 260px -> 220px
    - Reduced card padding: 1rem -> 0.875rem
    - Reduced card gap: 1rem -> 0.75rem
    - Reduced quote section margins and padding
    - Reduced quotation mark size: 4rem -> 3.5rem
    - All content now fits on screen without scrolling on standard laptop

20. **Logo Repositioning**
    - Moved Intellagentic logo from left to far right in header
    - Removed footer logo (logo-dark.png no longer displayed at bottom)
    - Final header layout: Hamburger | XO logo | Title | [space] | Intellagentic logo

21. **Skills Management Feature**
    - Added "Skills" menu item to hamburger sidebar (between Results and Configuration)
    - Created SkillsScreen component with skills list view
    - Created AddSkillModal for skill creation/editing
    - Skill modal features: name field, markdown content textarea (monospace), upload .md file option
    - Skills stored in S3 under {client_id}/skills/skill-name.md
    - Updated enrich Lambda to read skills from S3 and inject into Claude prompt
    - Added read_skills() function to Lambda
    - Skills appear as "DOMAIN-SPECIFIC SKILLS & INSTRUCTIONS" section in analysis prompt
    - Each skill can be viewed, edited, or deleted
    - Empty state guidance: "Add your first skill to enhance AI analysis"

22. **Card 3 Readability Improvements** (Session 3 - March 1, 2026)
    - Fixed disabled state opacity: removed layered opacity that made text unreadable
    - Changed background from semi-transparent rgba(26, 26, 46, 0.5) to solid #2a2a3e (lighter gray)
    - Increased text opacity from 30-40% range to 55-70% range for better contrast
    - Added visible border when disabled: 2px solid rgba(100, 100, 100, 0.3)
    - Lightened number circle background: rgba(100, 100, 100, 0.2) -> rgba(150, 150, 150, 0.3)
    - Lightened number circle text: #666 -> #999
    - Card now looks locked/pending rather than invisible (~60% visibility vs ~20%)

23. **Card 3 Branding Update**
    - Changed heading from "INTELLIGENT GROWTH" to "INTELLAGENTIC GROWTH"
    - Reinforces Intellagentic brand positioning
    - Deployed to production via CloudFront

24. **Light/Dark Theme Toggle** (Session 4 - February 28, 2026)
    - Added CSS variable system: `:root` (light) and `[data-theme="dark"]` selectors
    - Variables cover: body background, card background, inputs, borders, text colors, shadows, scrollbar
    - Theme state lifted to App root, applied via `data-theme` attribute on `<body>`
    - Persisted to localStorage (key: `xo-theme`), defaults to light
    - Working toggle in Configuration screen (toggle switch with Sun/Moon icons)
    - Working toggle in hamburger sidebar (bottom section)
    - All hardcoded colors in inline styles replaced with CSS variable references
    - Smooth 0.3s transition on background and color changes

25. **Configuration Screen -- Full Implementation**
    - Replaced shell implementation with Surgical Trays reference pattern
    - Left panel: "CONFIGURE BUTTONS" with "+ Add Button" (blue with glow shadow)
    - Button cards: drag handle (GripVertical), colored icon circle (hex + 20% opacity bg), label, color/icon metadata, URL display (blue text), edit/copy/delete action buttons
    - Inline editing panel (expands below card on edit click): label input, URL input, 8-color grid with checkmarks, 30+ icon grid (10 columns)
    - Drag-and-drop reordering via HTML5 draggable
    - Right panel: "LIVE PREVIEW" renders buttons with hex colors, glow shadows, icons
    - Theme-aware colors via `C` object (bg, surface, border, text, muted)
    - Animations: fadeIn, slideIn on card mount, card-hover/btn-hover transitions

26. **Button Configuration -- URL Field & Click Actions**
    - Added URL field to each button (stored in config, editable inline)
    - Placeholder text: `/enrich, /skills, or https://...`
    - URL displayed on card in blue text (truncated with ellipsis)
    - Welcome page buttons wired up and clickable:
      - Internal routes (`/upload`, `/enrich`, `/results`, `/skills`, `/configuration`) navigate to screen
      - External URLs (`https://...`) open in new tab with noopener/noreferrer
      - "New Partner" button opens company info modal
    - Route map: ROUTE_MAP constant maps URL paths to screen names

27. **Navigation Cleanup**
    - Added "Welcome" as first item in hamburger sidebar (Home icon), navigates to landing page
    - Removed top navigation tabs (Upload, Enrich, Results) -- sidebar handles all navigation
    - Removed "New Partner" and "Upload" from default action buttons (already in step cards 1 & 2)
    - Default action buttons: Enrich (/enrich), Skills (/skills)
    - Bumped localStorage key to `xo-buttons-v2` to reset stale data for all users
    - Button state lifted from ConfigurationScreen to App root (shared between Config and Welcome)

28. **Sidebar Navigation Fix**
    - Removed `disabled={!clientId}` restrictions from Enrich, Results, Skills menu items
    - Removed `opacity: 0.5` and `cursor: 'not-allowed'` on inactive items
    - Changed inactive item color from `rgba(255, 255, 255, 0.7)` to `#ffffff` (full white)
    - All sidebar items always clickable and navigate to their screen
    - Refactored sidebar nav from individual buttons to `.map()` loop over items array
    - Active item highlighted with red text (#dc2626) and red background tint

29. **Mobile Responsive Header**
    - Added `.header-title-desktop` and `.header-title-mobile` spans in header
    - Desktop shows "XO Capture", mobile (≤768px) shows "Rapid Prototype"
    - CSS media query swaps visibility: `.header-title-desktop` hidden, `.header-title-mobile` shown
    - Version badge hidden on mobile to save horizontal space
    - Deployed to production via CloudFront

30. **Immediate Pain Point Field**
    - Added "Immediate Pain Point" textarea to CompanyInfoModal (8th field, after Description)
    - Placeholder: "What's the one problem you need solved right now?"
    - Frontend sends `painPoint` in /clients API call
    - xo-clients Lambda stores as `pain_point` in metadata.json
    - xo-enrich Lambda reads `pain_point` from metadata, includes in enrichment context
    - When pain point is present, Claude prompt gets PRIORITY instruction:
      - Makes pain point the #1 problem in analysis
      - Leads executive summary with it
      - Front-loads 30-day action plan with steps addressing it
    - All three deployments updated: frontend, xo-clients Lambda, xo-enrich Lambda

31. **PostgreSQL Migration + Authentication** (Session 5 - February 28, 2026)
    - **RDS PostgreSQL 15** (db.t3.micro) replaces S3 metadata.json for structured data
    - Schema: 6 tables (users, clients, uploads, enrichments, skills, buttons)
    - 5 new DB columns (survival_metric_1, survival_metric_2, ai_persona, strategic_objective, tone_mode) -- no UI yet
    - **bcrypt auth + JWT tokens** (24h expiry)
    - New Lambda: xo-auth (POST /auth/login)
    - New Lambda: xo-buttons (GET /buttons, PUT /buttons/sync)
    - **Lambda layer** (xo-psycopg2): psycopg2, PyJWT, bcrypt for Python 3.11
    - **Shared auth_helper.py**: JWT verification + DB connection, copied into all Lambda packages
    - All 4 existing Lambdas migrated: auth check, PostgreSQL reads/writes, CORS Authorization header
    - xo-clients: S3 folders + DB INSERT (removed metadata.json write)
    - xo-upload: DB validation replaces S3 head_object, INSERT INTO uploads
    - xo-enrich: reads metadata from DB, enrichment tracking (processing/complete/error), skills from DB with S3 fallback
    - xo-results: checks enrichments table before S3, reads results_s3_key from DB
    - **LoginScreen** adapted from Surgical Trays reference (glassmorphism, slideUp/float animations)
    - XO red (#dc2626) replaces Surgical Trays navy (#325083)
    - Auth state: isLoggedIn, user, authToken in App root
    - Session restore from localStorage on mount (with JWT expiry check)
    - getAuthHeaders() helper on all 5 fetch() call sites
    - Sidebar: user name/email display, Sign Out button (red, LogOut icon)
    - **Buttons migrated to PostgreSQL**: fetchButtons() on login, saveButtons() syncs to API
    - CSS: .error-banner styles, @keyframes slideUp, @keyframes float
    - Deploy: updated deploy.sh (6 Lambdas), deploy-enrich.sh (auth_helper), new set-db-config.sh
    - Seed script: backend/seed.py (ken.scott@intellagentic.io + default buttons)
    - Files: 16 files created/modified

32. **Login Screen Redesign + Auth Enhancements** (Session 6 - February 28, 2026)
    - **Login screen redesign**: dark header / light body aesthetic matching main app
    - Header reuses exact same CSS classes as main app (header, header-inner, logo-box, header-title)
    - "Invitation" heading above form (uppercase, letter-spaced, elegant)
    - **Single form** for both new and returning users (no login/register toggle)
    - Button text: "Continue" (not "Sign In")
    - Helper text below form: "Enter your email and password to get started."
    - White form card on #f5f5f5 background, red focus states on inputs
    - **Auto-create backend**: /auth/login now creates accounts automatically if email doesn't exist
    - New account names derived from email prefix (ken.scott → Ken Scott)
    - Existing users: bcrypt password verification as before
    - **New API endpoints**: POST /auth/register (explicit), POST /auth/reset-password (prototype)
    - API Gateway routes added for /auth/register and /auth/reset-password
    - Lambda permissions configured for all new routes
    - Seed admin email updated to ken.scott@intellagentic.io across all files
    - Frontend build: ~215 KB JS (reduced from ~220 KB by removing mode switching code)

33. **Google Drive Connector** (Session 7 - February 28, 2026)
    - **New Lambda: xo-gdrive-import** (Python 3.11, 512 MB, 120s timeout)
    - 4 routes: GET /gdrive/auth-url, POST /gdrive/callback, GET /gdrive/files, POST /gdrive/import
    - **Google OAuth2 popup flow**: consent URL → popup → redirect → code exchange → refresh token stored in DB
    - Dependencies: google-auth, google-auth-oauthlib, google-api-python-client
    - Google Docs auto-export: Docs/Slides→PDF, Sheets→CSV
    - **DB migration**: 3 new columns (users.google_drive_refresh_token, users.google_drive_connected_at, uploads.source)
    - uploads.source defaults to 'manual', Google Drive imports recorded as 'google_drive'
    - **Frontend Sources strip**: 5 connector pills below drop zone (Upload, Google Drive, NotebookLM, Dropbox, OneDrive)
    - Upload and Google Drive are active connectors; NotebookLM, Dropbox, OneDrive grayed out (future)
    - **Google Drive file picker modal**: dark modal with folder navigation, file selection, import button
    - Folder navigation with back button and breadcrumb stack
    - File count display updated: "3 files selected (1 from Drive)"
    - Upload logic updated: manual files get presigned URLs, imported files skip S3 PUT (already in S3)
    - API Gateway: 4 new routes with OPTIONS, AWS_PROXY integration, Lambda invoke permission
    - Deploy scripts updated: set-db-config.sh (7 Lambdas), deploy.sh notes
    - Frontend build: ~224 KB JS
    - Files: 7 files created/modified

34. **Session Persistence Fix** (Session 8 - March 1, 2026)
    - **Root cause**: `isTokenExpired()` used `atob()` which can fail on JWT URL-safe base64 (`-` and `_` chars)
    - When `atob()` threw, catch block returned `true` (expired) → session silently cleared on restore
    - **Fix 1**: `isTokenExpired()` now converts URL-safe base64 to standard (`-`→`+`, `_`→`/`) and adds padding before `atob()`
    - **Fix 2**: Session restore moved from `useEffect` (async, after first render) to synchronous `useState` initializer
    - Old behavior: App always rendered LoginScreen first, then useEffect restored session on next tick → flash of login screen
    - New behavior: `getInitialAuth()` reads localStorage synchronously before first render → no flash, no race condition
    - `getInitialAuth()` wrapped in try/catch for JSON parse and localStorage errors → graceful fallback to logged-out state
    - Debug confirmed: backend `/auth/login` returns valid tokens, `getAuthHeaders()` sends Bearer token correctly
    - Deployed to production via CloudFront invalidation

35. **Model Selector + Opus Default** (Session 8 - March 1, 2026)
    - **AI Model selector** in Configuration screen: radio-button cards for Opus 4.5 and Sonnet 4.5
    - Opus 4.5 is default (best analysis quality); Sonnet 4.5 available (faster, cheaper)
    - Per-user preference stored in PostgreSQL (`users.preferred_model` column)
    - **DB migration**: `ALTER TABLE users ADD COLUMN preferred_model VARCHAR(100) DEFAULT 'claude-opus-4-5-20250529'`
    - **New API route**: PUT /auth/preferences (validates model against allowed list, updates DB)
    - **xo-auth Lambda updated**: login response includes `preferred_model`, new `handle_preferences` endpoint
    - **xo-enrich Lambda updated**: reads model from request body → user DB preference → default Opus
      - `analyze_with_claude()` now accepts `model` parameter
      - Lambda timeout increased from 120s to 300s (5 minutes) for Opus response times
    - **Frontend**: model selector with purple (Opus) and blue (Sonnet) accent cards
    - **Enrich screen**: model badge in header (purple "Opus 4.5" / blue "Sonnet 4.5")
    - **EnrichScreen** sends `model: preferredModel` in /enrich request body
    - API Gateway: /auth/preferences resource with PUT + OPTIONS, Lambda invoke permissions
    - Frontend build: ~226 KB JS
    - Deployed: xo-auth Lambda, xo-enrich Lambda, frontend, CloudFront invalidation

36. **Audio Transcription + Context Metadata** (Session 9 - March 1, 2026)
    - **AWS Transcribe integration** for MP3, WAV, M4A, AAC, OGG, FLAC, WMA files
    - Audio files now transcribed during enrichment and included in Claude analysis
    - **Async Lambda pattern**: xo-enrich refactored to two-phase execution
      - Phase 1 (synchronous, <2s): auth, validate, create enrichment record, self-invoke async → return immediately
      - Phase 2 (async invocation): extract text → transcribe audio → analyze with Claude → write results
      - Fixes API Gateway 29-second timeout for large enrichments
    - **Stage tracking**: new `enrichments.stage` DB column (extracting → transcribing → researching → analyzing → complete)
      - xo-results Lambda returns `stage` in polling response
      - Frontend stage tracker already wired (5 stages with icons including "Transcribing Audio")
    - **Transcription pipeline**: `find_audio_files()` → `transcribe_single_file()` (poll every 5s, max 240s) → `read_transcribe_output()`
    - Transcripts saved to `{client_id}/extracted/{filename}.transcript.txt`
    - Raw Transcribe output saved to `{client_id}/extracted/.transcribe-output/{filename}.json`
    - **Audio context metadata**: per-audio-file context form in upload screen
      - Date of recording (date picker, defaults to today)
      - Participants (text field, e.g., "Ken Scott, Alan Moore")
      - Context/Topic (text field, e.g., "Weekly strategy call")
      - Saved as `{filename}.context.json` alongside audio in S3 uploads folder
    - **Context-aware transcripts**: enrich Lambda reads context JSON and prepends to each transcript:
      `"Audio Transcript (file.mp3) -- Date: 2026-03-01 -- Participants: Ken, Alan -- Topic: Strategy call"`
    - `extract_all_files()` skips audio files (handled by Transcribe) and `.context.json` files (metadata only)
    - **DB migration**: `ALTER TABLE enrichments ADD COLUMN IF NOT EXISTS stage VARCHAR(50) DEFAULT 'extracting'`
    - **IAM**: transcribe:StartTranscriptionJob, transcribe:GetTranscriptionJob, lambda:InvokeFunction (self-invoke)
    - Frontend build: ~229 KB JS
    - Deployed: xo-enrich Lambda, xo-results Lambda, frontend, CloudFront invalidation, DB migration
    - Files: 4 files modified (schema.sql, enrich/lambda_function.py, results/lambda_function.py, App.jsx)

37. **Enrichment Templates, Structured Output, Client Config** (Session 9 - March 1, 2026)
    - **Default skill template** (`backend/templates/default-skill.md`): ships with every new client
      - 5 sections: Context, Focus Areas, Ignore List, Output Format, Authority Boundaries
      - Editable via Skills screen -- customizes how Claude analyzes each client
      - xo-clients Lambda copies `analysis-template.md` to `{client_id}/skills/` on client creation
      - Skill record inserted into DB (skills table) so it appears in Skills screen immediately
    - **Structured output prompt**: complete rewrite of the First Party Trick prompt
      - ASCII architecture diagrams (box-drawing characters) for proposed systems
      - Table-format database schemas (Column | Type | Description)
      - Schema relationships as explicit `table.column -> table.column` declarations
      - Numbered, measurable actions in 7/14/21 day plan
      - Bottom Line section: direct CEO-level summary (what to do, what it costs, what to expect)
      - New JSON fields: `architecture_diagram`, `schema.relationships`, `bottom_line`
    - **Client config** (`{client_id}/client-config.md`): generated on client creation
      - Structured context document from New Partner form inputs
      - Sections: Company Profile, Primary Contact, Immediate Pain Point, Analysis Instructions
      - Injected into every Claude call as persistent context (like CLAUDE.md for each client)
      - Read by enrich Lambda via `read_client_config()` function
    - **Frontend Results screen enhancements**:
      - New "Bottom Line" panel with red accent bar (appears first, after summary)
      - New "Proposed Architecture" panel with monospace pre-formatted ASCII diagram
      - Schema relationships section below table definitions
    - Frontend build: ~231 KB JS
    - Deployed: xo-clients Lambda, xo-enrich Lambda, frontend, CloudFront invalidation
    - Files: 5 files created/modified (default-skill.md, clients/lambda_function.py, enrich/lambda_function.py, App.jsx, CLAUDE.md)

38. **System Skills Layer + Enrichment Info Popover** (Session 9 - March 1, 2026)
    - **System skills** (`backend/system-skills/`): 4 markdown files always injected into every enrichment call
      - `analysis-framework.md` -- Revenue drivers, cost structure, operational bottlenecks, competitive position, risk factors; quantification rules
      - `output-format.md` -- Numbered sections, table schemas, severity ratings, confidence scores, source citations, bottom line format
      - `authority-boundaries.md` -- What to recommend directly vs flag for human review; hard rules (never recommend firing, never give legal advice, caveat financials)
      - `enrichment-process.md` -- Data source hierarchy: client data (ground truth) > context > audio transcripts > web research > inferred patterns
    - **Three-tier skill injection order** in Claude prompt:
      1. System skills (always, bundled with Lambda, not client-visible)
      2. Client config (client-config.md, generated from partner form)
      3. Client/domain skills (editable in Skills screen, customizable per client)
    - `load_system_skills()` reads from `system-skills/` directory bundled in Lambda package
    - `deploy-enrich.sh` updated to copy `system-skills/*.md` into Lambda package
    - **System Skills section in Configuration screen**: read-only admin view showing all 4 system skills with lock icon and descriptions
    - **Enrichment info popover** on Enrich screen:
      - Info icon (circle) next to Start Enrichment button
      - Click shows popover with 6 numbered steps: Extract, Context, Skills, Web Research, AI Analysis, Output
      - Shows current model badge (Opus/Sonnet) with "Change model in Configuration" hint
      - Dismisses on click outside
    - Frontend build: ~235 KB JS
    - Deployed: xo-enrich Lambda (with system-skills), frontend, CloudFront invalidation
    - Files: 8 files created/modified (4 system-skills .md files, deploy-enrich.sh, enrich/lambda_function.py, App.jsx)

39. **Simplified Skill Creation Form** (Session 10 - March 1, 2026)
    - **Replaced raw markdown textarea** in AddSkillModal with structured plain-English form
    - Four guided fields (no markdown knowledge required):
      - "What should the AI focus on?" -- metrics, problems, themes to prioritize
      - "What should the AI ignore or avoid?" -- topics and assumptions to skip
      - "What does success look like?" -- desired outcomes for the analysis
      - "Any industry terms or jargon to know?" -- domain-specific vocabulary
    - Each field has descriptive hints and placeholder examples
    - **Auto-converts to markdown** behind the scenes via `buildMarkdown()` -- user never sees or writes markdown
    - **Edit mode**: parses existing skill markdown back into structured fields via regex section extraction
    - **Upload mode preserved** for power users: "Advanced: Upload .md file" toggle (accepts .md and .txt)
    - Upload shows file loaded confirmation with character count
    - Tip text updated: "Answer in plain English. The AI will use your answers to guide its analysis."
    - Frontend build: ~238 KB JS
    - Deployed: frontend to S3, CloudFront invalidation
    - Files: 1 file modified (App.jsx)

40. **Skills Empty State & Context Text** (Session 10 - March 1, 2026)
    - **Fixed infinite spinner bug**: When `clientId` is falsy, `fetchSkills` never ran so `loading` stayed `true` forever — added `else { setLoading(false) }` fallback
    - **Improved empty state**: Updated message to "No skills yet. Skills guide how the AI analyzes your business. Add your first skill to get started." with an inline + Add Skill button
    - **Added context text** below Skills header: "Skills teach the AI what to focus on, what to ignore, and what success looks like for your business. Think of them as instructions for your analyst."
    - Frontend build: ~238 KB JS
    - Deployed: frontend to S3, CloudFront invalidation
    - Files: 1 file modified (App.jsx)

41. **Design Consistency + Duplicate Button Fix** (Session 10 - March 1, 2026)
    - **Removed duplicate "+ Add Skill" button** from empty state body — only one in header bar
    - **Restructured Skills screen** to match Enrich screen layout pattern:
      - Single `<div className="panel">` wrapping entire screen (was separate header + list panels)
      - `panel-header` with icon + title + badge + action button on right
      - Inner body `<div style={{ padding: '1.25rem' }}>` matching Enrich padding
    - **Empty state now matches Enrich "Ready to Enrich" design**:
      - Centered icon at `size={64}`, red color, `opacity: 0.5` (same as Sparkles icon on Enrich)
      - Bold heading "No Skills Yet" at `1.125rem` / `fontWeight: 600` (same as "Ready to Enrich Your Data")
      - Description text at `0.875rem`, `color: var(--text-secondary)`, `lineHeight: 1.6` (matches Enrich description)
      - Subtle hint: 'Click **+ Add Skill** above to get started.' in muted text
    - **Context text moved** from standalone paragraph into the centered empty state body
    - **Loading state** also redesigned to match: centered spinner icon at 64px, heading "Loading Skills"
    - **Skill cards** use bordered rows within the single panel body (no nested panels)
    - Frontend build: ~238 KB JS
    - Deployed: frontend to S3, CloudFront invalidation
    - Files: 1 file modified (App.jsx)

42. **Enrichment Info Modal** (Session 10 - March 1, 2026)
    - **Replaced clipped popover** with centered modal overlay — enrichment info was opening downward and falling off screen
    - Uses `modal-overlay` class (same as other modals) for consistent backdrop + centering
    - Card: 400px wide, `maxWidth: 90vw`, rounded corners, shadow
    - Header row with title + X close button
    - Same 6-step content, slightly larger text for readability (0.85rem labels, 0.8rem descriptions)
    - Dismiss on click outside (overlay) or X button
    - Model badge + "Change model in Configuration" footer preserved
    - Frontend build: ~239 KB JS
    - Deployed: frontend to S3, CloudFront invalidation
    - Files: 1 file modified (App.jsx)

43. **Source Library** (Session 11 - March 1, 2026)
    - **New SourcesScreen component** (~400 lines): NotebookLM-style source management
      - **Source Library panel**: card list with file type icon, filename, version badge (v2/v3), source pill (Local/Google Drive), file size, date, active/inactive toggle, kebab menu (Replace, Delete)
      - **Add Sources panel**: drag-and-drop zone with immediate upload, sources strip (Upload, Google Drive, NotebookLM, Dropbox, OneDrive), Google Drive picker modal
      - Summary bar: "X active · Y total · Z MB"
      - Delete confirmation modal, replace with version linking
      - Empty state + no-clientId state
    - **Sidebar**: "Sources" added between Welcome and Enrich (FolderOpen icon)
    - **UploadScreen Step 2 refactored**: Full drag-drop zone replaced with compact summary (source count + "Manage Sources" button). Google Drive code moved to SourcesScreen.
    - **CompanyInfoModal**: Now creates client on save (so Sources screen has clientId for uploads)
    - **Upload button renamed** to "Continue to Enrichment" (files already uploaded via Sources)
    - **DB migration**: 5 new columns on uploads table (status, file_size, version, parent_upload_id, replaced_at) + 2 indexes
    - **Upload Lambda rewritten** as method router: POST /upload + GET /uploads + DELETE /uploads/{id} + PUT /uploads/{id}/toggle + POST /uploads/{id}/replace
    - **Enrich Lambda updated**: Queries active S3 keys from DB, passes to extract_all_files, skips inactive/deleted files
    - Frontend build: ~248 KB JS
    - Branch: feature/source-library
    - Files: 4 files modified (App.jsx, schema.sql, upload/lambda_function.py, enrich/lambda_function.py)

44. **UI Polish, Domain Persistence, Source Library Fixes** (Session 12 - March 1, 2026)
    - **Forgot Password**: Added "Forgot Password?" link + reset form on login screen (email, new password, confirm). Uses POST /auth/reset-password.
    - **clientId persistence**: Fixed Source Library "Complete Domain Expertise First" bug -- clientId now persisted to localStorage, cleared on logout.
    - **Domain Expertise persistence**: Clients Lambda rewritten as method router (GET/PUT/POST). Frontend fetches existing client data on login, pre-populates CompanyInfoModal. Save does upsert (PUT if exists, POST if new). API Gateway routes added for GET/PUT /clients.
    - **Welcome screen cleanup**:
      - Removed redundant "Continue to Enrichment" bar from bottom of page
      - Removed duplicate Enrich/Skills buttons from "AI-Powered Business Intelligence" section
      - Moved Enrich (green #22c55e) and Skills (blue #3B82F6) buttons into Intellagentic Growth card (card 3)
      - Skills button above Enrich button
    - **Source Library kebab menu fixes**:
      - Fixed dropdown overflow: overrode `.panel` `overflow:hidden` with inline `overflow:visible`
      - Wrapper uses `position:relative`, dropdown uses `right:0, top:100%`
      - Restyled: white background, dark text (#1a1a1a), subtle border (#e5e7eb), soft box-shadow
      - Added View menu item (opens S3 URL), divider before Delete (red text)
      - Hover states: #f3f4f6 for View/Replace, #fef2f2 for Delete
    - **Connector pills visibility**: Google Drive + coming-soon pills now use CSS variables for theme compatibility
    - **Upload status default**: Upload Lambda explicitly sets `status='active'` on INSERT (both upload and replace handlers). DB column enforced as NOT NULL DEFAULT 'active'. Fixed existing inactive rows.
    - Branch: feature/source-library
    - Files: App.jsx, clients/lambda_function.py, upload/lambda_function.py

45. **Fix xo-enrich Lambda pydantic_core Import Error** (Session 13 - March 2, 2026)
    - **Root cause**: Local `pip3` is Python 3.14 (macOS ARM). `pip3 install -t package/` installed `pydantic_core` compiled as `cpython-314-darwin.so` — wrong Python version (3.14 vs 3.11) and wrong platform (macOS ARM vs Amazon Linux x86_64).
    - **Symptom**: `[ERROR] Runtime.ImportModuleError: Unable to import module 'lambda_function': No module named 'pydantic_core._pydantic_core'` — all enrichment requests failing.
    - **Fix**: Updated `deploy-enrich.sh` to use platform-targeting flags: `--platform manylinux2014_x86_64 --implementation cp --python-version 3.11 --only-binary=:all:`
    - **Result**: `pydantic_core/_pydantic_core.cpython-311-x86_64-linux-gnu.so` — correct binary for Lambda runtime
    - **Also fixed**: `deploy-gdrive.sh` with same platform flags to prevent future issues
    - Deployed xo-enrich Lambda, verified clean INIT and 200 response
    - Files: deploy-enrich.sh, deploy-gdrive.sh

46. **Delete Modal Contrast Fix** (Session 13 - March 2, 2026)
    - **Delete confirmation modal** on Source Library had low-contrast text (CSS variables blending into dark overlay)
    - Fixed with hardcoded light colors (same pattern as kebab menu fix, build #43):
      - Card background: `#ffffff` with `#e5e7eb` border and depth shadow
      - Heading "Delete Source?": `#1a1a1a` (dark black)
      - Description text: `#444444` (dark gray, was `#6b7280`)
      - Cancel button: `#f3f4f6` background, `#333333` text, `#d1d5db` border
      - Delete button: `#ef4444` background, `#ffffff` text
    - Files: App.jsx

47. **Fix xo-enrich Lambda Self-Invoke Permission** (Session 13 - March 2, 2026)
    - **Root cause**: `xo-lambda-role` IAM role missing `lambda:InvokeFunction` permission
    - xo-enrich uses async self-invoke pattern (Phase 1 calls itself for Phase 2) but the IAM policy was never attached
    - Error: `AccessDeniedException: User xo-lambda-role/xo-enrich is not authorized to perform lambda:InvokeFunction`
    - **Fix**: Added inline IAM policy `xo-lambda-invoke` to `xo-lambda-role`:
      - `lambda:InvokeFunction` on `arn:aws:lambda:us-west-1:941377154043:function:xo-enrich`
      - `transcribe:StartTranscriptionJob` + `transcribe:GetTranscriptionJob` on `*`
    - Verified clean execution with no AccessDeniedException

48. **Model ID Update — Opus 4.6, Sonnet 4.5, Haiku 4.5** (Session 13 - March 2, 2026)
    - **Updated all model IDs** across the entire stack (4 files, 14 occurrences):
      - Old default: `claude-opus-4-5-20250529` → New default: `claude-sonnet-4-5-20250929`
      - Old allowed: `[claude-opus-4-5-20250529, claude-sonnet-4-20250514]` → New allowed: `[claude-opus-4-6, claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001]`
    - **xo-enrich Lambda**: updated defaults, allowed list, Phase 2 fallback, `analyze_with_claude()` default parameter
    - **xo-auth Lambda**: updated `_success_response` default, DB query COALESCE default, `handle_preferences` allowed list
    - **Frontend (App.jsx)**: updated MODEL_LABELS (3 entries), Configuration selector (3 cards: Opus purple, Sonnet blue, Haiku green), default preferredModel
    - **schema.sql**: updated `preferred_model` column default
    - **Configuration screen** now shows 3 model cards:
      - Claude Opus 4.6 (purple #a855f7) — Best analysis, deeper reasoning
      - Claude Sonnet 4.5 (blue #3b82f6) — Balanced speed and quality (default)
      - Claude Haiku 4.5 (green #22c55e) — Fastest responses, lowest cost
    - Deployed: xo-enrich Lambda, xo-auth Lambda, frontend to S3/CloudFront
    - Files: App.jsx, auth/lambda_function.py, enrich/lambda_function.py, schema.sql

49. **Add .docx Extraction to Enrich Lambda** (Session 13 - March 2, 2026)
    - Enrichment failed when only .docx files uploaded — `extract_text()` returned "Unsupported file type: docx"
    - Added `extract_docx()` function using `python-docx` library: extracts paragraph text + table content (rows with pipe-delimited cells)
    - Added `python-docx==1.1.2` to requirements.txt (package size 7.5MB → 13MB)
    - Updated `extract_text()` routing: `docx`/`doc` extensions → `extract_docx()`
    - Deployed and verified: .docx files now extracted successfully
    - Files: enrich/lambda_function.py, enrich/requirements.txt

50. **Frontend Polling Resilience** (Session 13 - March 2, 2026)
    - Frontend showed "Enrichment Failed" because a single failed poll request killed all polling (zero error tolerance)
    - **Fix 1 — Retry tolerance**: Allows up to 5 consecutive failed poll requests before giving up (resets on success)
    - **Fix 2 — 5-minute max timeout**: Polling stops after 5 minutes with helpful message ("Check Results tab — it may have completed")
    - **Fix 3 — Poll interval**: Changed from 2s to 3s (reduces transient failure chance)
    - **Fix 4 — Results Lambda**: Always sets `results['status'] = 'complete'` on response instead of relying on Claude JSON output
    - Deployed: xo-results Lambda + frontend to S3/CloudFront
    - Files: App.jsx, results/lambda_function.py

51. **Fix Claude JSON Truncation — max_tokens + JSON Repair** (Session 13 - March 2, 2026)
    - **Root cause**: `max_tokens=8000` too small for analysis response. Claude's ~28K char response hit the token limit mid-JSON-string, producing `Unterminated string starting at: line 179 column 18 (char 28618)`. Error handler wrote empty results to S3.
    - **Fix 1 — Increased `max_tokens`**: 8000 → 16000 (primary fix — 16K tokens ≈ 64K chars, well above typical responses)
    - **Fix 2 — JSON repair function** (`_repair_truncated_json`): Safety net that closes unclosed strings, strips trailing commas, closes unclosed `[]`/`{}` brackets in correct order. Recovers partial analysis instead of returning empty results.
    - **Fix 3 — Better logging**: Logs `Claude response: {len} chars, stop_reason={stop_reason}` to CloudWatch for debugging truncation vs completion
    - Deployed xo-enrich Lambda
    - Files: enrich/lambda_function.py

52. **Google OAuth Login + Multi-Client Admin Dashboard** (Session 14 - March 3, 2026)
    - **Google OAuth login** for admin users via Google Identity Services (GIS) library
      - Frontend: Google Sign-In button as primary, "Sign in with email instead" link for fallback
      - Backend: `POST /auth/google` — verifies Google ID token via Google's tokeninfo endpoint (stdlib `urllib`, no new deps)
      - Hardcoded `ALLOWED_EMAILS` list: 4 admin emails (alan.moore@intellagentic.io, ken.scott@intellagentic.io, rs@multiversant.com, vn@multiversant.com)
      - Google users created with sentinel `password_hash='google-oauth-no-password'` (blocks password login)
      - JWT includes `is_admin` flag; frontend uses it to show dashboard vs single-client flow
    - **Admin Dashboard** (`DashboardScreen` component)
      - Fetches `GET /clients/list` — returns all clients with source count, enrichment status/date
      - Grid of client cards: company name, industry badge, source count, enrichment status badge (none/processing/complete/error), last enrichment date
      - Click card → fetches full client data, enters workspace scoped to that client
      - "+ New Client" button → opens CompanyInfoModal → creates client → enters workspace
      - Empty state, loading state, error state with retry
    - **Sidebar update**: "All Clients" (Building2 icon) at top for admin users, with divider
    - **Header subtitle**: "Client Dashboard" when on dashboard, company name in workspace
    - **API Gateway**: Added `/auth/google` (POST+OPTIONS → xo-auth), `/clients/list` (GET+OPTIONS → xo-clients), deployed to prod
    - **GOOGLE_CLIENT_ID** env var added to xo-auth Lambda (same value from xo-gdrive-import)
    - Self-serve email/password login preserved — non-admin users go straight to single-client workspace
    - Files: auth/lambda_function.py, clients/lambda_function.py, shared/auth_helper.py, App.jsx

53. **Add vn@multiversant.com to Allowed Admin Emails** (Session 14 - March 3, 2026)
    - Added Vamsi Nama (vn@multiversant.com) to ALLOWED_EMAILS list in xo-auth Lambda
    - Redeployed xo-auth Lambda
    - Files: auth/lambda_function.py

54. **Client Logo & Icon Branding** (Session 15 - March 3, 2026)
    - **Database**: Added `logo_s3_key` and `icon_s3_key` VARCHAR(500) columns to clients table
    - **Upload Lambda** — 2 new endpoints:
      - `POST /upload/branding` — presigned PUT URL for logo or icon, stores S3 key in clients table
      - `GET /upload/branding?client_id=X` — presigned GET URLs for viewing logo/icon
      - Validates content type (PNG, JPG, SVG, WebP), overwrites previous on re-upload
    - **Clients Lambda** — presigned URLs generated server-side:
      - `GET /clients/list` returns `icon_url` per client (presigned GET, 1h expiry) for dashboard cards
      - `GET /clients` returns `logo_url` and `icon_url` for workspace header
    - **Enrich Lambda** — webhook payload updated:
      - `client_logo_url` and `client_icon_url` (direct S3 URLs) added to Streamline webhook
      - Both `_run_enrichment_pipeline` and `_handle_send_to_streamline` include branding
    - **Frontend (App.jsx)**:
      - **CompanyInfoModal** — "Client Branding" section with drag-and-drop/click upload zones for logo (400x100px) and icon (128x128px), thumbnail previews, 2MB client-side validation
      - **Dashboard cards** — 32x32px client icon to left of company name, letter-in-circle fallback
      - **Workspace header** — client logo (20px height) next to company name in subtitle
      - `companyData` state extended with `logoUrl`/`iconUrl`, populated from API responses
    - S3 folder structure: `{client_id}/branding/logo.{ext}` and `{client_id}/branding/icon.{ext}`
    - **Deployment needed**: SQL migration, 3 Lambdas (upload, clients, enrich), API Gateway route `/upload/branding` (GET+POST+OPTIONS), frontend build
    - Files: schema.sql, upload/lambda_function.py, clients/lambda_function.py, enrich/lambda_function.py, App.jsx

55. **Branding Screen — Dedicated Sidebar Page** (Session 15 - March 3, 2026)
    - Moved branding upload from hidden-in-modal to a **dedicated BrandingScreen** component
    - **Sidebar**: Added "Branding" item (Image icon) between Configuration and Light/Dark Mode toggle
      - Only visible when inside a client workspace (hidden on All Clients dashboard)
    - **BrandingScreen** (full page, max-width 700px centered):
      - Company Logo card — large drop zone with drag-and-drop + click-to-browse, preview after upload, "Click or drop to replace" hint
      - Company Icon card — same pattern, square format
      - Preview section (appears after upload): header logo mockup (dark bar with XO box + logo), dashboard card icon mockup (icon + company name)
      - No-client empty state: "No Client Selected" with guidance message
    - Branding upload still also available in CompanyInfoModal (compact version at bottom)
    - Deployed frontend to S3/CloudFront
    - Files: App.jsx

56. **Streamline Webhook Toggle** (Session 15 - March 3, 2026)
    - **Database**: Added `streamline_webhook_enabled BOOLEAN DEFAULT FALSE` to clients table
    - **Clients Lambda**:
      - `GET /clients` returns `streamline_webhook_enabled` in response
      - `PUT /clients` accepts and persists `streamline_webhook_enabled` (optional field, only updated if present)
    - **Enrich Lambda**:
      - Reads `streamline_webhook_enabled` from clients table in `_run_enrichment_pipeline`
      - Only fires `_send_streamline_webhook()` if flag is true
      - Logs "Streamline webhook disabled for client" when skipped
      - `POST /send-to-streamline` (manual button) unaffected — always works as manual override
    - **Frontend (ConfigurationScreen)**:
      - "Streamline Webhook" panel (Send icon) between System Skills and Configure Buttons
      - Toggle switch: "Send to Streamline" with description, default OFF
      - Persists immediately to DB via `PUT /clients` on toggle
      - Webhook URL displayed read-only below toggle
      - Note: "Send to Streamline button on Results screen works regardless of this toggle"
      - Only shown when inside a client workspace (requires `clientId`)
    - Deployed frontend to S3/CloudFront
    - Files: schema.sql, clients/lambda_function.py, enrich/lambda_function.py, App.jsx

57. **Backend Deployment — Branding + Webhook** (Session 16 - March 3, 2026)
    - **SQL Migration**: Ran 3 ALTER TABLE statements via Python/psycopg2 (logo_s3_key, icon_s3_key, streamline_webhook_enabled)
    - **Lambda Deployments**:
      - xo-clients: Updated with branding presigned URLs + webhook toggle fields
      - xo-upload: Updated with `handle_branding_upload()` and `handle_branding_get()` endpoints
      - xo-enrich: Updated with branding in webhook payload + webhook enabled check
    - **API Gateway**: Created `/upload/branding` resource with POST, GET, OPTIONS methods → xo-upload Lambda
    - Added Lambda invoke permission for API Gateway → xo-upload on branding route
    - Deployed API Gateway to prod stage
    - All v1.25–v1.27 backend changes now live

58. **Client Context Bar** (Session 17 - March 3, 2026)
    - Added secondary context bar below the main "XO Capture" header, visible only inside client workspaces
    - **Left side**: "Back to All Clients" link with ChevronLeft icon → navigates to dashboard
    - **Right side**: Client icon (28px with letter fallback), company name (bold), industry pill badge
    - Conditionally rendered: hidden on dashboard, shown when `clientId` is set
    - Simplified header subtitle: removed duplicate company name/logo from main header; shows "Domain Partner Onboarding" in workspace
    - Reused existing patterns: icon fallback from dashboard cards, `navigateTo()`, `companyData` state
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

59. **Client Banner & Header Cleanup** (Session 17 - March 3, 2026)
    - **Header**: Renamed "XO Capture" → "Capture" (XO logo-box already present, text was redundant)
    - **Header subtitle**: Removed entirely in workspace view; only shows "Client Dashboard" on dashboard
    - **Removed context bar** from session 58 — replaced with in-page client identity banner
    - **Client Identity Banner**: Rendered inside `<main>` above screen content (between header and dark cards)
      - Client logo (44px, `companyData.logoUrl`) or letter fallback (44px dark circle, red letter)
      - Company name (1.25rem, bold)
      - "Client Workspace" label below in subtle text
    - Navigation back to dashboard remains in sidebar ("All Clients")
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

60. **Client Banner — Logo-only mode** (Session 17 - March 3, 2026)
    - **With logo**: Shows only the logo image + "Client Workspace" subtitle (no company name text — logo speaks for itself)
    - **Without logo**: Shows letter fallback icon + company name (bold) + "Client Workspace" subtitle
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

61. **Contact Email & Phone Fields** (Session 17 - March 3, 2026)
    - **Frontend**: Added "Contact Email" (email input) and "Contact Phone" (text input for international formats like +44, +1) to Domain Expertise form, between Contact Title and LinkedIn
    - **Database**: Added `contact_email VARCHAR(500)` and `contact_phone VARCHAR(100)` columns to clients table via migration
    - **Clients Lambda**: GET returns `contactEmail`/`contactPhone`, PUT/POST persist both fields, `generate_client_config()` includes email/phone in Primary Contact section
    - **Enrich Lambda**: Reads `contact_email`/`contact_phone` from DB, passes to Streamline webhook as `client_email`/`client_phone`
    - **Schema**: Added ALTER TABLE statements in `schema.sql`
    - Files: `src/App.jsx`, `backend/lambdas/clients/lambda_function.py`, `backend/lambdas/enrich/lambda_function.py`, `backend/schema.sql`
    - Deployed: frontend (S3/CloudFront), xo-clients Lambda, xo-enrich Lambda

62. **Fix xo-clients Lambda — missing auth_helper** (Session 17 - March 3, 2026)
    - **Root cause**: Session 61 deploy zipped only `clients/` directory, missing `auth_helper.py` from `backend/lambdas/shared/`
    - Lambda failed with `Runtime.ImportModuleError: No module named 'auth_helper'`
    - **Fix**: Copied `auth_helper.py` into zip alongside `lambda_function.py`, redeployed
    - Verified: Lambda returns 401 (correct — no auth token in test), no more import errors
    - Dashboard `/clients/list` endpoint restored

63. **Client Banner — show uploaded icon/logo** (Session 17 - March 3, 2026)
    - Banner now uses priority: logo → icon → letter fallback (previously skipped icon)
    - Branding upload state refresh already working (both CompanyInfoModal and BrandingScreen call `setCompanyData` after upload)
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

64. **Video/Audio File Support** (Session 17 - March 3, 2026)
    - **Frontend**: Added `.mp4`, `.webm` to file picker accept list; helper text now reads "Video, Audio"
    - **Enrich Lambda**: Added `mp4`, `webm` to `AUDIO_EXTENSIONS` set and `media_format_map` — routed through existing AWS Transcribe pipeline
    - **Transcribe poll timeout**: 240s → 360s (large video files can take 2–5 min)
    - **Lambda timeout**: 300s → 600s (10 min, accommodates transcription + Claude analysis)
    - Existing pipeline already handles: Transcribe job start, poll, transcript extraction, filename labeling, inclusion in Claude prompt
    - Files: `src/App.jsx`, `backend/lambdas/enrich/lambda_function.py`
    - Deployed: frontend (S3/CloudFront), xo-enrich Lambda, Lambda timeout config

65. **Delete Client from Dashboard** (Session 17 - March 3, 2026)
    - **Frontend**: Trash icon on each client card (gray → red on hover), confirmation modal with hardcoded contrast colors (#1a1a1a heading, #444 description), Cancel + Delete buttons matching source delete style
    - **Backend**: New `handle_delete_client()` in clients Lambda — verifies ownership, deletes from DB (cascades to uploads, enrichments, skills), deletes entire S3 folder via paginated delete
    - **API Gateway**: Added DELETE method on `/clients` resource → xo-clients Lambda proxy integration + invoke permission, deployed to prod
    - Files: `src/App.jsx`, `backend/lambdas/clients/lambda_function.py`
    - Deployed: frontend (S3/CloudFront), xo-clients Lambda, API Gateway

66. **Remove "XO" from sidebar header** (Session 17 - March 3, 2026)
    - Removed redundant XO logo-box from sidebar header — now shows user name + email only
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

67. **Multi-Contact Support Per Client** (Session 18 - March 3, 2026)
    - **Database**: Added `contacts_json TEXT` column to clients table — stores JSON array of contacts
    - **Clients Lambda**: GET returns `contacts` array (with legacy fallback from `contact_*` columns); PUT/POST accept `contacts` array and sync `contacts[0]` to legacy columns for backward compat; `generate_client_config()` renders all contacts with "Primary Contact" / "Contact 2" / etc. headings
    - **Enrich Lambda**: Phase 2 reads `contacts_json` with legacy fallback; `analyze_with_claude()` includes all contacts in prompt enrichment info; `_send_streamline_webhook()` sends both legacy flat fields (from primary) and full `contacts` array
    - **Frontend**: `companyData` state uses `contacts: []` array instead of flat `contactName`/`contactTitle`/etc. fields; CompanyInfoModal renders dynamic contact cards with Add/Remove; each card has 2-column grid (Name, Title, Email, Phone) + full-width LinkedIn; "Primary Contact" badge on first card; empty state with dashed border prompt
    - **Backward compatible**: Existing clients with only legacy `contact_*` columns appear as a single primary contact card when opened
    - Files: `backend/schema.sql`, `backend/lambdas/clients/lambda_function.py`, `backend/lambdas/enrich/lambda_function.py`, `src/App.jsx`
    - Deployed: DB migration (RDS), xo-clients Lambda, xo-enrich Lambda, frontend (S3/CloudFront)

68. **Workspace Two-Column Split View** (Session 19 - March 3, 2026)
    - **Layout**: Replaced 3-column horizontal card grid with permanent two-column split layout (38% left / 62% right)
    - **Left Column — Client Profile Card**: Logo/icon/letter avatar, company name + industry badge, website link, all contacts inline (name, title, email, phone) with "Primary" badge on first contact, Add Contact + Edit Details buttons
    - **Right Column — Workflow Cards**: Raw Data and Intellagentic Growth cards stacked vertically with horizontal badge+content layout; step badges renumbered 1 & 2
    - **Removed**: Domain Expertise card (functionality moved to profile card)
    - **Responsive**: flexWrap wrap with minWidth constraints — stacks vertically on narrow viewports
    - **Empty state**: Left column shows "New Partner" button when no client configured
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

69. **Inline Partner Information Form + Domain Expertise Card Restored** (Session 19 - March 3, 2026)
    - **Left Column**: Replaced read-only profile card with always-visible, editable Partner Information form — Company Name, Website URL, Industry, Description, Pain Point fields + Contacts section with Add/Remove (2-col grid: Name, Title, Email, Phone + LinkedIn) + Save button with loading state
    - **Right Column**: Restored Domain Expertise card as first card (step 1, "The Filter") showing company name/industry when saved; Raw Data card (step 2); Intellagentic Growth card (step 3) — all three stacked vertically
    - **No modal needed**: Partner info is edited directly in the left column; form state syncs from companyData on client switch
    - Props added: `setCompanyData` and `onClientCreate` passed to UploadScreen for inline save
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

70. **Light Theme for Partner Information Form** (Session 19 - March 3, 2026)
    - **Left column restyled**: White background (#ffffff), light gray border (#e0e0e0), dark text (#111827) — visually distinct from dark workflow cards on right
    - **Inputs**: Light gray background (#f9fafb) with gray borders (#d1d5db); labels in muted gray (#6b7280)
    - **Contacts**: Cards use #f9fafb background with #e5e7eb borders; inner inputs white with gray borders
    - **Divider**: Changed from semi-transparent white to #e5e7eb
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

71. **Screenshot Tip, Text Input Source, Partner Form Autosave** (Session 20 - March 4, 2026)
    - **Screenshot tip**: Added tip below file drop zone — "You can screenshot WhatsApp messages, text conversations, or any screen and drop them in as images." PNG, JPG, JPEG, WEBP added to valid upload extensions and file picker accept list
    - **Text input source**: New "Paste Text Source" section in Add Sources panel — source label field + large textarea + "Add Source" button; creates a `.txt` file in S3 (named from label + timestamp) via presigned URL upload, included in enrichment like any other upload
    - **Partner form autosave**: All form fields (Company Name, Website, Industry, Description, Pain Point, all contact inputs) trigger `autoSave` on blur; Save button replaced with subtle "Saving..." spinner / green "Saved" checkmark indicator that fades after 2 seconds; form state syncs on client switch
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

72. **Organization Profile Rename + First/Last Name Split** (Session 20 - March 4, 2026)
    - **Renamed**: "Partner Information" → "Organization Profile" in left column header
    - **Contact name split**: Single `name` field replaced with `firstName`/`lastName` (side by side) across all forms (UploadScreen left column, CompanyInfoModal dashboard form)
    - **Migration**: Frontend `migrateContact()` helper splits legacy `name` on first space; Clients Lambda migrates contacts on-the-fly in GET response; no DB ALTER needed (contacts stored as JSON in `contacts_json` TEXT column)
    - **Clients Lambda**: Legacy `contact_name` column synced as combined `firstName + lastName`; `generate_client_config` renders combined name; legacy fallback splits `contact_name` into first/last
    - **Enrich Lambda**: Streamline webhook payload now sends `first_name`/`last_name` per contact in array + `client_contact_first_name`/`client_contact_last_name` as top-level flat fields; backward-compatible `name` and `display` fields retained
    - Files: `src/App.jsx`, `backend/lambdas/clients/lambda_function.py`, `backend/lambdas/enrich/lambda_function.py`
    - Deployed: frontend (S3/CloudFront), xo-clients Lambda, xo-enrich Lambda

73. **Move Founder Quotes into Right Column** (Session 20 - March 4, 2026)
    - Moved Alan Moore and Ken Scott quotes from full-width section below layout into the right column, below the Intellagentic Growth card
    - 2-column grid within the right column; slightly smaller font sizes to fit narrower space
    - Keeps everything visible on laptop without scrolling past the left column form
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

74. **Organization Address Support** (Session 21 - March 5, 2026)
    - **Multi-address support** for Organization Profile — same JSON array pattern as contacts
    - Each address: Label, Address Line 1, Address Line 2, City, State/Province, Postal Code, Country
    - **Database**: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS addresses_json TEXT` — stores JSON array, first element = primary address
    - **Clients Lambda**: GET returns `addresses` array; PUT/POST accept and store `addresses`; `generate_client_config()` renders addresses section in client-config.md
    - **Enrich Lambda**: Both enrichment paths read `addresses_json` from DB; Streamline webhook payload includes `addresses` array
    - **Frontend (UploadScreen)**: `formAddresses` state with add/update/remove handlers; address cards with Label full-width, Address 1 & 2 full-width, City+State side-by-side, Postal Code+Country side-by-side; autosave on blur; syncs on client switch
    - **Frontend (CompanyInfoModal)**: Matching address UI with Add Address button, same field layout, included in handleSave
    - Layout: Address 1 and 2 full width; City and State side by side; Postal Code and Country side by side
    - First address labeled "Primary Address", subsequent "Address 2, 3..."
    - Files: `backend/schema.sql`, `backend/lambdas/clients/lambda_function.py`, `backend/lambdas/enrich/lambda_function.py`, `src/App.jsx`
    - Deployed: frontend (S3/CloudFront), xo-clients Lambda, xo-enrich Lambda, DB migration

75. **Contacts & Addresses Expand/Collapse** (Session 21 - March 5, 2026)
    - **Primary always visible**: Primary Contact and Primary Address cards always shown expanded in Organization Profile
    - **Collapsible extras**: Additional contacts/addresses hidden by default behind clickable links: "View X more contacts" / "View X more addresses" (red text, ChevronDown icon)
    - **Toggle**: Clicking expands to show all; clicking again collapses ("Hide X more contacts/addresses" with ChevronUp icon)
    - **Add button always visible**: "+ Add" button stays accessible regardless of expanded/collapsed state
    - Proper index preservation: uses ternary `null` pattern in `.map()` to maintain original array indices for update/remove handlers
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

76. **Company Name on Contact Cards** (Session 21 - March 5, 2026)
    - Each contact card now displays company/organization name as a read-only row between Name and Title
    - **Layout order**: First Name + Last Name → Company Name (gray, read-only) → Title → Email + Phone → LinkedIn
    - Company name sourced from Organization Profile's Company Name field (`formData.name` in UploadScreen, `localData.name` in CompanyInfoModal)
    - Only shown when company name is populated; hidden otherwise
    - Applied to both UploadScreen left column and CompanyInfoModal
    - Also added expand/collapse to CompanyInfoModal contacts and addresses (matching UploadScreen pattern from v1.44)
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

77. **Login Screen Header Fix** (Session 21 - March 5, 2026)
    - Changed login screen header from "Rapid Deployment" to "Capture" + "Rapid Prototype" badge, matching the logged-in header exactly
    - Single file change: `src/App.jsx`
    - Deployed frontend to S3/CloudFront

78. **Mobile Responsive Workspace Layout** (Session 21 - March 5, 2026)
    - Two-column workspace layout now stacks vertically on screens ≤768px
    - Organization Profile card goes full width on top, three workflow cards full width below
    - Added CSS classes (`workspace-columns`, `workspace-col-left`, `workspace-col-right`) with `@media (max-width: 768px)` breakpoint using `flex-direction: column`
    - Desktop unchanged: side-by-side 38%/62% split
    - Files: `src/App.jsx`, `src/index.css`
    - Deployed frontend to S3/CloudFront

79. **Mobile Overflow Fix, System Skills Layout, Per-Client Webhook URL** (Session 22 - March 5, 2026)
    - **Mobile overflow fix**: `.panel` gets `max-width: 100%; overflow: hidden; box-sizing: border-box` at ≤768px; skill card flex children get `minWidth: 0` and `wordBreak: 'break-word'`
    - **System Skills full-width on mobile**: Added `system-skill-grid` className with CSS to force `flex-direction: column` and full-width children; description text wraps instead of `nowrap`
    - **Per-client webhook URL**: New `streamline_webhook_url VARCHAR(1000)` column in clients table; clients Lambda GET returns it, PUT accepts it; enrich Lambda uses per-client URL with env var fallback; frontend replaces read-only display with editable `<input>` that saves onBlur with saving/saved indicator
    - Auto-migration runs on clients Lambda cold start
    - Files: `src/App.jsx`, `src/index.css`, `backend/schema.sql`, `backend/lambdas/clients/lambda_function.py`, `backend/lambdas/enrich/lambda_function.py`
    - Deployed frontend to S3/CloudFront + both Lambdas

80. **Admin Cross-User Client Access** (Session 22 - March 5, 2026)
    - Admin users (`is_admin` JWT flag) can now see and manage ALL clients, not just their own
    - `/clients/list` (GET): admins get all clients across all users; non-admins still filtered by `user_id`
    - `/clients?client_id=X` (GET): admins skip `user_id` filter, can load any client's full data
    - `/clients` (PUT): admins can update any client regardless of owner
    - `/clients` (DELETE): admins can delete any client regardless of owner
    - Fixed bug where clicking a client card on the dashboard showed blank workspace for clients created by other users
    - Non-admin users unchanged — still restricted to their own clients
    - Files: `backend/lambdas/clients/lambda_function.py`
    - Deployed xo-clients Lambda

81. **Fix Enrichment Lambda sniffio Import Error** (Session 22 - March 5, 2026)
    - Enrichment was failing at cold start: `No module named 'sniffio'` (a dependency of the Anthropic SDK)
    - Root cause: `sniffio` module directory was missing from deployment package — only `.dist-info` metadata was present
    - Installed `sniffio` into `package/` directory
    - Also fixed zip build process: was zipping with `package/` prefix (modules at `package/sniffio/`) instead of zipping from inside `package/` (modules at `sniffio/` root level, matching `deploy-enrich.sh`)
    - Verified cold start succeeds with OPTIONS invoke returning 200
    - Files: `backend/lambdas/enrich/package/sniffio/` (new module)
    - Deployed xo-enrich Lambda

82. **Partners Dimension — Channel Partner Model** (Session 23 - March 5, 2026)
    - **New `partners` table**: id, name, company, email, phone, industry, notes, timestamps
    - **New client columns**: `partner_id` (FK to partners, ON DELETE SET NULL), `intellagentic_lead` (boolean)
    - **Partner CRUD endpoints**: GET/POST/PUT/DELETE `/partners` — admin-only, full CRUD
    - **Client endpoints updated**: list/get/create/update now include `partner_id`, `intellagentic_lead`, `partner_name` (via LEFT JOIN)
    - **Partners screen**: Admin-only CRUD management UI with add/edit modal, delete confirmation, list view
    - **Sidebar nav**: "Partners" item with Users icon, visible only to admins
    - **Dashboard filters**: Partner and Industry dropdown filters in header row; partner name shown under client name in list rows
    - **CompanyInfoModal**: Channel Partner dropdown and Intellagentic Lead checkbox (admin-only fields)
    - **Data flow**: Partners fetched on login, threaded through App state to Dashboard, CompanyInfoModal, PartnersScreen
    - **API Gateway**: Added `/partners` resource with GET/POST/PUT/DELETE/OPTIONS methods, Lambda proxy integration, CORS
    - Auto-migration runs on Lambda cold start
    - Files: `backend/lambdas/clients/lambda_function.py`, `src/App.jsx`
    - Deployed xo-clients Lambda + frontend to S3/CloudFront

---

## PENDING ITEMS

### Immediate Enhancements

1. ~~**Audio Transcription**~~ **DONE (v1.9)** -- AWS Transcribe, context metadata, transcript extraction pipeline

2. **Web Enrichment**
   - Research company website (if provided)
   - Look up contact on LinkedIn (if provided)
   - Industry benchmarking data
   - Incorporate findings into Claude prompt

3. **Additional File Type Extraction**
   - ~~Word (.doc, .docx) -> python-docx library~~ **DONE (v1.22)** -- extract_docx() with paragraph + table extraction
   - PowerPoint (.ppt, .pptx) -> python-pptx library
   - JSON (.json) -> parse and summarize structure
   - XML (.xml) -> parse and extract key data
   - ZIP (.zip) -> extract and process contents

### Advanced Features

4. ~~**Async Job Processing**~~ **DONE (v1.9)** -- Lambda self-invoke async pattern, DB stage tracking, frontend polling

5. ~~**Richie's Encryption**~~ **REFACTORED (v2.07)** -- DB encryption removed, S3-only encryption with admin toggle
   - ~~End-to-end encryption for uploaded files~~
   - ~~Client-side encryption before S3 upload~~
   - S3 file encryption with per-client keys (toggleable via admin System Configuration)
   - DB fields stored as plaintext for searchability; S3 encryption controlled by `s3_encryption_enabled` system_config toggle
   - Bulk encrypt/decrypt conversion endpoint with progress modal

6. **RAG Integration**
   - Vector embeddings for uploaded documents
   - Pinecone/Weaviate for vector storage
   - Semantic search across client data
   - Follow-up questions on analysis

7. **Multi-Domain Templates**
   - Pre-built prompts for common verticals
   - Waste management, healthcare, hospitality, retail
   - Industry-specific schema recommendations
   - Vertical-specific KPIs and benchmarks

8. **Export & Sharing**
   - PDF export of analysis results
   - Email report delivery
   - Shareable links (time-limited)
   - ~~White-label branding options~~ **PARTIALLY DONE (v1.25)** -- client logo + icon upload, dashboard icons, workspace header logo

---

## BOTTOM LINE

**What Works Today:**

The XO Capture prototype is **fully operational** and deployed to production. A domain partner can:

1. Visit https://d36la414u58rw5.cloudfront.net
2. Sign in with Google (admin users) or email/password (self-serve). Admin users see a multi-client dashboard.
3. Fill out company information (8 fields including pain point and enrichment targets)
4. Upload business documents (15 file types supported) or import from Google Drive
5. Add context metadata for audio files (date, participants, topic)
6. Choose AI model in Configuration (Sonnet 4.5 default, Opus 4.6, or Haiku 4.5)
7. Click "Start Enrichment" and watch AI process their data (async with live stage tracking)
8. Receive structured MBA-level business analysis:
   - Executive summary of their business
   - 3-5 critical problems identified with evidence and recommendations
   - ASCII architecture diagram for proposed system
   - Proposed database schema (tables with columns, types, relationships)
   - 7/14/21 day action plan (Build & Demo → Validate & Connect → Deploy or Decide)
   - Bottom line summary (CEO-level: what to do first, cost, expected outcome)
   - Source attribution

**Technology Stack:**
- Frontend: React 18 + Vite, deployed to S3/CloudFront
- Backend: 7 Python Lambdas behind API Gateway (+ xo-psycopg2 layer)
- Database: PostgreSQL 15 on RDS (db.t3.micro) -- 6 tables
- Auth: Google OAuth (admin) + bcrypt password (self-serve) + JWT tokens (24h expiry, is_admin flag)
- AI: Claude Sonnet 4.5 (default), Opus 4.6, or Haiku 4.5 (user-selectable) via Anthropic API
- Storage: S3 with folder-per-client structure (files + analysis.json)
- Transcription: AWS Transcribe for audio files (MP3, WAV, M4A, AAC, OGG, FLAC, WMA)
- Integrations: Google Drive (OAuth2 connector with file picker)
- Region: us-west-1 (AWS)

**What's Not Built Yet:**
- Web enrichment (URLs collected but not researched)
- UI for 5 new DB fields (survival metrics, AI persona, strategic objective, tone mode)

**Performance:**
- Upload: Instant (direct to S3 via presigned URLs)
- Enrichment: 30-90 seconds depending on file count and size
- Results: Instant retrieval from S3

**Cost Estimate (100 clients/month):**
- RDS db.t3.micro: ~$15/month
- S3: ~$5 (5GB average)
- Lambda: ~$2
- API Gateway: ~$3.50
- Claude API: $10-50 (variable based on document size)
- **Total: $35-75/month** for prototype usage

**Repository:** All code is version-controlled at https://github.com/intellagentic/xo-capture with proper .gitignore to exclude secrets.

**v1.51 — Dashboard Filters: Industry Pills + Domain Partner Dropdown**
- Dashboard now has industry pill filters (horizontal row, red when active) with client counts per industry
- Admin users see a partner dropdown to filter by which user created the client (only shown when 2+ distinct partners exist)
- Filters are AND-combined; header count updates to show filtered total
- Empty filter state shows "No clients match" message with a Clear Filters button
- Backend `/clients/list` now returns `owner_name` via LEFT JOIN on users table

**v1.52 — 7/14/21 Day Action Plan (replaces 30/60/90)**
- Enrichment prompt now produces a 7/14/21 day action plan instead of 30/60/90
- Phases: 7-day (Build & Demo), 14-day (Validate & Connect), 21-day (Deploy or Decide)
- Frontend results heading updated to "7/14/21 Day Action Plan"
- Pain point priority now front-loads the 7-day phase
- Existing results still render correctly (frontend displays phase labels dynamically)

**v1.58 — Dashboard redesign: work queue layout**
- Replaced industry filter pills and partner dropdown with compact inline search/filter input
- Client rows now have left border color coding: green (complete), yellow (processing), red (error), gray (not enriched)
- Row layout: 24px icon + bold company name left, industry in gray text + source count + date + chevron right
- Delete button hidden by default, appears on row hover
- Clients grouped: enriched/processing at top, "Needs Enrichment" divider, unenriched below
- Header reduced to 18px, inline with search field and + New Client button
- Removed enrichmentBadge function (status now conveyed by left border color)

**v1.57 — Compact dashboard, tighter UI, Results breathing room**
- Dashboard: replaced card grid with compact single-row list layout (24px icons, inline industry pill, source count, status badge, date) — scales to 20+ clients
- Global font sizes: body base 13px, section headers 15px, sub-labels 12px, action buttons 13px (Results screen unchanged)
- Welcome step cards: reduced padding (0.875rem → 0.625rem), step circles (40px → 32px), inter-card gap (0.75rem → 0.5rem), smaller buttons — all 3 cards fit on screen without scrolling
- Results screen: added 2rem left/right padding for breathing room, no font/spacing changes

**v1.56 — Partner vs Client view + branding rename**
- All screens (Enrich, Skills, Configuration, Branding) available to both admin and client roles
- Header subtitle: admins see "Partner Workspace", clients see their company name (or "My Workspace")
- Founder quotes hidden for client users on Welcome screen
- Download Prototype Spec (.md) and Send to Streamline buttons hidden for clients on Results screen
- Renamed "Download Prototype Spec" button to "Download Prototype Spec (.md)" for clarity
- Download Prototype Spec (.md) button styled black background with white text
- Clients skip the All Clients dashboard, go straight to their workspace
- Replaced all "First Party Trick" references with "XO Capture Analysis" across system skill (analysis-framework.md), enrich Lambda prompt, S3, and database

**v1.55 — Narrower sidebar layout**
- Sidebar width reduced from 280px to 220px so main content stays visible
- Overlay opacity lightened (50% to 25%) to keep workspace context
- Tightened padding, font sizes (0.9rem to 0.8rem), icon sizes (20px to 17px), and gaps across all sidebar items
- Theme toggle switch scaled down, text-overflow ellipsis on header name/email
- All icons use flexShrink: 0 to prevent compression at narrow width

**v1.54 — Rapid Prototype Spec Generator**
- New `xo-rapid-prototype` Lambda generates a Claude Code-ready markdown build spec from enrichment results + client metadata
- "Download Prototype Spec" red button on Results screen (next to Send to Streamline) triggers .md file download
- Spec includes: client context, problem analysis, features, database schema, seed data instructions, tech stack, UI layout, API endpoints, build sequence checklist
- "Rapid Prototype" added as default configurable button (Download icon, red, routes to results)
- Download icon added to ICON_MAP for configurable buttons
- API Gateway: GET /rapid-prototype/{id} with CORS OPTIONS

**v1.53 — Global System Skills (DB-managed, admin-editable)**
- System skills (analysis-framework, output-format, authority-boundaries, enrichment-process) are now first-class DB entities
- `skills.client_id` is now nullable: NULL = system skill (global), set = client skill
- Auto-migration seeds 4 system skills into DB on Lambda cold start + copies .md files to S3 `_system/skills/`
- New `/skills` API endpoints: GET (combined or system-only), POST, PUT, DELETE with admin gating for system scope
- Skills screen shows system skills (blue "System" badge) at top, then client skills (gray "Client" badge) with divider
- Admins can create/edit/delete system skills; non-admins see them read-only
- Add Skill modal has scope selector for admins: "This client only" vs "System (all clients)"
- Enrich Lambda reads system skills from DB first, falls back to bundled files if DB empty
- Configuration screen system skills panel now dynamically fetches from API instead of hardcoded list

**v1.93 — Intellagentic Lead and Channel Partner on UploadScreen**

- Added Intellagentic Lead toggle and Channel Partner dropdown to UploadScreen form (admin only)
- Two-column grid row between Industry and Current Business Description
- Intellagentic Lead: red toggle button with checkmark when active, autosaves on click
- Channel Partner: select dropdown populated from partners list, "No partner" to clear, autosaves on change
- Both fields added to formData state and sync useEffect, already wired to API via `intellagentic_lead` and `partner_id`
- Partners list passed as prop from main App component
- Deployed: frontend only

**v1.92 — Export All Skills as .doc**

- Added `exportAllAsDocx()`: combines all skills into a single `.doc` file with page breaks between skills
- Office-compatible HTML with Word namespace, Calibri font, styled headings
- Two separate export buttons in header: `.doc` (Download icon) and `.md` (FileText icon)
- Deployed: frontend only

**v1.91 — Skills concertina view with inline editor and export**

- Skills screen converted from flat card list to accordion/concertina: click header to expand, chevron rotates on open
- Only one skill open at a time; unsaved-changes prompt when switching or closing
- Expanded state: monospace textarea inline editor for editable skills (client skills + system for admins)
- Read-only view (pre-formatted) for system skills when non-admin
- Inline save: amber "Unsaved changes" indicator, red Save button with spinner, calls PUT /skills directly
- Per-skill export: FileText icon exports as .md, Download icon exports as .doc (Office-compatible HTML with Word namespace)
- Export All button in header: combines all skills into single skills-export.md with --- separators
- Delete button per skill (trash icon) in accordion header
- Deployed: frontend only

**v1.90 — Sidebar hover-expand and pin/unpin**

- Hover: mouseover on collapsed icon strip temporarily expands sidebar with labels; mouseout collapses back
- Pin: clicking hamburger (collapsed) or lock icon (hover-expanded) pins sidebar open permanently; content shifts to make room
- Unpin: clicking chevron-left on pinned sidebar unpins it back to icon strip
- Hover-expand overlays content (no layout shift); pinned state pushes content via margin
- Stronger drop shadow on hover-expanded state to distinguish from pinned
- Pin state persisted in localStorage (`xo-sidebar-pinned`)
- Mobile: nav clicks auto-collapse and unpin
- Deployed: frontend only

**v1.89 — Bedrock bearer token authentication**

- Added `AWS_BEARER_TOKEN_BEDROCK` env var support for bearer token auth with Bedrock
- When set: calls Bedrock REST API directly with `Authorization: Bearer <token>` header (no boto3 Bedrock client needed)
- When not set: falls back to Lambda IAM role via boto3 (unchanged behavior)
- `_invoke_bedrock_bearer()`: direct HTTPS POST to `bedrock-runtime.{region}.amazonaws.com/model/{model}/invoke` with 300s timeout
- Removed previous `BEDROCK_ACCESS_KEY_ID`/`BEDROCK_SECRET_ACCESS_KEY`/`BEDROCK_SESSION_TOKEN` — replaced by single bearer token
- Auth mode logged on cold start for debugging
- Deployed: backend only (enrich Lambda)

**v1.88 — Switch from Anthropic API to AWS Bedrock**

- Replaced `anthropic` SDK with `boto3` Bedrock Runtime client in enrich Lambda
- `bedrock_client.invoke_model()` replaces `anthropic_client.messages.create()`
- Bedrock Messages API format: `anthropic_version: bedrock-2023-10-16`
- Model mapping: `claude-opus-4-6` → `us.anthropic.claude-opus-4-6-20250514-v1:0`, `claude-sonnet-4-5-20250929` → `us.anthropic.claude-sonnet-4-5-20250514-v1:0`, `claude-haiku-4-5-20251001` → `us.anthropic.claude-haiku-4-5-20251001-v1:0`
- Removed `anthropic==0.40.0` from requirements.txt (smaller deploy package)
- No longer needs `ANTHROPIC_API_KEY` env var; new optional `BEDROCK_REGION` (default `us-west-2`)
- Requires: Lambda IAM role needs `bedrock:InvokeModel` permission, Bedrock model access enabled in AWS console
- Deployed: backend only

**v1.87 — Collapsible sidebar with persistent icon strip**

- Replaced overlay sidebar with persistent collapsible sidebar: 220px expanded, 56px icon strip collapsed
- Expanded state: icon + label for each nav item, user name/email in header, chevron-left to collapse
- Collapsed state: centered icons only with tooltip on hover, hamburger menu icon to expand
- State persisted in localStorage across sessions; defaults to expanded on desktop (>768px), collapsed on mobile
- `SidebarItem` reusable component handles both states with smooth CSS transitions
- Theme toggle and Sign Out pinned to bottom of sidebar (always accessible)
- On mobile, nav clicks auto-collapse the sidebar
- Header changed from `position: fixed` to `position: sticky` (lives inside content wrapper, respects sidebar offset)
- Footer offset tracks sidebar width dynamically
- Removed `padding-top: 80px` from `.main` (no longer needed with sticky header)
- Deployed: frontend + CSS

**v1.86 — NDA signed timestamp tracking**

- New `nda_signed_at TIMESTAMP` column on clients table (auto-migration)
- When `ndaSigned` set to true: `nda_signed_at` automatically set to `NOW()`
- When `ndaSigned` set to false: `nda_signed_at` cleared to null
- Create also sets `nda_signed_at` if `ndaSigned` is true at creation time
- GET, List endpoints return `ndaSignedAt` as ISO timestamp or null
- Deployed: backend only

**v1.85 — 2FA opt-in: only check when user has enabled it**

- 2FA is now opt-in per user via `users.two_factor_enabled` (boolean, default false)
- Login flows (password + all 4 Google OAuth paths) check `two_factor_enabled` before triggering 2FA challenge
- If 2FA disabled: login returns JWT directly as before (no behavior change for existing users)
- If 2FA enabled: login returns `{ requires_2fa: true, session_id, masked_email }` → user enters code → `POST /auth/verify-2fa` returns JWT
- New accounts and registrations skip 2FA (user hasn't opted in yet)
- Magic link token validation still exempt from 2FA
- `PUT /auth/preferences` accepts `{ two_factor_enabled: true/false }` to toggle 2FA on/off
- `_success_response` now includes `two_factor_enabled` in user data so frontend can show toggle state
- Deployed: backend only

**v1.84 — Email-based Two-Factor Authentication (2FA)**

- New `two_factor_codes` table: session_id, user_id, 6-digit code, encrypted user context, expiry, attempt counter
- New endpoint `POST /auth/verify-2fa`: accepts `{ session_id, code }`, validates code, issues JWT on success
- Login flow (when 2FA enabled): credentials validated → 6-digit code emailed via AWS SES → frontend shows code entry → verify-2fa returns JWT
- Security: codes expire after 10 minutes, max 5 attempts per session, codes deleted after use
- Email: HTML + plaintext via SES with branded template, configurable `SES_FROM_EMAIL` and `SES_REGION` env vars
- User context (role, partner_id, client_id, preferred_model) stored encrypted in DB during 2FA, restored on verification
- Requires: SES sender email verified in AWS, `POST /auth/verify-2fa` route added to API Gateway
- Deployed: backend only (frontend 2FA code entry screen needed)

**v1.83 — NDA signed flag and Existing Apps per client**

- New `nda_signed` (boolean, default false) and `existing_apps` (text) columns on clients table
- Auto-migration adds columns on cold start
- Create, Update, GET, and List endpoints all support `ndaSigned` (boolean) and `existingApps` (string)
- Update is conditional: only sets these fields when present in the PUT body
- Deployed: backend only

**v1.82 — updated_by tracking, owner_name decryption, layer version fix**

- Bug fix: `owner_name` in client list was returning encrypted blob — now decrypted with `decrypt()` (master key)
- New `updated_by` column on clients table: stores encrypted name of the user who last created or updated the client
- `handle_update_client`: sets `updated_by = encrypt(user.name)` on every save
- `handle_create_client`: sets `updated_by = encrypt(user.name)` on create
- `handle_get_client` and `handle_list_clients` both return decrypted `updated_by` in response
- Auto-migration adds `updated_by TEXT` column on cold start
- Layer fix: all 8 Lambdas updated from `bcrypt-jwt-layer:1` to `:2` (which includes `cryptography` library for AES-GCM encryption)
- `deploy.sh` now dynamically resolves latest layer versions instead of hardcoding `:1`
- Deployed: backend only

**v1.81 — Encryption fixes, deploy hardening, API activity logging**

**Encryption fixes (crypto_helper.py):**
- Bug fix: `AES_MASTER_KEY` was cached at module import time — now reads from `os.environ` on every call so config changes take effect immediately
- Bug fix: `unwrap_client_key()` returned garbage bytes when encryption was unavailable — encrypted keys (nonce+ciphertext) were blindly base64-decoded and used as client keys, causing silent decryption failures. Now detects encrypted vs raw keys by length (raw = exactly 32 bytes) and returns `None` when it can't unwrap
- Bug fix: `unwrap_client_key()` didn't detect when master key decryption failed (returned input unchanged) — now returns `None` instead of proceeding with still-encrypted value
- Added logging throughout: warnings for missing key/library, pass-through mode, unwrap failures; debug logs for individual decrypt attempts

**Deploy hardening (deploy.sh):**
- `AES_MASTER_KEY` now required as first argument: `./deploy.sh <AES_MASTER_KEY>`
- Existing Lambda updates: merges `AES_MASTER_KEY` + `AES_ENCRYPTION_KEY` into existing env vars (preserves DATABASE_URL, JWT_SECRET, etc.)
- New Lambda creates: includes `AES_MASTER_KEY` + `AES_ENCRYPTION_KEY` from the start
- Added `aws lambda wait function-updated` between code and config updates to prevent race conditions

**API activity logging (all 8 Lambdas):**
- Added `log_activity()` to `auth_helper.py` — logs HTTP method, path, user email, status code, and result summary
- All Lambda handlers now log every request: `API POST /auth/login | user=ken@example.com | status=200 | role=admin`
- Auth lambda has custom `_log_auth_activity()` that extracts email from request body (login/register) or JWT
- Failed auth (401) and errors (500) are logged with error details
- Deployed: backend only

**v1.80 — Fix Paste Text Source "Add Source" button**
- Bug: `new File()` was calling lucide-react's `File` icon (imported on line 2) instead of the browser's native `File` constructor, causing "Tn is not a constructor" error
- Fix: changed to `globalThis.File` to bypass the shadowed import
- Added S3 PUT response status check (was silently ignoring upload failures)
- Added success confirmation: button turns green with checkmark + "Source Added!" for 3 seconds
- Added inline error display with specific error message on failure
- Added empty-label fallback (`'Text_Note'`) when sanitized label is empty
- Deployed: frontend only

**v1.79 — Invite countdown timer updated to March 23**
- Changed countdown target from March 16, 2026 10:00 AM PST to March 23, 2026 12:00 PM PDT
- Updated confirmation text from "March 16" to "March 23"
- Deployed: frontend only

**v1.78 — System vs Client Buttons (same pattern as Skills)**
- Buttons table schema migrated: added `client_id` column (nullable, FK to clients), made `user_id` nullable
- System buttons (`client_id IS NULL, user_id IS NULL`) appear on every client's Welcome screen before client-specific buttons
- Client buttons (`client_id = X`) are per-workspace, configured from client Configuration screen
- Buttons Lambda auto-migrates on cold start (adds column, drops NOT NULL, creates index)
- GET /buttons supports `?scope=system`, `?scope=client&client_id=X`, `?client_id=X` (combined), and legacy (no params)
- PUT /buttons/sync supports `{ scope: "system" }` (admin only), `{ client_id: X }`, and legacy (user-level)
- System Configuration screen (dashboard, admin): full Configure Buttons editor with drag-and-drop reorder, inline edit (label, URL, color grid, icon grid), "+ Add Button", and live preview
- Client Configuration screen (workspace): system buttons shown read-only with Lock icon + blue "System" badge; client buttons editable below with full editor; live preview shows both combined
- Reusable `renderButtonEditor()` and `renderButtonPreview()` helpers shared between system and client config views
- Frontend state: separate `systemButtons` + `configButtons` arrays; re-fetches client buttons on workspace entry
- Deployed: xo-buttons Lambda + frontend

**v1.77 — Reorder System Configuration: toggle below URL fields**
- Moved "Send to Streamline" toggle below Default Enrichment Webhook URL (order: Invite URL → Enrichment URL → toggle)
- Updated help text to "Per-client settings (in client Configuration) override these system defaults."
- Deployed: frontend only

**v1.76 — System-level Send to Streamline toggle**
- New "Send to Streamline" toggle on System Configuration screen, below Default Enrichment Webhook URL
- Stored in `system_config` table as `streamline_webhook_enabled` (`"true"` / `"false"`), OFF by default
- xo-enrich Lambda: after enrichment completes, checks per-client toggle first; if OFF, falls back to system-level toggle from `system_config`
- Precedence: per-client ON → fires; per-client OFF → check system default; system ON → fires; system OFF → manual only
- `_get_system_config_value()` updated to handle `conn=None` by opening its own DB connection (needed post-enrichment when main conn is closed)
- Deployed: xo-enrich Lambda + frontend

**v1.75 — Verified system_config webhook flow end-to-end**
- Verified save-on-blur: PUT `/system-config` writes to DB immediately, returns `{"status":"saved"}`, frontend shows 2-second "Saved" indicator
- Verified no caching: `handle_invite` runs fresh `SELECT` from `system_config` on every invocation — no module-level or Lambda-warm cache
- Live test: changed invite webhook URL from `httpbin.org/post` to `httpbin.org/anything`, submitted two invites — Lambda logs confirm each fired to the correct URL at time of submission
- Both invite paths (new invite + existing-invite duplicate email) read from `system_config`

**v1.74 — System Configuration: system_config table + dual-mode Configuration screen**
- New `system_config` PostgreSQL table (config_key/config_value key-value store), auto-migrated on Lambda cold start
- New `GET /system-config` and `PUT /system-config` API routes (admin-only) on xo-clients Lambda
- API Gateway `/system-config` resource with GET, PUT, OPTIONS methods → xo-clients Lambda proxy
- Configuration screen is now dual-mode based on `inWorkspace` state:
  - **Dashboard (System Configuration):** Shows "System Configuration" header with Global Webhook URLs panel (Invite Webhook URL + Default Enrichment Webhook URL), both saving to `system_config` on blur
  - **Client workspace (Client Configuration):** Shows "Client Configuration" header with client name, then per-client settings (theme, AI model, system skills, per-client webhook override URL + toggle, configurable buttons)
- `inWorkspace` state tracks whether user is in a client workspace or on dashboard level
- Invite webhook lookup in `handle_invite` now reads from `system_config` table instead of scanning clients table
- xo-enrich Lambda: per-client `streamline_webhook_url` falls back to `system_config.enrichment_webhook_url` before env var
- Removed standalone SystemSettingsScreen — unified into single ConfigurationScreen component
- Deployed: xo-clients Lambda, xo-enrich Lambda, API Gateway, frontend

**v1.73 — Invite Webhook URL: per-client configuration**
- New `invite_webhook_url VARCHAR(1000)` column on clients table, auto-migrated on Lambda cold start
- Configuration screen now shows two webhook URL fields under Streamline toggle: "Enrichment Webhook URL" (renamed from "Webhook URL") and "Invite Webhook URL" (new)
- Both fields save on blur with "Saved" indicator
- `_send_invite_webhook()` uses per-client `invite_webhook_url` if set, falls back to `STREAMLINE_INVITE_WEBHOOK_URL` env var
- Added to all 4 SELECT queries, response mapping, and PUT handler in clients Lambda
- Existing-invite path (duplicate email) also passes per-client URL from DB
- Deployed: xo-clients Lambda + frontend

**v1.72 — Country code dropdown on all phone fields**
- Added country code dropdown before phone number input across all 4 locations: Invite page, CompanyInfoModal, Partner Info modal, inline auto-save form
- Country codes: +1 (US/Canada), +44 (UK), +61 (Australia), +353 (Ireland), +256 (Uganda), +971 (UAE) — defaults to +1
- Shared utilities at top of App.jsx: `COUNTRY_CODES` array, `splitPhone()` parser, `joinPhone()` combiner
- Stored as combined value (e.g. `+44 7700900123`) — `splitPhone()` parses existing values to pre-select correct dropdown
- Small dropdown on left, phone input taking remaining width on right

**v1.71 — XO + Streamline dual-layer architecture in system skills**
- Updated `analysis-framework.md` system skill to distinguish XO (intelligence layer) from Streamline (action layer)
- XO capabilities: runtime monitoring, pattern detection, anomaly surfacing, decision support, predictive alerts, compliance watching, exception-based management
- Streamline capabilities: workflow automation, document generation, notifications, form logic, e-signatures, task routing
- Tagline embedded: "The XO clears the path. You give the Order. Streamline Acts."
- Every recommendation now requires: Problem → XO monitors → Streamline executes → Outcome
- Updated `output-format.md` with 3 new rules: Proposed Architecture must include both XO and Streamline components, Problems section must use XO verbs vs Streamline verbs, Action Plan items indicate XO vs Streamline setup tasks
- Deployed to S3 (`_system/skills/`), Lambda package (bundled fallback), and redeployed `xo-enrich` Lambda

**v1.70 — Fix Enrich screen stage progress display**
- Fixed bug where AI Analysis appeared to start before Transcribing Audio completed
- Backend Lambda confirmed sequential — bug was in frontend `updateStageStatus()` display logic
- Rewrote `updateStageStatus` with index-based logic: all stages before current → 'complete', current → active, all after → 'pending'
- Old logic only marked prior stages complete if they were 'pending', so skipped stages (e.g. no audio files) or stages that were still 'active' could overlap visually
- Added immediate `updateStageStatus('extracting', 'active')` call at enrichment start (was only set on first 3-second poll)

**v1.69 — Organization Profile textarea sizing, workspace logo, copyright footer**
- Organization Profile textareas (Current Business Description, Future Plans, Pain Points) set to `rows={4}` with `minHeight: 100px` across all 3 form instances (CompanyInfoModal, Partner Info modal, inline form)
- Client logo/icon in workspace header increased from 44px to 56px (logo, icon, and letter fallback) for better visibility
- Copyright footer "© 2026 Intellagentic Limited. All rights reserved." verified on all screens
- Added missing footer to LoginScreen (was the only screen without it)
- All other screens (Dashboard, Welcome, Sources, Enrich, Results, Skills, Configuration, Branding, Partners, Invite) already had footer via fixed-position element

**v1.68 — Invite Landing Page for HIMSS 2026**
- New public `/invite` page — dark-themed, mobile-first landing page for conference signups (no auth required)
- `InvitePage` component: dark gradient background, XO Capture header, "Invitation" heading, tagline
- Tagline split across two lines: "XO clears the path." / "You decide. Streamline Acts."
- "Your Second-in-Command" subtitle below countdown
- Live countdown timer to March 16, 2026 10:00 AM PST (4 red-tinted boxes: Days/Hrs/Min/Sec)
- Glass-morphism form card with 6 fields: First Name + Last Name (side-by-side row), Email, Phone, LinkedIn (optional, icon label), Company
- All fields have proper autocomplete attributes: given-name, family-name, email, tel, url, organization
- LinkedIn field: SVG icon label, placeholder "linkedin.com/in/yourprofile", optional
- Submit → `POST /invite` → creates client (S3 folders, client-config.md, default skill) + generates 30-day magic link (stored, not shown)
- Confirmation screen: CheckCircle icon, "You're in.", "We'll send your access on March 16.", Intellagentic logo — no magic link displayed
- Idempotent: same email returns success (no duplicate clients)
- Backend: `handle_invite()` in clients Lambda, routed before auth check
- Phone number stored in `contact_phone`, LinkedIn in `contact_linkedin`, full name in `contact_name` — all included in client-config.md
- Auto-migration: `source` column on clients table, `user_id` made nullable for invite clients
- Dedicated invite webhook via `STREAMLINE_INVITE_WEBHOOK_URL` env var (separate from enrichment webhook)
- Invite webhook payload: `invite_submission` event with first_name, last_name, email, phone, linkedin, company_name, signup_date
- API Gateway: `/invite` resource with POST + OPTIONS methods → Lambda proxy to xo-clients
- `STREAMLINE_INVITE_WEBHOOK_URL` and `FRONTEND_URL` env vars added to clients Lambda
- CloudFront SPA routing handles `/invite` path (404 → index.html already configured)
- Single-viewport layout: entire page fits without scrolling on laptop (1440x900) and mobile (375x812)
- Tightened spacing: centered flex layout with gap, compact countdown boxes, reduced form/button padding
- Tagline prominent: 17px near-white (#e0e0e0) with line break — "XO clears the path." / "You decide. Streamline Acts."
- Submit button text: "I'm In"
- Footer matches main app: © 2026 Intellagentic Limited. All rights reserved.

**v1.66 — Streamline Applications: new system skill + Potential Streamline Applications on Results screen**
- New system skill: `streamline-applications.md` — full reference of 12 Streamline workflow steps and 15 integrations
- Instructs AI to identify 3-5 practical Streamline workflow applications ranked by ease of implementation and business impact
- Each application includes: business problem, workflow steps used, applicable integrations, operational outcome
- Enrich Lambda prompt updated with section 8 (POTENTIAL STREAMLINE APPLICATIONS) and `streamline_applications` field in JSON output
- Results screen: new "Potential Streamline Applications" panel between Client Summary and Executive Summary
- Black header (#1a1a1a) with white text and Intellistack logo (copied from surgical-trays assets)
- Parses bold headers, labeled fields (Problem/Workflow/Integrations/Outcome), bullets, and paragraphs
- Color-coded labels: Problem (red #ef4444), Workflow (blue #3b82f6 matching Send to Streamline button), Integrations/Outcome (gray #6b7280)
- `streamline_applications` included in Streamline webhook payload
- 6 system skills total: analysis-framework, output-format, authority-boundaries, enrichment-process, client-facing-summary, streamline-applications

**v1.65 — Add client_summary to Streamline webhook payload**
- Enrich Lambda webhook now includes `client_summary` field (XO Summary for Client) alongside existing sections
- Applies to both automatic post-enrichment webhook and manual "Send to Streamline" re-send
- No frontend changes

**v1.64-hotfix — Revert dashboard grouping to restore stable state**
- Reverted v1.65 (dashboard grouped by Channel Partner) and v1.66 (ErrorBoundary) — both caused blank screen crash (React error #310)
- Restored App.jsx to v1.64 stable state (flat client list, no ErrorBoundary)
- Dashboard partner grouping to be re-implemented on a feature branch

**v1.64 — Client-facing summary: new system skill + XO Summary for Client on Results screen**
- New system skill: `client-facing-summary.md` — instructs AI enrichment to produce a concise, client-ready summary
- Summary opens with "Based on the information provided, XO has identified the following opportunities for [Company Name]:"
- 3-5 bullet points framed as business outcomes — no tech jargon, no pricing, no internal tools
- Closes with forward-looking next steps statement
- Enrich Lambda prompt updated with section 7 (CLIENT SUMMARY) and `client_summary` field in JSON output schema
- Results screen: new "XO Summary for Client" panel at top with red gradient header (Star icon), above Executive Summary
- Bullet lines parsed and rendered with red dot markers; non-bullet lines as paragraphs
- Skill auto-seeded to DB via `SYSTEM_SKILLS` list in clients Lambda + uploaded to S3 `_system/skills/`
- 5 system skills total: analysis-framework, output-format, authority-boundaries, enrichment-process, client-facing-summary

**v1.63 — Enhanced organization forms: future plans, multi-entry pain points, website links**
- Renamed "Description" to "Current Business Description" across all forms (CompanyInfoModal, UploadScreen, PartnersScreen)
- Added "Future Plans" textarea field — captures strategic direction and growth plans
- Replaced single "Immediate Pain Point" with multi-entry Pain Points section — add/remove individual entries, stored as JSON array
- Website URL field now has clickable external link icon (ExternalLink) that opens URL in new tab
- DB migration: `future_plans` + `pain_points_json` columns on clients table; `description` + `future_plans` + `pain_points_json` on partners table
- Backend `generate_client_config()` updated to include Future Plans section and numbered Pain Points list in Claude analysis context
- All three forms consistent: CompanyInfoModal (modal), UploadScreen (inline autosave), PartnersScreen (modal)
- handleClientCreate PUT/POST bodies now send `futurePlans` and `painPoints` to backend

**v1.62 — Partner form aligned with Organization Profile + role fix**
- Partner Add/Edit form now matches client Organization Profile modal exactly
- Organization fields: Company/Organization Name, Website URL, Industry/Vertical
- Contacts section: expandable cards with First Name, Last Name, Title, Email, Phone, LinkedIn (same as client contacts)
- Addresses section: expandable cards with Label, Address 1/2, City, State/Province, Postal Code, Country
- Same field styling, expand/collapse behavior, empty states, and "Add Contact"/"Add Address" buttons
- DB migration adds `website`, `contacts_json`, `addresses_json` columns to partners table
- Backend CRUD updated to store/return structured contacts and addresses arrays
- Partner list rows now show primary contact name + title instead of just email
- Fixed: partner save now checks API response and shows error if save fails (was silently swallowing errors)
- Fixed: old JWTs missing `role` field caused 403 "Access denied" on partner routes — now derives role from `is_admin`/`is_partner` flags as fallback

**v1.61 — Three-tier role system: Admin, Partner, Client**
- Database-driven role system: `role` column on users table ('admin', 'partner', 'client') + `partner_id` FK to partners table
- Admin seed emails auto-provisioned on cold start (replaces hardcoded ALLOWED_EMAILS for login)
- Auth Lambda login flow: DB role check → admin seed fallback → client contacts_json match → denied
- JWT claims now include: `role`, `is_admin`, `is_partner`, `is_client`, `partner_id`, `client_id`
- Partner-scoped access across all lambdas: partners see/manage only clients with matching partner_id
- Partners can: view dashboard (filtered), create clients (auto-assigned), upload/enrich, share magic links for their clients
- Partners cannot: delete clients, access Partners management screen, see other partners' clients
- Frontend: `isPartner` state, partner login → "Partner Dashboard" with "My Clients" sidebar, no partner filter/delete buttons
- Workspace banner shows "Partner Workspace" for both admin and partner roles
- All 4 auth_helper.py files updated to propagate role/is_partner/partner_id from JWT

**v1.60 — Client Access: Magic Links + Google OAuth for Clients**
- New `client_tokens` table for magic link tokens (64-char hex, 30-day expiry, per-client)
- `POST /auth/token` validates magic link tokens, issues client-scoped JWT
- `POST/GET/DELETE /auth/magic-link` for admin/partner management of shareable URLs
- Google OAuth now checks `contacts_json` on clients table — matching contact emails get client-scoped access
- Client-scoped access in upload + clients lambdas (users see only their own workspace)
- Frontend: `?token=` URL parameter auto-validates and enters workspace, `ShareLinkModal` component
- Share buttons on dashboard rows (ExternalLink icon) and workspace header for admins
- API Gateway: `/auth/token` (POST) and `/auth/magic-link` (GET/POST/DELETE) resources added

**v1.94–v1.98 — HubSpot CRM Bi-directional Sync (complete integration)**

Backend Lambda (`xo-hubspot-sync`, eu-west-2, Python 3.11, 60s timeout):
- Private App bearer token auth via `HUBSPOT_PRIVATE_TOKEN` env var (replaced initial OAuth 2.1 approach after scope issues)
- 12 custom HubSpot Company properties auto-created on first sync: xo_record_type, xo_client_id, xo_industry, xo_status, xo_source, xo_nda_signed, xo_nda_signed_at, xo_intellagentic_lead, xo_future_plans, xo_pain_points_json, xo_addresses_json, xo_sync_enabled
- Industry mapped to `xo_industry` custom text property (HubSpot's native `industry` field is an enum that rejects free-text)
- DateTime fields (nda_signed_at) sent as Unix epoch milliseconds per HubSpot API requirements

API routes (10 endpoints on API Gateway `odvopohlp3`, all with CORS OPTIONS):
- `POST /hubspot/connect` — returns Private App status message
- `GET /hubspot/callback` — returns Private App status message (OAuth no longer needed)
- `GET /hubspot/status` — live connectivity test via HubSpot read, returns auth_type + last_sync
- `POST /hubspot/sync` — full bi-directional sync with push + pull + conflict detection
- `POST /hubspot/sync/push` — push single client to HubSpot
- `POST /hubspot/sync/pull` — pull single company from HubSpot into XO
- `GET /hubspot/mapping` — returns full field mapping + pull behavior documentation
- `GET /hubspot/conflicts` — returns unresolved sync conflicts
- `POST /hubspot/conflicts/resolve` — resolves conflict by choosing XO or HubSpot as winner
- `POST /hubspot/webhook?secret=xxx` — pull-only sync triggered by external webhook (no JWT, shared secret auth)

Push (XO Capture → HubSpot):
- company_name→name, website_url→website, description→description
- Custom properties: xo_industry, xo_future_plans, xo_status, xo_source, xo_nda_signed, xo_nda_signed_at, xo_intellagentic_lead, xo_pain_points_json, xo_addresses_json
- contacts_json → multiple HubSpot Contacts associated to Company
- addresses_json → xo_addresses_json custom property + HubSpot standard address fields from primary address
- partner_id → Company-to-Company association with partner's HubSpot Company record
- Enrichment results (summary, bottom_line) → HubSpot Note on Company

Pull (HubSpot → XO Capture):
- Tag-based: only creates new XO client records for companies with `xo_sync_enabled=true` checkbox
- Existing linked records (with xo_client_id) continue syncing normally regardless of checkbox
- All contacts pulled into contacts_json array on client record
- All custom properties synced back to corresponding XO fields

Dedup logic:
- URL normalization: strips protocol, www prefix, trailing slashes, lowercases before comparing
- Searches both HubSpot `domain` and `website` properties with normalized comparison
- Falls back to company name fuzzy match (CONTAINS_TOKEN)
- Tracked via hubspot_company_id in clients/partners tables

Conflict resolution:
- Timestamp-based: compares xo.updated_at vs hs.hs_lastmodifieddate vs hubspot_last_sync
- First sync (NULL last_sync): HubSpot authoritative, overwrites XO values
- Ongoing: only the side that changed since last sync wins
- True conflict (both changed): neither overwritten, logged to hubspot_sync_log with both values
- `GET /hubspot/conflicts` + `POST /hubspot/conflicts/resolve` for manual review

Frontend (src/App.jsx):
- OAuth callback handler on `/oauth/callback?code=` with loading/success/error states
- HubSpot Integration panel in admin Configuration screen: connection status badge, Sync Now button
- CloudFront custom error responses (403/404 → index.html) for SPA routing

Infrastructure deployed:
- Lambda: `xo-hubspot-sync` (eu-west-2, role xo-lambda-role, 256MB, 60s)
- Env vars: DATABASE_URL, JWT_SECRET, AES_MASTER_KEY, AES_ENCRYPTION_KEY, BUCKET_NAME, HUBSPOT_PRIVATE_TOKEN, HUBSPOT_WEBHOOK_SECRET, HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET
- API Gateway: 10 resources under /hubspot/* on xo-api (odvopohlp3), deployed to prod
- DB migrations: hubspot_company_id, hubspot_contact_id, hubspot_last_sync on clients/partners; hubspot_sync_log table
- JWT secret rotated across all 9 xo- Lambda functions (64-char)
- RDS master password rotated (32-char)
- CloudFront SPA routing configured (E7PWZX8BT02CE)

Performance optimization (v1.99–v2.00):
- Batch HubSpot API: company creates/updates use /batch/create and /batch/update (up to 100 per call)
- Skip unchanged records: only push clients/partners where updated_at > hubspot_last_sync
- Pull no longer sets updated_at (only hubspot_last_sync), preventing push-pull feedback loop
- Accurate sync counters: pull only counts records where field values actually changed (was counting all checked)
- Before: ~138 API calls per sync. After: 0-4 batch calls steady-state, ~25 when records changed (~85% reduction)
- Steady-state sync returns 0/0/0/0 instead of misleading 12 updated

Contact field mapping fixes (v1.99–v2.00):
- Handles both {firstName, lastName} (separate) and {name} (combined) patterns in contacts_json
- Phone pushed to HubSpot phone property, LinkedIn to linkedinbio property (correct HubSpot property name)
- Honorifics (Mr, Mrs, Dr, Prof, etc.) filtered — not pushed as jobtitle
- Pull contacts merges into existing contacts_json (fills gaps) instead of overwriting
- Contact matching by email or firstName with merge preserving XO data
- Phone country code preference: _prefer_phone() prefers the version with + prefix, won't overwrite +44 with bare number
- Cleaned stale hubspot_company_id on deleted duplicate company

Enrichment note deduplication (v2.00):
- New hubspot_last_enrichment_id column on clients tracks which enrichment was last pushed as a HubSpot Note
- Before creating a Note, checks if enrichment_id matches last pushed — skips if same
- Only creates new Note when a new enrichment completes (different enrichment_id)
- Pushes: summary + bottom_line from latest completed enrichment results JSON in S3
- Prevents duplicate Notes accumulating on HubSpot Company records across repeated syncs

Testing: 55 pytest regression tests covering Private App auth, sync push/pull, batch API, field mapping, firstName/lastName handling, honorific filtering, LinkedIn mapping, phone country code preference, dedup with URL normalization, timestamp-based conflict resolution, webhook auth, pull-only mode, accurate counters, enrichment note dedup

Verified: Full sync pushed 2 partners + 12 clients via batch API. Steady-state sync: 0 pushed, 0 updated. Webhook pull-only operational. FC Dynamics contact fully synced both directions. Enrichment note pushed once, skipped on repeat push (verified via logs).

**v2.01 -- Deployment Brief Generation (March 30, 2026)**

Feature: Client-ready XO Deployment Brief on the Results page with branded .docx download.

Architecture:
- Enrichment produces standard analysis (summary, problems, architecture, plan, streamline_applications)
- Frontend assembleBrief() maps analysis results into 7-section brief structure -- no Bedrock call, instant render
- Static templates for Section 03 (Why Standard AI) and Section 05 (Constitutional Safety) with domain terms swapped in
- Node.js Lambda (xo-brief-download) generates branded .docx using docx npm package
- Results Lambda injects client metadata (company_name, industry, description, contacts) from encrypted DB into API response
- Download button on Results page calls POST /results/{id}/brief, receives base64-encoded .docx in JSON

Brief sections (7 total):
- 01 CLIENT PROFILE -- executive summary + company context from DB
- 02 THE OPERATIONAL CRISIS -- problems identified with severity, evidence, recommendations
- 03 WHY STANDARD AI CANNOT BE USED HERE -- static XO positioning with domain terms
- 04 THE XO DEPLOYMENT: ARCHITECTURE & OODA WORKFLOW -- ASCII diagram + 4-phase OODA loop
- 05 CONSTITUTIONAL SAFETY -- guardrails framework with domain adaptation
- 06 INTELLISTACK STREAMLINE APPLICATIONS -- parsed from streamline_applications field
- 07 PROOF OF CONCEPT & NEXT STEPS -- 7/14/21 day plan + POC timeline table + success metric

Branded .docx formatting (from brief-formatting skill):
- Dark navy cover page (#0D0D0D) with INTELLAGENTICXO header, teal accent, CONFIDENTIAL tag
- All "XO" text rendered in red (#CC0000) via xoTextRuns() helper
- Section headers with navy number badge + teal number
- Key metrics row (borderless table, large teal numbers)
- Teal callout boxes (THE PRINCIPLE, THE GUARANTEE, SUCCESS METRIC) -- cantSplit + keepNext
- Red risk callout boxes -- cantSplit to prevent page-break splits
- OODA phases with emoji icons, teal bold phase names, indented sub-bullets
- Streamline Applications with colored labels (Problem: red, Workflow: blue)
- POC timeline table with navy header row, alternating shading, column widths 720/1350/6956 DXA
- CONFIDENTIAL header + page numbers on all body pages
- ASCII architecture diagram in Courier New 14pt on F5F5F5 background, same page as section header
- Cover metadata: client name, Intellagentic Limited, enrichment date

Infrastructure changes:
- New Lambda: xo-brief-download (Node.js 20, eu-west-2, 256MB, 30s timeout)
- API Gateway: POST /results/{id}/brief routed to xo-brief-download with Lambda invoke permission
- IAM: xo-brief-invoke-results policy allows cross-Lambda invocation of xo-results
- Admin bypass on enrichment Lambda client lookup (admins can enrich any client)
- Bedrock model IDs updated to EU inference profiles (eu.anthropic.claude-opus-4-6-v1, etc.)
- Bedrock API switched from InvokeModel to Converse API (required for EU profiles)
- Enrichment Lambda timeout increased to 900s, Bedrock socket timeout to 840s
- IAM: xo-enrich-self-invoke policy for async Phase 2 self-invocation
- Legal pages: /terms, /privacy, /security -- public, no auth, SPA-routed via CloudFront
- Mobile landscape overflow fixes on dashboard and header

Enrichment fixes (v2.01):
- Admin bypass: admins can enrich any client regardless of user_id ownership
- Bedrock EU model IDs: eu.anthropic.claude-opus-4-6-v1, eu.anthropic.claude-sonnet-4-5-20250929-v1:0
- Converse API: replaced InvokeModel (required for EU inference profiles)
- Lambda timeout: 300s to 900s for Opus 4.6 analysis with deployment brief
- Self-invoke IAM permission for async enrichment Phase 2

Frontend additions (v2.01):
- Deployment Brief collapsible section on Results page with teal cover, metrics, numbered sections, OODA grid, POC table
- renderMarkdown() function: bold, bullets, numbered lists, fenced code blocks, backslash escape stripping
- assembleBrief() maps analysis results to brief structure -- zero API calls, instant render
- Legal pages (/terms, /privacy, /security) with shared styling, cross-links, company footer
- Login screen footer links (Terms, Privacy, Security)
- Mobile landscape overflow fixes (filter bar wrapping, hide-narrow CSS, header position:fixed)

**v2.02 -- Page-Agnostic Buttons + Skills Authority Refactor (March 31, 2026)**

Page-agnostic configurable buttons:
- New show_on TEXT column on buttons table (JSON array, default ["welcome"])
- Auto-migration on Lambda cold start
- Buttons API returns showOn as parsed array, accepts showOn in PUT body
- BUTTON_PAGE_OPTIONS: welcome, dashboard, sources, enrich, results, skills, configuration
- PageActionButtons shared component: filters system + client buttons by showOn for current page
- Button editor: "Show on pages" checkbox group with None option (empty array = hidden)
- New buttons default to showOn: [] (None) until admin assigns pages
- Rapid Prototype: system-scoped, showOn ["results"], renders inside Technical Section header
- Download .docx: system-scoped, showOn ["results"], renders inside Deployment Brief header
- Webhook to Streamline: system-scoped, showOn [] (hidden, admin can enable)
- Enrich/Skills removed from buttons table (duplicates of hardcoded sidebar nav)
- Buttons right-justified on all pages via justifyContent: flex-end

Skills authority refactor:
- Moved {system_skills_section} injection from before company data to AFTER TASK section
- Skill files are now the last instructions the model sees, giving them highest precedence
- Removed hardcoded Sections 1-8 from enrich Lambda (Executive Summary, Problems, Architecture, Schema, Action Plan, Bottom Line, Client Summary, Streamline Applications)
- All formatting intelligence now lives exclusively in skill .md files
- JSON output schema descriptions stripped to field purpose only (no formatting instructions)
- output-format.md expanded: problems structure (title/severity/evidence/recommendation), architecture ASCII example, schema table format example, 7/14/21 day action plan phase definitions
- Prompt order: persona -> company data -> client skills -> TASK -> system skills -> JSON schema

Prompt tuning:
- Executive summary: lead-in sentence + 3-4 bullet points, no filler/transition bullets
- Bottom line: no problem restatement, specific costs in currency, specific timeline in days
- Frontend bullet splitting: replaced Intl.Segmenter sentence splitting with newline-based splitting to preserve model's intended bullet groupings
- Fallback to sentence segmenter for legacy results without newlines

Current system buttons:
- Webhook to Streamline (showOn: [], hidden)
- Rapid Prototype (showOn: ["results"], Technical Section header)
- Download .docx (showOn: ["results"], Deployment Brief header)

System skill files (6 total, bundled in enrich Lambda):
- analysis-framework.md (65 lines) -- XO + Streamline architecture, analysis methodology
- authority-boundaries.md (34 lines) -- what to recommend vs defer
- client-facing-summary.md (32 lines) -- client_summary field format
- enrichment-process.md (22 lines) -- data source hierarchy, trust levels
- output-format.md (56 lines) -- all formatting rules (executive summary, problems, schema, architecture, action plan, bottom line, XO+Streamline framing)
- streamline-applications.md (90 lines) -- Streamline workflow recommendations

**v2.03 -- Growth Deck Generation + Consent Flow Cleanup (March 31 -- April 1, 2026)**

Growth Deck (.pptx) generation:
- xo-deck-download Lambda (Node.js 20, PptxGenJS) -- 8-slide branded Growth Deck
- assembleDeckData() maps analysis JSON directly to slide data -- no Bedrock call, pure JavaScript
- Instant synchronous download via POST /results/{id}/deck (same pattern as brief-download)
- Removed Bedrock on-demand extraction (was 60s, exceeded API Gateway 29s timeout)
- Removed async self-invoke + S3 polling architecture (handleDeckStart, handleDeckStatus)
- Removed @aws-sdk/client-bedrock-runtime and @aws-sdk/client-s3 dependencies from Lambda
- Download .pptx button on Results page alongside existing Download .docx
- Frontend reverted from polling pattern to simple POST-and-download
- RAG positioning rules hardcoded in slide builders:
  -- Protocol vs Probability comparison table
  -- Constitutional Safety (Two-Brain architecture, Dr. Mabrouka Abuhmida)
  -- OODA Command Loop (Observe/Orient/Decide/Act) with sector-specific descriptions
  -- L1-L4 Maturity Roadmap
  -- Pricing against cost of problem, not cost of technology
- Sector-specific text derived from client_industry and client_description
- Reference scripts: reference-pine-fund.js, reference-php-group.js (correct slide positioning)
- Text parsing helpers: cleanText() strips markdown artifacts, firstSentence() skips "1." numbering
- parseWorkflows() extracts title/desc from streamline_applications markdown sections
- cleanPlanItem() strips [XO Setup] tags and truncates after first colon
- API Gateway route: POST /results/{id}/deck

Enrichment without documents:
- xo-enrich Lambda no longer errors when no files uploaded
- Injects "_profile_only" placeholder so Claude analyzes using organization profile only
- Enables enrichment based on company_name, industry, description, contacts, website_url

Consent flow cleanup:
- ndaSigned state renamed to consentAgreed throughout UploadScreen component
- addNDA function renamed to handleConsent
- Tooltip changed from "Non Disclosure Agreement" to "Data Processing Consent"
- Drag-and-drop upload zone blocked until consent accepted (handleDrop guard + alert)
- Click-to-browse disabled until consent accepted
- handleDragOver suppresses drag highlight before consent

Unsaved changes protection:
- CompanyInfoModal warns before closing if form has unsaved data
- Applies to X button, overlay click, and browser beforeunload
- guardedClose() with window.confirm dialog

Known issues:
- S3 uploaded source documents stored as plaintext -- encryption fix scoped, waiting on Richie timing
- Bedrock IAM policy is wildcard Resource:* -- needs tightening to specific EU regions
- Growth Deck slide formatting is functional but could use further polish on edge cases

**v2.04 -- Growth Deck On-Screen Rendering + DRAFT Watermark System (April 1, 2026)**

Growth Deck on-screen rendering:
- 8 branded slide cards rendered inline on Results page (collapsible section, dark/light alternating)
- assembleDeckData() ported to frontend from Lambda -- same mapping logic, pure JavaScript
- Slide content previews: title, stat cards, challenges, Protocol vs Probability table, OODA phases, workflows, before/after comparisons, 21-day POC timeline, next steps + success metric
- Download .pptx button relocated into Growth Deck section header (previously in Deployment Brief header)
- Matches Deployment Brief collapsible section pattern
- ken.scott@intellagentic.io added to Slide 8 footer alongside alan.moore@intellagentic.io (on-screen + .pptx download)

DRAFT watermark system:
- All Brief and Deck output starts in DRAFT state by default
- On-screen: DRAFT banner bar at top of each section (red dashed border, "Watermarked until reviewed and approved")
- Downloads: DRAFT header text in .docx pages, rotated DRAFT watermark on .pptx slides
- "Draft -- watermarked until reviewed and approved" note in section headers
- approved_at / approved_by columns added to clients table (auto-migration on Lambda cold start)
- Re-enrichment resets approved_at to NULL (back to DRAFT state)

Review & Correct modal:
- "Review" button (amber) in Deployment Brief and Growth Deck section headers
- Modal with textarea for factual corrections
- "Submit Corrections" saves as text source on Your Data page:
  -- "Factual Corrections - Brief" or "Factual Corrections - Deck" as source label
  -- Uses existing POST /upload presigned URL flow
  -- Corrections included in next enrichment run
- "Approve" button (green) in section headers and modal:
  -- Sets approved_at timestamp via PUT /clients
  -- Removes DRAFT watermark on-screen immediately
  -- Future downloads (.docx and .pptx) exclude watermark
  -- APPROVED badge (green pill) replaces Review/Approve buttons

Backend changes:
- xo-clients Lambda: GET returns approved_at, PUT handles approved field, auto-migration adds columns
- xo-enrich Lambda: resets approved_at = NULL on new enrichment
- xo-results Lambda: passes approved_at through to download Lambdas
- xo-brief-download Lambda: conditional DRAFT header in .docx when not approved
- xo-deck-download Lambda: conditional DRAFT watermark on .pptx slides when not approved
- API Gateway: no new routes (reuses PUT /clients for approval)

**v2.05 -- Company LinkedIn + Bedrock IAM Cleanup (April 1, 2026)**

Company LinkedIn field:
- company_linkedin TEXT column added to clients table (auto-migration on Lambda cold start)
- Organization Profile view (welcome page): Company LinkedIn input with ExternalLink icon, autoSave on blur
- CompanyInfoModal (new client / edit modal): Company LinkedIn input after Website URL
- GET /clients returns company_linkedin, PUT /clients accepts company_linkedin, POST /clients includes on create
- HubSpot bi-directional sync: company_linkedin maps to HubSpot standard property linkedin_company_page
  -- Push: _build_company_properties sends linkedin_company_page to HubSpot
  -- Pull: _apply_hs_to_xo_update reads linkedin_company_page from HubSpot
  -- Conflict detection includes company_linkedin field

Bedrock IAM cleanup:
- Removed xo-bedrock-invoke inline policy from xo-lambda-role (wildcard Resource:*)
- No longer needed -- deck generation uses assembleDeckData() pure JavaScript mapping, no Bedrock calls

**v2.06 -- Engagements Model (April 1, 2026)**

Engagements model -- multiple deals/divisions per company:
- Each engagement has own focus area, contacts, enrichment, brief, deck, and approval status
- engagements table: id (UUID), client_id (FK), name, focus_area, contacts_json, status (active/won/lost/paused), approved_at, approved_by, hubspot_deal_id
- enrichments table: added engagement_id column (nullable, backward compatible)
- CRUD API: GET/POST/PUT/DELETE /engagements via clients Lambda
- API Gateway /engagements resource added with Lambda proxy integration + CORS OPTIONS
- Auto-migration creates engagements table on Lambda cold start

Frontend engagement management:
- Engagement cards on welcome page (after Company LinkedIn, before Industry)
- New Engagement modal: name (required), focus area (textarea directive), status dropdown
- Edit/delete engagement via card edit button
- SELECTED badge + CheckCircle vs "Click to select" prompt -- visually distinct from status badge (ACTIVE/WON/LOST/PAUSED)
- Auto-select when client has exactly one engagement
- Active Engagement Banner on Enrich, Results, Skills screens with "Change" link back to welcome page

Engagement-scoped enrichment pipeline:
- POST /enrich accepts optional engagement_id
- Focus area directive injected into Claude prompt: "ENGAGEMENT FOCUS: {focus_area}"
- Engagement contacts merged with company contacts (engagement contacts take priority)
- Results stored at {client_id}/engagements/{engagement_id}/results/analysis.json
- engagements.approved_at reset on re-enrichment (not clients.approved_at)

Engagement-scoped results and downloads:
- GET /results/{id}?engagement_id=X reads from engagement-scoped S3 path
- Returns engagement's approved_at (for DRAFT watermark) and engagement_name
- Brief download: reads engagement_id from body, passes to results Lambda, includes engagement name in filename
- Deck download: same pattern as brief
- Frontend: ResultsScreen passes ?engagement_id=X, isDraft uses engagement approved_at when scoped
- Download handlers pass engagement_id in POST body

Backward compatibility:
- engagement_id is optional in every API call
- When absent, all Lambdas behave exactly as before (company-level paths)
- Existing enrichment results stay at {client_id}/results/ -- no data moved
- Company-level uploads shared across engagements (focus_area directive handles relevance filtering)

Deferred to Phase 5:
- HubSpot Deal sync (engagements -> Deals, associate with parent Company)

**Next Step:** HubSpot Deal sync, web enrichment (company website + LinkedIn research), UI for 5 new DB fields (survival metrics, AI persona, strategic objective, tone mode).

---

**v2.07 -- Encryption Refactor: S3-Only Encryption with Admin Toggle (April 2, 2026)**

DB encryption removed — all database fields now stored as plaintext for searchability and simplicity. S3 file encryption retained as an optional, admin-toggleable feature. All encryption functions and keys preserved for future use.

Database changes:
- Removed all `encrypt()`/`decrypt()`/`search_hash()` calls on DB fields across 6 lambdas (~80+ call sites)
- auth: user email/name stored plaintext, lookups use `WHERE email = %s` directly (no more email_hash)
- clients: contact fields, contacts_json, addresses_json, webhook URLs stored plaintext
- buttons: button URLs stored plaintext
- gdrive: refresh_token stored plaintext
- enrich: all client field reads are plaintext (no decrypt on DB reads)
- results: client metadata reads are plaintext
- partners: email, phone, contacts_json, addresses_json stored plaintext
- engagements: contacts_json stored plaintext
- `migrate_decrypt_db.py`: one-time migration script to decrypt all existing DB fields (users, partners, clients, engagements, buttons, two_factor_codes)

S3 encryption toggle system:
- New `s3_encryption_enabled` key in system_config table (defaults to true)
- `is_s3_encryption_enabled(cursor)` helper reads the toggle
- `maybe_encrypt_s3_body/bytes()` — conditional encryption on writes (skips if toggle is off)
- `maybe_decrypt_s3_body/bytes()` — always decrypts if `ENC:`/`ENCB:` prefix found (reads always work regardless of toggle)
- All S3 writes in clients, enrich, gdrive lambdas use `maybe_*` wrappers
- All S3 reads in clients, enrich, results, rapid-prototype use `maybe_decrypt_*` wrappers

Bulk S3 conversion endpoint:
- `POST /system-config/s3-encryption-convert` — admin only
- Accepts `{ "action": "encrypt" | "decrypt" }`
- Iterates all clients, processes all S3 objects per client
- Text files (.md, .json, .txt, .csv): `encrypt_s3_body`/`decrypt_s3_body`
- Binary files: `encrypt_s3_bytes`/`decrypt_s3_bytes`
- Skips already-encrypted or already-plaintext files (idempotent)
- Updates `s3_encryption_enabled` toggle on completion
- Returns per-client results: status, files_converted, errors

Frontend admin UI:
- S3 File Encryption toggle in System Configuration panel (below Streamline toggle)
- Clicking toggle opens confirmation modal with action description
- Progress modal: progress bar + per-client log (company name, file count, status with color coding)
- Completion state: "Conversion complete" with Done button
- Modal blocks close while conversion is running

Files changed:
- `backend/lambdas/shared/crypto_helper.py` — added 5 new functions (toggle helpers)
- `backend/lambdas/shared/migrate_decrypt_db.py` — new one-time migration script
- `backend/lambdas/auth/lambda_function.py` — removed DB encryption (~19 call sites)
- `backend/lambdas/clients/lambda_function.py` — removed DB encryption (~36 call sites), added conversion endpoint, S3 toggle
- `backend/lambdas/buttons/lambda_function.py` — removed DB encryption (4 call sites)
- `backend/lambdas/gdrive/lambda_function.py` — removed DB encryption (3 call sites), S3 toggle
- `backend/lambdas/enrich/lambda_function.py` — removed DB encryption (~18 call sites), S3 toggle
- `backend/lambdas/results/lambda_function.py` — removed DB encryption (6 call sites), S3 toggle
- `backend/lambdas/rapid-prototype/lambda_function.py` — S3 toggle
- `src/App.jsx` — S3 encryption toggle + conversion progress modal
- `backend/EncryptionRefactor.md` — full proposal document

API Gateway: Add `POST /system-config/s3-encryption-convert` route to clients Lambda.

Deployment: (1) Take DB snapshot, (2) Run `migrate_decrypt_db.py`, (3) Deploy all lambdas, (4) Add API Gateway route, (5) Deploy frontend.

**v2.08 -- Engagement Labels, Admin Badge, Results Fix (April 2, 2026)**

Engagement context in output:
- Results page: engagement name and focus area shown above analysis sections when scoped
- Brief download (.docx): engagement name on cover page descriptor, bold "Engagement: {name}" in executive summary
- Deck download (.pptx): engagement name on slide 1 (title slide) below company name in smaller gray text

Admin visibility:
- XO ADMIN red pill badge added to sidebar between user name and email (isAdmin only)

Bug fixes:
- Results Lambda (xo-results): cryptography pip package was missing from deployment zip -- rebuilt with full requirements.txt (psycopg2-binary, PyJWT, cryptography) targeting Lambda runtime, CodeSize 370KB -> 9.5MB
- s3ConvertModal ReferenceError: stale cached bundle -- redeployed with CloudFront invalidation

Design scoped:
- Multi-tenant auth design: accounts, partner admin, partner user, client contact roles

**v2.09 -- Multi-Tenant Auth Phases 1-3 (April 2, 2026)**

Phase 1 -- Schema & Rename (complete):
- Renamed partners table to accounts across full stack (21 files, 181 references)
- Idempotent migration: DROP empty accounts table, ALTER TABLE partners RENAME TO accounts
- Added account_role column to users (super_admin, account_admin, account_user, client_contact)
- Added status (invited/active/deactivated), invite_token, invite_expires_at columns to users
- Created user_client_assignments table with user_id + client_id unique constraint and indexes
- JWT now carries account_id and account_role alongside legacy role field
- Auth middleware (auth_helper.py) reads both new fields from decoded JWT
- Data migration: role=admin -> account_role=super_admin, role=partner -> account_user, role=client -> client_contact
- All 6 Lambdas deployed, migration confirmed on cold start, fully backward compatible

Phase 2 -- Invite Flow (complete):
- POST /auth/invite -- create invited user, send branded email via SES
- POST /auth/invite/resend -- refresh token, resend email
- GET /auth/invite/{token} -- validate token (public endpoint, no auth required)
- POST /auth/invite/{token}/accept -- set password with bcrypt, activate user, return JWT
- DELETE /auth/invite?user_id=X -- soft deactivate user (status=deactivated, not hard delete)
- GET /auth/invite -- list all users in account (for Team page)
- SES configured in eu-west-2, sending from xo@intellagentic.io
- DNS verified: TXT (_amazonses), 3 DKIM CNAMEs, SPF include, DMARC on intellagentic.io
- Branded HTML email template with IntellagenticXO header, red CTA button, 30-day expiry
- Handles all user states: new (INSERT), invited (refresh token + resend), deactivated (reactivate as invited), active (reject with 409)
- Frontend: AcceptInvitePage at /accept-invite?token=xxx (pre-auth, password setup)
- Frontend: TeamScreen with invite modal (name, email, role, account dropdown), user list with status badges, resend and remove buttons
- "Team" sidebar nav item for super_admin and account_admin roles
- SES still in sandbox mode -- verified test recipients only until production access requested
- IAM: xo-ses-send inline policy on xo-lambda-role (ses:SendEmail, ses:SendRawEmail, Resource: *)

Phase 3 -- Client Assignment Scoping (complete):
- Assignment UI on Team page -- "Clients" button per user opens checkbox modal
- GET /auth/users/{userId}/clients -- list assigned clients
- POST /auth/users/{userId}/clients -- replace all assignments (delete + insert pattern)
- 6-tier scoped query in clients Lambda handle_list_clients:
  -- super_admin: all clients (no filter)
  -- account_admin: WHERE clients.account_id = user.account_id
  -- account_user: JOIN user_client_assignments WHERE uca.user_id = jwt.user_id
  -- client_contact: same as account_user
  -- Legacy is_account/is_client fallbacks preserved
  -- Default: WHERE clients.user_id = jwt.user_id
- Backend enforcement on results Lambda (_get_enrichment_results): account_role scoping
- Backend enforcement on upload Lambda (_verify_client): account_role + assignment check
- Frontend: account_user and account_admin now see "My Clients" in sidebar
- Frontend: login and page-load routing sends account_user/account_admin to dashboard
- Frontend: /accounts fetch gated behind isAdmin (no 403 for non-admin users)
- GET /clients without client_id now routes to handle_list_clients (was hitting handle_get_client)
- Tested end-to-end: account_user sees only assigned clients after assignment via Team page

API Gateway routes added:
- POST /auth/invite, GET /auth/invite, DELETE /auth/invite, OPTIONS
- POST /auth/invite/resend, OPTIONS
- GET /auth/invite/{token}, OPTIONS
- POST /auth/invite/{token}/accept, OPTIONS
- GET /auth/users/{userId}/clients, POST /auth/users/{userId}/clients, OPTIONS
- /accounts resource (GET/POST/PUT/DELETE/OPTIONS) -- renamed from /partners

Additional fixes and polish:
- Fixed s3ConvertModal scope bug crashing Results page (variable declared in ConfigurationScreen, JSX was in ResultsScreen scope)
- Fixed "System of Action" column text: "XO automates" changed to "Streamline + XO automates" in deck download Lambda and frontend
- Results page: "Potential Streamline Applications" header updated to "Potential Streamline + XO Applications" with XO in red (#CC0000)
- Fixed inviter name in email template -- was showing "XO Admin", now queries actual inviter name from DB instead of JWT
- Fixed Ken's display name in DB (was "XO Admin", migration now sets "Ken Scott")
- Fixed preferred_model to claude-opus-4-6 for ken.scott@intellagentic.io
- Fixed invite routing bug -- /auth/invite/resend was caught by /auth/invite/{token} wildcard, returning 405
- Fixed offset-naive vs offset-aware datetime comparison in invite token validation
- Fixed invite handler for deactivated users -- reactivates instead of INSERT duplicate
- Removed duplicate engagement context block on Results page (kept ActiveEngagementBanner only)

**April 3, 2026 -- Phases 4-5 Complete**

Phase 4 complete -- Account admin self-service:
- PATCH /auth/invite/role endpoint with role hierarchy enforcement (cannot promote above own role)
- Last-admin protection on both role change and deactivate (409 if last admin on account)
- Role change dropdown in TeamScreen (scoped by caller's role level, confirm on change)

Phase 5 complete -- Client contact + contributor roles:
- contributor role added to account_role CHECK constraint (super_admin > account_admin > account_user > contributor > client_contact)
- All scoped queries updated: clients, results, upload Lambdas include contributor in assignment-based filtering
- client_contact sidebar: Welcome + Results only (read-only, no upload/enrich/config)
- contributor sidebar: Welcome + Sources + Results (can upload, cannot enrich/configure)
- account_user and above: full workspace access (unchanged)
- Login and page-load routing includes contributor and client_contact -> dashboard
- Team sidebar remains admin/account_admin only
- Invite flow supports contributor role with client assignment

**April 3 continued:**
- Multi-tenant auth Phases 4-5 complete -- role change with hierarchy enforcement, last-admin protection, contributor role with filtered sidebar and scoped queries
- Google OAuth fix -- invited users with role='client' but valid account_role now login correctly instead of falling through to client contact scan
- API Gateway route added for PATCH /auth/invite/role
- Team page -- search/filter bar (name/email), account grouping with sorted sections (active > invited > deactivated), role/status dropdowns, client-token users filtered from list
- Partners page -- search/industry filter bar
- All list pages (All Clients, Team, Partners) -- consistent two-row header layout (title+count / action button on row 1, filters on row 2, 300px search + 150px dropdowns, 36px height, 12px gap)
- Data cleanup -- user names corrected (Richie Saville, Vamsi Nama), test accounts deactivated (ken.scott@intellagentic.com, xo@intellagentic.io), users assigned to accounts (Intellagentic created, core team assigned, kscott@scottaffiliated.com to Intellistack)
- feature/multi-tenant-auth merged to main -- all Phases 1-5 deployed and tested end to end

HubSpot Engagement Results Sync:
- Approved engagements push as Notes on HubSpot Company records with Opportunities List, Streamline + XO Applications content, and link to XO Capture results
- _push_engagement_results_for_client reads analysis.json from S3, decrypts, builds HTML note, creates/updates HubSpot Note associated with Company
- Only syncs approved engagements (approved_at IS NOT NULL) -- DRAFT engagements skipped
- Idempotent: tracks hubspot_note_id + hubspot_synced_at on engagements table, skips if already synced
- Runs over all clients with hubspot_company_id (independent of client change detection)
- Deal sync removed -- engagements are analysis lenses not pipeline items; Deals managed manually in HubSpot
- HubSpot Private App token updated, deal properties (xo_engagement_id, xo_focus_area) created
- HubSpot file/attachment scopes added to Private App -- file upload deferred (not needed for partner CRM flow)

Frontend fixes:
- Approve button fix -- setActiveEngagement prop threaded to ResultsScreen, engagement-level approved_at set correctly (was updating client-level instead of engagement)
- Independent loading states: briefDownloadLoading, deckDownloadLoading, briefApproveLoading, deckApproveLoading (clicking one no longer spins the other)
- handleApprove accepts section parameter ('brief' or 'deck') for targeted loading

Engagements feature fully complete (all 5 phases from the original plan):
- Phase 1: DB + CRUD API
- Phase 2: Frontend management (cards, modal, selection)
- Phase 3: Enrich pipeline scoping (focus_area, S3 paths)
- Phase 4: Results + downloads scoping (engagement_id throughout)
- Phase 5: HubSpot engagement notes sync

Remaining:
- Phase 6: 2FA/MFA (SMS via SNS + TOTP fallback)
- Polish: Google OAuth on accept-invite page, SES production access (requested, pending AWS review), remove debug logging, hide "Create Client" for contributor/client_contact

---

**April 4, 2026:**
- SES production access approved — invite emails can now send to any address
- Results page restructured — Solutions parent section with collapsible Intellistack Streamline and Intellagentic XO sub-blocks
- Removed "+ XO" from Streamline Applications title
- Scroll-to-section on expand (needs further polish)
- Fixed stray )} characters on Results section headers
- Fixed Rapid Prototype download — crypto_helper missing from Lambda package
- Independent loading states for Brief/Deck approve and download buttons
- SNS SMS configured — SenderID "XO" registered for UK, sandbox exit requested
- Team page search/filter deployed and consistent across all list pages

Backlog:
- Scroll-to-section positioning needs further refinement
- 2FA with email codes (SES ready), SMS pending sandbox exit

---

**April 6, 2026:**

XO CONSOLE + CLIENT FORM FIXES

- XO Console Layer 3 mobile fix -- reduced font sizes on mobile (<768px), removed whiteSpace: nowrap, added overflow-wrap: break-word, stacked grid to single column. Scoped CSS classes (xo-layer3, xo-layer3-text, xo-layer3-header, xo-layer3-subheader) in index.css @media block. No changes outside Layer 3 section.
- Channel Partner dropdown -- fixed duplicate name display ("Intellistack -- Intellistack"). Now shows single name when account_name and company match.
- New Client modal -- renamed "Partner Information" to "Client Information", save button updated to match.
- Client Branding uploads -- added prominent amber message "Save client first to enable logo and icon uploads" when clientId is null.
- Super_admin consent bypass -- super_admin users can now upload docs on Your Data page without client consent gate. Consent status shows "Admin Bypass -- client consent pending" in amber when client hasn't consented yet.

FILE VIEW + UPLOAD ERROR HANDLING

File View -- Presigned URL:
- Fixed View button on uploaded files -- was using hardcoded direct URL to wrong bucket (xo-client-data in us-west-1)
- Now calls GET /uploads?action=view to generate presigned GET URL from xo-client-data-mv in eu-west-2
- Presigned URLs include ResponseContentType and ResponseContentDisposition: inline -- PDFs and images open in browser
- No API Gateway changes -- reuses existing GET /uploads route with action query parameter

Upload Error Handling:
- Frontend now checks S3 PUT response after each file upload
- On failure, automatically deletes phantom DB record via DELETE /uploads/{id}
- Shows error message to user
- Prevents phantom entries in Data Library

GROWTH DECK -- ENGAGEMENT THREADING

- Engagement name (e.g. "Radiology") now threaded through all Growth Deck slides
- Title slide: "Scaling Mayo Clinic -- Radiology"
- Challenge slide: "The Radiology Challenge" instead of generic industry
- OODA slide: references engagement in deployment context
- Workflow slide: "Radiology Workflows That Encode Institutional Knowledge"
- Before/After slide: "Radiology: From System of Record to System of Action"
- POC slide: "21-Day Radiology Proof of Concept"
- Next Steps: references engagement scope
- Falls back to industry name when no engagement selected
- Updated both frontend (App.jsx) and backend (xo-deck-download Lambda)
- Removed duplicate engagement subtitle from .pptx title slide
- Fixed Lambda crash (duplicate engName variable)
- Changed deck subtitle from "INVESTOR-READY" to "CLIENT-READY"

BUILD IN STREAMLINE BUTTONS

- Restored "Build in Streamline" buttons to Potential Streamline Applications section
- Blue button after each workflow Outcome line with loading/success/error states
- Re-added buildingWorkflow and buildResults state variables
- Calls POST /build-workflow with client_id, engagement_id, app_index, app_data

---

**April 14, 2026:**

CONTACT PHOTOS
- Contact avatar on welcome page -- click circle for popover with Upload photo, Paste URL, or Remove photo
- Photos uploaded to S3 under client contacts folder
- Avatar displayed on dashboard client list next to primary contact name
- No backend/DB changes -- photo_url stored in existing contacts_json blob

TEAM PHOTOS
- Photo popover on Team page avatars -- Upload photo, Paste URL, Remove photo
- Admins can edit any team member's photo, users can edit their own
- Sidebar shows logged-in user's avatar (28px circle)
- Cross-reference: contact avatars auto-resolve from team member photos by email match
- S3 upload path: _system/contacts/team_{user_id}_photo.{ext}
- Auth Lambda: handle_preferences accepts target_user_id for admin photo edits
- Upload Lambda: _system path bypass for admin team photo uploads

BACKLOG: Team member photos -- upload once on profile, shows everywhere (Team page, sidebar, auto-populates matching contact avatars by email)

BUG FIXES
- Country code dropdown: selection now persists when phone number is empty (joinPhone preserved country code)
- Company LinkedIn field: added to PUT/POST API payloads, added to fetchExistingClient and handleSelectClient data mapping

---

**April 13, 2026:**

BRIEF FORMATTING POLISH

Architecture Change:
- brief-download Lambda now reads brief-formatting.md skill from S3 at runtime
- parseFormattingSkill() extracts component definitions (oodaPhaseCard, problemCard, solutionCard, metricCard) into config object
- buildDocument() is config-driven -- colors, fonts, layout read from skill file, not hardcoded
- Editing the skill on XO Capture Skills page updates the next brief download -- no Lambda redeploy needed

Formatting Changes:
- Section 02: Problem cards with severity-colored left borders (red/orange/green), bold first sentence, 3-sentence evidence cap
- Section 04 OODA: 2x2 card grid (teal phase names, bold subtitles, bullet items) replacing flat paragraphs
- Section 04 Recommendations: Solution cards with XO (red) / Streamline (teal) / Outcome (green) labeled sections
- Section 04 Architecture: Client-specific ASCII diagram from analysis JSON in Courier New 6pt code block (replaces broken structured table)
- Executive Summary metrics: Short priority labels (Priority A(i), Priority A(ii), Priority B) replacing truncated titles
- Section 01: Callout box shows client description only (no duplicate of Section 02 evidence)
- Section 03: Clean 2-sentence AI limitations argument (no evidence leaking)
- D-priority problems merged when two D items exist
- Source citations stripped from all text fields
- FLAG FOR HUMAN REVIEW prefix stripped from recommendations
- Blank pages eliminated (pageBreakBefore replaces standalone pageBreak, trailing spacers removed)
- Dead architectureDiagram() function removed

Files Changed:
- backend/lambdas/brief-download/index.js (buildDocument refactor, S3 skill loading, new component builders)
- skills/system/brief-formatting.md (parseable component blocks added)

---

**April 15, 2026:**

PR #1 -- Component Library Skill
- skills/system/component-library.md loaded by enrich Lambda
- Generator gen_component_library.py scans 01_Components/ READMEs
- Synced to s3://xo-client-data-mv/_system/skills/ and seeded to DB

PR #2 -- Component Mapping Three-Surface Rendering
- component_mapping JSON field in enrich Lambda output (fits/extends/new_components/summary_line)
- Architecture diagram ASCII carries [EXISTING]/[EXTEND]/[NEW] inline tags
- Results page: admin-only Component Mapping nested under Proposed Architecture, collapsed by default
- rapid-prototype.md: COMPONENT REUSE MAP section

PR #3 -- rapid-prototype.md Hygiene (c8c9307)
- Pain_point verbatim dumps fixed (200-char truncate + generic framing)
- Word-boundary title truncation + [XO + Component] tag prefix stripping
- Added PROPOSED ARCHITECTURE fenced ASCII to .md
- Renamed "Out of Scope" to "Weeks 2-3 (Validate & Decide)"
- SEED DATA uses analysis.sources with [type] reference format

PR #4 -- POC Scoping + [POC]/[PHASE 2] Overlay + Caption Consistency (33a9f8c)
- clients.poc_scope JSONB + GET/PUT /clients?action=scope endpoints
- Scope POC modal on Results (admin-only)
- Status indicator + warning banner; expandable detail when scope set
- rapid-prototype scope-aware: POC SCOPE header, tag overlay on Component Reuse Map, legend under Proposed Architecture, programmatic summary_line caption
- Pain Point Target now uses in-scope problem titles
- Enrich Lambda: model no longer embeds caption inside architecture_diagram

Component Classification Quality (9b8645f):
- Status-based tag mapping: v1_shipped as-is = [EXISTING], adding capability = [EXTEND], spec = [NEW]
- Tag format enforcement: exactly [EXISTING], [EXTEND], or [NEW] -- no variants
- Streamline convention: platform layer not component, workflows configured not built
- Component status fields added to CarrierGate and ExceptionEngine READMEs

Stale Scope Detection (9f18fad):
- rapid-prototype: detects stale scope (no problem ID overlap), falls back to full scope with warning
- Enrich Lambda: auto-clears or trims poc_scope on re-enrichment when problem IDs change
- Frontend: red warning banner "Scope is stale" with Re-scope link

Streamline/XO Ingestion Decision Rule (3d2143e):
- component-library.md skill updated with ingestion path decision rule
- Streamline connector vs XO component classification for data sources
- Division of responsibility: Streamline owns transport + connectors, XO owns persistent state + domain logic

HubSpot Configuration Fix:
- Frontend now handles Private App response (no authorization_url) -- sets hubspotConnected on success
- Differentiated error: token not set vs token rejected vs OAuth flow
- Added Private App tooltip on Connect button + italic note when connected
- Root cause of 401: HubSpot Private App token (pat-eu1-...) returning 401 on /crm/v3/objects/companies -- token may be expired/revoked/scope-limited. Credential issue, not code bug.

HubSpot Sync UI + Log Fix:
- Frontend: replaced alerts with inline success/failure banner (green/red, auto-dismiss 8s)
- Shows push counts inline: "Synced 2 accounts, 22 clients. Pulled 0 new, 0 updated."
- Lambda: 409 property-exists responses now logged as INFO not ERROR
- Both root and package/ lambda_function.py synced

Workspace-Check Tooling Migration:
- Moved ~/Documents/workspace-check/ to ~/dev/workspace-check/
- Pushed to github.com/intellagentic/workspace-check (private repo)
- Contains check.py (workspace validator) + gen_component_library.py (skill generator)

Engagement + Scope Coexistence Fix:
- Root cause: displayResults.status stuck on 'processing' from engagement-scoped enrichment while data exists -- scope indicator gated on status === 'complete', never rendered
- Fix: loosened conditionals to check problems.length > 0 instead of status string
- Badge now conditional: shows "Complete" when data exists, "Processing" when status says so
- Scope nulled on engagement change via useEffect ref tracking
- POC Scope line added to rapid-prototype .md metadata
- Visual separator between engagement banner and scope indicator
- Debug console.log removed

POC Scope on Engagement:
- Moved POC scope from clients.poc_scope to engagements.poc_scope
- DB migration: ALTER TABLE engagements ADD COLUMN poc_scope JSONB + one-time data migration from clients
- Backend: scope GET/PUT endpoints accept engagement_id (client_id fallback); rapid-prototype + results Lambdas accept engagement_id with root S3 analysis fallback
- Frontend: scope modal saves to engagement; scope syncs from activeEngagement.poc_scope; modal disabled when no active engagement; prototype download appends ?engagement_id=
- Fixed missing e.poc_scope in list-engagements SELECT query
- Enrich Lambda stale-scope check operates on engagement or client table as appropriate

PR #7 -- UI Fixes Post-Merge (cc9fd88):
- Scope indicator count line restored -- always shows "Scope: N of M problems, X of Y components" with titles below
- Executive Summary metric card parser switched from period split to semicolon split -- avoids breaking on parenthetical text
- Two-card render restored

Accessibility Quick Wins (WCAG 2.2 AA):
- select-name (4.1.2): aria-label added to all 16 select elements — 0 violations
- color-contrast (1.4.3): --text-muted CSS variable #888888 -> #6b7280 (passes 4.5:1 on white); sidebar text opacity 0.5 -> 0.7; footer links #808080 -> #6b7280
- Lighthouse login score: 92% (remaining: login gradient contrast — borderline, dark bg)
- axe authed: select-name eliminated; color-contrast reduced from 13 to ~2 nodes (sidebar active item borderline)

Generator/Skill Drift Closed (workspace-check PR #1, 6ea13a1):
- gen_component_library.py now emits classification rules, tag format enforcement, Streamline convention, and ingestion path decision rule
- Regeneration diff verified empty against current xo-capture skill
- Status section renders phase inline (spec/in_build/v1_shipped)
- Linked: https://github.com/intellagentic/workspace-check/pull/1

Tag Format Drift Fix (PR #11, ef6dc74):
- Canonical [EXISTING]/[EXTEND]/[NEW] enforced across skill and rapid-prototype Lambda
- Removed [FITS] and [EXTENDS] variants from rendered .md output
- Skill tag-format rule expanded with explicit forbidden-variants list
- Zero-drift verified on InXpress re-enrichment

Classification Rule Fix (PR #9, 65821b5):
- Spec-phase library components now tag as [EXTEND] not [NEW]
- Rule: library entry exists = [EXTEND]; no library entry = [NEW]
- Skill updated (component-library.md), reseeded to DB + S3
- Enrich Lambda unchanged (reads rule from skill at runtime)
- Verified on InXpress re-enrichment: CarrierGate [EXTEND], ExceptionEngine [EXTEND], CustomerStatusPortal [NEW]

Repo Rename xo-quickstart -> xo-capture:
- GitHub repo renamed via gh repo rename
- Updated all path references in CLAUDE.md, skills/README.md, PROJECT-STATUS.md, deploy-xo-capture.sh
- RDS instance name (xo-quickstart-db) and DB name (xo_quickstart) left unchanged -- infrastructure names, not repo refs
- GitHub auto-redirects old URL to new

PR #20 -- Fresh Presigned S3 URLs for Team Avatar Photos:
- Team user photo_url stored as presigned URL which expired after 1 hour, showing gray circles
- Added _resolve_photo_url() in auth Lambda to regenerate fresh presigned URLs at read time
- Applied to login response and invite list endpoints

PR #21 -- Model Picker Update:
- Added Opus 4.7 (eu.anthropic.claude-opus-4-7-20250415) as default enrichment model
- Updated Opus 4.6 and Sonnet 4.6 model IDs in BEDROCK_MODEL_MAP
- Removed Sonnet 4.5 and Haiku 4.5 from picker

PR #22 -- Exec Summary Skill Enforcement + Resilient Metric Card Parser:
- Enforced 3-paragraph executive summary structure in output-format.md skill
- Paragraph 3 must start with "Key metrics:" prefix
- Added fallback scanner for metric cards when model doesn't produce "Key metrics:" prefix
- Strip trailing parenthetical source citations before comma-split

PR #23 -- Scope Preservation on Re-enrichment:
- Re-enrichment no longer auto-clears poc_scope on engagements
- Added scope_review_needed BOOLEAN flag — set TRUE after enrichment, cleared on manual scope save
- Amber banner in UI when scope review needed
- Replaced stale-scope slugify comparison with flag-based approach

PR #24 -- Contact Photo Upload — Store S3 Key Not Presigned URL:
- Contact photos in contacts_json stored presigned URLs that expired after 1 hour
- Frontend now stores bare S3 key from upload response instead of view_url
- Added _resolve_contact_photos() in clients Lambda to generate fresh presigned URLs on read
- Applied to both handle_get_client and _format_engagement contact loading
- contactPhotoCache in frontend for immediate display after upload

PR #25 -- Fix Stale Closure in Contact Photo Save:
- updateContact + setTimeout(autoSave, 0) caused autoSave to read stale formContacts from React closure
- Added contactsOverride as second parameter to autoSave
- All four handlers (upload, paste URL, remove, country code) now build updated contacts array and pass directly to autoSave
- Fixes Contact 2+ photo not persisting after upload

PR #26-35 -- Growth Deck + Architecture Diagram Iterations:
- Growth Deck slide 6: removed duplicate/filler rows, capped at min(problems, workflows)
- Workflow count metric card matched to slide 6 row count
- Architecture diagram template evolved from 5-layer to named bands model
- Final model: DATA SOURCES → XO RUNTIME PREDICTIVE ANALYSIS → STREAMLINE WORKFLOW ORCHESTRATION → CONSOLE
- Single Streamline Redox Connector (not per-module), no XO Direct in diagram, unified Console box

PR #36 -- Build in Streamline Webhook Fix:
- incoming_webhook step type mapped to webhook before Streamline API call
- Frontend polls GET /build-workflow/{build_id} instead of expecting synchronous response

PR #37 -- JWT account_role Fix:
- Added [TOKEN] diagnostic log to _success_response DB lookup
- Fallback to caller-provided account_id when DB re-query fails

PR #38 -- Client Assignment for Invited Users:
- Clients button now shows for both active and invited users on Team page

PR #39 -- Invite Modal Client Assignment:
- Client picker with checkboxes added to Invite User modal for scoped roles
- After invite, calls POST /auth/users/{id}/clients with selected client IDs

PR #40 -- Invite Client List Sort + Search:
- Client list sorted alphabetically, search input filters by name

PR #41 -- Engagement Selection Persistence:
- Selection saved to sessionStorage keyed by clientId
- Restored on page refresh and client re-selection
- Engagement fetch added to fetchExistingClient for page-load restoration
- Status badge renamed from "ACTIVE" to "Open" (gray, subtle)

PR #42 -- Button Label Rename:
- "Download .docx" → "Download Brief"
- "Download .pptx" → "Download Deck"

PR #43 -- Button Visibility Toggle:
- Added hidden BOOLEAN column to buttons table
- Eye/EyeOff toggle in Configure Buttons admin
- Hidden buttons render dimmed in config, excluded from PageActionButtons

PR #44 -- Button Sync Upsert:
- PUT /buttons/sync changed from delete-and-replace to upsert by ID
- Only deletes buttons listed in deleted_ids array
- Prevents accidental wipe of all system buttons

PR #45 -- Inline Button Visibility Filter:
- Added shouldRenderButton(label, page) helper in ResultsScreen
- Checks systemButtons config for hidden flag and showOn array
- Applied to all 5 inline render sites: Rapid Prototype, Download Brief, Download Deck, Build in Streamline (per-workflow), Issue Report
- Top-bar exclusions: Download Deck, Build in Streamline, Rapid Prototype suppressed from floating top bar on Results and Configuration pages
- Legacy-safe: undefined showOn or no matching entry = render as before
- No changes to button definitions, Configure Buttons registry, or Lambda code

PENDING ITEMS:
- Drop clients.poc_scope column in follow-up once no fallback hits observed for 30 days
- CS Triage Dashboard + Customer Dashboard rendered as standalone [NEW] boxes in architecture_diagram when they are UI surfaces of ExceptionEngine / CustomerPortal respectively. Needs a ui_surface modeling concept in component READMEs.
- Remove [PHOTO DEBUG] console.log statements after contact photo upload verified stable
- CLAUDE.md deploy patterns: document that buttons Lambda deploys from package/ (same as results)

---

**April 26, 2026 — v2.46:**

TWO-STAGE PER-DOCUMENT /enrich (the citation-depth fix)

Driver — round-1 audit finding:
- audits/2026-04-26-enrich-investigation branch ran a four-step diagnostic (CloudWatch / DB↔S3 diff / analysis-name coverage / signature-citation depth) on FC Dynamics + MFP Trading.
- Steps A-C cleared retrieval. Step D failed: 6 of 18 input files across the two clients had ZERO unique content cited in the substantive analysis fields.
- Mechanism: text[:5000] per-file truncation discarded 87% of the FC Dynamics Intro Call transcript and 63% of Fire Strategy.pdf; Stage 2 then synthesised across a flat concat that mashed all files together, encouraging consolidation of near-duplicates and silent dropping of transcripts and follow-up emails.

Architecture (replaces text[:5000] concat at lambda_function.py:1300):
- Stage 1: per-document Claude call with FULL text (Opus 4.6, max 100k chars/doc), parallel via ThreadPoolExecutor (max_workers=3). Output is a structured per-file summary (distinctive_facts, named_entities, decisions, action_items, quotes, overlap_signals, summary_2_lines).
- Stage 2: existing analyze_with_claude prompt rewritten to consume Stage 1's structured output instead of raw concatenated text. sources[] schema now requires one entry per filename with a verbatim distinctive_fact, plus consolidated_with + unique_angle for legitimate overlaps. Server-side enforcement: sources[] coverage gap → auto-fill missing filenames with a marker (never silent drop).
- maxTokens raised 16000 → 32000 (Opus output is richer; 16k was a real truncation risk).
- Both stages use the same model — value flows from request body → users.preferred_model → backend fallback (now Opus 4.6, see below). No hardcoded model identifier in any new code.

Per-document caching (new document_analyses table):
- Schema: UUID id, upload_id (FK uploads), etag (S3 ETag), prompt_version (lambda constant), stage1_output JSONB, UNIQUE(upload_id, etag, prompt_version), CASCADE on uploads delete.
- INSERT ... ON CONFLICT DO NOTHING for race-safety. Cache invalidates on file change (new ETag), prompt edit (STAGE1_PROMPT_VERSION bump), or upload deletion.
- Stage 2 is NEVER cached — synthesis depends on full corpus + skills + client config, all of which can change.
- Cache verified end-to-end on FC Dynamics: gate-A cold ran 3 fresh + 5 cache-hit; gate-B warm hit 8/8.

Stage 1 hardening (after gate-A 429 incident):
- Initial deploy with max_workers=8 hit Bedrock 429s on 3 of 8 parallel Opus calls within 1s — Opus per-account TPM/RPM tighter than modelled. Rolled back, hardened, re-deployed.
- DEFAULT_MAX_WORKERS=3 (was 8). Hand-rolled exponential backoff with jitter in _bedrock_invoke_with_retry. 1s, 2s, 4s base + 0-1s jitter, max 3 retries. Uniform across bearer-token urllib and boto3 IAM converse paths. Non-throttle errors bypass the loop. Both DEFAULT_MAX_WORKERS=3 and MAX_STAGE1_RETRIES=3 locked by a unit test.
- _fallback_stage1 deleted. When a file's Stage 1 cannot complete after retries, Stage1FailedError propagates. Pipeline halts: enrichments.status='failed', stage='stage1_failed', error_message=<truncated>. NO degraded analysis JSON is written. Successful per-file outputs from a partial run ARE still cached so a retry skips work that did complete.

Silent-fallback audit (six sites flipped to Opus 4.6):
- Production check: 25 of 35 users on Opus 4.6, 10 explicitly on Sonnet 4.5 (their choice, untouched), 0 NULL — but six fallback paths in code defaulted to Sonnet:
  - lambda_function.py:192 COALESCE(preferred_model, 'claude-sonnet-4-5-20250929')
  - lambda_function.py:196 Python `else 'claude-sonnet-4-5-20250929'`
  - lambda_function.py:337 event.get('model', 'claude-sonnet-4-5-20250929')
  - lambda_function.py:1430 analyze_with_claude(model='claude-sonnet-4-5-20250929')
  - lambda_function.py:1645 BEDROCK_MODEL_MAP.get(model, BEDROCK_MODEL_MAP['claude-sonnet-4-6'])
  - App.jsx:1941 useState(initialAuth.user?.preferred_model || 'claude-sonnet-4-6')
- All flipped to claude-opus-4-6. Locked by test_no_request_model_no_user_row_resolves_to_opus_4_6.

UI updates:
- New 'preprocessing' enrichment stage label "Analyzing Each Document" added to ResultsScreen.stages (App.jsx:7123) between Transcribing and Web Research.
- /results Lambda now recognises status='failed' alongside legacy 'error'; surfaces enrichments.error_message to the frontend so operators see what halted Stage 1.
- Frontend polling treats 'failed' identically to 'error' — existing red-card UI renders error_message text as-is.
- Sources card on results view shows consolidated_with info: small italic note "Consolidated with N other files — unique angle: <text>" beneath each source entry.

Schema changes (idempotent):
- CREATE TABLE document_analyses (...).
- ALTER TABLE enrichments ADD COLUMN error_message TEXT.

.md upload support:
- frontend file picker accept= adds .md.
- extract_text gains md branch (UTF-8 with errors='replace').
- Upload Lambda has no allowlist so no change there. End-to-end verified by Gate D: synthetic .md with sentinel marker GATE-D-MD-SENTINEL-zphq9217 → Stage 1 extracted verbatim → Stage 2 cited in sources[].distinctive_fact.

Verification (post-deploy):
- Gate A FC cold: PASS, 3/3 fresh + 5 cache-hit, 0 failed, 4m 15s.
- Gate B FC warm: PASS, 8/8 cached, 0 fresh, 3m 19s.
- Gate C1 MFP cold: PASS, 10/10 fresh, 5 separate 429 events absorbed by retry-with-backoff, 0 leaked, 6m 21s.
- Gate C2 MFP warm: PASS, 10/10 cached, 0 fresh, 5m 12s.
- Gate D .md end-to-end: PASS, sentinel cited verbatim, fixture cleaned up.
- Citation-depth verification (audits/diag_step_d_score_signatures_v2.py): 8/8 FC + 10/10 MFP covered, 0 failing. Hard contrast vs round-1: 6 of 18 uncited pre-fix, 0 of 18 uncited post-fix.

Production state at deploy completion:
- Lambda xo-enrich at v3 (CodeSha256 D88ttp/zJyCG2uGAMMs9cTwm1YiPOAwOBtSbKqOJpoo=). v1 + v2 retained as immutable AWS rollback targets.
- Schema applied to production RDS (xo-quickstart-db).
- Frontend deployed (CloudFront E7PWZX8BT02CE invalidated /*).

Files changed (commits 857e446 + 70610a9 + f55acb8 + frontend redeploy):
- backend/schema.sql (+22)
- backend/lambdas/enrich/lambda_function.py (+220 / -19)
- backend/lambdas/enrich/preprocess_per_document.py (NEW, +413)
- backend/lambdas/enrich/deploy-enrich.sh (+1: include preprocess_per_document.py in package)
- backend/lambdas/results/lambda_function.py (+13 / -7: failed-status branch + error_message surfacing)
- src/App.jsx (+25 / -7: .md accept, opus default, preprocessing stage, consolidated_with badge)
- backend/lambdas/tests/test_enrich_lambda.py (+37: lock test for Opus fallback)
- backend/lambdas/tests/test_enrich_preprocess.py (NEW, +334: 12 unit tests)

Cost (measured from CloudWatch Bedrock metrics, post-deploy):
- First enrichment (Stage 1 fresh + Stage 2 fresh, 8-10 file client): ~$0.90 (extrapolated; cold-cache run not captured post-deploy — recommend capturing next time a cold-cache client runs through to confirm).
- Cached re-run (Stage 1 cache hits, Stage 2 fresh): ~$0.42-$0.56 measured (FC Dynamics $0.42, MFP Trading $0.56).
- Annualised platform spend at 53 clients × ~7 enrichments/year (1 cold + 6 warm mix per client): ~$204/year ($224 with the regional inference profile premium).
- Earlier $0.30 / $910 figures were based on incorrect pricing assumptions (used Opus 3-era $15/$75 per Mtok rather than Opus 4.6's $5/$25 per Mtok). Corrected in v2.48.

Known issues filed separately (not addressed in this branch):
- GitHub #49 — list_objects_v2 missing pagination, P2 (silent 1000-key cap on enrich/lambda_function.py extract_all_files / find_audio_files / read_skills_from_s3).
- GitHub #50 — source_count column predicate disagrees with enrich retrieval predicate, P3 (clients/lambda_function.py:872 vs enrich/lambda_function.py:230, NULL-status case).

Audit branch retained:
- audits/2026-04-26-enrich-investigation on origin — durable record of the four-step diagnostic, source-text dumps for FC + MFP, and the round-1 verdict that motivated this change.

---

**April 26, 2026 — v2.47:**

PR #52 — close out the two latent issues filed during the v2.46 audit. Squash-merged to main as f2a5cf9. Closes GitHub #49, closes GitHub #50.

GitHub #49 — list_objects_v2 missing pagination (P2):
Three call sites in backend/lambdas/enrich/lambda_function.py invoked list_objects_v2 once and consumed the first page only — any client with > 1000 objects under their S3 prefix would silently lose everything past the first page (Lambda completes without error, fewer documents in the analysis than the client uploaded). No client today is anywhere near 1000 keys; the failure was latent. Replaced with the paginator pattern at all three sites:
- extract_all_files     (uploads listing)
- find_audio_files      (audio files for Transcribe)
- read_skills_from_s3   (skills directory listing)

Three new moto-backed unit tests confirm > 1000 keys are retrieved at each site (1500 uploads + 5 audio + 1100 skills synthetic fixtures). Existing tests adapted from the single-call mock shape to a paginator-shape mock via _set_paginator helper.

GitHub #50 — source_count predicate divergence (P3):
Two predicates over the same uploads table disagreed:
- clients/lambda_function.py:872 source_count: status='active' only
- enrich/lambda_function.py:230 active uploads: status='active' OR status IS NULL

Read-only production probe (2026-04-26) confirmed zero NULL-status rows across all 91 uploads (77 active + 14 deleted). The divergence was theoretical only, never realised. No upstream code path leaks NULLs (30-day window: zero NULL inserts). Schema migration (idempotent — UPDATE 0 rows on prod):
  UPDATE uploads SET status='active' WHERE status IS NULL;
  ALTER TABLE uploads ALTER COLUMN status SET DEFAULT 'active';
  ALTER TABLE uploads ALTER COLUMN status SET NOT NULL;
Code: dropped `OR status IS NULL` from the enrich predicate (line 230) — now status='active' only, byte-identical to source_count. New lock test test_active_upload_query_uses_strict_active_predicate asserts the SQL string can't drift back without tripping CI.

Source-count parity verification (post-deploy):
Re-enriched FC Dynamics + MFP Trading with new code, then compared three numbers per client:
  A) source_count predicate via clients/lambda_function.py:872
  B) new enrich active-uploads SELECT
  C) len(analysis['analyzed_files']) from the latest complete enrichment

  client          A   B   C   parity
  FC Dynamics     8   8   8   PASS
  MFP Trading    10  10  10   PASS

A=B=C across the board. The divergence class is closed.

Production state at deploy completion:
- Lambda xo-enrich CodeSha256 tE++g2fNKHb6Ebrmfw/2GvB4FGehW1E5Aepz8TOrKMA= (deployed 2026-04-26T23:15:22Z).
- Lambda v3 retained as immutable AWS rollback target (CodeSha256 D88ttp/zJyCG2uGAMMs9cTwm1YiPOAwOBtSbKqOJpoo=).
- Schema applied to production RDS: uploads.status NOT NULL DEFAULT 'active'.
- Pre-PR-52 uploads-table state archived at audits/2026-04-26-pre-pr52-uploads-state.txt.

Tests: 34/34 passing on main (was 30 → +3 pagination + 1 predicate lock).

Files changed (squash commit f2a5cf9):
- backend/schema.sql                              (+13)
- backend/lambdas/enrich/lambda_function.py       (+24 / -23)
- backend/lambdas/tests/test_enrich_lambda.py     (+59 / -11)
- backend/lambdas/tests/test_enrich_preprocess.py (+145)
Total: +302 / -97

---

**April 27, 2026 — v2.49:**

Two production frontend fixes shipped in response to a "Partners page renders blank" report. Both bugs were latent in main; the v2.46 redeploy on 2026-04-26 produced the fresh bundle that surfaced them on first navigation.

Fix 1 — Partners page blank render (commit 1b58cf2):
AccountsScreen at src/App.jsx:2913 referenced `teamUsers` inside the contact-photo cross-reference block (lines 3105-3106) but the prop was never passed in at the mount site (src/App.jsx:2875 — `<AccountsScreen accounts={accounts} setAccounts={setAccounts} />`). On render of any partner row whose first contact had `firstName` or `lastName` set, `teamUsers.find(...)` threw `ReferenceError: teamUsers is not defined`, React unmounted the subtree, the page rendered blank. Live data tripped on Intellistack (Aled Miles) and Tom Dudbridge.

Bug introduced 2026-04-14 in commit ba107c7 ("feat: team member photos — popover, sidebar avatar, contact cross-reference"). Latent for 13 days because either Partners wasn't visited or the buggy branch wasn't hit; the fresh bundle from PR #51 (frontend redeploy 2026-04-26 15:07 UTC) made today's navigation the first that exercised the path with current data.

Two-line fix: add `teamUsers={teamUsers}` to the mount site, add `teamUsers` to the AccountsScreen function signature. The existing state hook in App (src/App.jsx:2052) already manages teamUsers correctly. Verified via headless puppeteer against https://xo.intellagentic.io: Partners click renders all 4 accounts (Intellagentic, Intellistack, Simon Berrill, Tom Dudbridge); zero pageerror events; ReferenceError gone.

Fix 2 — fetchExistingClient ReferenceError (commit 1ee83fb):
While diagnosing fix 1, headless verification surfaced a second console error: `Failed to fetch existing client: ReferenceError: data is not defined`. Traced to src/App.jsx:2257 in `fetchExistingClient` — `const cid = clientId || data?.client_id` references `data`, but `data` was declared with `const` inside the `if (response.ok)` block. Any non-2xx response from /clients (new user with no client row, auth blip, transient API error) skipped the if-body, leaving `data` undeclared, and the post-block reference threw.

Not currently exercised in production because Ken's /clients returns 200, but would fire for any first-time user without a client row, or any /clients failure. The outer try/catch swallowed it as `Failed to fetch existing client`, masking the real cause from logs.

One-line fix: hoist `let data = null` outside the if-block; change the inner declaration from `const data = ...` to `data = ...`. The post-block `data?.client_id` short-circuits cleanly when null. Verified via headless puppeteer with request interception forcing /clients to fail: ReferenceError gone, page still loads cleanly, the catch block now logs the real network error (TypeError: Failed to fetch) instead of a misleading ReferenceError.

Companion finding (no fix needed): a /buttons 500 also appeared in CloudWatch during verification (`invalid input syntax for type uuid: "1"`). Traced to my own puppeteer scripts using a synthetic JWT with `user_id: 1`. All real Ken-authored GET /buttons calls in the last hour returned 200. Not a production bug, no fix shipped. Optional backend hardening (UUID validation in xo-buttons handle_get) noted but skipped per scope.

Production state at deploy completion:
- Bundle v2.49: dist/assets/index-ChetDeZE.js (542.16 kB), deployed 2026-04-27T19:08:50Z.
- CloudFront invalidation IBC5LVIAZIOAWWCAMT0YP7SXUN.
- Intermediate bundle index-DXthaf9D.js (fix 1 only) deployed 2026-04-27T19:01:58Z, invalidation I1SPHC3CU6IA890XRNEQ08V8VZ — superseded by v2.49.
- No backend changes. No schema changes. No Lambda redeploys.

Files changed:
- src/App.jsx (+3 / -2 across two commits)

Verification artefacts (puppeteer scripts) cleaned up after each run; not retained in audits/.

---

**May 4, 2026 — Brand alignment with mfp:**

Ported the canonical Intellagentic XO logo from intellagentic-ltd/mfp and aligned xo-capture's chrome to the Ink & Steel palette MFP uses. Four PRs, all merged to main, four production deploys.

PR #56 — Logo port + footer redesign
- Copied frontend/src/components/IntellagenticLogo.jsx from mfp verbatim into src/components/IntellagenticLogo.jsx.
- Added Google Fonts <link> tags for Archivo, Source Serif 4, JetBrains Mono, Noto Serif JP to index.html (matches mfp's font stack — Hanko XO renders in Noto Serif JP).
- Replaced three <img src={logoLight}> usages in src/App.jsx with <IntellagenticLogo /> (two header instances at height={32}, one splash at height={22} with 0.5 opacity).
- Removed the legacy red <div className="logo-box">XO</div> from the header lockup at lines ~349, ~2724, ~1269.
- Updated the header title text from "Capture" to "XO Capture" at lines ~352, ~2727, ~2728.
- Restyled the sign-in footer to match the MFP pattern: IntellagenticLogo + em-dash + italic "The end of guesswork." (left), Terms · Privacy · Security · | · © 2026 INTELLAGENTIC LIMITED. (right), single row.
- IntellagenticLogo internal style change: removed `color: var(--text-0)` from the wordmark span so the .wm-text class (#E8E1CF) drives colour — fixes invisible wordmark on dark headers without adding a global CSS variable.

PR #57 — Post-login footer match
- Restyled the post-login app-shell footer at line ~2885 to match the sign-in footer treatment.

PR #58 — Full-width footer
- Two-line layout fix: footer left: 0 (full bleed) + sidebar bottom: <footer-height> so the sidebar stops above the footer instead of overlapping it. No structural refactor — sidebar/header pinning behaviour preserved.

PR #59 — Ink & Steel palette
- Header background: #1a1a2e → #122236 (--ink)
- Sidebar background: → #0C1A2A (--ink-deep)
- Footer background: already #0C1A2A from prior PRs
- Header bottom border: → #2B3F5C (--ink-rule)
- User-name colour in sidebar: aligned to bone tones
- No font changes, no layout changes, no structural changes outside chrome.

Files changed across the four PRs:
- src/App.jsx (header lockup, footer, sidebar inline styles, post-login footer, layout tweaks)
- src/index.css (.wm-lockup, .wm-text, .hanko classes; Ink & Steel chrome tokens)
- src/components/IntellagenticLogo.jsx (added; verbatim from mfp + one-line colour-driver fix)
- index.html (Google Fonts <link> tags)

Legacy assets logoLight, logoDark PNGs left in place but unused — easy revert path. Not deleted.

Production state after deploy: chrome aligned to MFP's Ink & Steel system, Hanko XO lockup live on every screen, footer consistent across pre/post-login, no behaviour regressions reported.

---

**END OF PROJECT STATUS**
