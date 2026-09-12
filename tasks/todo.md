# Graduation Announcement Showcase — Todo

## Scope and approvals

- Work only in this repository; do not access or use private repositories or employer materials.
- Use independently written content and fictional data. Leave unconfirmed facts as Scott review placeholders.
- 2026-09-12: Scott approved Phase 2 and requested the `swa34/` branch prefix.
- 2026-09-12: Scott authorized preparing a pull request for review. Commit and push are authorized for this documentation milestone; merging and Phase 3 remain pending review.
- 2026-09-12: Scott explicitly requested writing Phase 3 after creating its branch. This authorizes specification work; personal claims and public release remain separate review items.
- 2026-09-12: Scott explicitly authorized committing and pushing the Phase 3 documents and opening a PR for review. Implementation and merging remain pending approval.
- Active branch: `swa34/phase-3-technical-specification`.
- Implementation requires approval of the Phase 3 specification.
- Do not commit, push, merge, deploy, or publish without explicit authorization.

## Execution plan

- [x] Phase 1: Inspect the current repository without changing files.
- [x] Phase 1: Recommend structure, stack, tradeoffs, and confidentiality safeguards.
- [x] Phase 2: Create the requested branch and persistent todo list.
- [x] Phase 2: Draft the complete 19-section sanitized case study.
- [x] Phase 2: Draft four Mermaid diagrams and the confidentiality disclaimer.
- [x] Phase 2: Check completeness, links, claims, and diagram consistency.
- [x] Phase 2: Commit the documentation milestone, push the feature branch, and open a review PR.
- [x] Phase 2: Address PR review consistency comments and verify local agent files remain excluded.
- [x] Phase 2: Confirm all four Mermaid diagrams render in GitHub's Markdown preview.
- [ ] Before public portfolio release: Obtain Scott's license choice; do not select a license on his behalf.
- [x] Obtain Scott's authorization to proceed to Phase 3 (explicit drafting request on 2026-09-12).
- [x] Phase 3: Define architecture, synthetic records, API contracts, and structured output schema.
- [x] Phase 3: Specify factual validation, human review, state transitions, and security controls.
- [x] Phase 3: Specify evaluation cases and expected results.
- [ ] Phase 3: Obtain owner approval of the specification before implementation.
- [ ] Phase 4: Build the independent demonstration with a default mock provider.
- [ ] Phase 4: Implement validation, revision history, human approval, export, and failure recovery.
- [ ] Phase 4: Add automated tests using synthetic data and provider fault fixtures.
- [ ] Phase 5: Create the portfolio homepage, case-study presentation, and printable view.
- [ ] Phase 5: Capture actual demo screenshots and add approved résumé wording and metadata.
- [ ] Phase 6: Run linting, automated tests, accessibility checks, and a secret/content scan.
- [ ] Phase 6: Verify setup instructions from a clean start and record actual results and limitations.

## Phase 3 execution plan

- [x] Read the Phase 2 requirements and identify unresolved design decisions.
- [x] Define the local architecture, fictional fixtures, schemas, persistence invariants, API contracts, and failure recovery.
- [x] Specify security boundaries, accessibility behavior, and an executable evaluation matrix in dedicated documents.
- [x] Review cross-document consistency and verify local links, structured examples, required coverage, and patch hygiene.
- [x] Record verification evidence and leave implementation pending owner review.

## Phase 2 success criteria

- All 19 requested case-study sections exist, including exact placeholders for unconfirmed personal claims.
- Four maintainable Mermaid diagram drafts describe a generalized workflow, not an employer system.
- Documents clearly identify proposed behavior, untested controls, and fictional demonstration data.
- Approval is explicit; failed validation blocks approval; edits are revalidated; approved versions are preserved.
- No implementation, credentials, real records, fabricated results, or publication actions are introduced.

## Review record

Phase 1: The repository had no tracked files, application, or commits. The recommended stack is React with Vite, TypeScript, Node.js with Express, SQLite locally, and a default mock provider. Phase 3 will turn that recommendation into a concrete specification.

Phase 2 review completed on 2026-09-12; owner approval is pending. Deliverables include the repository overview, showcase overview, 19-section case study, four Mermaid diagram drafts, and confidentiality disclaimer. Verification below covers the tracked deliverables only.

Verification evidence:

- Automated document checks passed across six tracked Markdown files: all 19 section headings appear in the requested order, seven owner placeholders use the exact requested text, and all 14 local Markdown links resolve to tracked files inside this repository.
- The four expected Mermaid blocks are present. Markdown fences and sequence control blocks are balanced; no trailing whitespace was found. These are structural checks, not full Mermaid syntax validation.
- A limited credential-pattern check of authored Markdown found no matches. This is not a comprehensive secret scan; the final repository scan remains in Phase 6.
- An independent read-only reviewer found no blocking issue in confidentiality framing, personal claims, proposed-versus-implemented distinctions, or workflow consistency.
- Source comparison, narrative validation limits, revalidation of human edits, version-bound approval, and preservation of approved content are explicit in the drafts.

Remaining limitations and review gates:

- GitHub rendering is now verified for all four Mermaid diagrams following PR review. The sequence parse failure and stray state nodes caused by semicolons were corrected. This is diagram verification, not application validation.
- The application has not been implemented. Application, security, accessibility, and performance evaluation remain not yet tested.
- Phase 3 must resolve narrative composition constraints, request-versus-candidate state storage, demo identity, and practical retention/audit protections before implementation.
- Scott must approve the Phase 2 drafts before Phase 3 begins. Unconfirmed personal claims may remain placeholders while development proceeds.
- At completion of the original Phase 2 drafting turn, no commit, push, merge, deployment, or publication had been performed. Scott subsequently requested a PR for review.

## Pull request preparation

The remote repository was verified as public and empty, with no existing branches or open PRs. An empty initial commit on `main` is needed as the PR base; all showcase content will be introduced through `swa34/graduation-announcement-showcase`. Local agent configuration and memory are excluded from Git. Only independently authored documentation and repository housekeeping belong in this PR.

The PR is a review checkpoint for the Phase 2 documentation. It does not certify implementation, approve personal-role placeholders, or start Phase 3. Mermaid rendering was checked in GitHub's Markdown preview during the review follow-up.

Final staged-content verification passed for seven files (six Markdown documents and `.gitignore`): 14 links target files included in the PR, all 19 case-study sections and seven exact owner placeholders are present, and the four Mermaid blocks exist. A limited credential-pattern scan found no matches. Local agent memory is excluded, and the initial `main` commit contains no files. An independent final document review found no merge blockers for this documentation milestone. No application or full security evaluation was performed.

2026-09-12: Opened [PR #1](https://github.com/swa34/ai-engineering-portfolio/pull/1) from `swa34/graduation-announcement-showcase` into `main` after committing and pushing the documentation. The PR is ready for owner review. Merging, Phase 3 approval, and deployment remain pending; no merge or deployment was performed.

## PR review follow-up

2026-09-12: Addressed all six inline review findings: restricted verification counts to tracked documents; aligned regeneration around a separate Submitted cycle using the existing consented snapshot; made human editing optional before approval; made the return to Submitted visible after provider failure; distinguished terminal rejection from a revision request; and labeled the root overview as an unfinished public draft. Added a dependency ignore rule. License selection remains an owner decision.

Repeated document checks passed for six tracked Markdown files, 14 local links to tracked files, 19 numbered sections, seven exact placeholders, and four Mermaid blocks with balanced sequence controls. A second read-only review found no blocking consistency issues. Git inventory and every reachable commit contain no Codex configuration, agent configuration, or local memory files; `.Codex/`, `.codex/`, and `.agents/` are ignored and remain local only.

2026-09-12: GitHub's preview exposed semicolons being interpreted as Mermaid statement separators: the state diagram gained stray nodes and the sequence diagram failed to parse. Replaced those separators in diagram labels and verified all four rendered diagrams on GitHub at commit `7582f71`. The corrected state and sequence views were also inspected visually. This closes the outstanding rendering check; owner approval and licensing remain pending.

## Phase 3 review record — 2026-09-12

Scott explicitly requested writing the specification on `swa34/phase-3-technical-specification`. That instruction supersedes the historical pending-Phase-3 gate above; it does not approve personal claims, implementation, licensing, or public release.

Drafted four dedicated documents:

- [Technical specification](../case-studies/graduation-announcement-system/TECHNICAL_SPEC.md): local architecture, complete fictional source and candidate examples, strict schema rules, canonical prose composition, storage invariants, API contracts, concurrency, review decisions, immutable approved exports, and recovery.
- [Security design](../case-studies/graduation-announcement-system/SECURITY_DESIGN.md): simulated session roles, ownership checks, resource limits, input screening, transactional audit history, consent withdrawal, and disposable dataset reset.
- [Accessibility requirements](../case-studies/graduation-announcement-system/ACCESSIBILITY.md): keyboard and screen-reader flows, labels/errors, review order, status announcements, contrast/reflow, and print behavior.
- [Evaluation plan](../case-studies/graduation-announcement-system/EVALUATION.md): 44 explicit cases with expected outcomes and unexecuted actual/pass-fail fields.

The draft chooses controlled source-based prose over arbitrary paraphrase, separate cycle/revision/approval identities, conspicuously simulated local sessions, and local whole-dataset reset. These are proposed implementation decisions awaiting owner review. Both overviews link the deliverables, and the conceptual architecture points to the detailed contracts while retaining its existing diagrams.

Verification evidence:

- The documentation check explicitly inspected six tracked Markdown documents plus the four named new specification documents; ignored local agent files were excluded from the deliverable count.
- All 46 local Markdown links resolve to files in that ten-document deliverable set. Markdown fences are balanced and no trailing whitespace was found, including in the new files.
- Both JSON examples parse. The candidate's facts and all three prose outputs match the source and literal composition rules; example output bounds and byte limits pass.
- All 44 evaluation IDs are unique and sequential; every actual-result cell remains “Not run” and every pass/fail cell remains “Not tested.”
- The case study retains its 19 numbered sections and seven exact owner placeholders. All four Mermaid blocks are byte-for-byte unchanged from HEAD; no new diagram-rendering claim is made.
- An independent read-only specification review identified contract gaps in sensitive-output handling, session replacement, access-denial status, capacity/recovery, decision storage, restoring malformed content, and generation version binding. Those gaps were corrected in the draft.
- `git diff --check` passed. At completion of drafting, changes were documentation only and uncommitted on the Phase 3 branch; no push, deployment, or publication had been performed.

Limitations and next gate: no application has been built or tested, and document/example checks do not validate implemented security or accessibility. Implementation starts only after Scott approves this specification. Personal-role/outcome placeholders and license choice remain owner decisions.

## Phase 3 PR preparation

- [x] Recheck document examples, local links, expected evaluation coverage, and patch hygiene.
- [x] Verify the exact staged file inventory and commit the Phase 3 documentation.
- [x] Push `swa34/phase-3-technical-specification` and open its review PR against `main`.
- [x] Verify the remote branch and PR point to the committed specification.

The PR will describe the proposed architecture, API and storage contracts, constrained prose validation, review/approval behavior, security and accessibility requirements, and 44 unexecuted evaluation cases. Its validation record is limited to document checks and independent specification review. Local agent memory and configuration stay excluded from Git.

2026-09-12: Committed the specification as `efa7ca0`, pushed the Phase 3 branch, and opened [PR #2](https://github.com/swa34/ai-engineering-portfolio/pull/2) against `main`. GitHub readback confirmed the PR is open for review, references that specification commit, and includes exactly the eight intended documentation files. The staged inventory excludes local agent files, the limited credential-pattern scan found no matches, and the independent scope review found no publication blocker. Merging and implementation remain pending approval.
