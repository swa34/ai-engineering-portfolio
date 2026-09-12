# Architecture and Workflow Drafts

**Phase 2 conceptual diagrams — not implemented or evaluated.** These independently proposed designs use only fictional demonstration data and do not document any private system. See the [disclaimer](DISCLAIMER.md) and [case-study draft](CASE_STUDY.md).

The proposed stack is React/Vite, TypeScript, Node.js/Express, runtime schema validation, and SQLite locally. The [Phase 3 technical specification](TECHNICAL_SPEC.md) now defines exact contracts, authorization mechanisms, storage constraints, and failure semantics. These diagrams remain conceptual; a PostgreSQL production path would need separate migration and integration verification.

## 1. End-to-end workflow

```mermaid
flowchart TD
    A[Create fictional announcement request] --> B[Enter structured graduate facts]
    B --> C{Required fields and consent valid?}
    C -->|No| D[Show actionable field errors]
    D --> B
    C -->|Yes| E[Preserve immutable source snapshot]
    E --> S[Submitted: ready for an explicit generation attempt]
    S -->|Start generation| F[Generate structured candidate with mock provider]
    F --> G{Provider response usable?}
    G -->|Timeout or malformed output| H[Record safe failure and return to Submitted]
    H --> S
    G -->|Yes| I[Validate factual fields and narrative against snapshot]
    I --> J[Show source, generated draft, findings, and edits]
    J --> K{Human reviewer decision}
    K -->|Edit| L[Save a new human revision and revalidate]
    L --> J
    K -->|Request revision| M[Record reasons and prepare a new candidate]
    M -->|Explicit regeneration| F
    K -->|Reject| N[Record rejection]
    K -->|Approve| O{Authorized, current, consented, and passing?}
    O -->|No| J
    O -->|Yes| P[Atomically record approval and audit event]
    P --> Q[Preview or export approved version with fictional label]
    P -->|Request regeneration using unchanged facts| R{Authorized and source consented?}
    R -->|No| Q
    R -->|Yes| T[Create separate Submitted cycle using existing snapshot, preserve approved artifact]
    T --> S
```

Audit events accompany submissions, generation attempts, revisions, decisions, and exports. The diagram highlights approval but does not imply that other actions lack auditing. Export is a local artifact handoff, not publication. A timeout or malformed response returns the current cycle to Submitted; an explicit retry starts generation with the same immutable snapshot. Regeneration after approval starts a separate Submitted cycle after authorization and consent checks, using the existing snapshot without contributor resubmission or re-freezing the facts. Correcting source facts instead starts at Draft and requires validation, submission, and a new immutable snapshot. Retry bounds and sensitive-error redaction will be specified in Phase 3.

## 2. Application architecture

```mermaid
flowchart LR
    subgraph Browser[Browser - fictional demonstration]
        UI[React interface: requests, review, comparison, history]
    end
    subgraph Server[Server - enforcement boundary]
        API[Express API: identity, authorization, limits, safe errors]
        FLOW[Workflow and version-bound approval]
        CHECK[Input, output schema, and factual validation]
        ADAPTER[Provider adapter: minimal synthetic payload]
        MOCK[Default mock provider and fault fixtures]
        EXPORT[Approved preview and export]
        SECRETS[Server-only configuration for optional provider]
    end
    subgraph Store[SQLite - local demonstration storage]
        SOURCE[Immutable submitted-facts snapshots]
        VERSIONS[Generated candidates and human revisions]
        EVENTS[Application append-only audit events]
    end
    LIVE[Optional live AI provider - future adapter]
    UI -->|REST requests| API
    API --> FLOW
    FLOW --> CHECK
    FLOW --> ADAPTER
    ADAPTER --> MOCK
    SECRETS -.-> ADAPTER
    ADAPTER -.->|Optional external request| LIVE
    FLOW --> SOURCE
    FLOW --> VERSIONS
    FLOW --> EVENTS
    FLOW --> EXPORT
    EXPORT -->|Fictional approved artifact| UI
```

Only the API would read or change persisted workflow data. The browser would receive neither provider credentials nor direct database access. Provider output is untrusted and must pass validation before it becomes eligible for approval. A provider cannot invoke review or publication actions.

The diagram shows intended responsibilities, not a set of microservices: these modules can run in one backend process. Local role simulation, if used, must be conspicuously labeled and cannot be represented as production authentication. Audit rows protected by application rules are not tamper-proof against privileged storage access.

## 3. Announcement status transitions

```mermaid
stateDiagram-v2
    [*] --> Draft
    [*] --> Submitted: New cycle for authorized regeneration using existing consented snapshot
    Draft --> Submitted: Validate and freeze consented facts
    Submitted --> Generating: Start generation attempt
    Generating --> Submitted: Record provider failure
    Generating --> NeedsReview: Save structured candidate and validation findings
    NeedsReview --> NeedsReview: Edit and revalidate
    NeedsReview --> ChangesRequested: Reviewer requests revision
    ChangesRequested --> Generating: Explicit generation of another candidate
    NeedsReview --> Rejected: Authorized reviewer rejects
    NeedsReview --> Approved: Authorized explicit approval of current passing version
    Approved --> ReadyForPublication: Prepare approved preview or export
    Rejected --> [*]
    ReadyForPublication --> [*]
    note right of NeedsReview
        Blocking validation findings prevent approval.
        Status alone does not establish a validation pass.
    end note
    note right of Approved
        Approval binds to a source snapshot and content revision.
        Regeneration starts a separate cycle at Submitted using the same snapshot.
        This approved version and its history remain preserved.
    end note
```

These are conceptual statuses for one review cycle. The two entry paths distinguish an initial Draft from a separate Submitted cycle created by authorized regeneration using an existing consented snapshot. Regeneration after approval does not re-freeze the facts or require contributor resubmission; it creates a separate cycle that must complete generation, validation, and human review. The existing approved version remains unchanged, which is why regeneration is a new entry rather than a transition out of Approved. Corrected source facts must follow the Draft submission path to create a new snapshot. Exact request-versus-version status storage belongs in Phase 3.

Rejected is terminal for that review cycle: the reviewer declines further work on it. Changes requested keeps the cycle open for revision and review. Pursuing content after rejection requires a new cycle; it does not reopen or alter the rejected record.

UI labels would read “Needs review,” “Changes requested,” and “Ready for publication.” The last means an approved artifact is prepared for handoff; it does not assert actual publication. `Published` is intentionally excluded from the initial demo because no publication or external distribution integration is proposed.

## 4. AI generation and validation sequence

```mermaid
sequenceDiagram
    actor Contributor
    actor Reviewer
    participant UI as Review interface
    participant API as Workflow API
    participant DB as Local store
    participant AI as Mock provider by default
    participant V as Application validator

    Contributor->>UI: Submit synthetic facts and preferences
    UI->>API: Submit request
    API->>V: Validate fields, lengths, options, and consent
    alt Invalid source input
        V-->>API: Field errors
        API-->>UI: Actionable validation errors, no generation
    else Valid source input
        V-->>API: Validated source facts
        API->>DB: Transaction: preserve snapshot and audit submission
        API->>DB: Record generation attempt and status
        API->>AI: Request structured draft from minimal untrusted source data
        alt Timeout or provider error
            API->>DB: Record redacted failure, return to Submitted
            API-->>UI: Generation failed, offer explicit retry
        else Provider responds
            AI-->>API: Untrusted structured-output candidate
            API->>V: Validate output schema
            alt Malformed output
                V-->>API: Reject response
                API->>DB: Record safe failure, return to Submitted
                API-->>UI: No approvable draft, offer retry
            else Schema-conforming output
                API->>V: Compare factual fields and narrative with snapshot
                V-->>API: Findings, including blocking failures if present
                API->>DB: Save generated version, findings, and audit event
                API-->>UI: Needs review: original draft, source facts, and findings
            end
        end
    end

    opt Reviewer chooses to edit an existing structured candidate
        Reviewer->>UI: Edit candidate
        UI->>API: Save human revision against expected version
        API->>API: Check reviewer authorization and current version
        API->>V: Validate complete edited content against source
        V-->>API: Updated findings
        API->>DB: Save separate revision, findings, and audit event
        API-->>UI: Display human revision and validation result
    end

    opt Reviewer chooses to approve the current generated or human-edited revision
        Reviewer->>UI: Explicitly approve selected revision
        UI->>API: Approval request with expected revision
        API->>API: Check role, current revision, source consent, and validation
        alt Unauthorized, stale, or failing
            API-->>UI: Deny approval with safe explanation
        else Eligible for approval
            API->>DB: Transaction: verify version and persist approval plus audit event
            DB-->>API: Approval persisted
            API-->>UI: Approved version available for preview or export
        end
    end

    opt Regeneration requested after approval
        Reviewer->>UI: Request a new candidate
        UI->>API: Request regeneration using existing source snapshot
        API->>API: Check authorization and source consent
        alt Unauthorized or consent absent
            API-->>UI: Deny regeneration, retain approved version
        else Eligible for regeneration
            API->>DB: Create separate Submitted cycle referencing same snapshot, audit action
            API-->>UI: Approved version preserved, explicit generation and review required
        end
    end
```

Phase 3 must specify authorization failures for every mutation, concurrency conflicts, bounded provider retries, and stale generation responses. This conceptual sequence highlights the approval boundary; an unsuccessful check must never fall through to a write. Editing is optional: an unchanged generated candidate can be approved if its current revision passes all checks. Every human content revision would invalidate any previous validation result for that candidate, and approval would apply only to the checked revision. The regeneration block reuses the submitted snapshot without contributor resubmission; source corrections require the separate Draft submission path described above.

## Decisions resolved in the Phase 3 draft

- Two controlled prose templates allow exact comparison of headline, body, and social content against submitted facts; arbitrary paraphrase cannot pass approval checks.
- Requests group independently stored review cycles; immutable snapshots, revisions, validation runs, approvals, and artifacts preserve history.
- Server-issued sessions for conspicuously simulated local roles demonstrate API authorization without claiming verified identity.
- Pattern-based input screening, transactional application audit events, snapshot consent withdrawal, and whole-dataset reset define the local safeguards and their limits.

The [technical specification](TECHNICAL_SPEC.md) is authoritative for the proposed implementation contracts. In particular, submission and generation are separate explicit API actions; the conceptual sequence above compresses that handoff. Consent withdrawal and reset are detailed in the specification rather than added to these Phase 2 diagrams. No API implementation or working security guarantee is established by these drafts.
