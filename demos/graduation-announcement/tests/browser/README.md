# Browser verification

Run `npm run test:browser` from this demonstration's directory. Playwright starts
the production build against a temporary SQLite database and runs Chromium tests
serially. Each test resets only that test server's fictional dataset.

The automated checks exercise the visible mock workflow, deliberate approval,
validation and recovery controls, dialog focus, responsive reflow, print CSS,
downloaded text, and axe accessibility scans. Regression cases cover dirty-navigation cancellation/discard, dirty-only browser unload warnings, polling recovery after network/503 interruptions without another generation, and 22 revisions browsed independently of the audit page. Browser request monitoring rejects
external HTTP requests during the mock workflow. An automated accessibility pass
does not establish accessibility conformance.

Manual acceptance still requires a recorded browser/OS/screen-reader combination,
screen-reader announcements and reading order, complete keyboard recovery paths,
200% text zoom, actual 400% browser zoom, measured focus/control contrast, and
inspection of the browser's print preview. A 320 CSS-pixel automated viewport is
reflow evidence, not a substitute for those zoom checks. Print-media emulation
checks retained labels and hidden controls, not printer pagination.

On failure, Playwright saves a screenshot and trace under `test-results/`; the
HTML report is under `playwright-report/`. These generated artifacts and the
temporary database are local test evidence and must not be committed.
