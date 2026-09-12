import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import request from "supertest";
import { createApp } from "../server/app.js";
import { openDatabase } from "../server/storage.js";
import { completeStandard } from "../fixtures/records.js";
import { compose } from "../shared/contracts.js";

test("schema version 1 reopens persisted records without reinitializing settings", () => {
	const directory = mkdtempSync(join(tmpdir(), "demo-schema-v1-"));
	try {
		const path = join(directory, "demo.sqlite");
		const first = openDatabase(path);
		first
			.prepare("INSERT INTO requests VALUES (?,?,?)")
			.run("saved", "owner", "2026-09-12");
		first
			.prepare("UPDATE settings SET value='timeout' WHERE key='scenario'")
			.run();
		first.close();
		const reopened = openDatabase(path);
		try {
			assert.deepEqual(reopened.prepare("SELECT * FROM migrations").all(), [
				{ version: 1 },
			]);
			assert.equal(
				(reopened.prepare("SELECT id FROM requests").get() as { id: string })
					.id,
				"saved",
			);
			assert.equal(
				(
					reopened
						.prepare("SELECT value FROM settings WHERE key='scenario'")
						.get() as { value: string }
				).value,
				"timeout",
			);
		} finally {
			reopened.close();
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("unsupported and malformed recorded schemas reject without altering the database and close connections", () => {
	const directory = mkdtempSync(join(tmpdir(), "demo-schema-invalid-"));
	const close = Database.prototype.close;
	let closed = 0;
	try {
		const schemas = [
			"CREATE TABLE migrations (version INTEGER PRIMARY KEY); INSERT INTO migrations VALUES (2)",
			"CREATE TABLE migrations (version TEXT); INSERT INTO migrations VALUES ('1')",
			"CREATE TABLE migrations (version INTEGER PRIMARY KEY)",
			"CREATE TABLE migrations (version INTEGER PRIMARY KEY); INSERT INTO migrations VALUES (1),(2)",
			"CREATE TABLE legacy_records (id TEXT)",
		];
		for (const [index, schema] of schemas.entries()) {
			const path = join(directory, `${index}.sqlite`);
			const fixture = new Database(path);
			fixture.exec(schema);
			fixture.close();
			const before = readFileSync(path);
			Database.prototype.close = function () {
				closed++;
				return close.call(this);
			};
			assert.throws(
				() => openDatabase(path),
				/schema version 1.*Preserve the existing file.*DATABASE_PATH/,
			);
			Database.prototype.close = close;
			assert.deepEqual(readFileSync(path), before);
			assert.equal(closed, index + 1);
		}
	} finally {
		Database.prototype.close = close;
		rmSync(directory, { recursive: true, force: true });
	}
});

function fixture() {
	const actorIds = { contributor: "owner-one" };
	const app = createApp({
		databasePath: ":memory:",
		rateLimits: false,
		actorIds,
	});
	const db = app.locals.db;
	const cycleId = randomUUID();
	const requestId = randomUUID();
	const snapshotId = randomUUID();
	const revisionIds = Array.from({ length: 23 }, () => randomUUID());
	db.prepare("INSERT INTO requests VALUES (?,?,?)").run(
		requestId,
		"owner-one",
		"2026-09-12",
	);
	db.prepare("INSERT INTO source_snapshots VALUES (?,?,?,?,?,?,?)").run(
		snapshotId,
		requestId,
		JSON.stringify(completeStandard),
		"1",
		"digest",
		"owner-one",
		"2026-09-12",
	);
	db.prepare(
		"INSERT INTO cycles (id,request_id,creation_reason,status,version,snapshot_id,created_at) VALUES (?,?,?,'NeedsReview',1,?,?)",
	).run(cycleId, requestId, "initial", snapshotId, "2026-09-12");
	for (let i = 0; i < 25; i++)
		db.prepare("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)").run(
			randomUUID(),
			requestId,
			cycleId,
			"draft_saved",
			"owner-one",
			"{}",
			null,
			new Date(i).toISOString(),
		);
	for (const [i, id] of revisionIds.entries()) {
		db.prepare("INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
			id,
			cycleId,
			snapshotId,
			i + 1,
			revisionIds[i - 1] ?? null,
			"human",
			null,
			"reviewer",
			JSON.stringify(compose(completeStandard)),
			"digest",
			new Date(25 + i).toISOString(),
		);
		db.prepare("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)").run(
			randomUUID(),
			requestId,
			cycleId,
			"revision_saved",
			"reviewer",
			JSON.stringify({ revision_id: id }),
			null,
			new Date(25 + i).toISOString(),
		);
	}
	db.prepare("UPDATE cycles SET current_revision_id=? WHERE id=?").run(
		revisionIds.at(-1),
		cycleId,
	);
	const login = async (actor = "contributor") => {
		const session = await request(app)
			.post("/api/v1/demo-session")
			.set("Host", "localhost:3001")
			.set("Origin", "http://localhost:5173")
			.send({ actor });
		assert.equal(session.status, 201);
		return (path: string) =>
			request(app)
				.get(`/api/v1${path}`)
				.set("Host", "localhost:3001")
				.set("Cookie", session.headers["set-cookie"][0].split(";")[0]);
	};
	return { app, actorIds, cycleId, revisionIds, login };
}

test("revision pagination and independent content reads remain complete beyond twenty audit events", async () => {
	const h = fixture();
	try {
		const read = await h.login("reviewer");
		const path = `/cycles/${h.cycleId}`;
		const firstAudit = (await read(`${path}/history`)).body;
		assert.equal(firstAudit.events.length, 20);
		assert.deepEqual(firstAudit.revisions, []);
		const first = (await read(`${path}/revisions`)).body;
		assert.equal(first.revisions.length, 20);
		assert.ok(first.revisions.every((row: object) => !("content" in row)));
		const last = (await read(`${path}/revisions?cursor=${first.next_cursor}`))
			.body;
		assert.equal(last.revisions.length, 3);
		assert.equal(last.next_cursor, null);
		assert.deepEqual(
			[...first.revisions, ...last.revisions].map(
				(row: { id: string }) => row.id,
			),
			h.revisionIds,
		);
		for (const id of [h.revisionIds[0], h.revisionIds.at(-1)]) {
			const loaded = await read(`${path}/revisions/${id}`);
			assert.equal(loaded.status, 200);
			assert.equal(loaded.body.revision.id, id);
			assert.ok(loaded.body.revision.content.announcement_body);
		}
		assert.equal(
			(await read(path)).body.current_revision.id,
			h.revisionIds.at(-1),
		);
		const historicalIds: string[] = [];
		let cursor: string | null = null;
		do {
			const page: {
				revisions: { id: string }[];
				events: { related_ids: Record<string, string> }[];
				next_cursor: string | null;
			} = (await read(`${path}/history${cursor ? `?cursor=${cursor}` : ""}`))
				.body;
			const referenced = new Set(
				page.events.flatMap((event: { related_ids: object }) =>
					Object.values(event.related_ids),
				),
			);
			for (const revision of page.revisions) {
				assert.ok(referenced.has(revision.id));
				historicalIds.push(revision.id);
			}
			cursor = page.next_cursor;
		} while (cursor);
		assert.deepEqual(new Set(historicalIds), new Set(h.revisionIds));
		assert.equal(
			(await read(`${path}/revisions?limit=50`)).body.revisions.length,
			23,
		);
		for (const query of ["limit=0", "limit=51", "cursor=invalid"])
			assert.equal((await read(`${path}/revisions?${query}`)).status, 400);
	} finally {
		h.app.locals.close();
	}
});

test("revision reads enforce request ownership and nested cycle membership", async () => {
	const h = fixture();
	try {
		const owner = await h.login();
		const otherCycleId = randomUUID();
		h.app.locals.db
			.prepare(
				"INSERT INTO cycles (id,request_id,creation_reason,status,version,created_at) SELECT ?,request_id,'initial','Draft',1,created_at FROM cycles WHERE id=?",
			)
			.run(otherCycleId, h.cycleId);
		assert.equal(
			(await owner(`/cycles/${otherCycleId}/revisions/${h.revisionIds[0]}`))
				.status,
			404,
		);
		assert.equal(
			(await owner(`/cycles/${h.cycleId}/revisions/${randomUUID()}`)).status,
			404,
		);
		assert.equal(
			(await owner(`/cycles/${h.cycleId}/revisions/${h.revisionIds[0]}`))
				.status,
			200,
		);
		h.actorIds.contributor = "owner-two";
		for (const read of [await h.login(), await h.login("administrator")])
			for (const path of [
				`/cycles/${h.cycleId}/revisions`,
				`/cycles/${h.cycleId}/revisions/${h.revisionIds[0]}`,
			])
				assert.equal((await read(path)).status, 404);
	} finally {
		h.app.locals.close();
	}
});
