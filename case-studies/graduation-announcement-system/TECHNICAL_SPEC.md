# Graduation Announcement Demonstration — Technical Specification

**Implementation contract.** The local mock demonstration is implemented; [verification evidence](../../demos/graduation-announcement/VERIFICATION.md) records what was exercised and the remaining acceptance checks. This document specifies an independently authored local demonstration using fictional data. Nothing here is an implementation result or a claim about an employer system. See the [disclaimer](DISCLAIMER.md).

The [case study](CASE_STUDY.md) establishes the intended workflow. This specification resolves its open decisions; the [conceptual diagrams](ARCHITECTURE.md) remain a higher-level view. Companion requirements are in [security design](SECURITY_DESIGN.md), [accessibility](ACCESSIBILITY.md), and [evaluation](EVALUATION.md).

## 1. Scope and design decisions

The demonstration will let a contributor submit fictional graduate facts, explicitly generate a mock candidate, and let a reviewer compare, optionally edit, request changes, reject, or approve it. Only a specifically approved revision can be prepared for local preview/export. Success means the evaluation requirements can be demonstrated reproducibly without credentials or external requests.

| Decision | Design choice and consequence |
| --- | --- |
| Runtime boundary | React/Vite and TypeScript UI, one Node.js/Express API process, runtime schemas, and local SQLite. API modules own all enforcement. |
| Drafting freedom | Two versioned prose templates with exact source-linked facts. Arbitrary paraphrase cannot pass approval checks. This limits editorial variety but makes narrative checks reproducible. |
| State ownership | A request groups review cycles. Each cycle has a status and current revision. Immutable revisions, approvals, and source snapshots have their own identities. There is no independent request status. |
| Identity | Explicitly labeled local role simulation using server-issued sessions for three fixed fictional actors. Role checks demonstrate application policy, not verified human identity. |
| History and retention | Append-only application history within a disposable local dataset. Whole-dataset reset clears the database and invalidates sessions. No production retention or tamper-proof audit claim. |
| Provider | Mock only in the local demonstration. A future adapter must use the same contract and receive separate review. No SDK, API key, or live request is needed for the local demonstration. |

No email, social publishing, external data import, file upload, real student accounts, institutional authentication, dashboards of invented metrics, or production deployment is in scope. PostgreSQL migration and live-model evaluation are follow-on work. Dependency versions and lockfiles will be selected and verified at implementation time, not asserted as tested here.

## 2. Implementation layout

Application code lives in `demos/graduation-announcement/`. The initial local implementation keeps the API, workflow, validation orchestration, and mock lifecycle together in one server module; shared schemas and persistence are separate modules.

```text
demos/graduation-announcement/
  web/                 React screens, accessible forms, comparison and history
  server/
    app.ts             API policy, transactional workflow, mock lifecycle
    storage.ts         SQLite schema initialization and database connections
    index.ts           Loopback startup, built UI serving and shutdown
  shared/contracts.ts  Runtime schemas, canonical composition and findings
  fixtures/records.ts  Independently authored fictional records
  tests/               Contract, workflow, resource and browser tests
  data/                Ignored disposable SQLite database
```

Use one origin for UI and `/api/v1`; a development proxy routes API requests. Bind the local app to loopback. The browser never writes SQLite or chooses authoritative roles, timestamps, findings, or statuses. Runtime parsing is required on the server even when shared UI schemas pass. No background queue service is needed: a persisted attempt plus an in-process mock worker is sufficient for this single-process demo.

## 3. Source input and fictional fixtures

All schemas are strict: reject unknown keys, wrong types, non-finite or fractional integers, and implicit string/boolean coercion. The [shared resource budget](SECURITY_DESIGN.md#http-and-resource-controls) defines JSON byte limits, which apply before parsing. String length means Unicode code points. Input strings are trimmed and Unicode NFC-normalized before source validation and freezing; control characters including line breaks are rejected in single-line source fields. Do not silently truncate. Array items must be unique after normalization. Empty optional strings are represented as `null`, not empty strings.

A Draft may contain incomplete fields. Submission requires this complete `SourceInput`:

| Field | Type and rule |
| --- | --- |
| `institution` | Literal `North Valley University`; fixed fictional label, not user-selectable. |
| `graduate_name` | String, 1–80 characters. |
| `degree` | One of `Bachelor of Arts`, `Bachelor of Science`, `Master of Arts`, `Master of Science`, `Doctor of Philosophy`. |
| `program` | String, 1–100 characters. |
| `graduation_year` | Integer, 2000–2100; synthetic demonstration range. |
| `honors` | Array, 0–3 strings of 1–60 characters. |
| `activities` | Array, 0–3 strings of 1–100 characters. |
| `quote` | `null` or a string of 1–240 characters; exact supplied wording only. |
| `future_plan` | `null` or a string of 1–160 characters; no inferred destination or employer. |
| `preferences` | Strict object: `tone` = `professional` or `warm`; `length` = `brief` or `standard`; `channel` = `web` or `social`. Both versions are generated; channel selects the initially shown preview tab. |
| `consent` | Boolean; must be `true` to submit. This is fictional demo permission, not legally verified consent. |
| `fictional_data_acknowledged` | Boolean; must be `true` for a client-submitted draft save or submission. Server-created draft defaults are defined below. |

`DraftSource` is a separate strict shape with the same required keys as `SourceInput`. Only `graduate_name`, `degree`, `program`, `graduation_year`, and `consent` may additionally be `null`. The entire `preferences` object may be `null`; when present, all three members are required and non-null with the submitted enum values. `institution` retains its fixed literal, honors/activities remain arrays (never null), quote/future_plan retain their existing nullable types, and `fictional_data_acknowledged` remains a non-null Boolean. Non-null values use the same bounds, normalization, and screening as `SourceInput`. Omitted keys are errors; a draft save replaces the complete `DraftSource` object.

The server creates an initial Draft with the fixed institution, empty honors/activities, null graduate_name/degree/program/graduation_year/preferences/quote/future_plan/consent, and fictional acknowledgment false. Server-created correction/restart drafts may contain copied source content with consent and fictional acknowledgment both false. This is an explicit stored-draft exception: acknowledgment is an action guard on client saves and submission, not a database invariant that all stored content must have acknowledgment true. The first owner save must set fictional acknowledgment true; consent may stay false or null until submission. The UI shows copied content with both acknowledgments unchecked.

Submission revalidates the stored draft against complete `SourceInput`, requires both acknowledgments true, and freezes the normalized source, preferences, actor, server timestamp, and source-schema version. Neither a provider nor a reviewer can change that snapshot.

Example fictional source, to become fixture `complete-standard`:

```json
{
  "institution": "North Valley University",
  "graduate_name": "Avery Example",
  "degree": "Bachelor of Science",
  "program": "Environmental Studies",
  "graduation_year": 2026,
  "honors": ["Fictional Faculty Recognition"],
  "activities": ["Campus Garden Club"],
  "quote": "I enjoyed learning with my classmates.",
  "future_plan": "Continue studying community gardens.",
  "preferences": {"tone": "professional", "length": "standard", "channel": "web"},
  "consent": true,
  "fictional_data_acknowledged": true
}
```

Fixture `minimal-brief` uses fictional Jordan Sample, Bachelor of Arts, History, 2026, empty honors/activities, null quote/plan, and warm/brief/social preferences with both acknowledgments true. Fault fixtures are derived copies: remove degree, remove consent, alter program, invent an honor or quote, inject a narrative sentence, and simulate provider failures. Never use imported records, copied private templates, or credentials in fixtures.

Source corrections create another Draft cycle and require submission of a new snapshot. A correction does not change any earlier cycle. Consent withdrawal is a separate irreversible action within the dataset: append a withdrawal record for a snapshot, block further generation/approval/preview/export for all cycles using it, and preserve history. Already downloaded files cannot be recalled. Corrected/new submissions require a fresh affirmative acknowledgment.

## 4. Provider response and narrative contract

The adapter receives only normalized facts and preferences, a random attempt ID, and `schema_version: "1"`. It receives no session, reviewer identity, consent metadata, audit history, filesystem path, or tool capability. The local mock performs no network access and visibly reports `provider_mode: "mock"` in server metadata, outside the provider-controlled payload.

Every successful response must satisfy this strict `CandidateOutput` shape. Required keys are exactly those below; nested objects are strict too.

| Field | Type and bounds |
| --- | --- |
| `schema_version` | Literal `1` (string). |
| `template_id` | Enum: `professional-v1` or `warm-v1`. Source-tone correspondence is checked during semantic validation, not schema parsing. |
| `headline` | String, 1–180 characters. |
| `announcement_body` | String, 1–3000 characters. |
| `short_social_version` | String, 1–500 characters. |
| `facts_used` | Object with all keys `graduate_name`, `degree`, `program`, `graduation_year`, `honors`, `activities`, `quote`, `future_plan`; same individual types/bounds as submitted facts. No institution/preferences/consent keys. |
| `potentially_unsupported_claims` | Array of 0–8 strings, each 1–200 characters. Advisory concerns; any nonempty value blocks approval. |
| `missing_information` | Array of 0–8 distinct names from the eight `facts_used` keys. Any nonempty value blocks approval until a new validated revision resolves it. |
| `editor_notes` | Array of 0–5 strings of 1–200 characters. Shown as untrusted advisory text, never exported or treated as instructions. |

Schema failure creates a failed generation attempt, with no candidate revision. Except for sensitive-pattern matches, which fail the attempt without retaining raw output, a schema-conforming but factually failing candidate is retained for comparison with blocking findings and enters NeedsReview. Parsing a model response is never evidence of factual consistency.

### Canonical composition version 1

The validator computes expected content independently from the frozen source and template definition. It must not derive expected facts from `facts_used` or accept provider concern lists as proof. Required facts in `facts_used` must equal the source exactly. For `standard`, all optional source facts must also be included exactly, including array order. For `brief`, optional arrays must be empty and optional strings null; the source facts remain visible in the comparison panel as intentionally omitted. No optional fact selection language or arbitrary templating engine is needed.

The following templates are literal rules. Braced names substitute source values verbatim; they are not executable interpolation received from a provider. Quotes are straight double-quote characters. Every paragraph is one line, joined with exactly two newline characters, without a trailing newline.

| Output | Canonical text |
| --- | --- |
| Professional headline | `{graduate_name} graduates from North Valley University` |
| Warm headline | `Congratulations, {graduate_name}!` |
| Required first body paragraph, both tones | `{graduate_name} graduates from North Valley University in {graduation_year} with a {degree} in {program}.` |
| Professional social | `{graduate_name} graduates in {graduation_year} with a {degree} in {program} from North Valley University.` |
| Warm social | `Congratulations to {graduate_name}, a {graduation_year} North Valley University graduate with a {degree} in {program}!` |

In `standard`, append the following paragraphs in order when the corresponding value is nonempty: `Honors: {honors joined with "; "}.`, `Activities: {activities joined with "; "}.`, `Graduate statement: "{quote}"`, and `Future plans (as submitted): {future_plan}`. In `brief`, append none. The body is deliberately identical across tones; only the headline and social wording change. No invented praise, pronouns, inferred achievements, hashtags, URLs, or call to action are added.

Candidate example for `complete-standard`:

```json
{
  "schema_version": "1",
  "template_id": "professional-v1",
  "headline": "Avery Example graduates from North Valley University",
  "announcement_body": "Avery Example graduates from North Valley University in 2026 with a Bachelor of Science in Environmental Studies.\n\nHonors: Fictional Faculty Recognition.\n\nActivities: Campus Garden Club.\n\nGraduate statement: \"I enjoyed learning with my classmates.\"\n\nFuture plans (as submitted): Continue studying community gardens.",
  "short_social_version": "Avery Example graduates in 2026 with a Bachelor of Science in Environmental Studies from North Valley University.",
  "facts_used": {
    "graduate_name": "Avery Example",
    "degree": "Bachelor of Science",
    "program": "Environmental Studies",
    "graduation_year": 2026,
    "honors": ["Fictional Faculty Recognition"],
    "activities": ["Campus Garden Club"],
    "quote": "I enjoyed learning with my classmates.",
    "future_plan": "Continue studying community gardens."
  },
  "potentially_unsupported_claims": [],
  "missing_information": [],
  "editor_notes": []
}
```

Reviewers can edit the three prose fields and advisory lists through a plain-text editor; fact fields, schema version, and template ID are read-only. The API accepts a complete replacement `CandidateOutput` for a human revision and validates every field regardless of UI restrictions. Schema-conforming edits that deviate from canonical composition are saved with blocking findings, making the failure visible. A “Restore source-based wording” action rebuilds a complete canonical CandidateOutput from the frozen source, including the otherwise read-only fact fields and template ID, and clears advisory lists. The reviewer previews this proposed replacement before saving; saving creates a new revision, reruns every check, and never silently overwrites history. Source/preference changes require a new Draft. This constraint must be explained beside the editor.

The same canonical equality checks apply to all three prose fields after human editing, with no automatic whitespace cleanup of returned/edited content. A factual match means correspondence to submitted strings under this grammar, not real-world truth, safe semantics within a submitted quote, or general hallucination detection.

## 5. Validation results

Server findings use `{code, severity, path, message}`. `severity` is `blocking` or `advisory`; paths identify fields and messages use safe application-owned wording. A validation run stores revision ID, snapshot ID, validator version, content digest, timestamp, status (`pass` or `fail`), and findings. `pass` requires zero blocking findings. Untrusted provider text appears only in explicitly labeled advisory panels.

Required blocking codes include `FACT_MISMATCH`, `NARRATIVE_MISMATCH`, `TONE_MISMATCH`, `PROVIDER_CONCERN`, `MISSING_INFORMATION`, `SENSITIVE_CONTENT`, and `INSTRUCTION_LIKE_CONTENT`. Optional omissions in brief mode produce an informational UI explanation, not a missing-information failure. Known template IDs that disagree with source tone produce a retained `TONE_MISMATCH` finding; unknown IDs fail schema parsing. Field-length violations also fail schema parsing and create request/attempt errors, not revision findings. There is no separate editorial length limit or `LENGTH_EXCEEDED` revision finding. Validation runs are immutable; a new revision always gets a new run.

Approval reruns the currently supported validator over the selected immutable revision. If the validator has changed, persist the new run; if it fails, retain NeedsReview and return `422 VALIDATION_FAILED`. Only a passing run from the current validator version can be bound to approval. Already approved artifacts retain their recorded validator version; they are not silently rewritten or recertified after an upgrade.

## 6. Persistence model and invariants

IDs are server-generated UUIDs; timestamps are UTC strings set by the server. JSON documents are stored with their schema version and a digest of deterministic JSON serialization (sorted object keys recursively, array order preserved, UTF-8). Hashes identify content; they are not tamper-proof signatures. Enable foreign keys on every database connection. Use migrations, foreign keys, unique indexes, and transactional application checks for cross-row invariants.

| Record | Required data and relationships |
| --- | --- |
| `requests` | ID, contributor actor ID, created timestamp. Groups cycles, has no status. |
| `cycles` | ID, request ID, predecessor cycle ID if any, creation reason, status, integer `version`, editable draft JSON only in Draft, snapshot ID after submission, current revision ID, active attempt ID. |
| `source_snapshots` | ID, request ID, normalized source JSON, schema version, digest, submitted-by actor, timestamp. Immutable. |
| `consent_withdrawals` | ID, snapshot ID (unique), actor, timestamp. Append-only override of original consent. |
| `generation_attempts` | ID, cycle ID, snapshot ID, reserved cycle version (the post-start committed version, not the client's pre-start expected version), state (`running`, `succeeded`, `failed`, `discarded`), safe failure code, start/deadline/completion times, fixture mode. |
| `revisions` | ID, cycle ID, snapshot ID, sequence number unique within cycle, parent revision ID if any, origin (`mock` or `human`), attempt ID for mock, author actor for human, complete output JSON, digest, timestamp. Immutable. |
| `validation_runs` | ID and fields from section 5; belongs to exactly one revision and snapshot. Immutable. |
| `approvals` | ID, unique cycle ID, revision ID, snapshot ID, passing validation-run ID, content digest, reviewer actor, timestamp. Immutable. |
| `review_decisions` | ID, cycle/revision IDs, reviewer actor, decision, screened reason (null for approval), approval ID if approved, timestamp. Immutable; referenced by the audit event. |
| `exports` | ID, approval ID, template version, exact UTF-8 plain-text artifact, digest, creator, timestamp. Unique approval/template-version pair. Immutable. |
| `audit_events` | ID, request/cycle IDs as applicable, event type, actor or system identity, related object IDs, safe code, timestamp. Append-only application interface; no content copies. |
| `mutation_receipts` | Session ID, idempotency key, method/path, input digest, safe outcome reference and HTTP status; unique session/key pair. Replay is available only while the issuing session is valid. Rows remain until dataset reset for historical uniqueness; retention does not extend session lifetime or transfer keys to a new session. |

Every cycle's pointers must refer to rows from its own request, cycle, and snapshot as appropriate. Approved/ReadyForPublication must have an approval for the current revision. Failed generation must not change the current revision pointer. Earlier revisions stay visible even when a later attempt fails; they cannot be approved while the cycle is Submitted/Generating. Submission, edits, decisions, attempt completion, preparation, withdrawal, and cycle creation each persist their domain changes and audit event together. If audit insertion fails, roll back the domain changes.

Use a short SQLite write transaction with an expected-version comparison on each mutation. Increment `cycles.version` once per committed cycle change, including start and completion of generation. A transaction must recheck role, state, consent, pointers, and expected version before writing. Do not hold a database transaction open while calling the mock. Return a safe retryable `503 STORAGE_BUSY` if a write cannot acquire its lock within 2 seconds; never report success before commit.

## 7. Cycle transitions and concurrency

The request list shows individual cycles with their statuses and links to prior approvals; it must not imply that the most recently created cycle is approved because another one is.

| From | Action | To | Conditions and effects |
| --- | --- | --- | --- |
| New request | Create | Draft | Contributor owns request; empty draft, no snapshot. |
| Draft | Save input | Draft | Owner, input screening, expected cycle version. |
| Draft | Submit | Submitted | Owner, complete facts, both acknowledgments true; freeze new snapshot. |
| Submitted | Generate | Generating | Owner or reviewer, effective consent, no running attempt; persist new attempt before starting worker. |
| Generating | Valid schema response | NeedsReview | Active unexpired attempt only, no sensitive-pattern match; create revision and validation run, even if factual checks fail. |
| Generating | Timeout, malformed response, sensitive-pattern match, or worker failure | Submitted | Safe failed attempt and event; explicit retry required. |
| NeedsReview | Save human revision | NeedsReview | Reviewer, expected current revision and cycle version; validate complete content. |
| NeedsReview | Request changes | ChangesRequested | Reviewer, nonempty screened reason of 1–500 characters; reason belongs to review history, not provider input. |
| ChangesRequested | Generate revised candidate | Generating | Owner or reviewer, explicit action and effective consent; same snapshot and output contract. |
| NeedsReview | Reject | Rejected | Reviewer, screened reason; terminal cycle. |
| NeedsReview | Approve | Approved | Reviewer, effective consent, current expected revision, passing current validation; approval and event atomic. Editing is optional. |
| Approved | Prepare artifact | ReadyForPublication | Owner or reviewer, effective consent, immutable approval; export artifact and event atomic. |
| ReadyForPublication | Prepare again | ReadyForPublication | Return same stored artifact for that approval/template version. |

The UI label “Ready for publication” means ready for local handoff only. No `Published` state or outbound distribution exists. Preview/export reads must use an approval ID, never a “latest content” query. Repeated downloads do not create revisions or approvals; record a download-request event before returning bytes without claiming the download completed.

New cycles, all under the same request:

- `regenerate`: reviewer only, predecessor Approved or ReadyForPublication, effective consent required. Create a separate Submitted cycle with the existing snapshot and empty revision pointer. Preserve the predecessor and require an explicit generation action.
- `correct_source`: request owner only, predecessor in any non-Generating status. Copy its source/draft into a server-created `DraftSource`, set consent and fictional acknowledgment to false under the stored-draft exception in section 3, and require a new submission/snapshot. The prior cycle remains unchanged; correction alone is not consent withdrawal or revocation of earlier approval.
- `restart_after_rejection`: request owner only, predecessor Rejected. Create a Draft as above. Rejected stays terminal.

Creation checks the predecessor's expected version and commits its audit event and receipt atomically; creation does not change the predecessor status or revision. Multiple intentionally created child cycles are allowed and displayed separately. Duplicate HTTP delivery with the same idempotency key must not create extra cycles.

Source withdrawal can occur in any state: a request owner creates the withdrawal record; generation attempts using that snapshot are failed and their cycles return to Submitted in the same transaction. Other cycle statuses and historical approvals are preserved with a visible “Consent withdrawn” overlay. The API denies new generation, approval, preparation, and artifact reads for that snapshot. A late response cannot revive an invalidated attempt. Reset is a separate whole-dataset operation, not a workflow state.

## 8. API contracts

All paths below are relative to `/api/v1`. Bodies are JSON unless serving an artifact. No endpoint accepts actor IDs, validation results, or authoritative status from the client. Reads return only records the session may access. List responses use opaque cursors, default 20 items, maximum 50, sorted by creation time then ID.

Every authenticated mutation requires `X-CSRF-Token` and `Idempotency-Key` (a UUID). Every mutation of an existing cycle, including child-cycle creation and preparation, includes integer `expected_cycle_version`; review mutations also include `expected_revision_id`. Source withdrawal instead uses immutable `snapshot_id`, with a unique database constraint. Reusing a key with the same session/method/path/payload returns the original outcome after current access and consent checks; reusing it with different input returns `409 IDEMPOTENCY_CONFLICT`. Replay is scoped to the issuing session while it remains valid. Expiration, restart, logout, replacement, or reset makes that session ineligible for replay; a retry with an invalidated session receives `401`. Retained receipts are not reused by a newly created session. A current withdrawn-consent or invalid-session denial takes precedence over replay. Concurrent duplicate keys must resolve to one receipt and one effect. A `503` before commit has no receipt and can be retried with the same key.

| Method and path | Actor and request | Success contract |
| --- | --- | --- |
| `POST /demo-session` | `{actor: "contributor" | "reviewer" | "administrator"}`; strict Origin/Host check and rate limit; replacing an existing session also requires its CSRF token and idempotency key. | `201`; invalidate previous session if present, set new session cookie, return simulated actor and CSRF token. |
| `GET /session` | Any session. | `200`; actor, role, demo label, CSRF token. |
| `DELETE /session` | Any session; empty body, standard mutation headers. | `204`; invalidate session and cookie. |
| `POST /requests` | Contributor; empty body. | `201`; request and initial Draft cycle at version 1. |
| `GET /requests` | Contributor sees own; reviewer sees all. | `200`; paginated request/cycle summaries and approval links. |
| `GET /requests/:requestId` | Owner or reviewer. | `200`; request, accessible cycles and snapshot withdrawal flags. |
| `GET /cycles/:cycleId` | Owner or reviewer. | `200`; cycle/version, snapshot, current revision and latest findings, approval reference, safe active-attempt status. |
| `GET /cycles/:cycleId/history` | Owner or reviewer. | `200`; paginated revisions, decisions, safe attempt summaries and events in chronological order. |
| `PUT /cycles/:cycleId/draft` | Owner; `{expected_cycle_version, source}` where `source` is complete `DraftSource`; require fictional acknowledgment true. | `200`; updated Draft/version. |
| `POST /cycles/:cycleId/submit` | Owner; `{expected_cycle_version}`; revalidate stored draft as `SourceInput` with both acknowledgments true. | `200`; Submitted cycle and snapshot reference. |
| `POST /cycles/:cycleId/generations` | Owner or reviewer; `{expected_cycle_version}`. | `202`; `{attempt_id, cycle_id, status: "Generating", cycle_version}` and Location for attempt polling. |
| `GET /attempts/:attemptId` | Owner or reviewer of its cycle. | `200`; state, safe failure code, cycle version and resulting revision ID if successful. |
| `POST /cycles/:cycleId/revisions` | Reviewer; `{expected_cycle_version, expected_revision_id, content}` with complete `CandidateOutput`. | `201`; new human revision, findings, updated cycle/version. |
| `POST /cycles/:cycleId/decisions` | Reviewer; `{expected_cycle_version, expected_revision_id, decision, reason}`. `decision` is `approve`, `reject`, or `request_changes`; reason is null for approve, required otherwise. | `200`; updated cycle, approval ID for approval; other decisions return no approval. |
| `POST /cycles/:cycleId/children` | Role determined by reason; `{expected_cycle_version, reason}` from the three reasons in section 7. | `201`; new cycle ID/state/version and predecessor ID. |
| `POST /snapshots/:snapshotId/withdraw-consent` | Owner; empty body. | `200`; withdrawal ID and affected cycle IDs. Repeated withdrawal returns existing record. |
| `POST /approvals/:approvalId/prepare` | Owner or reviewer; `{expected_cycle_version}` for the approval's cycle. | `201` for first preparation, `200` if already prepared; export ID and protected preview/download paths. |
| `GET /exports/:exportId` | Owner or reviewer; effective consent. | `200 application/json`; stored text plus approval, revision, source, digest and fictional label for safe UI preview. |
| `GET /exports/:exportId/download` | Same authorization/consent as preview. | `200 text/plain; charset=utf-8`, attachment with server-generated filename, exact stored bytes, `Cache-Control: no-store`. |
| `POST /demo/reset` | Administrator; `{confirmation: "RESET FICTIONAL DEMO"}` and standard headers. | `200`; new empty dataset, all sessions invalidated; client returns to role selection. |

Administrator can select/reset predefined mock scenarios and inspect safe configuration; it cannot read content or approve by virtue of the administrator role. Scenario selection uses `PUT /demo/scenario` with `{scenario: "normal" | "timeout" | "malformed" | "altered_program" | "invented_honor" | "unsupported_quote" | "narrative_invention" | "inappropriate_tone"}` and standard mutation headers, returning `200` with selected scenario. Capture the scenario when each attempt starts so changing it cannot alter an in-flight attempt. Other fault cases may be test-only adapter fixtures. Session replacement, logout, and reset deliberately invalidate the old session and its receipts. They are exceptions to successful receipt replay: a retry using the invalidated session receives `401` and cannot repeat a workflow mutation. The client returns to role selection after losing such a response; a subsequent initial session creation only selects a role and never replays a reset.

Errors use `{error: {code, message, fields?, request_id}}`, with application-owned messages and optional safe field paths/codes; never echo input, provider payloads, SQL, or stack traces. Status mapping: `400` invalid JSON or missing concurrency/idempotency fields; `401` missing/expired session; `403` forbidden role, origin/CSRF failure, or withdrawn consent; `404` unknown or inaccessible object; `409` wrong state, stale revision/version, active attempt, or conflicting key; `413` size limit; `415` unsupported content type; `422` source/output/approval validation failure; `429` rate/capacity limit; `503` temporary storage failure; `500` safe unexpected failure. `429` includes `Retry-After`. Error precedence is authentication, origin/CSRF, request shape, object access, receipt replay, then transactional state/consent/content checks; consent is also checked before any replay of protected content.

## 9. Generation lifecycle and recovery

One running attempt is allowed per cycle and at most two globally. A start transaction reserves capacity, checks consent/version, changes the cycle to Generating, and records the attempt/event/receipt. Return `202` after commit; the worker runs outside the transaction. Clients use the polling cadence and read allowance in the shared resource budget, share one poller per attempt within a page, and stop on completion, navigation, or logout. A read `429` pauses polling and other automatic reads for at least `Retry-After`; retry only after that delay without changing attempt state. Reloading a page recovers state from the API.

A mock attempt has a 10-second server deadline and the provider-response byte cap from the shared resource budget. Both direct UTF-8 and Unicode-escaped compact JSON at the specified field maxima must fit; extra whitespace/padding remains subject to the wire-byte cap. There are no automatic retries. Permit at most three generation starts per cycle in a rolling 60 seconds, counting failed attempts; after the window elapses an explicit retry is allowed. Global saturation returns `429 GENERATION_CAPACITY` without starting an attempt. Successful normal mock behavior is deterministic for the same snapshot/contract; requesting changes demonstrates the review loop, not model learning from reviewer notes.

Completion starts another short transaction. Accept output only if the attempt is still running, remains the cycle's active attempt, matches its snapshot and reserved generation version, has not reached the deadline, and effective consent remains true. Atomically save the revision, validation, completion event, and NeedsReview state. Timeout/malformed/sensitive-content/provider failure marks the attempt failed and returns the cycle to Submitted without creating a revision. Oversized responses count as malformed. Ignore late completions; add a content-free discard event without overwriting a recorded failure or any newer attempt/revision.

On startup, before serving requests, mark all persisted running attempts `failed` with `PROCESS_INTERRUPTED` and return their cycles to Submitted, preserving any older revision. The single-process design cannot resume in-flight mock work. If completion persistence fails, do not claim success; the deadline sweep retries the terminal transaction, and startup recovery handles a process exit. Sweep deadlines at least once per second. A lost HTTP response is recovered through idempotency replay within the issuing session, or authorized GET status. After session expiration/replacement, select a role and inspect existing cycles/history before starting new work; a new session does not inherit an earlier receipt.

## 10. Screens and artifacts

The request form shows fictional-only guidance, field errors, explicit consent, and separate Save and Submit actions. Submission does not start generation. The queue lists cycle status, validation status, provider mode, and withdrawal status as separate facts. Avoid totals that imply measured operational outcomes.

The review screen presents source snapshot, original generated revision, selected human revision, and findings in a logical reading order. Display revision IDs/sequence labels, the current version indicator, and the approval-bound revision. Offer explicit Generate, Save revision, Request changes, Reject, and Approve controls only where appropriate; the server repeats every guard. A stale response prompts refresh with an explanation and preserves unsaved editor text for comparison; it never automatically resubmits approval.

Preparing an approval creates a plain-text artifact from the stored approved content. Its first line is `FICTIONAL DEMONSTRATION — NOT FOR REAL DISTRIBUTION`. Include the fictional institution, provider mode, approval/revision/source IDs, headline, body, and short social version in fixed labeled sections. Exclude internal notes and findings. Server-side artifact template version 1 and exact bytes are stored. The JSON preview renders those bytes as text, and its print view retains the label and identifiers. There is no separate unapproved download path. Browser print of a draft cannot be prevented, so draft screens also retain “Unapproved fictional draft” in print styles.
