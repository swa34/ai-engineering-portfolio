# Graduation Announcement Studio

A local, fictional university communications workflow built with React, TypeScript, Express, and SQLite. A contributor submits source facts, a deterministic mock proposes source-based wording, and a simulated reviewer explicitly approves a specific immutable revision before preparing an artifact.

**Fictional information only.** North Valley University and all supplied records are invented. Roles are simulated, not verified identities. The mock makes no external requests and uses no credentials. This demonstrates application workflow and validation; it does not measure a live model's quality or establish real-world factual truth.

## Run locally

Use **Node.js 26.8.2** (the stable Current release selected on September 12, 2026) and npm. The repository pins it in `.nvmrc`. If you use nvm:

```bash
cd demos/graduation-announcement
nvm install
nvm use
npm ci
npm run dev
```

Open [the local studio](http://localhost:5173). Keep the default hostname `localhost`: the API checks the configured host and exact origin. The development server binds to loopback and proxies `/api/v1` to the local Express process on port 3001. Installing dependencies needs network access; the installed mock workflow runs offline.

To run the built interface on one origin:

```bash
npm run build
npm start
```

Open [the built local studio](http://localhost:3001). This remains a local demonstration, not a production deployment. Stop either server with Ctrl+C. Restarting preserves the fictional dataset and invalidates sessions; interrupted generations become retryable failures.

## Try the workflow

1. Select **Contributor**, create a request, and load a fictional example or enter invented facts. Independently check the fictional-data acknowledgment and consent. Save, then submit.
2. Explicitly generate a mock candidate. Submission alone never generates content.
3. Switch to **Reviewer** and open the cycle. Compare the frozen source, generated wording, validation findings, and revision history. Editing is optional. Revision browsing has a separate **Load more revisions** control; it does not depend on loading audit events. Unsaved edits require confirmation before navigation, and transient polling interruptions recover without starting another generation. Wording that departs from the source-based template cannot be approved; restoring wording creates another revision when saved.
4. Confirm approval of the current revision, then prepare the artifact. The preview and plain-text download contain the exact approved content and its identifiers.
5. Explore corrections, requests for changes, rejection/restart, and regeneration. Earlier revisions and approvals remain visible. A contributor can withdraw snapshot consent to block future generation, approval, and artifact access.
6. Select **Administrator** to choose a predefined mock fault or reset the dataset. Reset requires typing `RESET FICTIONAL DEMO` and ends every session. It removes the application's fictional dataset, not previously downloaded files or forensic disk traces.

Source-based composition deliberately allows two limited templates. `brief` omits optional facts; `standard` includes them exactly. This is a repeatable validation demonstration, not unrestricted AI copywriting.

## Checks

```bash
npm run check
npx playwright install chromium
npm run test:browser
```

The checks run strict TypeScript analysis, correctness and React hook lint rules, unit/API tests, and a production build. Browser tests launch their own server and temporary SQLite database on port 3001, which must be free. Test dependencies include Chromium; on an unsupported host Playwright may use a fallback build. Browser reports and traces are local ignored files under `playwright-report/` and `test-results/`.

See [verification evidence](VERIFICATION.md) for executed commands, results, and remaining manual accessibility checks. Automated browser checks do not establish screen-reader or accessibility conformance. The [44-case evaluation specification](../../case-studies/graduation-announcement-system/EVALUATION.md) defines the wider acceptance criteria.

## Data and implementation

The default dataset is `data/demo.sqlite`, excluded by local ignore rules. Do not commit databases, journals, browser traces, credentials, or local agent files. The administrator reset is the supported way to clear the dataset. The application does not upload data, publish announcements, import files, or send email. Startup accepts schema version 1 and preserves existing data and settings. Existing databases with missing, malformed, or unsupported version metadata are refused before modification; preserve the file and use a compatible app version or set `DATABASE_PATH` to a new file.

- `shared/` — strict runtime schemas, safe screening, source-based composition, validation.
- `fixtures/` — independently authored fictional records.
- `server/` — sessions, API authorization, transactional workflow, SQLite storage, mock generation and recovery.
- `web/` — accessible forms, source comparison, review, history, and local artifact preview.
- `tests/` — unit, API/storage, and browser verification.

The exact dependency versions are pinned in `package.json` and `package-lock.json`: React 19.3.0, Vite 8.3.0, TypeScript 7.0.2, Express 5.2.1, better-sqlite3 13.0.3, and Zod 4.6.2. These were selected from the npm stable `latest` tags on September 12, 2026. Biome checks formatting and lint rules without requiring an older TypeScript version. The tests use Node's runner without process isolation so the TypeScript loader registers and reports each test; API cases create isolated databases and sessions.

For the contracts and limitations, see the [technical specification](../../case-studies/graduation-announcement-system/TECHNICAL_SPEC.md), [security design](../../case-studies/graduation-announcement-system/SECURITY_DESIGN.md), [accessibility requirements](../../case-studies/graduation-announcement-system/ACCESSIBILITY.md), and [disclaimer](../../case-studies/graduation-announcement-system/DISCLAIMER.md).
