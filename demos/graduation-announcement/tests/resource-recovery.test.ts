import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import Database from "better-sqlite3";
import request from "supertest";
import { createApp, type AppOptions } from "../server/app.js";
import { completeStandard } from "../fixtures/records.js";
import { compose } from "../shared/contracts.js";

async function client(
	app: ReturnType<typeof createApp>,
	actor = "contributor",
) {
	const raw = (method: string, path: string) =>
		(request(app) as any)
			[method](`/api/v1${path}`)
			.set("Host", "localhost:3001");
	const response = await raw("post", "/demo-session")
		.set("Origin", "http://localhost:5173")
		.send({ actor });
	assert.equal(response.status, 201);
	const cookie = response.headers["set-cookie"][0].split(";")[0];
	return (
		method: string,
		path: string,
		body: unknown = {},
		key = randomUUID(),
	) => {
		const req = raw(method, path).set("Cookie", cookie);
		return method === "get"
			? req
			: req
					.set("Origin", "http://localhost:5173")
					.set("X-CSRF-Token", response.body.csrf_token)
					.set("Idempotency-Key", key)
					.send(body);
	};
}
type Client = Awaited<ReturnType<typeof client>>;
async function submit(call: Client) {
	const created = await call("post", "/requests");
	assert.equal(created.status, 201);
	const id = created.body.cycle.id;
	assert.equal(
		(
			await call("put", `/cycles/${id}/draft`, {
				expected_cycle_version: 1,
				source: completeStandard,
			})
		).status,
		200,
	);
	const submitted = await call("post", `/cycles/${id}/submit`, {
		expected_cycle_version: 2,
	});
	assert.equal(submitted.status, 200);
	return { id, snapshot: submitted.body.snapshot_id };
}
async function until(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await delay(5);
	}
	assert(predicate(), "Expected worker state was not reached");
}
function fillEvents(app: ReturnType<typeof createApp>) {
	const db = app.locals.db;
	const insert = db.prepare(
		"INSERT INTO audit_events VALUES (?,NULL,NULL,'test_capacity','system','{}',NULL,?)",
	);
	db.transaction(() => {
		const remaining =
			10000 - db.prepare("SELECT count(*) AS n FROM audit_events").get().n;
		for (let i = 0; i < remaining; i++)
			insert.run(randomUUID(), new Date().toISOString());
	})();
}

test("E33 real SQLite write contention yields 503 with no partial write; same-key recovery commits once", async () => {
	const directory = mkdtempSync(join(tmpdir(), "graduation-lock-"));
	const path = join(directory, "demo.sqlite");
	const app = createApp({ databasePath: path, rateLimits: false });
	const lock = new Database(path);
	try {
		const call = await client(app);
		const key = randomUUID();
		lock.exec("BEGIN IMMEDIATE");
		const busy = await call("post", "/requests", {}, key);
		assert.equal(busy.status, 503);
		assert.equal(busy.body.error.code, "STORAGE_BUSY");
		lock.exec("ROLLBACK");
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM requests").get().n,
			0,
		);
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM mutation_receipts").get()
				.n,
			0,
		);
		const recovered = await call("post", "/requests", {}, key);
		const duplicate = await call("post", "/requests", {}, key);
		assert.equal(recovered.status, 201);
		assert.deepEqual(duplicate.body, recovered.body);
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM requests").get().n,
			1,
		);
		assert.deepEqual(app.locals.db.pragma("foreign_key_check"), []);
		assert.equal(
			app.locals.db.pragma("integrity_check", { simple: true }),
			"ok",
		);
	} finally {
		if (lock.inTransaction) lock.exec("ROLLBACK");
		lock.close();
		app.locals.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("E20 late success after timeout cannot replace a newer candidate and records one safe discard", async () => {
	let clock = Date.now();
	const pending: ((value: unknown) => void)[] = [];
	const app = createApp({
		databasePath: ":memory:",
		rateLimits: false,
		now: () => clock,
		mockDelayMs: 1,
		deadlineMs: 100,
		provider: () => new Promise((resolve) => pending.push(resolve)),
	});
	try {
		const call = await client(app);
		const cycle = await submit(call);
		const first = await call("post", `/cycles/${cycle.id}/generations`, {
			expected_cycle_version: 3,
		});
		await until(() => pending.length === 1);
		clock += 101;
		app.locals.sweep();
		const second = await call("post", `/cycles/${cycle.id}/generations`, {
			expected_cycle_version: 5,
		});
		assert.equal(second.status, 202);
		await until(() => pending.length === 2);
		pending[1](compose(completeStandard));
		await until(
			() =>
				app.locals.db
					.prepare("SELECT state FROM generation_attempts WHERE id=?")
					.get(second.body.attempt_id).state === "succeeded",
		);
		const before = (await call("get", `/cycles/${cycle.id}`)).body;
		pending[0]({
			...compose(completeStandard),
			headline: "Late obsolete content",
		});
		await until(
			() =>
				app.locals.db
					.prepare(
						"SELECT discard_recorded FROM generation_attempts WHERE id=?",
					)
					.get(first.body.attempt_id).discard_recorded === 1,
		);
		const after = (await call("get", `/cycles/${cycle.id}`)).body;
		assert.equal(after.current_revision.id, before.current_revision.id);
		assert.equal(after.cycle.version, before.cycle.version);
		assert.equal(after.cycle.status, "NeedsReview");
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM revisions").get().n,
			1,
		);
		assert.equal(
			app.locals.db
				.prepare(
					"SELECT count(*) AS n FROM audit_events WHERE event_type='generation_discarded'",
				)
				.get().n,
			1,
		);
		assert(
			!JSON.stringify(
				app.locals.db.prepare("SELECT * FROM audit_events").all(),
			).includes("Late obsolete content"),
		);
	} finally {
		app.locals.close();
	}
});

test("E31/E43 accepted work settles above the event threshold; growth is denied and withdrawal/reset remain available", async () => {
	let resolve: (value: unknown) => void = () => {};
	let workerStarted = false;
	const options: AppOptions = {
		databasePath: ":memory:",
		rateLimits: false,
		mockDelayMs: 1,
		provider: () =>
			new Promise((done) => {
				resolve = done;
				workerStarted = true;
			}),
	};
	const app = createApp(options);
	try {
		const call = await client(app);
		const admin = await client(app, "administrator");
		const cycle = await submit(call);
		const started = await call("post", `/cycles/${cycle.id}/generations`, {
			expected_cycle_version: 3,
		});
		assert.equal(started.status, 202);
		await until(() => workerStarted);
		fillEvents(app);
		const denied = await call("post", "/requests");
		assert.equal(denied.status, 409);
		assert.equal(denied.body.error.code, "DATASET_LIMIT");
		resolve(compose(completeStandard));
		await until(
			() =>
				app.locals.db
					.prepare("SELECT state FROM generation_attempts WHERE id=?")
					.get(started.body.attempt_id).state === "succeeded",
		);
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM revisions").get().n,
			1,
		);
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM audit_events").get().n,
			10001,
		);
		const withdrawn = await call(
			"post",
			`/snapshots/${cycle.snapshot}/withdraw-consent`,
		);
		assert.equal(withdrawn.status, 200);
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM audit_events").get().n,
			10002,
		);
		const reset = await admin("post", "/demo/reset", {
			confirmation: "RESET FICTIONAL DEMO",
		});
		assert.equal(reset.status, 200);
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM audit_events").get().n,
			0,
		);
		assert.equal((await call("get", "/requests")).status, 401);
	} finally {
		app.locals.close();
	}
});

test("E31 revision slots count running reservations and accepted completion never exceeds capacity", async () => {
	const pending: ((value: unknown) => void)[] = [];
	const app = createApp({
		databasePath: ":memory:",
		rateLimits: false,
		mockDelayMs: 1,
		provider: () => new Promise((done) => pending.push(done)),
	});
	try {
		const call = await client(app);
		const first = await submit(call);
		const second = await submit(call);
		const db = app.locals.db;
		const insert = db.prepare(
			"INSERT INTO revisions VALUES (?,?,?,?,NULL,'human',NULL,'reviewer',?,'test-fixture',?)",
		);
		db.transaction(() => {
			for (let sequence = 1; sequence <= 999; sequence++)
				insert.run(
					randomUUID(),
					first.id,
					first.snapshot,
					sequence,
					JSON.stringify(compose(completeStandard)),
					new Date().toISOString(),
				);
		})();
		const accepted = await call("post", `/cycles/${first.id}/generations`, {
			expected_cycle_version: 3,
		});
		assert.equal(accepted.status, 202);
		const denied = await call("post", `/cycles/${second.id}/generations`, {
			expected_cycle_version: 3,
		});
		assert.equal(denied.status, 409);
		assert.equal(denied.body.error.code, "DATASET_LIMIT");
		await until(() => pending.length === 1);
		pending[0](compose(completeStandard));
		await until(
			() =>
				db
					.prepare("SELECT state FROM generation_attempts WHERE id=?")
					.get(accepted.body.attempt_id).state === "succeeded",
		);
		assert.equal(
			db.prepare("SELECT count(*) AS n FROM revisions").get().n,
			1000,
		);
		assert.deepEqual(db.pragma("foreign_key_check"), []);
	} finally {
		app.locals.close();
	}
});

test("E31 request and cycle caps reject new growth before exceeding either limit", async () => {
	const app = createApp({ databasePath: ":memory:", rateLimits: false });
	try {
		const call = await client(app);
		const db = app.locals.db;
		const initial = await call("post", "/requests");
		assert.equal(initial.status, 201);
		const requestId = initial.body.request.id;
		const cycleId = initial.body.cycle.id;
		db.transaction(() => {
			for (let i = 1; i < 50; i++)
				db.prepare("INSERT INTO requests VALUES (?,?,?)").run(
					randomUUID(),
					"contributor",
					new Date().toISOString(),
				);
		})();
		const deniedRequest = await call("post", "/requests");
		assert.equal(deniedRequest.status, 409);
		assert.equal(deniedRequest.body.error.code, "DATASET_LIMIT");
		assert.equal(db.prepare("SELECT count(*) AS n FROM requests").get().n, 50);
		const draft = db
			.prepare("SELECT draft FROM cycles WHERE id=?")
			.get(cycleId).draft;
		db.transaction(() => {
			for (let i = 1; i < 200; i++)
				db.prepare(
					"INSERT INTO cycles VALUES (?,? ,NULL,'initial','Draft',1,?,NULL,NULL,NULL,?)",
				).run(randomUUID(), requestId, draft, new Date().toISOString());
		})();
		const deniedCycle = await call("post", `/cycles/${cycleId}/children`, {
			expected_cycle_version: 1,
			reason: "correct_source",
		});
		assert.equal(deniedCycle.status, 409);
		assert.equal(deniedCycle.body.error.code, "DATASET_LIMIT");
		assert.equal(db.prepare("SELECT count(*) AS n FROM cycles").get().n, 200);
	} finally {
		app.locals.close();
	}
});

test("E23/E43 download admission requires its audit event even for a previously prepared artifact", async () => {
	const app = createApp({
		databasePath: ":memory:",
		rateLimits: false,
		mockDelayMs: 1,
	});
	try {
		const call = await client(app);
		const reviewer = await client(app, "reviewer");
		const cycle = await submit(call);
		const started = await call("post", `/cycles/${cycle.id}/generations`, {
			expected_cycle_version: 3,
		});
		assert.equal(started.status, 202);
		await until(
			() =>
				app.locals.db
					.prepare("SELECT state FROM generation_attempts WHERE id=?")
					.get(started.body.attempt_id).state === "succeeded",
		);
		const detail = (await call("get", `/cycles/${cycle.id}`)).body;
		const approved = await reviewer("post", `/cycles/${cycle.id}/decisions`, {
			expected_cycle_version: detail.cycle.version,
			expected_revision_id: detail.current_revision.id,
			decision: "approve",
			reason: null,
		});
		assert.equal(approved.status, 200);
		const prepared = await reviewer(
			"post",
			`/approvals/${approved.body.approval_id}/prepare`,
			{ expected_cycle_version: approved.body.cycle.version },
		);
		assert.equal(prepared.status, 201);
		fillEvents(app);
		const download = await call(
			"get",
			`/exports/${prepared.body.export_id}/download`,
		);
		assert.equal(download.status, 409);
		assert.equal(download.body.error.code, "DATASET_LIMIT");
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM audit_events").get().n,
			10000,
		);
		assert.equal(
			(await call("get", `/exports/${prepared.body.export_id}`)).status,
			200,
		);
	} finally {
		app.locals.close();
	}
});

test("E13 direct contributor and administrator approval attempts cannot create an approval or decision event", async () => {
	const app = createApp({
		databasePath: ":memory:",
		rateLimits: false,
		mockDelayMs: 1,
	});
	try {
		const call = await client(app);
		const admin = await client(app, "administrator");
		const cycle = await submit(call);
		const started = await call("post", `/cycles/${cycle.id}/generations`, {
			expected_cycle_version: 3,
		});
		assert.equal(started.status, 202);
		await until(
			() =>
				app.locals.db
					.prepare("SELECT state FROM generation_attempts WHERE id=?")
					.get(started.body.attempt_id).state === "succeeded",
		);
		const detail = (await call("get", `/cycles/${cycle.id}`)).body;
		const body = {
			expected_cycle_version: detail.cycle.version,
			expected_revision_id: detail.current_revision.id,
			decision: "approve",
			reason: null,
		};
		assert.equal(
			(await call("post", `/cycles/${cycle.id}/decisions`, body)).status,
			403,
		);
		assert.equal(
			(await admin("post", `/cycles/${cycle.id}/decisions`, body)).status,
			404,
		);
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM approvals").get().n,
			0,
		);
		assert.equal(
			app.locals.db.prepare("SELECT count(*) AS n FROM review_decisions").get()
				.n,
			0,
		);
		assert.equal(
			(await call("get", `/cycles/${cycle.id}`)).body.cycle.status,
			"NeedsReview",
		);
	} finally {
		app.locals.close();
	}
});
