# Local demonstration verification

Executed September 12, 2026 against independently authored fictional data and the local mock provider. The application is implemented and its automated checks pass. **Manual accessibility acceptance remains open.** These results are not live-model evaluation, production assurance, or an accessibility conformance claim.

## Environment and source

- Node.js 26.8.2; npm 11.11.0; SQLite 3.53.4 (better-sqlite3 13.0.3); database schema version 1; provider mode `mock`.
- React 19.3.0, Vite 8.3.0, TypeScript 7.0.2, Express 5.2.1, Zod 4.6.2. Exact direct and transitive dependencies are captured by the lockfile.
- Playwright 1.63.0, Chromium 153.0.8010.12, axe-core 4.13.0; Linux 6.18.7-76061807-generic. Playwright used its Ubuntu 24.04 fallback browser build on this host.
- Browser viewports: 1280 × 900 and 320 × 900 CSS pixels; reduced-motion and print-media emulation. No screen reader was available for this run.
- Application source/configuration/test/lockfile fingerprint: `639651874fe8400e42f96eea36de54061ae79b9f4d963f9ea9df19e0ed9cfcc3`. This is the SHA-256 of a sorted manifest of SHA-256 hashes and relative paths for the 25 non-Markdown application files, excluding dependencies, data, build outputs, and browser reports. It identifies the tested source without treating generated reports as source files.

## Executed commands and results

Run commands from this demonstration's directory using the pinned Node version.

| Command/check | Actual result |
| --- | --- |
| `npm run check` | Passed TypeScript analysis, Biome formatting/correctness/hook checks, 45 unit/API/resource tests, and production build. No tests skipped. |
| `npm run test:browser` | 16 of 16 Chromium workflow and regression tests passed. |
| axe scans within browser tests | Zero violations across 16 interface checkpoints, including both discard-dialog states. The report retains 23 incomplete rule-check entries across other states (`aria-prohibited-attr` and `color-contrast`); these require manual review and are not passes. |
| Clean-copy `npm ci --no-fund` followed by `npm run build` | Previously passed without existing dependencies, build output, or database; the lockfile is unchanged by the recovery fixes. npm reported zero known dependency vulnerabilities at installation time; this is not a full security audit. |
| Clean-copy real HTTP workflow | New empty SQLite dataset → source submission → mock generation → reviewer approval → prepared artifact. Stored artifact references the approved revision. |
| SQLite checks on fresh and exercised databases | `integrity_check` returned `ok`; `foreign_key_check` returned no violations. |
| Source and deliverable inspection | Runtime browser requests stay on the local origin. Provider input excludes session, consent, and review metadata. User text renders as text. The 37-file deliverable inventory excludes database/build/report/local-agent paths; 74 local Markdown links resolve. A limited credential-pattern scan found no unexpected matches after reviewing the explicit fictional test sentinel. |

The main browser test also exercises the entire primary workflow with Tab, Enter, and Space; approval initially focuses Cancel, Escape returns focus, and confirmation is deliberate. It compares downloaded text against the stored artifact and verifies source/revision/approval identifiers and approved content. Draft and approved fictional notices remain under print-media emulation, and interactive print controls are hidden. The 320-pixel checks found no horizontal page scrolling. Desktop and narrow-screen review screenshots were visually inspected.

## Automated evidence by area

| Area | Executed coverage | Reproducible test source |
| --- | --- | --- |
| Source and candidate contracts | Named draft nullability, acknowledgments, strict fields/types, normalized duplicate items, control characters, exact Unicode code-point bounds, literal standard/brief templates, facts/narrative/tone mismatches, advisory blockers, safe sensitive/instruction findings, maximum Unicode wire budgets. | [contracts.test.ts](tests/contracts.test.ts) |
| API and workflow | Frozen source, immutable revisions, explicit generation, five semantic faults, malformed/sensitive outputs, human restoration, decisions, rejection/restart, regeneration, approval-bound artifacts, withdrawal, restart/reset, source access, role/Origin/Host/CSRF checks, session expiry/replacement, validator upgrades, provider metadata isolation. | [backend.test.ts](tests/backend.test.ts) |
| Delivery and concurrency | Same-key replay across eight mutation types with domain/event/receipt counts; changed-key payload conflict; approval-versus-edit in both dispatch orders yields one commit and one stale-version rejection; two active pollers fit the read allowance and excess reads back off without changing attempts. | [backend.test.ts](tests/backend.test.ts) |
| Client delivery recovery | Lost committed creation survives an intervening mutation and retries once; independent 503 keys, changed payloads, known-result retirement, session invalidation, and the 64-key pending bound without eviction. | [client-api.test.ts](tests/client-api.test.ts) |
| Storage and revision reads | Version 1 preserves data/settings; five incompatible metadata fixtures reject without changing bytes; 23 revisions and 48 audit events exercise independent pagination and content reads; nested ownership checks reject inaccessible revisions. | [backend-review.test.ts](tests/backend-review.test.ts) |
| Resource and recovery boundaries | Real SQLite write lock returns safe 503 and same-key retry commits once; timed-out late result cannot replace a newer candidate; event threshold permits accepted completion and withdrawal; request/cycle/revision caps and running revision reservations; audited download admission; direct unauthorized approval attempts. | [resource-recovery.test.ts](tests/resource-recovery.test.ts) |
| Browser recovery and navigation | Cancel/discard source navigation, same-cycle preservation, role-change cancellation without session replacement, dirty-only native unload warning, recovery from one network abort and one 503 without duplicate generation, and independent browsing of 22 revisions beyond the audit page. | [review-regressions.spec.ts](tests/browser/review-regressions.spec.ts) |
| Browser behavior | Full keyboard workflow, linked form errors, explicit timeout retry, blocked facts, human edit/restore, stale edits and approval, request changes/rejection/restart, inert HTML-like text, withdrawal/correction, typed reset, responsive layout, print labels, exact artifact download, no external browser HTTP requests. | [workflow.spec.ts](tests/browser/workflow.spec.ts) |

Fixtures include Avery Example's complete standard record, Jordan Sample's minimal brief record, the eight selectable mock scenarios, independently invented screening sentinels, deferred test-provider responses, and temporary isolated databases. No paid requests, API keys, real student records, or external model calls were used.

Browser-generated axe attachments, screenshots, traces, and the HTML report remain local under `test-results/` and `playwright-report/`. The test source recreates them. See the [44-case evaluation matrix](../../case-studies/graduation-announcement-system/EVALUATION.md) for the relationship between these executed checks and the broader acceptance specification.

## Remaining acceptance work

- A recorded screen-reader/browser combination must verify announcements, error navigation, comparison reading order, and dialogs. Automated accessible names and axe checks do not substitute for this.
- Complete human keyboard review of recovery paths, actual 200% text zoom and 400% browser zoom, and measured focus/control-boundary contrast remain unexecuted. The 320-pixel automated viewport and automated text-contrast checks are narrower evidence.
- Inspect actual browser print preview and pagination for clipping and retained notices. Print-media emulation does not establish printer pagination.
- The evaluation's deliberately vague-link fixture/manual link audit has not been executed; actual workflow links and controls were exercised by their descriptive accessible names.

No known automated failure remains in the executed suite. These open manual checks remain acceptance gates; all 44 specification rows must not be presented as fully passed. Source screening is deliberately narrow, simulated roles do not verify people, the host owner can alter SQLite, and no production deployment or live-provider adapter is included.
