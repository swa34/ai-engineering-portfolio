# Graduation Announcement Demonstration — Accessibility Requirements

**Phase 3 requirements draft — not implemented or evaluated.** These are testable design requirements for the fictional local demonstration, not an accessibility conformance claim. See the [technical specification](TECHNICAL_SPEC.md) and [evaluation matrix](EVALUATION.md).

## Structure and navigation

Use semantic landmarks, one descriptive page heading, a skip link, native controls, and a logical heading sequence. Every navigation/action link must name its destination or action; use “Review Avery Example's draft” instead of repeated “Click here” links. Status, provider mode, consent withdrawal, and validation must have visible text and accessible names rather than color or icons alone.

Support the full create → submit → generate → review → approve → prepare/download flow using only the keyboard. Keep visible focus indicators, logical tab order, and no keyboard traps. Modals must have a programmatic title, contain focus while open, support Cancel/Escape where safe, and return focus to the invoking control when dismissed. Approval requires a deliberate confirmation naming the revision; its dialog must not default focus to confirmation. Reset names the data being removed and requires typing its confirmation phrase.

## Forms and errors

Provide visible labels for every input, required-field indicators explained in text, and instructions for synthetic-only data and consent. Group tone, length, and channel controls using native grouping semantics. Consent and fictional-data acknowledgment start unchecked and require independent actions. Never infer them from continuing the workflow.

After failed submission, focus an error summary with links to invalid fields. Keep entered values, associate field errors with their controls, mark invalid controls programmatically, and explain how to fix the error without repeating potentially sensitive text. Inline length counters must not announce every keystroke; announce approaching/exceeded limits at meaningful thresholds. Do not rely on placeholder text as the only label.

Explain editing constraints beside the editor: wording must match the selected source-based template to pass, and corrections to facts require a new submitted snapshot. Restore wording is an explicit action that preserves the previous revision. Disabled approval must have a visible reason and a reachable explanation, not just a disabled control with an inaccessible tooltip.

## Generation and review

Announce generation start, completion, and recoverable failure through a polite live region. Do not move focus on polling, completion, or queue refresh, and do not repeatedly announce unchanged status. Keep a stable attempt/status area and provide an explicit retry button on failure. Use assertive announcements only for errors requiring immediate action, not routine status updates.

Source, original generated content, human revision, validation findings, and history appear in that reading order. On narrow screens they stack in the same order; the DOM order must not depend on visual column placement. Use semantic tables only for genuinely tabular facts, with captions and column headings. Identify inserted/removed text with readable labels or annotations; color and strikethrough alone are insufficient. Offer complete readable source and revision text alongside differences.

Changing the selected revision updates its visible heading and status without losing keyboard focus. Clearly distinguish historical revisions from the current revision and identify the exact approved revision. Stale-edit/approval errors explain that another action changed the cycle, preserve unsaved text, and offer refresh without automatically retrying a decision. Consent withdrawal remains visible in history and disables future protected actions with an explanation.

## Visual, responsive, and print behavior

Use a project target of at least 4.5:1 contrast for normal text and 3:1 for large text, meaningful control boundaries, and focus indicators. These are implementation acceptance targets; no standards certification is asserted. Honor reduced-motion preferences and avoid animations needed to understand state. Controls should have a minimum 24 by 24 CSS-pixel target or equivalent spacing, with larger primary action targets where practical.

Verify at 200% text zoom and at 400% browser zoom on a 1280-pixel-wide viewport (approximately 320 CSS pixels of layout width). Ordinary forms and stacked review panels must reflow without content loss or two-dimensional scrolling. Long synthetic strings must wrap. Any necessary wide comparison table needs a clearly labeled scroll region and a stacked reading alternative.

Approved preview and print views retain the fictional-data notice, approval/revision identifiers, logical headings, and readable body text. Draft print views retain “Unapproved fictional draft.” Hide interactive controls in print while preserving meaning. Plain-text downloads include descriptive section labels and do not rely on visual layout. Check print preview for clipped text and missing notices; downloadable PDF generation is outside the initial demo.

## Verification record requirements

Automated browser accessibility checks cover role selection, invalid form, submitted cycle, generation failure, review with blocking findings, human revision, stale decision, approval dialog, ready artifact, withdrawal, and reset dialog. No high-impact automated findings may remain untriaged; automated passes do not establish full accessibility.

Manual acceptance requires keyboard completion of the main flow and recovery paths, focus inspection, zoom/reflow, contrast measurement, reduced motion, and print preview. Use a supported browser/screen-reader combination available to the evaluator; record the exact browser, OS, assistive technology, and versions actually used. Check form labels/errors, review reading order, status announcements, dialogs, and export links with that combination. If assistive technology is unavailable, mark those cases untested and retain the release gate rather than inferring success.

Record expected behavior, actual observations, pass/fail, evidence, and known limitations in the [evaluation matrix](EVALUATION.md). Accessibility status remains **not yet tested** until these checks run on an implemented application.
