# AI-Assisted Graduation Announcement Workflow

**Review status: Phase 2 draft.** This directory contains a sanitized case-study outline and conceptual diagram drafts. It is not documentation of an employer's implementation or an available application.

Read the [case study](CASE_STUDY.md), [four diagram drafts](ARCHITECTURE.md), and [confidentiality disclaimer](DISCLAIMER.md). The [repository todo list](../../tasks/todo.md) tracks the approval gates and remaining work.

## Proposed showcase

A fictional North Valley University communications workflow would collect synthetic graduate information, preserve submitted facts, generate a structured draft, validate its factual content, and route it to human review. The main screen would compare source facts, generated content, validation findings, human edits, and approval status. It would include a review queue and version history without invented dashboard statistics.

The mock provider would work without credentials or paid requests and be visibly labeled as simulated generation. A possible live-provider adapter would remain server-side and optional; it is not implemented or enabled.

## Owner review

- Review the framing and generalized workflow without disclosing internal processes.
- Replace personal-role and historical-outcome placeholders only with approved, non-confidential statements. Placeholders may remain during development.
- Review the validation limits, fictional framing, and proposed human-approval boundary.
- Approve Phase 3 before detailed architecture and API specification work begins.

## Planned documentation

Phase 3 will add dedicated security, accessibility, and evaluation documents and specify the data model, API contracts, validation rules, and testing strategy. Phase 4 will create the demonstration in `demos/graduation-announcement/`. Phase 5 will add working screenshots, portfolio presentation, and print-friendly views. These deliverables do not exist yet.

No files in this showcase were derived from a private application. See the [full disclaimer](DISCLAIMER.md) for scope and limitations.
