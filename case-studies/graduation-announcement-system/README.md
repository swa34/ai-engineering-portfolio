# AI-Assisted Graduation Announcement Workflow

A system design for an AI-assisted communications workflow using a fictional university and synthetic graduate records. It examines how to preserve submitted facts, validate generated content, and require a deliberate human decision before an announcement can be exported.

**Status:** Design documentation is available. The demonstration is not yet implemented; application, security, and accessibility tests have not been run.

## Engineering focus

- Structured source records and constrained prose composition to make factual checks explicit.
- Server-enforced review decisions, immutable revisions, and approval bound to a specific version.
- Source-to-draft comparison, visible validation findings, and accessible review controls.
- A local mock provider specified for repeatable scenarios without credentials or paid requests.

The proposed stack uses React/Vite, TypeScript, Node.js/Express, and SQLite. Mock generation would demonstrate the workflow; it would not establish live-model performance.

## Documentation

- [Case study](CASE_STUDY.md): problem, workflow, engineering choices, and limitations.
- [Architecture and workflow diagrams](ARCHITECTURE.md): components, state transitions, and review sequence.
- [Technical specification](TECHNICAL_SPEC.md): fictional records, schemas, persistence, API contracts, and failure recovery.
- [Security design](SECURITY_DESIGN.md): trust boundaries, simulated identities, input screening, and audit limits.
- [Accessibility requirements](ACCESSIBILITY.md): forms, keyboard interaction, status announcements, and print behavior.
- [Evaluation criteria and test matrix](EVALUATION.md): 44 scenarios with expected outcomes; results are untested.
- [Disclaimer](DISCLAIMER.md): fictional data and independent-demonstration scope.
