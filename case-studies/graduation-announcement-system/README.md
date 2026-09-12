# AI-Assisted Graduation Announcement Workflow

**Review status: Phase 3 specification draft, awaiting approval before implementation.** This directory contains a sanitized case-study outline, conceptual diagrams, and detailed demonstration requirements. It is not documentation of an employer's implementation or an available application.

Read the [case study](CASE_STUDY.md), [four diagram drafts](ARCHITECTURE.md), and [confidentiality disclaimer](DISCLAIMER.md). The [repository todo list](../../tasks/todo.md) tracks the approval gates and remaining work.

Phase 3 deliverables:

- [Technical specification](TECHNICAL_SPEC.md): architecture, fictional source records, structured output, constrained prose, storage, API, and review lifecycle.
- [Security design](SECURITY_DESIGN.md): simulated identities, server enforcement, input screening, consent withdrawal, audit limits, and dataset reset.
- [Accessibility requirements](ACCESSIBILITY.md): forms, keyboard review, announcements, responsive comparison, and print behavior.
- [Evaluation plan](EVALUATION.md): 44 required cases, expected results, and explicitly untested result fields.

## Proposed showcase

A fictional North Valley University communications workflow would collect synthetic graduate information, preserve submitted facts, generate a structured draft, validate its factual content, and route it to human review. The main screen would compare source facts, generated content, validation findings, human edits, and approval status. It would include a review queue and version history without invented dashboard statistics.

The mock provider would work without credentials or paid requests and be visibly labeled as simulated generation. A possible live-provider adapter would remain server-side and optional; it is not implemented or enabled.

## Owner review

- Review the framing and generalized workflow without disclosing internal processes.
- Replace personal-role and historical-outcome placeholders only with approved, non-confidential statements. Placeholders may remain during development.
- Review the validation limits, fictional framing, and proposed human-approval boundary.
- Review the Phase 3 specification and approve it before implementation. Key choices are controlled prose templates, simulated local roles, immutable version-bound approval, and disposable local storage.

## Planned documentation

Phase 3 documentation is drafted above. Phase 4 will create the demonstration in `demos/graduation-announcement/`. Phase 5 will add working screenshots, portfolio presentation, and print-friendly views. The application and presentation deliverables do not exist yet; all application evaluation results remain untested.

No files in this showcase were derived from a private application. See the [full disclaimer](DISCLAIMER.md) for scope and limitations.
