import { randomUUID } from "node:crypto";
import {
	expect,
	request as apiRequest,
	test,
	type APIRequestContext,
	type Page,
} from "@playwright/test";
import { completeStandard } from "../../fixtures/records";
import type { CandidateOutput } from "../../shared/contracts";
import { checkAccessibility } from "./helpers";

const origin = "http://localhost:3001";
type Actor = "contributor" | "reviewer" | "administrator";
type ApiSession = { context: APIRequestContext; csrf: string };
type CycleDetail = {
	cycle: { id: string; version: number; status: string };
	current_revision: {
		id: string;
		sequence: number;
		content: CandidateOutput;
	} | null;
};

async function session(actor: Actor): Promise<ApiSession> {
	const context = await apiRequest.newContext({
		baseURL: origin,
		extraHTTPHeaders: { Origin: origin },
	});
	const response = await context.post("/api/v1/demo-session", {
		data: { actor },
	});
	expect(response.status()).toBe(201);
	return { context, csrf: (await response.json()).csrf_token };
}

async function mutate<T>(
	actor: ApiSession,
	path: string,
	data: unknown = {},
	method = "POST",
): Promise<T> {
	const response = await actor.context.fetch(`/api/v1${path}`, {
		method,
		data,
		headers: {
			"X-CSRF-Token": actor.csrf,
			"Idempotency-Key": randomUUID(),
		},
	});
	expect(response.ok(), await response.text()).toBe(true);
	return response.json();
}

test.beforeEach(async () => {
	const administrator = await session("administrator");
	try {
		await mutate(administrator, "/demo/reset", {
			confirmation: "RESET FICTIONAL DEMO",
		});
	} finally {
		await administrator.context.dispose();
	}
});

async function selectRole(page: Page, actor: Actor = "contributor") {
	await page.goto("/");
	await page
		.getByRole("button", {
			name: new RegExp(
				`${actor}.*${actor === "contributor" ? "Create fictional" : "Compare drafts"}`,
			),
		})
		.click();
	await expect(
		page.getByRole("button", { name: actor, exact: true }),
	).toBeVisible();
}

async function createDraft(page: Page) {
	const created = page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/v1/requests") &&
			response.request().method() === "POST",
	);
	await page
		.getByRole("button", { name: "New announcement", exact: true })
		.click();
	const result = (await (await created).json()) as CycleDetail;
	await expect(
		page.getByText(`CYCLE ${result.cycle.id.slice(0, 8)}`, { exact: false }),
	).toBeVisible();
	await expect(
		page.getByRole("textbox", { name: /Graduate name/ }),
	).toBeVisible();
	return result.cycle.id;
}

async function fillExample(page: Page) {
	await page.getByRole("button", { name: "Use fictional example" }).click();
	await page.getByRole("checkbox", { name: /I confirm this record/ }).check();
	await page
		.getByRole("checkbox", { name: /I give fictional demo permission/ })
		.check();
}

test("dirty cycle navigation preserves text until an explicit discard, including same-cycle clicks", async ({
	page,
}) => {
	await selectRole(page);
	const firstId = await createDraft(page);
	const secondId = await createDraft(page);
	const name = page.getByRole("textbox", { name: /Graduate name/ });
	await name.fill("Unsaved fictional graduate");
	const cycles = page.getByRole("navigation", { name: "Announcement cycles" });
	const selected = cycles.locator('button[aria-current="page"]');
	await selected.click();
	await expect(name).toHaveValue("Unsaved fictional graduate");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	const other = cycles.locator('button:not([aria-current="page"])');
	await other.click();
	const discard = page.getByRole("dialog", {
		name: "Discard unsaved changes?",
	});
	await expect(discard.getByRole("button", { name: "Cancel" })).toBeFocused();
	await checkAccessibility(page, "discard-unsaved-cycle-dialog");
	await discard.getByRole("button", { name: "Cancel" }).click();
	await expect(name).toHaveValue("Unsaved fictional graduate");
	await expect(
		page.getByText(`CYCLE ${secondId.slice(0, 8)}`, { exact: false }),
	).toBeVisible();
	await other.click();
	await discard
		.getByRole("button", { name: "Discard changes", exact: true })
		.click();
	await expect(name).toHaveValue("");
	await expect(
		page.getByText(`CYCLE ${firstId.slice(0, 8)}`, { exact: false }),
	).toBeVisible();
});

test("canceling a dirty role change preserves the session and unsaved source", async ({
	page,
}) => {
	await selectRole(page);
	await createDraft(page);
	const name = page.getByRole("textbox", { name: /Graduate name/ });
	await name.fill("Unsaved fictional source");
	const before = await (await page.request.get("/api/v1/session")).json();
	const replacements: string[] = [];
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			request.url().endsWith("/api/v1/demo-session")
		)
			replacements.push(request.url());
	});
	await page.getByRole("button", { name: "contributor", exact: true }).click();
	const roles = page.getByRole("dialog", { name: "Switch simulated role" });
	await roles.getByRole("button", { name: /^reviewer/ }).click();
	const discard = page.getByRole("dialog", {
		name: "Discard unsaved changes?",
	});
	await expect(discard).toBeVisible();
	await checkAccessibility(page, "discard-unsaved-role-dialog");
	await discard.getByRole("button", { name: "Cancel" }).click();
	await expect(roles.getByRole("button", { name: /^reviewer/ })).toBeFocused();
	await roles.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(name).toHaveValue("Unsaved fictional source");
	await expect(
		page.getByRole("button", { name: "contributor", exact: true }),
	).toBeVisible();
	const after = await (await page.request.get("/api/v1/session")).json();
	expect(after.role).toBe("contributor");
	expect(after.csrf_token).toBe(before.csrf_token);
	expect(replacements).toEqual([]);
});

test("beforeunload protection exists only while source edits are unsaved", async ({
	page,
}) => {
	await selectRole(page);
	await createDraft(page);
	const preventsUnload = () =>
		page.evaluate(() => {
			const event = new Event("beforeunload", { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		});
	expect(await preventsUnload()).toBe(false);
	await fillExample(page);
	await expect.poll(preventsUnload).toBe(true);
	const nativeDialog = page.waitForEvent("dialog");
	// Trigger the browser action without waiting for a load that cancellation
	// deliberately prevents; page.reload() would wait until its navigation timeout.
	await page.evaluate(() => {
		window.setTimeout(() => window.location.reload(), 0);
	});
	const confirmation = await nativeDialog;
	expect(confirmation.type()).toBe("beforeunload");
	await confirmation.dismiss();
	await expect(
		page.getByRole("textbox", { name: /Graduate name/ }),
	).toHaveValue("Avery Example");
	await page.getByRole("button", { name: "Save draft", exact: true }).click();
	await expect(page.getByRole("status")).toContainText(
		"Fictional source saved",
	);
	await expect.poll(preventsUnload).toBe(false);
	await page.reload();
	await expect(
		page.getByRole("button", { name: "contributor", exact: true }),
	).toBeVisible();
});

for (const fault of ["network abort", "503 response"] as const) {
	test(`attempt polling recovers after one ${fault} without starting another generation`, async ({
		page,
	}) => {
		await selectRole(page);
		const cycleId = await createDraft(page);
		await fillExample(page);
		await page
			.getByRole("button", { name: "Submit source", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Your source is ready." }),
		).toBeVisible();
		let pollRequests = 0;
		let generations = 0;
		page.on("request", (request) => {
			if (
				request.method() === "POST" &&
				request.url().endsWith(`/cycles/${cycleId}/generations`)
			)
				generations++;
		});
		await page.route("**/api/v1/attempts/*", async (route) => {
			pollRequests++;
			if (pollRequests !== 1) return route.continue();
			if (fault === "network abort") return route.abort("failed");
			return route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({
					error: {
						code: "STORAGE_BUSY",
						message: "Local storage is temporarily busy.",
					},
				}),
			});
		});
		await page
			.getByRole("button", { name: "Generate candidate", exact: true })
			.click();
		await expect(
			page.getByRole("status").filter({ hasText: "Reconnecting" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Current revision 1", exact: true }),
		).toBeVisible();
		await expect(page.getByRole("status")).toContainText(
			"Mock generation complete",
		);
		expect(pollRequests).toBeGreaterThanOrEqual(2);
		expect(generations).toBe(1);
		const history = await (
			await page.request.get(`/api/v1/cycles/${cycleId}/history`)
		).json();
		expect(history.attempts).toHaveLength(1);
		expect(history.attempts[0].state).toBe("succeeded");
	});
}

async function seedTwentyTwoRevisions() {
	const contributor = await session("contributor");
	let detail: CycleDetail;
	try {
		detail = await mutate<CycleDetail>(contributor, "/requests");
		detail = await mutate<CycleDetail>(
			contributor,
			`/cycles/${detail.cycle.id}/draft`,
			{
				expected_cycle_version: detail.cycle.version,
				source: completeStandard,
			},
			"PUT",
		);
		detail = await mutate<CycleDetail>(
			contributor,
			`/cycles/${detail.cycle.id}/submit`,
			{
				expected_cycle_version: detail.cycle.version,
			},
		);
		await mutate(contributor, `/cycles/${detail.cycle.id}/generations`, {
			expected_cycle_version: detail.cycle.version,
		});
		const cycleId = detail.cycle.id;
		await expect
			.poll(async () => {
				detail = await (
					await contributor.context.get(`/api/v1/cycles/${cycleId}`)
				).json();
				return detail.cycle.status;
			})
			.toBe("NeedsReview");
	} finally {
		await contributor.context.dispose();
	}
	const cycleId = detail.cycle.id;
	// Two independent reviewer sessions keep setup below the documented per-session
	// mutation budget while exercising real persisted revision and audit records.
	for (const [first, last] of [
		[2, 12],
		[13, 22],
	]) {
		const reviewer = await session("reviewer");
		try {
			for (let sequence = first; sequence <= last; sequence++) {
				detail = await (
					await reviewer.context.get(`/api/v1/cycles/${cycleId}`)
				).json();
				await mutate(reviewer, `/cycles/${cycleId}/revisions`, {
					expected_cycle_version: detail.cycle.version,
					expected_revision_id: detail.current_revision!.id,
					content: {
						...detail.current_revision!.content,
						editor_notes: [`Fictional revision ${sequence}`],
					},
				});
			}
		} finally {
			await reviewer.context.dispose();
		}
	}
	return cycleId;
}

test("revision navigation is independently paginated beyond twenty audit events", async ({
	page,
}) => {
	const cycleId = await seedTwentyTwoRevisions();
	await selectRole(page, "reviewer");
	await page
		.getByRole("navigation", { name: "Announcement cycles" })
		.getByRole("button")
		.click();
	await expect(
		page.getByRole("heading", { name: "Current revision 22", exact: true }),
	).toBeVisible();
	const history = await (
		await page.request.get(`/api/v1/cycles/${cycleId}/history`)
	).json();
	expect(history.events).toHaveLength(20);
	expect(history.next_cursor).not.toBeNull();
	const first = await (
		await page.request.get(`/api/v1/cycles/${cycleId}/revisions`)
	).json();
	expect(first.revisions).toHaveLength(20);
	expect(first.next_cursor).not.toBeNull();
	for (const revision of first.revisions)
		expect(revision).not.toHaveProperty("content");
	const second = await (
		await page.request.get(
			`/api/v1/cycles/${cycleId}/revisions?cursor=${encodeURIComponent(first.next_cursor)}`,
		)
	).json();
	expect(
		second.revisions.map((revision: { sequence: number }) => revision.sequence),
	).toEqual([21, 22]);
	expect(second.next_cursor).toBeNull();
	const revisions = page.getByRole("combobox", { name: "View revision" });
	await expect(revisions.getByRole("option", { name: /^#21 / })).toHaveCount(0);
	await page
		.getByRole("button", { name: "Load more revisions", exact: true })
		.click();
	await expect(revisions.getByRole("option")).toHaveCount(22);
	await expect(
		page.getByRole("heading", { name: "Current revision 22", exact: true }),
	).toBeVisible();
	await revisions.focus();
	await revisions.selectOption({ label: "#21 · human" });
	await expect(
		page.getByRole("heading", { name: "Historical revision 21", exact: true }),
	).toBeVisible();
	await expect(revisions).toBeFocused();
	await page
		.getByText("Candidate fact fields and untrusted advisories", {
			exact: true,
		})
		.last()
		.click();
	await expect(
		page.getByText("Fictional revision 21", { exact: false }),
	).toBeVisible();
});
