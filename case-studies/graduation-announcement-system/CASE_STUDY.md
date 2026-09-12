# AI-Assisted Graduation Announcement Workflow

**Phase 2 case-study draft — awaiting Scott's review.** All technical behavior below is proposed for an independent demonstration unless explicitly identified otherwise. The demonstration has not been built or evaluated. This document does not describe an employer's actual architecture, workflow, or results.

> This case study and demonstration are independently created, generalized representations of an AI-assisted communications workflow. They contain no employer source code, private repository content, production data, internal prompts, confidential configuration, or personally identifiable student information. All people, institutions, records, and announcements shown in the demonstration are fictional.

## 1. Executive summary

This showcase proposes an AI-assisted communications workflow in which software collects structured graduate information, preserves submitted facts, requests a draft, validates the result, and requires a human decision before content is eligible for export. The engineering focus is the boundary between assistance and authority: a provider may propose language, but it cannot approve content or change the source record.

The fictional North Valley University demonstration would make these boundaries visible through a review queue, source-to-draft comparison, validation findings, and revision history. It is intended to show architectural judgment and backend engineering as well as interface design.

Approved connection to Scott's professional experience:

[SCOTT: Add an approved, non-confidential description here.]

## 2. Business problem

In a generalized graduation-announcement process, information collected from multiple contributors must become accurate, consistent, appropriately written communications. Missing fields, unsupported additions, and unclear approval responsibility are design risks worth addressing. Their frequency and impact in any real organization are not established here.

AI assistance could help produce an initial draft, while validation and human review would remain necessary to preserve facts and editorial accountability. No time savings or business benefit has yet been measured.

Approved historical problem context, if available:

[SCOTT: Add an approved, non-confidential description here.]

## 3. Users and stakeholders

The proposed demo uses fictional roles: a contributor submits synthetic graduate facts; a communications reviewer edits and decides on a draft; an administrator manages demonstration configuration. A graduate is the subject of a synthetic record, not a real account or person.

These roles are illustrative and do not assert an employer's organizational structure. Real stakeholder involvement, if suitable for disclosure:

[SCOTT: Add an approved, non-confidential description here.]

## 4. My role

Scott's responsibilities have not been confirmed. The following are candidate topics for owner review, not assertions that Scott performed the work:

- Designed or contributed to application architecture.
- Integrated AI into an existing business workflow.
- Developed validation and automation patterns.
- Worked with stakeholders to clarify requirements.
- Designed human-review safeguards.
- Considered privacy, security, maintainability, and accessibility.
- Helped modernize a previously manual process.

Approved account of Scott's individual contributions, collaborators, and scope:

[SCOTT: Add an approved, non-confidential description here.]

The independent portfolio implementation will be AI-assisted. Its eventual description should distinguish Scott's confirmed design and review contributions from implementation assistance, without implying ownership of an employer's work.

## 5. Project constraints

All content and code must be independently authored from the supplied generalized brief. Only fictional institutions, people, and records may appear. Private code, internal prompts, templates, configuration, schemas, production screenshots, and unpublished metrics are excluded.

The default demo must run without an API key or paid provider request. Any optional provider integration must keep secrets server-side. Approval must be explicit and content must never be distributed automatically. The implementation should remain understandable to a hiring manager running it locally.

Original project constraints, if approved for disclosure:

[SCOTT: Add an approved, non-confidential description here.]

## 6. Generalized workflow

1. Create a request and enter structured synthetic graduate information and communication preferences.
2. Validate required fields, allowed values, input limits, and affirmative consent.
3. Preserve an immutable submitted-facts snapshot; corrections create a new snapshot instead of changing history.
4. Ask the configured provider for schema-conforming draft content.
5. Validate the response independently against the submitted facts, then display findings.
6. Let a human compare source facts, original generated content, and their proposed edits.
7. Record revisions and revalidate edited content; a reviewer can request changes, reject, or explicitly approve a passing version.
8. Allow approved content to be previewed or exported with its fictional-demo label.

Audit events would record each transition. Approval would bind to a specific content version and source snapshot, so a subsequent edit or generation cannot inherit it. This is a proposed generalized workflow, not a reconstruction of a private process.

## 7. Technical architecture

The recommended stack is a React/Vite interface, a Node.js/Express API, TypeScript contracts, runtime schema validation, and SQLite for local persistence. A PostgreSQL path would be documented and would require its own migration and integration tests. A default mock provider would support repeatable demos and failure scenarios without network calls.

The API would own authorization, state transitions, validation, and approval. Browser controls would reflect those decisions rather than act as the enforcement boundary. Persistence would separate source snapshots, generated versions, human revisions, and audit events. A proposed optional live-provider adapter would accept only the necessary synthetic fields.

See the [architecture and workflow drafts](ARCHITECTURE.md). Detailed contracts and implementation decisions are reserved for Phase 3.

## 8. AI-assisted drafting approach

The provider would receive narrowly scoped drafting instructions and clearly delimited source data. Free-form quotes, activities, and plans would be treated as untrusted content, not instructions. Tone, length, and channel would use application-controlled options. Missing facts would be omitted or reported; consent could never be inferred.

The mock provider would simulate the same output contract as a possible live adapter, including malformed responses, altered facts, and timeouts for tests. The interface would identify the active provider as mock or live. Mock behavior would not establish the quality or safety of a real model.

## 9. Structured output and validation

The proposed response includes `headline`, `announcement_body`, `short_social_version`, `facts_used`, `potentially_unsupported_claims`, `missing_information`, and `editor_notes`. Exact field types, bounds, and rejection behavior belong in the Phase 3 schema.

Runtime validation would reject malformed or unexpected structures. Application code would compare claimed names, degrees, programs, honors, activities, quotes, and future plans to the immutable source snapshot. The model's own list of facts or concerns would be advisory and could not clear a validation failure.

Narrative text must also be checked: accurate `facts_used` can accompany an invented sentence in the body, headline, or social version. Phase 3 must choose a bounded drafting approach, such as source-linked factual content rendered through controlled composition, and specify what prose checks can and cannot detect. Arbitrary paraphrase cannot be guaranteed factual by schema validation or string matching alone.

Checks would run again after human edits. A passing result would mean that documented checks passed against submitted data; it would not prove that the submitted data is true in the real world or guarantee detection of every implication. Unsupported claims, failed checks, and unresolved blocking findings would prevent approval.

## 10. Human-review process

The review view would show submitted facts, generated content, validation findings, human edits, and approval state together. The AI version and each human revision would remain distinguishable. Editing would be optional: a reviewer could approve an unchanged generated version if it passes all checks. Reviewers would explicitly approve, reject, or request revision, with actions recorded in history. Rejection would end that review cycle; requesting changes would keep it open for revision and review.

Approval would require an authorized reviewer, affirmative source consent, passing checks, and the current content version. The server would reject stale approval attempts. Authorized regeneration after approval would create a separate Submitted review cycle using the existing consented source snapshot, without contributor resubmission or re-freezing the facts. It would preserve the approved artifact and its audit history while requiring explicit generation, validation, and human review for the new candidate. Corrected source facts would instead start at Draft and require validation, submission, and a new immutable snapshot. Approval and the corresponding audit event should be persisted atomically.

## 11. Security and privacy

The planned demo would minimize collected fields, use synthetic fixtures, enforce consent and role checks on the server, limit input sizes and request rates, and avoid logging source text or secrets. It would render text safely and avoid interpreting graduate content as HTML or instructions. No publication integration is proposed.

The security specification would cover prompt injection, malicious free text, unsupported claims, credential handling, and accidental sensitive-data entry. Sensitive-content screening would be a limited safeguard, not a guarantee that all personal information can be detected. A demo label would instruct users to enter fictional information only.

Application-level append-only audit events would not by themselves prevent a database administrator from altering records. Production identity, audit protection, deletion/retention policies, backups, and provider data handling would require separate design and review. No regulatory compliance or production readiness is asserted.

## 12. Accessibility

The intended interface uses semantic HTML, explicit labels, keyboard-operable controls, visible focus indicators, clear field errors, and text labels for status. Asynchronous generation would announce progress and failures without unexpectedly moving focus. Comparison views would have a meaningful reading order and remain usable when stacked on small screens.

Contrast, reduced-motion preferences, and a print-friendly approved preview would be considered from the outset. Automated checks would be supplemented with manual keyboard, zoom, and screen-reader review. Accessibility has not yet been tested; no conformance claim is made.

## 13. Testing and evaluation

Evaluation would use synthetic fixtures and cover factual consistency, unsupported-claim detection, field validation, tone and length, accessibility, injection resistance, approval enforcement, error recovery, and audit history.

The planned matrix will contain input condition, expected behavior, actual behavior, and pass/fail. Its required cases are: a complete record; missing degree; missing consent; injection in a quote; altered major; invented honor; unsupported quotation; inappropriate tone; provider timeout; malformed output; requested revision; regeneration after approval; unauthorized approval; sensitive text; and inaccessible link text. Additional checks should address narrative-only inventions, edited content, and stale approvals.

**Application evaluation status: not yet tested.** Actual behavior and results will be populated only after execution. Documentation review is not evidence that the application works.

## 14. Outcomes

No production outcomes, adoption numbers, accuracy scores, time savings, or business impact are available for this showcase. No application performance measurements have been collected.

Approved historical outcomes, including evidence and scope if available:

[SCOTT: Add an approved, non-confidential description here.]

Once the demo is built, this section may report reproducible test results with dates, tested versions, provider mode, and limitations. Mock-provider results must remain distinct from live-provider evaluation.

## 15. Challenges and tradeoffs

The central design tradeoff is editorial freedom versus verifiable factual content. More constrained composition makes checks clearer but limits natural variation. Human edits improve usefulness while requiring fresh validation and version-bound approval.

SQLite reduces local setup but is not a substitute for validating a PostgreSQL deployment. Mock generation improves reproducibility but cannot establish real-model behavior. Rich audit history improves traceability while creating retention and sensitive-data handling responsibilities. These are anticipated demo tradeoffs, not claims about completed project decisions.

## 16. Lessons learned

No implementation lessons have been established yet. The demo will examine whether explicit source boundaries, independently enforced review, and visible validation limitations make the workflow easier to understand and assess.

Scott's approved lessons from professional experience:

[SCOTT: Add an approved, non-confidential description here.]

Observed demo lessons will be added after implementation and evaluation, with evidence rather than retrospective assumptions.

## 17. Future improvements

Potential follow-on work includes a separately evaluated live-provider adapter, institutional identity integration, a tested PostgreSQL migration, stronger audit protection, and broader accessibility evaluation. These are candidates, not commitments or implemented capabilities.

Any distribution integration would need separate authorization, publication controls, and review. The showcase itself would stop at approved preview/export.

## 18. Independent demonstration

The planned demo would use fictional North Valley University and synthetic graduate records created specifically for this repository. It would support a request form, review queue, fact comparison, visible findings, revision history, explicit decisions, and approved-content export. Its planned location is `demos/graduation-announcement/` within this repository.

The interface would use restrained typography, clear structure, mobile-responsive layouts, and accessible controls. It would avoid chatbot framing, decorative AI imagery, invented statistics, and unnecessary animation. Screenshots and run instructions will be added only after the software works.

**Current availability: not implemented.**

## 19. Confidentiality disclaimer

This case study and demonstration are independently created, generalized representations of an AI-assisted communications workflow. They contain no employer source code, private repository content, production data, internal prompts, confidential configuration, or personally identifiable student information. All people, institutions, records, and announcements shown in the demonstration are fictional.

The demonstration is not the production system and does not imply institutional affiliation, endorsement, regulatory compliance, or verified business outcomes. See the [full disclaimer](DISCLAIMER.md).
