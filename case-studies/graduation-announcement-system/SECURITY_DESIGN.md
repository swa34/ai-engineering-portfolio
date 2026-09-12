# Graduation Announcement Demonstration — Security Design

**Security requirements — controls are not implemented or tested.** This is the security design for the local fictional demonstration, not a repository vulnerability report or production assurance. Read the [technical specification](TECHNICAL_SPEC.md), [evaluation matrix](EVALUATION.md), and [disclaimer](DISCLAIMER.md).

## Trust boundaries and protected operations

The browser, entered source strings, provider output, and client-supplied identifiers are untrusted. The API enforces policy; SQLite stores authoritative snapshots, revisions, findings, and approvals. A provider can propose content only. It cannot read sessions, invoke application actions, amend facts, clear findings, or approve/export content. The specified local demonstration uses the mock with no external requests.

Primary properties to demonstrate are source and approval integrity, rejection of unauthorized mutations, separation of approved and unapproved artifacts, bounded resource use, and avoidance of accidental source/secret disclosure. A person controlling the local host or database can alter it; that threat is outside this demo's protection boundary and must be stated in its documentation.

## Local identity and permission model

Show “Local demo — roles are simulated, not verified identities” on role selection and every authenticated screen. The session endpoint offers three fixed fictional actors and sets an opaque, cryptographically random session cookie; roles are stored server-side. Do not accept role headers, actor IDs, local-storage flags, or a submitted `isAdmin` field as authority. Switching roles explicitly replaces the session; it is not privilege escalation protection against the person operating the demo.

Sessions expire after 30 minutes of inactivity and at most eight hours from creation. Store session metadata only server-side and invalidate it on restart/reset. Cookies use HttpOnly, SameSite=Strict, Path=/, and no Domain attribute. Use Secure when served over HTTPS; loopback HTTP development must be conspicuously limited to local use. No password or third-party identity provider is implied.

| Capability | Contributor | Reviewer | Administrator |
| --- | --- | --- | --- |
| Create requests, edit/submit Draft | Own requests | No | No |
| Read requests, sources, revisions, history | Own requests | All demo requests | No |
| Start generation | Own submitted/changes-requested cycles | All eligible cycles | No |
| Save human revisions, request changes, reject, approve | No | All eligible cycles | No |
| Regenerate from approval | No | All eligible approvals | No |
| Correct source/restart after rejection | Own requests | No | No |
| Withdraw snapshot consent | Own snapshots | No | No |
| Prepare/read approved artifact | Own request, effective consent | Effective consent | No |
| Select mock scenario or reset dataset | No | No | Yes |

Read access must follow parent ownership through every nested object ID, including history, attempts, and exports. Return 404 for unknown/inaccessible objects rather than disclosing their existence. Wrong-role actions on an otherwise accessible object return 403. Production identity and separation of duties would require a different design; switching to the reviewer in this local demo is intentionally available to its operator.

## HTTP and resource controls

Bind to loopback, allow only the configured local Host and exact UI Origin, and reject arbitrary Host values to reduce unintended network exposure and DNS rebinding. Do not enable wildcard CORS. Require an exact Origin on mutations and a session-bound CSRF token for authenticated mutations, including role replacement if already signed in. Initial session creation has no CSRF token; it still requires the configured Origin, JSON content type, Host validation, and a creation rate limit. Logout/reset invalidate CSRF tokens with the session.

This table is the shared resource budget for API transport and client polling. The technical specification and evaluation cases reference these values rather than define independent limits. One KiB is 1,024 bytes.

| Resource | Limit or cadence |
| --- | --- |
| JSON request body | 128 KiB, including revision content and concurrency fields. |
| Provider response | 96 KiB. |
| Reads per session | 240 per rolling 60 seconds, including attempt polling. |
| Mutations per session | 20 per rolling 60 seconds. |
| Session creation per loopback client | 10 per rolling 60 seconds. |
| Attempt polling | Once per second while visible; once per five seconds while hidden. Stop at completion, navigation, or logout. |

The byte caps accommodate compact JSON at the defined field maxima, including four-byte Unicode code points represented either directly in UTF-8 or as surrogate-pair escapes. Reference boundary fixtures use the longest allowed strings/arrays, both serialization forms, and the revision request wrapper. Unbounded whitespace, redundant number encodings, or other padding can still exceed a transport cap and must be rejected; field limits do not waive the wire-byte limit.

Enforce transport caps before parsing. Enforce strict schemas, parameterized SQL, server-generated IDs/filenames, and safe path handling. No upload or arbitrary file path endpoint exists. Use a 10-second generation deadline, one running attempt per cycle, two globally, and the per-cycle retry limits in the technical specification.

Enforce the shared request-rate limits and return 429 with a Retry-After delay rather than queueing indefinitely. At the global concurrency limit, two continuously active visible pollers consume at most 120 reads per minute, leaving 120 for session, queue, history, and other reads. Share a single poller per attempt within a page; additional tabs still share the session budget and must honor Retry-After. Test a supported two-attempt flow alongside ordinary navigation, plus excess traffic that correctly backs off. Limits are demo resource controls; they are not a distributed denial-of-service defense. Sessions restarting must not bypass persisted per-cycle generation limits. Limit the dataset to 50 requests, 200 cycles, and 1,000 revisions, with a 10,000-event admission threshold for ordinary audited actions. Count a reserved revision slot for each running generation attempt against the revision cap so accepted attempts can finish. Reject new growth with `409 DATASET_LIMIT` before exceeding a cap, including artifact download requests when their audit event cannot be admitted. Attempt completion/failure, one late-discard event per attempt, startup recovery, and consent withdrawal (including its affected attempt failures) may exceed the event threshold to settle existing work and revoke access safely; they must still commit their audit events. These bounded exceptions admit no new attempts or revisions beyond already reserved capacity. Keep reset available at all caps. Reset operates under an exclusive dataset lock and cancels workers before deleting data.

Serve content with a restrictive content-security policy: scripts and styles from self, connections to self, no objects, no framing, base URI self. Development tooling exceptions must stay in development configuration. Use `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` for authenticated API content/artifacts. Raw HTML rendering, Markdown evaluation, and automatic linkification of source/provider text are prohibited. The plain-text export uses a server-generated attachment filename; it is not a CSV or executable HTML file.

## Input screening and prompt injection

Screen all user-editable text and all provider strings before persistence. For the local demonstration, implement deterministic detectors for email-like strings, HTTP(S) URLs, US-style phone-number patterns, SSN-shaped digit groups, and credential markers such as `sk-proj-`, `BEGIN PRIVATE KEY`, and `password=` (case-insensitive). Use independently invented sentinel strings in tests, never valid credentials. A match blocks source/draft saves, human revisions, and review reasons with `422 SENSITIVE_CONTENT`; provider matches fail the attempt without retaining a candidate. Length limits and control-character screening apply separately.

Do not persist a changed provider payload as though it were the original revision. Store only detector category and field path in safe diagnostic summaries, never matched text. Preserve unsaved editor input only in the current page's memory so the user can correct it; return application-owned error text without logging the input. No sensitive raw data belongs in revisions, logs, receipts, audit events, or browser persistence.

Normalize text for detection only (NFC plus case folding) and check instruction-like phrases including `ignore previous instructions`, `ignore all instructions`, `system prompt`, and `approve automatically`. Block source saves containing these phrases with `422 INSTRUCTION_LIKE_CONTENT`. Schema-conforming candidate text containing them gets a blocking finding unless sensitive-content screening already rejects persistence. These fixtures demonstrate a narrow defense, not a complete injection detector. Ordinary text can be a false positive, and evasion is possible.

Source quotes, activities, and plans remain untrusted facts even when screening passes. The mock never executes their content. A future live adapter would delimit source data separately from instructions and expose no tools; it would still need independent evaluation. Canonical composition prevents additional provider narrative from passing, but cannot establish the truth or appropriateness of source-supplied statements. Human review remains necessary. The UI must say “Fictional information only” and must not promise that screening detects every real person or secret.

## Transactions, audit, and failure handling

Audit successful submissions, generation starts/completions/failures/discards, source corrections, revisions, review decisions, approvals, preparations, artifact download requests, and consent withdrawals. Store only server actor IDs, related object IDs, event types, timestamps, and safe reason codes. Screened reviewer decision reasons are stored as separate immutable decision data associated with the event; they are not copied into telemetry or provider payloads.

Every workflow mutation and its audit event commit together. Server authorization and expected-version checks precede writes. Unique approval/receipt constraints plus transaction checks prevent duplicate approval and stale updates. Late workers must verify the active attempt, deadline, cycle version, and effective consent before accepting a response. Never allow a failed audit write to produce an approval or unrecorded export.

Operational logs contain request ID, route template, status, safe error code, duration, and provider mode. Do not log request/response bodies, names, quoted text, cookies, tokens, database URLs, or full provider errors. Failed authentication and denied operations may emit content-free security log entries; avoid a database audit row for every hostile request. Return safe API errors and record no fabricated successful operation after a persistence failure.

Database constraints and application append-only interfaces protect ordinary workflows, not privileged storage tampering. Do not advertise the audit as immutable against a host owner. Hashes permit consistent version comparison, not proof of authenticity.

## Retention, withdrawal, and reset

The local database is disposable and ignored by Git. Keep records until an explicit administrator reset; no automatic TTL or backup is implemented. On setup and in the reset screen, disclose that stopping/restarting the app does not delete the dataset. At demo completion, recommend the operator reset fictional records. Do not claim this is a legally sufficient retention policy.

Consent withdrawal blocks future access to generated preview/export and further generation/approval for the referenced snapshot, while allowing authorized history/source inspection to explain the block. It preserves prior approvals and does not undo downloaded artifacts. Withdrawals are append-only; reconsenting requires a new Draft/submission/snapshot.

Reset requires the literal confirmation string in the API contract and a dedicated confirmation dialog in the UI. Under an exclusive lock, stop/cancel workers, remove the entire old dataset including database journals through the storage layer, clear sessions/receipts/rate-limit state, and initialize an empty schema. Existing worker callbacks must carry a dataset-instance ID and be rejected after reset. No old content, events, or deletion certificate remains in the replacement dataset; a content-free operational reset log may remain. Reset success means application deletion, not forensic secure erasure or deletion of downloaded files. If reset fails, return a safe failure and prevent partial operation until storage recovery succeeds.

## Verification and exclusions

Implement and execute the applicable [evaluation cases](EVALUATION.md), including direct API authorization, object access, cross-origin requests, malicious source/output rendering, stale writes, interrupted attempts, audit rollback, withdrawal, and reset races. Documentation review alone cannot pass these tests.

Real identity, deployment hardening, encrypted backups, regulatory analysis, external provider retention, intrusion detection, and tamper-evident external audit storage are outside the local demonstration scope. They require their own design and evidence before any production use. The current application/security evaluation status is **not yet tested**.
