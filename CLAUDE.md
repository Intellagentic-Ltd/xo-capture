# XO Rapid Prototype

## CRITICAL RULES
1. **DO NOT modify anything in the Surgical Trays repo.** Read only. Copy components you need into this repo.
2. Surgical Trays reference files are in ./reference/ -- READ ONLY
3. This repo is a clean, independent project.

## What This Is
A universal entry point for domain partners. Three screens:
1. **Upload** -- partner drops in documents (CSV, Excel, PDF), enters company name + description
2. **Enrich** -- one button, system sends data to Claude + web research, shows progress
3. **Results** -- AI-generated analysis: problems identified, proposed schema, action plan

Domain-agnostic. Same tool works for waste management, healthcare, hospitality -- anyone.

## Tech Stack
- React 18 + Vite 5 (same as Surgical Trays)
- Single-page app, no router needed for prototype
- AWS: S3 static hosting + CloudFront CDN
- Backend: API Gateway + Lambda (Node.js 18 / Python 3.11)
- Storage: S3 bucket with folder-per-partner, DynamoDB for client metadata

## What to Copy from ./reference/
Copy these patterns/components. Adapt, don't just paste:
- vite.config.js -- build config
- package.json -- dependencies (React 18, Vite 5, Lucide React)
- Modal system from App.jsx -- overlay, header, body, close pattern
- Badge/status indicator CSS classes (badge-count, color variants)
- Card grid layout patterns (stat cards, expandable rows)
- Dark theme CSS token architecture from index.css (color variables, base styles, scrollbar)
- Loading state patterns

## What NOT to Copy
- Any NHS/surgical tray/procedure/sterilization domain logic
- NHS branding, logos, Swansea Bay references
- Theatre board, date picker, pick list, HSDU status code
- Procedure card library
- Any API endpoints pointing to Surgical Trays backend

## AWS Resources
- S3 frontend bucket: xo-prototype-frontend (us-west-1)
- S3 data bucket: xo-client-data (private, folder per partner)
- CloudFront distribution: TBD after creation
- API Gateway: xo-api
- Lambdas: xo-upload, xo-enrich, xo-results
- DynamoDB: xo-clients

## API Endpoints
POST /clients          -- create partner, make S3 folder, return client_id
POST /upload           -- return presigned S3 URLs for client folder
POST /enrich           -- trigger Claude enrichment pipeline
GET  /results/:id      -- return analysis results (poll for progress)

## S3 Folder Structure Per Partner
xo-client-data/{client_id}/uploads/
xo-client-data/{client_id}/extracted/
xo-client-data/{client_id}/results/

## Workflow Rules
1. Read reference files BEFORE writing any component -- understand the pattern first
2. Small diffs. One component at a time.
3. Test the build after each major addition: npm run build
4. Do not over-engineer. Three screens. Simple S3 write. Claude API call. Render results.
5. After every component or feature is completed, always ask "Update PROJECT-STATUS.md and push to github?" before moving to the next task.

## Commands
npm run dev          # local dev server
npm run build        # production build

## DEPLOY PATTERNS

Results Lambda -- root .py files are source of truth. Copy into package/ before zipping:

```bash
cd ~/xo-capture/backend/lambdas/results && \
cp lambda_function.py package/lambda_function.py && \
cp auth_helper.py package/auth_helper.py && \
cp crypto_helper.py package/crypto_helper.py && \
cd package && \
zip -r /tmp/xo-results.zip . -x "*.git*" > /dev/null && \
aws lambda update-function-code \
  --function-name xo-results \
  --zip-file fileb:///tmp/xo-results.zip \
  --region eu-west-2 \
  --profile intellagentic
```

All other Lambdas deploy from their root directory:

```bash
cd ~/xo-capture/backend/lambdas/{lambda-name} && \
zip -r /tmp/{lambda-name}.zip . -x "*.git*" > /dev/null && \
aws lambda update-function-code \
  --function-name {lambda-name} \
  --zip-file fileb:///tmp/{lambda-name}.zip \
  --region eu-west-2 \
  --profile intellagentic
```

Frontend deploy:

```bash
cd ~/xo-capture && npm run build && \
aws s3 sync dist/ s3://xo-prototype-frontend-mv --delete --profile intellagentic && \
aws cloudfront create-invalidation --distribution-id E7PWZX8BT02CE --paths "/*" --profile intellagentic
```

System skills deploy (sync git to S3):

```bash
aws s3 sync ~/xo-capture/skills/system/ s3://xo-client-data-mv/_system/skills/ --profile intellagentic --region eu-west-2
```

## Commit and PR conventions
- NEVER add "Co-Authored-By: Claude" trailers to commits.
- NEVER add "Generated with Claude Code" footers to commits or PR bodies.
- No tool attribution of any kind. Commits and PRs are authored by Ken.
