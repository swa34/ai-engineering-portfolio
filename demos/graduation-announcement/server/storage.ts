import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string) {
	let db: Database.Database | undefined;
	try {
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
		db = new Database(path);
		const tables = db
			.prepare(
				"SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",
			)
			.all() as { name: string }[];
		if (tables.length) {
			if (!tables.some((table) => table.name === "migrations"))
				throw new Error("Unsupported schema");
			const columns = db.pragma("table_info(migrations)") as {
				name: string;
				type: string;
				pk: number;
			}[];
			const versions = db.prepare("SELECT version FROM migrations").all() as {
				version: unknown;
			}[];
			if (
				columns.length !== 1 ||
				columns[0].name !== "version" ||
				columns[0].type !== "INTEGER" ||
				columns[0].pk !== 1 ||
				versions.length !== 1 ||
				versions[0].version !== 1
			)
				throw new Error("Unsupported schema");
		}
		db.pragma("foreign_keys = ON");
		db.pragma("busy_timeout = 2000");
		db.pragma("journal_mode = DELETE");
		if (!tables.length)
			db.transaction(() =>
				db!.exec(`
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO migrations VALUES (1);
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, contributor_actor_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_snapshots (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id), source TEXT NOT NULL,
      schema_version TEXT NOT NULL, digest TEXT NOT NULL, submitted_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cycles (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id),
      predecessor_cycle_id TEXT REFERENCES cycles(id), creation_reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Draft','Submitted','Generating','NeedsReview','ChangesRequested','Rejected','Approved','ReadyForPublication')),
      version INTEGER NOT NULL CHECK(version > 0), draft TEXT,
      snapshot_id TEXT REFERENCES source_snapshots(id), current_revision_id TEXT REFERENCES revisions(id),
      active_attempt_id TEXT REFERENCES generation_attempts(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS consent_withdrawals (
      id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL UNIQUE REFERENCES source_snapshots(id), actor TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_attempts (
      id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES cycles(id), snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
      reserved_cycle_version INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed','discarded')),
      failure_code TEXT, started_at TEXT NOT NULL, deadline_at TEXT NOT NULL, completed_at TEXT,
      fixture_mode TEXT NOT NULL, revision_id TEXT REFERENCES revisions(id), discard_recorded INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_attempt ON generation_attempts(cycle_id) WHERE state = 'running';
    CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES cycles(id), snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
      sequence INTEGER NOT NULL, parent_revision_id TEXT REFERENCES revisions(id), origin TEXT NOT NULL,
      attempt_id TEXT UNIQUE REFERENCES generation_attempts(id), author_actor TEXT, content TEXT NOT NULL,
      digest TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(cycle_id, sequence)
    );
    CREATE TABLE IF NOT EXISTS validation_runs (
      id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id), snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
      validator_version TEXT NOT NULL, content_digest TEXT NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pass','fail')), findings TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL UNIQUE REFERENCES cycles(id), revision_id TEXT NOT NULL REFERENCES revisions(id),
      snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id), validation_run_id TEXT NOT NULL REFERENCES validation_runs(id),
      content_digest TEXT NOT NULL, reviewer_actor TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_decisions (
      id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES cycles(id), revision_id TEXT NOT NULL REFERENCES revisions(id),
      reviewer_actor TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT, approval_id TEXT REFERENCES approvals(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES approvals(id), template_version TEXT NOT NULL,
      text TEXT NOT NULL, digest TEXT NOT NULL, creator TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(approval_id,template_version)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY, request_id TEXT REFERENCES requests(id), cycle_id TEXT REFERENCES cycles(id),
      event_type TEXT NOT NULL, actor TEXT NOT NULL, related_ids TEXT NOT NULL, safe_code TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mutation_receipts (
      session_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, method_path TEXT NOT NULL, input_digest TEXT NOT NULL,
      outcome TEXT NOT NULL, http_status INTEGER NOT NULL, PRIMARY KEY(session_id,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO settings VALUES ('scenario','normal');
  `),
			)();
		return db;
	} catch {
		if (db?.open) db.close();
		throw new Error(
			"The demo database could not be opened with schema version 1. Preserve the existing file, then use a compatible app version or set DATABASE_PATH to a new file for a fresh fictional demo.",
		);
	}
}

export type DemoDatabase = ReturnType<typeof openDatabase>;
