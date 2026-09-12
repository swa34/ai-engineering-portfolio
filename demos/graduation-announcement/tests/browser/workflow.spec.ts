import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, request as apiRequest, test, type Locator, type Page } from '@playwright/test';
import { checkAccessibility, checkNarrowReflow, monitorExternalRequests } from './helpers';

const origin = 'http://localhost:3001';

async function administer(path: string, data: unknown, method = 'POST') {
  const context = await apiRequest.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  try {
    const selected = await context.post('/api/v1/demo-session', { data: { actor: 'administrator' } });
    expect(selected.status()).toBe(201);
    const session = await selected.json();
    const result = await context.fetch(`/api/v1${path}`, {
      method, data, headers: { 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': randomUUID() },
    });
    expect(result.ok(), await result.text()).toBe(true);
  } finally { await context.dispose(); }
}

test.beforeEach(async () => {
  await administer('/demo/reset', { confirmation: 'RESET FICTIONAL DEMO' });
});

async function keyboardActivate(page: Page, control: Locator, key = 'Enter') {
  for (let tabs = 0; tabs < 160; tabs++) {
    if (await control.evaluate(element => document.activeElement === element)) {
      await page.keyboard.press(key);
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Control was not keyboard reachable: ${await control.textContent()}`);
}

async function createExample(page: Page, keyboard = false) {
  const activate = (control: Locator, key = 'Enter') => keyboard ? keyboardActivate(page, control, key) : control.click();
  await page.goto('/');
  const contributor = page.getByRole('button', { name: /contributor.*Create fictional/ });
  await expect(contributor).toBeVisible();
  await activate(contributor);
  const created = page.waitForResponse(response => response.url().endsWith('/api/v1/requests') && response.request().method() === 'POST');
  await activate(page.getByRole('button', { name: 'New announcement', exact: true }));
  const { cycle } = await (await created).json();
  await activate(page.getByRole('button', { name: 'Use fictional example' }));
  const fiction = page.getByRole('checkbox', { name: /I confirm this record/ });
  const consent = page.getByRole('checkbox', { name: /I give fictional demo permission/ });
  await expect(fiction).not.toBeChecked();
  await expect(consent).not.toBeChecked();
  await activate(fiction, 'Space');
  await activate(consent, 'Space');
  return cycle.id as string;
}

async function submitExample(page: Page, keyboard = false) {
  const cycleId = await createExample(page, keyboard);
  const submit = page.getByRole('button', { name: 'Submit source', exact: true });
  if (keyboard) await keyboardActivate(page, submit); else await submit.click();
  await expect(page.getByRole('heading', { name: 'Your source is ready.' })).toBeVisible();
  const detail = await (await page.request.get(`/api/v1/cycles/${cycleId}`)).json();
  expect(detail.cycle.status).toBe('Submitted');
  expect(detail.cycle.current_revision_id).toBeNull();
  expect(detail.cycle.active_attempt_id).toBeNull();
  return cycleId;
}

async function generateExample(page: Page) {
  const cycleId = await submitExample(page);
  await page.getByRole('button', { name: 'Generate candidate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Current revision 1', exact: true })).toBeVisible();
  return cycleId;
}

async function switchRole(page: Page, current: string, next: string, keyboard = false) {
  const trigger = page.getByRole('button', { name: current, exact: true });
  if (keyboard) await keyboardActivate(page, trigger); else await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Switch simulated role' });
  const selection = dialog.getByRole('button', { name: new RegExp(`^${next}`) });
  if (keyboard) await keyboardActivate(page, selection); else await selection.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: next, exact: true })).toBeVisible();
}

test('complete-standard: keyboard approval, exact artifact, reflow, print, and isolated mock requests', async ({ page }) => {
  test.setTimeout(90_000);
  const external = monitorExternalRequests(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /contributor.*Create fictional/ })).toBeVisible();
  await checkAccessibility(page, 'role-selection');
  const cycleId = await submitExample(page, true);
  await checkAccessibility(page, 'submitted-source');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByText('Unapproved fictional draft', { exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await keyboardActivate(page, page.getByRole('button', { name: 'Generate candidate', exact: true }));
  await expect(page.getByRole('heading', { name: 'Source checks passed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve revision…' })).toHaveCount(0);
  await switchRole(page, 'contributor', 'reviewer', true);
  await checkAccessibility(page, 'review');
  await expect(page.getByRole('navigation', { name: 'Announcement cycles' })).toContainText('Validation: passed');
  await page.screenshot({ path: test.info().outputPath('review-desktop.png'), fullPage: true });
  await checkNarrowReflow(page);
  await checkAccessibility(page, 'review-320px');
  await page.screenshot({ path: test.info().outputPath('review-320px.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const approve = page.getByRole('button', { name: 'Approve revision…' });
  await keyboardActivate(page, approve);
  const approvalDialog = page.getByRole('dialog', { name: 'Approve this exact revision?' });
  await expect(approvalDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(approvalDialog).toContainText('Avery Example');
  await checkAccessibility(page, 'approval-dialog');
  await page.keyboard.press('Escape');
  await expect(approve).toBeFocused();
  await keyboardActivate(page, approve);
  await keyboardActivate(page, approvalDialog.getByRole('button', { name: 'Confirm approval of revision 1' }));
  await expect(page.getByRole('heading', { name: 'Approved. Ready to prepare.' })).toBeVisible();
  await keyboardActivate(page, page.getByRole('button', { name: 'Prepare approved artifact', exact: true }));
  const downloadLink = page.getByRole('link', { name: 'Download approved text', exact: true });
  await expect(downloadLink).toBeVisible();
  const downloadReady = page.waitForEvent('download');
  await keyboardActivate(page, downloadLink);
  const download = await downloadReady;
  const text = await readFile((await download.path())!, 'utf8');
  const detail = await (await page.request.get(`/api/v1/cycles/${cycleId}`)).json();
  expect(detail.cycle.status).toBe('ReadyForPublication');
  expect(text).toContain('FICTIONAL DEMONSTRATION — NOT FOR REAL DISTRIBUTION');
  for (const value of [detail.approval.id, detail.current_revision.id, detail.snapshot.id, detail.current_revision.content.headline, detail.current_revision.content.announcement_body, detail.current_revision.content.short_social_version]) expect(text).toContain(value);
  const exportPath = (await downloadLink.getAttribute('href'))!.replace('/download', '');
  const artifact = await (await page.request.get(exportPath)).json();
  expect(text).toBe(artifact.text);
  await checkAccessibility(page, 'ready-artifact');
  await checkNarrowReflow(page);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print approved preview' })).not.toBeVisible();
  expect(external).toEqual([]);
  await test.info().attach('artifact-identifiers', { body: JSON.stringify({ cycleId, approvalId: detail.approval.id, revisionId: detail.current_revision.id, snapshotId: detail.snapshot.id }), contentType: 'application/json' });
});

test('invalid source and independent acknowledgments preserve input and expose linked errors', async ({ page }) => {
  await createExample(page);
  await page.getByRole('checkbox', { name: /I confirm this record/ }).uncheck();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  await expect(error).toBeFocused();
  await expect(page.getByRole('textbox', { name: /Graduate name/ })).toHaveValue('Avery Example');
  await page.getByRole('checkbox', { name: /I confirm this record/ }).check();
  await page.getByRole('combobox', { name: /Degree/ }).selectOption('');
  await page.getByRole('button', { name: 'Submit source', exact: true }).click();
  await expect(error).toBeFocused();
  await expect(page.getByRole('combobox', { name: /Degree/ })).toHaveAttribute('aria-invalid', 'true');
  const degreeLink = error.getByRole('link', { name: /degree/i });
  await expect(degreeLink).toHaveAttribute('href', '#degree');
  await degreeLink.click();
  await expect(page.getByRole('combobox', { name: /Degree/ })).toBeFocused();
  await checkAccessibility(page, 'invalid-form');
  await checkNarrowReflow(page);
});

test('timeout remains retryable and only an explicit later generation creates a revision', async ({ page }) => {
  await administer('/demo/scenario', { scenario: 'timeout' }, 'PUT');
  const cycleId = await submitExample(page);
  await page.getByRole('button', { name: 'Generate candidate', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Generation failed', { timeout: 18_000 });
  await checkAccessibility(page, 'generation-failure');
  const failed = await (await page.request.get(`/api/v1/cycles/${cycleId}`)).json();
  expect(failed.cycle.status).toBe('Submitted');
  expect(failed.current_revision).toBeNull();
  await administer('/demo/scenario', { scenario: 'normal' }, 'PUT');
  await page.getByRole('button', { name: 'Generate candidate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Current revision 1', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Mock generation complete');
});

test('altered facts and a human invention block approval; explicit restoration preserves revisions', async ({ page }) => {
  await administer('/demo/scenario', { scenario: 'altered_program' }, 'PUT');
  await generateExample(page);
  await switchRole(page, 'contributor', 'reviewer');
  await expect(page.getByRole('heading', { name: 'Resolve blocking findings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve revision…' })).toBeDisabled();
  await checkAccessibility(page, 'blocked-provider-output');
  await page.getByRole('textbox', { name: 'Headline', exact: true }).fill('Avery Example receives an invented award');
  await page.getByRole('button', { name: 'Save new revision', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Current revision 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve revision…' })).toBeDisabled();
  await checkAccessibility(page, 'human-revision-with-findings');
  await page.getByRole('button', { name: 'Restore source-based wording…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview restored wording' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Save restored wording as new revision' }).click();
  await expect(page.getByRole('heading', { name: 'Current revision 3', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source checks passed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve revision…' })).toBeEnabled();
  const revisions = page.getByRole('combobox', { name: 'View revision' });
  await expect(revisions.getByRole('option')).toHaveCount(3);
  await revisions.focus();
  await revisions.selectOption({ index: 0 });
  await expect(page.getByRole('heading', { name: 'Historical revision 1', exact: true })).toBeVisible();
  await expect(revisions).toBeFocused();
});

test('stale editor preserves unsaved text and requires an explicit refresh', async ({ page }) => {
  const cycleId = await generateExample(page);
  await switchRole(page, 'contributor', 'reviewer');
  const headline = page.getByRole('textbox', { name: 'Headline', exact: true });
  await headline.fill('Unsaved wording kept for comparison');
  const session = await (await page.request.get('/api/v1/session')).json();
  const detail = await (await page.request.get(`/api/v1/cycles/${cycleId}`)).json();
  const otherEdit = await page.request.post(`/api/v1/cycles/${cycleId}/revisions`, {
    data: { expected_cycle_version: detail.cycle.version, expected_revision_id: detail.current_revision.id, content: detail.current_revision.content },
    headers: { Origin: origin, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': randomUUID() },
  });
  expect(otherEdit.status()).toBe(201);
  await page.getByRole('button', { name: 'Save new revision', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Another action may have changed this cycle');
  await expect(headline).toHaveValue('Unsaved wording kept for comparison');
  await checkAccessibility(page, 'stale-edit');
  await page.getByRole('button', { name: 'Refresh and preserve edits' }).click();
  await expect(headline).toHaveValue('Unsaved wording kept for comparison');
  const after = await (await page.request.get(`/api/v1/cycles/${cycleId}`)).json();
  expect(after.approval).toBeNull();
});

test('a revision changed behind an open approval dialog cannot be approved', async ({ page }) => {
  const cycleId = await generateExample(page);
  await switchRole(page, 'contributor', 'reviewer');
  await page.getByRole('button', { name: 'Approve revision…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve this exact revision?' });
  const session = await (await page.request.get('/api/v1/session')).json();
  const detail = await (await page.request.get(`/api/v1/cycles/${cycleId}`)).json();
  const changed = await page.request.post(`/api/v1/cycles/${cycleId}/revisions`, {
    data: { expected_cycle_version: detail.cycle.version, expected_revision_id: detail.current_revision.id, content: detail.current_revision.content },
    headers: { Origin: origin, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': randomUUID() },
  });
  expect(changed.status()).toBe(201);
  await dialog.getByRole('button', { name: 'Confirm approval of revision 1' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  const after = await (await page.request.get(`/api/v1/cycles/${cycleId}`)).json();
  expect(after.approval).toBeNull();
  expect(after.cycle.status).toBe('NeedsReview');
  await checkAccessibility(page, 'stale-approval-dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Refresh and preserve edits' }).click();
  await expect(page.getByRole('heading', { name: 'Current revision 2', exact: true })).toBeVisible();
});

test('request changes requires a reason; rejection is terminal and restart copies only facts', async ({ page }) => {
  await generateExample(page);
  await switchRole(page, 'contributor', 'reviewer');
  await page.getByRole('button', { name: 'Request changes…' }).click();
  const changes = page.getByRole('dialog', { name: 'Request changes', exact: true });
  await expect(changes.getByRole('button', { name: 'Confirm request for changes' })).toBeDisabled();
  await changes.getByRole('textbox', { name: /Reason/ }).fill('Please verify the fictional announcement wording.');
  await changes.getByRole('button', { name: 'Confirm request for changes' }).click();
  await expect(page.getByRole('heading', { name: 'Changes requested', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve revision…' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate candidate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Current revision 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reject…' }).click();
  const reject = page.getByRole('dialog', { name: 'Reject this cycle?' });
  await reject.getByRole('textbox', { name: /Reason/ }).fill('A separate fictional source review is required.');
  await reject.getByRole('button', { name: 'Confirm rejection' }).click();
  await expect(page.getByRole('button', { name: 'Approve revision…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate candidate', exact: true })).toHaveCount(0);
  await switchRole(page, 'reviewer', 'contributor');
  await page.getByRole('button', { name: 'Restart after rejection' }).click();
  await expect(page.getByRole('textbox', { name: /Graduate name/ })).toHaveValue('Avery Example');
  await expect(page.getByRole('checkbox', { name: /I confirm this record/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /I give fictional demo permission/ })).not.toBeChecked();
});

test('HTML-like source is rendered as inert text through mock generation', async ({ page }) => {
  await createExample(page);
  const sentinel = '<img src=x onerror="window.__injected=true">';
  await page.getByRole('textbox', { name: /Graduate name/ }).fill(sentinel);
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/x') requests.push(request.url()); });
  await page.getByRole('button', { name: 'Submit source', exact: true }).click();
  await expect(page.getByRole('heading', { name: sentinel, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate candidate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Current revision 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __injected?: boolean }).__injected)).toBeUndefined();
  await expect(page.locator('img')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('withdrawal blocks protected actions and correction requires fresh acknowledgments', async ({ page }) => {
  await generateExample(page);
  await page.getByRole('button', { name: 'Withdraw source consent…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw source consent?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Withdraw consent for this source' }).click();
  await expect(page.getByRole('strong').filter({ hasText: /^Consent withdrawn$/ })).toBeVisible();
  await checkAccessibility(page, 'withdrawal');
  await page.getByRole('button', { name: 'Correct source in new cycle' }).click();
  await expect(page.getByRole('textbox', { name: /Graduate name/ })).toHaveValue('Avery Example');
  await expect(page.getByRole('checkbox', { name: /I confirm this record/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /I give fictional demo permission/ })).not.toBeChecked();
  await expect(page.getByText('Copied source information must be acknowledged again.', { exact: false })).toBeVisible();
});

test('administrator reset requires exact typing and returns to an empty role-selection workflow', async ({ page }) => {
  await createExample(page);
  await switchRole(page, 'contributor', 'administrator');
  const reset = page.getByRole('button', { name: 'Reset dataset…' });
  await reset.click();
  const dialog = page.getByRole('dialog', { name: 'Reset the fictional dataset?' });
  const confirm = dialog.getByRole('button', { name: 'Permanently reset fictional dataset' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(confirm).toBeDisabled();
  await checkAccessibility(page, 'reset-dialog');
  await page.keyboard.press('Escape');
  await expect(reset).toBeFocused();
  await reset.click();
  const phrase = dialog.getByRole('textbox', { name: 'Type RESET FICTIONAL DEMO to confirm' });
  await phrase.fill('RESET');
  await expect(confirm).toBeDisabled();
  await phrase.fill('RESET FICTIONAL DEMO');
  await confirm.click();
  await expect(page.getByRole('status')).toContainText('The fictional dataset was reset');
  await page.getByRole('button', { name: /contributor.*Create fictional/ }).click();
  await expect(page.getByText('No announcements yet.', { exact: false })).toBeVisible();
});
