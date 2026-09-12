import express, {
	type Request,
	type Response,
	type NextFunction,
} from "express";
import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import { rmSync } from "node:fs";
import { z } from "zod";
import { openDatabase } from "./storage.js";
import {
	SourceInputSchema,
	DraftSourceSchema,
	CandidateOutputSchema,
	compose,
	validateCandidate,
	screen,
	emptyDraft,
	type SourceInput,
	type CandidateOutput,
	type Finding,
} from "../shared/contracts.js";

type Row = Record<string, any>;
type Role = "contributor" | "reviewer" | "administrator";
type Session = {
	id: string;
	role: Role;
	actorId: string;
	csrf: string;
	created: number;
	touched: number;
	reads: number[];
	mutations: number[];
};
type Outcome = { status: number; body?: Row; headers?: Record<string, string> };
export type ProviderInput = Omit<
	SourceInput,
	"consent" | "fictional_data_acknowledged"
> & { attempt_id: string; schema_version: "1" };
export type AppOptions = {
	databasePath?: string;
	origin?: string;
	allowedHosts?: string[];
	mockDelayMs?: number;
	deadlineMs?: number;
	now?: () => number;
	rateLimits?: boolean;
	auditHook?: (event: string) => void;
	provider?: (
		source: ProviderInput,
		scenario: string,
	) => unknown | Promise<unknown>;
	actorIds?: Partial<Record<Role, string>>;
	validatorVersion?: string | (() => string);
	validator?: (source: SourceInput, content: CandidateOutput) => Finding[];
};
class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public fields?: Row[],
		public retryAfter?: number,
	) {
		super(message);
	}
}
const fail = (status: number, code: string, message: string): never => {
	throw new ApiError(status, code, message);
};
const LABEL = "Local demo — roles are simulated, not verified identities";
const FICTIONAL = "FICTIONAL DEMONSTRATION — NOT FOR REAL DISTRIBUTION";
const uuid = z.uuid();
const version = z.number().int().positive();
const versionBody = z.strictObject({ expected_cycle_version: version });
const emptyBody = z.strictObject({});
const scenarios = z.enum([
	"normal",
	"timeout",
	"malformed",
	"altered_program",
	"invented_honor",
	"unsupported_quote",
	"narrative_invention",
	"inappropriate_tone",
]);

export function canonicalJSON(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonicalJSON((value as Record<string, unknown>)[key])}`,
			)
			.join(",")}}`;
	return JSON.stringify(value);
}
const digest = (value: unknown) =>
	createHash("sha256").update(canonicalJSON(value)).digest("hex");
const equal = (a: string, b: string) => {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
};

export function createApp(options: AppOptions = {}) {
	const app = express();
	app.disable("x-powered-by");
	const databasePath = options.databasePath ?? "data/demo.sqlite";
	const origin = options.origin ?? "http://localhost:5173";
	const allowedHosts = options.allowedHosts ?? [
		new URL(origin).host,
		"localhost:3001",
		"127.0.0.1:3001",
	];
	const now = options.now ?? Date.now;
	const validator = options.validator ?? validateCandidate;
	const validatorVersion = () =>
		typeof options.validatorVersion === "function"
			? options.validatorVersion()
			: (options.validatorVersion ?? "1");
	const iso = () => new Date(now()).toISOString();
	let db = openDatabase(databasePath);
	let dataset = randomUUID();
	let unavailable = false;
	const sessions = new Map<string, Session>();
	const sessionCreations = new Map<string, number[]>();
	const workers = new Map<string, ReturnType<typeof setTimeout>>();
	const get = (sql: string, ...params: any[]): Row | undefined =>
		db.prepare(sql).get(...params) as Row | undefined;
	const all = (sql: string, ...params: any[]): Row[] =>
		db.prepare(sql).all(...params) as Row[];
	const run = (sql: string, ...params: any[]) => db.prepare(sql).run(...params);
	const count = (table: string) =>
		Number(get(`SELECT count(*) AS count FROM ${table}`)!.count);
	const transact = <T>(fn: () => T): T => db.transaction(fn).immediate();
	const consent = (snapshotId: string | null) => {
		if (
			snapshotId &&
			get("SELECT id FROM consent_withdrawals WHERE snapshot_id=?", snapshotId)
		)
			fail(
				403,
				"CONSENT_WITHDRAWN",
				"Consent was withdrawn for this source. Create and submit a correction to continue.",
			);
	};
	const admission = (kind?: "requests" | "cycles" | "revisions") => {
		const cap = { requests: 50, cycles: 200, revisions: 1000 };
		if (
			count("audit_events") >= 10000 ||
			(kind &&
				count(kind) +
					(kind === "revisions"
						? Number(
								get(
									"SELECT count(*) AS count FROM generation_attempts WHERE state='running'",
								)!.count,
							)
						: 0) >=
					cap[kind])
		)
			fail(
				409,
				"DATASET_LIMIT",
				"The fictional dataset limit has been reached. An administrator can reset it.",
			);
	};
	const event = (
		type: string,
		actor: string,
		cycle?: Row,
		related: Row = {},
		code: string | null = null,
	) => {
		options.auditHook?.(type);
		run(
			"INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)",
			randomUUID(),
			cycle?.request_id ?? null,
			cycle?.id ?? null,
			type,
			actor,
			JSON.stringify(related),
			code,
			iso(),
		);
	};
	const cycleMeta = (cycle: Row) => {
		const { draft, ...metadata } = cycle;
		return metadata;
	};
	const source = (snapshotId: string): SourceInput =>
		JSON.parse(
			get("SELECT source FROM source_snapshots WHERE id=?", snapshotId)!.source,
		);
	const role = (session: Session, expected: Role) => {
		if (session.role !== expected)
			fail(
				403,
				"FORBIDDEN_ROLE",
				"This action is unavailable for the selected simulated role.",
			);
	};
	const accessRequest = (id: string, session: Session) => {
		const request = get("SELECT * FROM requests WHERE id=?", id);
		if (
			!request ||
			session.role === "administrator" ||
			(session.role === "contributor" &&
				request.contributor_actor_id !== session.actorId)
		)
			fail(404, "NOT_FOUND", "The requested record is unavailable.");
		return request!;
	};
	const accessCycle = (id: string, session: Session) => {
		const cycle = get("SELECT * FROM cycles WHERE id=?", id);
		if (!cycle) fail(404, "NOT_FOUND", "The requested record is unavailable.");
		accessRequest(cycle!.request_id, session);
		return cycle!;
	};
	const checkVersion = (cycle: Row, expected: number) => {
		if (cycle.version !== expected)
			fail(
				409,
				"STALE_VERSION",
				"This cycle changed. Refresh and compare your unsaved work before trying again.",
			);
	};
	const state = (cycle: Row, ...statuses: string[]) => {
		if (!statuses.includes(cycle.status))
			fail(
				409,
				"WRONG_STATE",
				"This action is unavailable in the current cycle state.",
			);
	};
	const revisionGuard = (cycle: Row, revisionId: string) => {
		if (cycle.current_revision_id !== revisionId)
			fail(
				409,
				"STALE_REVISION",
				"The current revision changed. Refresh before making a decision.",
			);
	};
	const parse = <T>(schema: z.ZodType<T>, body: unknown, status = 400): T => {
		const result = schema.safeParse(body ?? {});
		if (!result.success)
			throw new ApiError(
				status,
				status === 422 ? "VALIDATION_FAILED" : "INVALID_REQUEST",
				"The supplied fields do not match the required format.",
				result.error.issues.map((issue) => ({
					path: issue.path.join("."),
					code: issue.code,
				})),
			);
		return result.data;
	};
	const screenInput = (input: unknown, instructions = false) => {
		const findings = screen(input, { instructions });
		if (findings.length)
			throw new ApiError(
				422,
				findings[0].code,
				"Remove sensitive or instruction-like text before continuing.",
				findings.map((finding) => ({ path: finding.path, code: finding.code })),
			);
	};
	const decodeRevision = (revision?: Row) =>
		revision ? { ...revision, content: JSON.parse(revision.content) } : null;
	const attemptSafe = (attempt?: Row) =>
		attempt
			? {
					id: attempt.id,
					attempt_id: attempt.id,
					cycle_id: attempt.cycle_id,
					state: attempt.state,
					failure_code: attempt.failure_code,
					started_at: attempt.started_at,
					deadline_at: attempt.deadline_at,
					completed_at: attempt.completed_at,
					revision_id: attempt.revision_id,
					provider_mode: "mock",
				}
			: null;
	const detail = (cycle: Row) => {
		const snapshot = cycle.snapshot_id
			? get("SELECT * FROM source_snapshots WHERE id=?", cycle.snapshot_id)
			: undefined;
		const revision = cycle.current_revision_id
			? get("SELECT * FROM revisions WHERE id=?", cycle.current_revision_id)
			: undefined;
		const validation = revision
			? get(
					"SELECT * FROM validation_runs WHERE revision_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
					revision.id,
				)
			: undefined;
		const draft = cycle.draft ? JSON.parse(cycle.draft) : null;
		return {
			cycle: { ...cycleMeta(cycle), draft, draft_source: draft },
			snapshot: snapshot
				? {
						...snapshot,
						source: JSON.parse(snapshot.source),
						withdrawn: Boolean(
							get(
								"SELECT id FROM consent_withdrawals WHERE snapshot_id=?",
								snapshot.id,
							),
						),
					}
				: null,
			current_revision: decodeRevision(revision),
			findings: validation ? JSON.parse(validation.findings) : [],
			validation: validation
				? { ...validation, findings: JSON.parse(validation.findings) }
				: null,
			approval:
				get("SELECT * FROM approvals WHERE cycle_id=?", cycle.id) ?? null,
			active_attempt: attemptSafe(
				cycle.active_attempt_id
					? get(
							"SELECT * FROM generation_attempts WHERE id=?",
							cycle.active_attempt_id,
						)
					: undefined,
			),
			provider_mode: "mock",
		};
	};
	const validate = (cycle: Row, revision: Row) => {
		const findings = validator(
			source(cycle.snapshot_id),
			JSON.parse(revision.content),
		);
		const validation = {
			id: randomUUID(),
			revision_id: revision.id,
			snapshot_id: cycle.snapshot_id,
			validator_version: validatorVersion(),
			content_digest: revision.digest,
			created_at: iso(),
			status: findings.some((f) => f.severity === "blocking") ? "fail" : "pass",
			findings,
		};
		run(
			"INSERT INTO validation_runs VALUES (?,?,?,?,?,?,?,?)",
			validation.id,
			revision.id,
			cycle.snapshot_id,
			validation.validator_version,
			revision.digest,
			validation.created_at,
			validation.status,
			JSON.stringify(findings),
		);
		return validation;
	};
	const saveRevision = (
		cycle: Row,
		content: CandidateOutput,
		origin: "mock" | "human",
		author: string | null,
		attemptId: string | null,
	) => {
		const id = randomUUID();
		const sequence = Number(
			get(
				"SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM revisions WHERE cycle_id=?",
				cycle.id,
			)!.sequence,
		);
		run(
			"INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?,?,?)",
			id,
			cycle.id,
			cycle.snapshot_id,
			sequence,
			cycle.current_revision_id,
			origin,
			attemptId,
			author,
			JSON.stringify(content),
			digest(content),
			iso(),
		);
		const revision = get("SELECT * FROM revisions WHERE id=?", id)!;
		return { revision, validation: validate(cycle, revision) };
	};
	const failAttempt = (attempt: Row, code: string) => {
		if (attempt.state !== "running") return;
		const cycle = get("SELECT * FROM cycles WHERE id=?", attempt.cycle_id)!;
		run(
			"UPDATE generation_attempts SET state='failed',failure_code=?,completed_at=? WHERE id=?",
			code,
			iso(),
			attempt.id,
		);
		if (cycle.active_attempt_id === attempt.id)
			run(
				"UPDATE cycles SET status='Submitted',active_attempt_id=NULL,version=version+1 WHERE id=?",
				cycle.id,
			);
		event(
			"generation_failed",
			"system",
			cycle,
			{ attempt_id: attempt.id },
			code,
		);
	};
	transact(() => {
		for (const attempt of all(
			"SELECT * FROM generation_attempts WHERE state='running'",
		))
			failAttempt(attempt, "PROCESS_INTERRUPTED");
	});

	const mock = (input: ProviderInput, scenario: string): unknown => {
		const content = compose(input);
		if (scenario === "malformed") return { broken: true };
		if (scenario === "altered_program")
			content.facts_used.program = "Fictional Astronomy";
		if (scenario === "invented_honor")
			content.facts_used.honors = ["Invented Demonstration Award"];
		if (scenario === "unsupported_quote")
			content.facts_used.quote = "This statement was never submitted.";
		if (scenario === "narrative_invention")
			content.announcement_body +=
				"\n\nThe graduate won an international award.";
		if (scenario === "inappropriate_tone")
			content.template_id =
				input.preferences.tone === "warm" ? "professional-v1" : "warm-v1";
		return content;
	};
	const complete = (
		attemptId: string,
		capturedDataset: string,
		payload: unknown,
		failure?: string,
	) => {
		if (capturedDataset !== dataset || unavailable) return;
		try {
			transact(() => {
				const attempt = get(
					"SELECT * FROM generation_attempts WHERE id=?",
					attemptId,
				);
				if (!attempt) return;
				const cycle = get("SELECT * FROM cycles WHERE id=?", attempt.cycle_id)!;
				if (
					attempt.state !== "running" ||
					cycle.active_attempt_id !== attempt.id ||
					cycle.snapshot_id !== attempt.snapshot_id ||
					cycle.version !== attempt.reserved_cycle_version
				) {
					if (!attempt.discard_recorded) {
						event(
							"generation_discarded",
							"system",
							cycle,
							{ attempt_id: attempt.id },
							"LATE_RESULT",
						);
						run(
							"UPDATE generation_attempts SET discard_recorded=1 WHERE id=?",
							attempt.id,
						);
					}
					return;
				}
				if (Date.parse(attempt.deadline_at) <= now()) {
					failAttempt(attempt, "TIMEOUT");
					return;
				}
				if (
					get(
						"SELECT id FROM consent_withdrawals WHERE snapshot_id=?",
						cycle.snapshot_id,
					)
				) {
					failAttempt(attempt, "CONSENT_WITHDRAWN");
					return;
				}
				if (failure) {
					failAttempt(attempt, failure);
					return;
				}
				let parsed: CandidateOutput;
				try {
					const serialized =
						typeof payload === "string" ? payload : JSON.stringify(payload);
					if (!serialized || Buffer.byteLength(serialized, "utf8") > 96 * 1024)
						throw new Error("size");
					parsed = CandidateOutputSchema.parse(
						typeof payload === "string" ? JSON.parse(payload) : payload,
					);
				} catch {
					failAttempt(attempt, "MALFORMED_OUTPUT");
					return;
				}
				if (screen(parsed).length) {
					failAttempt(attempt, "SENSITIVE_CONTENT");
					return;
				}
				const { revision } = saveRevision(
					cycle,
					parsed,
					"mock",
					null,
					attempt.id,
				);
				run(
					"UPDATE generation_attempts SET state='succeeded',revision_id=?,completed_at=? WHERE id=?",
					revision.id,
					iso(),
					attempt.id,
				);
				run(
					"UPDATE cycles SET status='NeedsReview',current_revision_id=?,active_attempt_id=NULL,version=version+1 WHERE id=?",
					revision.id,
					cycle.id,
				);
				event("generation_completed", "system", cycle, {
					attempt_id: attempt.id,
					revision_id: revision.id,
				});
			});
		} catch {
			/* No result is published on failed persistence; the deadline sweep settles the attempt. */
		}
	};
	const startWorker = (attemptId: string) => {
		const capturedDataset = dataset;
		const timer = setTimeout(async () => {
			workers.delete(attemptId);
			if (capturedDataset !== dataset || unavailable) return;
			const attempt = get(
				"SELECT * FROM generation_attempts WHERE id=?",
				attemptId,
			);
			if (
				!attempt ||
				attempt.state !== "running" ||
				attempt.fixture_mode === "timeout"
			)
				return;
			const {
				consent: _consent,
				fictional_data_acknowledged: _acknowledgment,
				...facts
			} = source(attempt.snapshot_id);
			try {
				const payload = await (options.provider ?? mock)(
					{ ...facts, attempt_id: attempt.id, schema_version: "1" },
					attempt.fixture_mode,
				);
				complete(attemptId, capturedDataset, payload);
			} catch {
				complete(attemptId, capturedDataset, null, "PROVIDER_FAILURE");
			}
		}, options.mockDelayMs ?? 250);
		timer.unref();
		workers.set(attemptId, timer);
	};
	const sweep = setInterval(() => {
		if (unavailable) return;
		try {
			transact(() => {
				for (const attempt of all(
					"SELECT * FROM generation_attempts WHERE state='running' AND deadline_at<=?",
					iso(),
				))
					failAttempt(attempt, "TIMEOUT");
			});
		} catch {
			/* Retry the transaction on the next sweep. */
		}
	}, 1000);
	sweep.unref();

	const cookieId = (req: Request) =>
		req.headers.cookie
			?.split(";")
			.map((s) => s.trim())
			.find((s) => s.startsWith("demo_session="))
			?.slice("demo_session=".length);
	const sessionFor = (req: Request): Session => {
		const id = cookieId(req);
		const session = id ? sessions.get(id) : undefined;
		if (
			!session ||
			now() - session.touched >= 30 * 60_000 ||
			now() - session.created >= 8 * 60 * 60_000
		) {
			if (id) sessions.delete(id);
			fail(401, "SESSION_REQUIRED", "Select a simulated role to continue.");
		}
		session!.touched = now();
		return session!;
	};
	const limit = (timestamps: number[], max: number) => {
		while (timestamps.length && timestamps[0] <= now() - 60_000)
			timestamps.shift();
		if (options.rateLimits !== false && timestamps.length >= max)
			throw new ApiError(
				429,
				"RATE_LIMITED",
				"Pause before making more requests.",
				undefined,
				Math.max(1, Math.ceil((timestamps[0] + 60_000 - now()) / 1000)),
			);
		timestamps.push(now());
	};
	const csrf = (req: Request, session: Session) => {
		if (
			!req.get("X-CSRF-Token") ||
			!equal(req.get("X-CSRF-Token")!, session.csrf)
		)
			fail(
				403,
				"CSRF_FAILED",
				"The session security token is missing or invalid.",
			);
		if (!uuid.safeParse(req.get("Idempotency-Key")).success)
			fail(
				400,
				"IDEMPOTENCY_REQUIRED",
				"A UUID Idempotency-Key header is required.",
			);
	};
	app.use((req, res, next) => {
		res.locals.requestId = randomUUID();
		res.set({
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
			"Content-Security-Policy":
				"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
		});
		if (!allowedHosts.includes(req.get("Host") ?? ""))
			return next(
				new ApiError(
					403,
					"HOST_REJECTED",
					"This local demo accepts only its configured host.",
				),
			);
		next();
	});
	app.use("/api/v1", (req, res, next) => {
		try {
			if (unavailable)
				fail(
					503,
					"STORAGE_UNAVAILABLE",
					"Storage recovery is required. Restart the local application.",
				);
			const mutation = !["GET", "HEAD"].includes(req.method);
			const initialSession =
				req.method === "POST" && req.path === "/demo-session" && !cookieId(req);
			if (!initialSession) {
				const session = sessionFor(req);
				res.locals.session = session;
				limit(
					mutation ? session.mutations : session.reads,
					mutation ? 20 : 240,
				);
			}
			if (mutation) {
				if (req.get("Origin") !== origin)
					fail(
						403,
						"ORIGIN_REJECTED",
						"Requests must originate from the configured local demo.",
					);
				if (res.locals.session) csrf(req, res.locals.session);
				if (!req.is("application/json"))
					fail(
						415,
						"UNSUPPORTED_MEDIA_TYPE",
						"Use application/json for this request.",
					);
			}
			next();
		} catch (error) {
			next(error);
		}
	});
	app.use("/api/v1", express.json({ limit: 128 * 1024, strict: true }));
	const api = express.Router();
	app.use("/api/v1", api);
	const sessionView = (session: Session) => ({
		actor: session.actorId,
		role: session.role,
		csrf_token: session.csrf,
		demo_label: LABEL,
		provider_mode: "mock",
	});
	const sendOutcome = (res: Response, result: Outcome) => {
		if (result.headers) res.set(result.headers);
		if (result.status === 204) res.status(204).end();
		else res.status(result.status).json(result.body);
	};
	const terminalKeyGuard = (req: Request, session?: Session) => {
		if (
			session &&
			get(
				"SELECT session_id FROM mutation_receipts WHERE session_id=? AND idempotency_key=?",
				session.id,
				req.get("Idempotency-Key"),
			)
		)
			fail(
				409,
				"IDEMPOTENCY_CONFLICT",
				"This idempotency key was already used for a different request.",
			);
	};
	const mutation = (
		req: Request,
		res: Response,
		fn: (session: Session) => Outcome,
		beforeReplay?: (session: Session) => void,
	) => {
		const session = res.locals.session as Session;
		const key = req.get("Idempotency-Key")!;
		const methodPath = `${req.method} ${req.originalUrl}`;
		const inputDigest = digest(req.body ?? {});
		const result = transact(() => {
			beforeReplay?.(session);
			const receipt = get(
				"SELECT * FROM mutation_receipts WHERE session_id=? AND idempotency_key=?",
				session.id,
				key,
			);
			if (receipt) {
				if (
					receipt.method_path !== methodPath ||
					receipt.input_digest !== inputDigest
				)
					fail(
						409,
						"IDEMPOTENCY_CONFLICT",
						"This idempotency key was already used for a different request.",
					);
				return {
					status: receipt.http_status,
					...JSON.parse(receipt.outcome),
				} as Outcome;
			}
			const outcome = fn(session);
			run(
				"INSERT INTO mutation_receipts VALUES (?,?,?,?,?,?)",
				session.id,
				key,
				methodPath,
				inputDigest,
				JSON.stringify({ body: outcome.body, headers: outcome.headers }),
				outcome.status,
			);
			return outcome;
		});
		sendOutcome(res, result);
	};
	const cycleAccess =
		(req: Request, protectedConsent = false) =>
		(session: Session) => {
			const cycle = accessCycle(String(req.params.cycleId), session);
			if (protectedConsent) consent(cycle.snapshot_id);
		};
	const readPage = (req: Request) => {
		const size = req.query.limit === undefined ? 20 : Number(req.query.limit);
		if (!Number.isInteger(size) || size < 1 || size > 50)
			fail(400, "INVALID_REQUEST", "Page size must be between 1 and 50.");
		let offset = 0;
		if (req.query.cursor !== undefined) {
			try {
				const parsed = JSON.parse(
					Buffer.from(String(req.query.cursor), "base64url").toString(),
				);
				if (!Number.isSafeInteger(parsed.offset) || parsed.offset < 0)
					throw new Error();
				offset = parsed.offset;
			} catch {
				fail(400, "INVALID_REQUEST", "The page cursor is invalid.");
			}
		}
		return {
			size,
			offset,
			next: (hasMore: boolean) =>
				hasMore
					? Buffer.from(JSON.stringify({ offset: offset + size })).toString(
							"base64url",
						)
					: null,
		};
	};
	api.post("/demo-session", (req, res) => {
		const body = parse(
			z.strictObject({
				actor: z.enum(["contributor", "reviewer", "administrator"]),
			}),
			req.body,
		);
		const client = req.socket.remoteAddress ?? "loopback";
		const timestamps = sessionCreations.get(client) ?? [];
		limit(timestamps, 10);
		sessionCreations.set(client, timestamps);
		const old = res.locals.session as Session | undefined;
		terminalKeyGuard(req, old);
		const session: Session = {
			id: randomBytes(32).toString("hex"),
			csrf: randomBytes(32).toString("hex"),
			role: body.actor,
			actorId: options.actorIds?.[body.actor] ?? body.actor,
			created: now(),
			touched: now(),
			reads: [],
			mutations: [],
		};
		if (old) sessions.delete(old.id);
		sessions.set(session.id, session);
		res.cookie("demo_session", session.id, {
			httpOnly: true,
			sameSite: "strict",
			path: "/",
			secure: new URL(origin).protocol === "https:",
		});
		res.status(201).json(sessionView(session));
	});
	api.get("/session", (_req, res) => res.json(sessionView(res.locals.session)));
	api.delete("/session", (req, res) => {
		parse(emptyBody, req.body);
		terminalKeyGuard(req, res.locals.session);
		sessions.delete(res.locals.session.id);
		res
			.clearCookie("demo_session", {
				path: "/",
				httpOnly: true,
				sameSite: "strict",
			})
			.status(204)
			.end();
	});
	api.post("/requests", (req, res) => {
		parse(emptyBody, req.body);
		mutation(req, res, (session) => {
			role(session, "contributor");
			admission("requests");
			admission("cycles");
			const request = {
				id: randomUUID(),
				contributor_actor_id: session.actorId,
				created_at: iso(),
			};
			run(
				"INSERT INTO requests VALUES (?,?,?)",
				request.id,
				request.contributor_actor_id,
				request.created_at,
			);
			const id = randomUUID();
			run(
				"INSERT INTO cycles VALUES (?,?,NULL,'initial','Draft',1,?,NULL,NULL,NULL,?)",
				id,
				request.id,
				JSON.stringify(emptyDraft()),
				iso(),
			);
			const cycle = get("SELECT * FROM cycles WHERE id=?", id)!;
			event("request_created", session.actorId, cycle);
			return { status: 201, body: { request, cycle: cycleMeta(cycle) } };
		});
	});
	api.get("/requests", (req, res) => {
		const session = res.locals.session as Session;
		if (session.role === "administrator")
			fail(
				403,
				"FORBIDDEN_ROLE",
				"The administrator cannot read request content.",
			);
		const page = readPage(req);
		const rows =
			session.role === "contributor"
				? all(
						"SELECT * FROM requests WHERE contributor_actor_id=? ORDER BY created_at,id LIMIT ? OFFSET ?",
						session.actorId,
						page.size + 1,
						page.offset,
					)
				: all(
						"SELECT * FROM requests ORDER BY created_at,id LIMIT ? OFFSET ?",
						page.size + 1,
						page.offset,
					);
		res.json({
			requests: rows
				.slice(0, page.size)
				.map((request) => ({
					...request,
					cycles: all(
						"SELECT * FROM cycles WHERE request_id=? ORDER BY created_at,id",
						request.id,
					).map((cycle) => ({
						...cycleMeta(cycle),
						withdrawn: cycle.snapshot_id
							? Boolean(
									get(
										"SELECT id FROM consent_withdrawals WHERE snapshot_id=?",
										cycle.snapshot_id,
									),
								)
							: false,
						approval_id:
							get("SELECT id FROM approvals WHERE cycle_id=?", cycle.id)?.id ??
							null,
						validation_status: cycle.current_revision_id
							? (get(
									"SELECT status FROM validation_runs WHERE revision_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
									cycle.current_revision_id,
								)?.status ?? null)
							: null,
						provider_mode: "mock",
					})),
				})),
			next_cursor: page.next(rows.length > page.size),
		});
	});
	api.get("/requests/:requestId", (req, res) => {
		const request = accessRequest(
			String(req.params.requestId),
			res.locals.session,
		);
		res.json({
			request,
			cycles: all(
				"SELECT * FROM cycles WHERE request_id=? ORDER BY created_at,id",
				request.id,
			).map((cycle) => ({
				...cycleMeta(cycle),
				withdrawn: cycle.snapshot_id
					? Boolean(
							get(
								"SELECT id FROM consent_withdrawals WHERE snapshot_id=?",
								cycle.snapshot_id,
							),
						)
					: false,
			})),
		});
	});
	api.get("/cycles/:cycleId", (req, res) =>
		res.json(
			detail(accessCycle(String(req.params.cycleId), res.locals.session)),
		),
	);
	api.get("/cycles/:cycleId/history", (req, res) => {
		const cycle = accessCycle(String(req.params.cycleId), res.locals.session);
		const page = readPage(req);
		const events = all(
			"SELECT * FROM audit_events WHERE cycle_id=? ORDER BY created_at,id LIMIT ? OFFSET ?",
			cycle.id,
			page.size + 1,
			page.offset,
		);
		const selected = events
			.slice(0, page.size)
			.map((event) => ({
				...event,
				related_ids: JSON.parse(event.related_ids),
			}));
		const ids = new Set(
			selected.flatMap((event) => Object.values(event.related_ids)),
		);
		res.json({
			revisions: all(
				"SELECT * FROM revisions WHERE cycle_id=? ORDER BY sequence",
				cycle.id,
			)
				.filter((row) => ids.has(row.id))
				.map(decodeRevision),
			decisions: all(
				"SELECT * FROM review_decisions WHERE cycle_id=? ORDER BY created_at,id",
				cycle.id,
			).filter((row) => ids.has(row.id)),
			attempts: all(
				"SELECT * FROM generation_attempts WHERE cycle_id=? ORDER BY started_at,id",
				cycle.id,
			)
				.filter((row) => ids.has(row.id))
				.map(attemptSafe),
			events: selected,
			next_cursor: page.next(events.length > page.size),
		});
	});
	api.put("/cycles/:cycleId/draft", (req, res) => {
		const wrapper = parse(
			z.strictObject({ expected_cycle_version: version, source: z.unknown() }),
			req.body,
		);
		mutation(
			req,
			res,
			(session) => {
				role(session, "contributor");
				const cycle = accessCycle(String(req.params.cycleId), session);
				checkVersion(cycle, wrapper.expected_cycle_version);
				state(cycle, "Draft");
				admission();
				const draft = parse(DraftSourceSchema, wrapper.source, 422);
				screenInput(draft, true);
				if (!draft.fictional_data_acknowledged)
					fail(
						422,
						"FICTIONAL_ACKNOWLEDGMENT_REQUIRED",
						"Acknowledge that the submitted information is fictional.",
					);
				run(
					"UPDATE cycles SET draft=?,version=version+1 WHERE id=?",
					JSON.stringify(draft),
					cycle.id,
				);
				event("draft_saved", session.actorId, cycle);
				return {
					status: 200,
					body: {
						cycle: cycleMeta(get("SELECT * FROM cycles WHERE id=?", cycle.id)!),
					},
				};
			},
			cycleAccess(req),
		);
	});
	api.post("/cycles/:cycleId/submit", (req, res) => {
		const body = parse(versionBody, req.body);
		mutation(
			req,
			res,
			(session) => {
				role(session, "contributor");
				const cycle = accessCycle(String(req.params.cycleId), session);
				checkVersion(cycle, body.expected_cycle_version);
				state(cycle, "Draft");
				admission();
				const input = parse(SourceInputSchema, JSON.parse(cycle.draft), 422);
				screenInput(input, true);
				if (!input.consent || !input.fictional_data_acknowledged)
					fail(
						422,
						"CONSENT_REQUIRED",
						"Both fictional data acknowledgment and consent are required.",
					);
				const id = randomUUID();
				run(
					"INSERT INTO source_snapshots VALUES (?,?,?,?,?,?,?)",
					id,
					cycle.request_id,
					JSON.stringify(input),
					"1",
					digest(input),
					session.actorId,
					iso(),
				);
				run(
					"UPDATE cycles SET status='Submitted',snapshot_id=?,draft=NULL,version=version+1 WHERE id=?",
					id,
					cycle.id,
				);
				event("source_submitted", session.actorId, cycle, { snapshot_id: id });
				return {
					status: 200,
					body: {
						cycle: cycleMeta(get("SELECT * FROM cycles WHERE id=?", cycle.id)!),
						snapshot_id: id,
					},
				};
			},
			cycleAccess(req),
		);
	});
	api.post("/cycles/:cycleId/generations", (req, res) => {
		const body = parse(versionBody, req.body);
		let started: string | undefined;
		mutation(
			req,
			res,
			(session) => {
				const cycle = accessCycle(String(req.params.cycleId), session);
				checkVersion(cycle, body.expected_cycle_version);
				state(cycle, "Submitted", "ChangesRequested");
				consent(cycle.snapshot_id);
				admission("revisions");
				if (
					Number(
						get(
							"SELECT count(*) AS count FROM generation_attempts WHERE state='running'",
						)!.count,
					) >= 2
				)
					throw new ApiError(
						429,
						"GENERATION_CAPACITY",
						"Two generation attempts are already running.",
						undefined,
						1,
					);
				const recent = all(
					"SELECT started_at FROM generation_attempts WHERE cycle_id=? AND started_at>? ORDER BY started_at",
					cycle.id,
					new Date(now() - 60_000).toISOString(),
				);
				if (recent.length >= 3)
					throw new ApiError(
						429,
						"GENERATION_RATE_LIMIT",
						"Wait before starting another generation for this cycle.",
						undefined,
						Math.max(
							1,
							Math.ceil(
								(Date.parse(recent[0].started_at) + 60_000 - now()) / 1000,
							),
						),
					);
				const id = randomUUID();
				run(
					"INSERT INTO generation_attempts VALUES (?,?,?,?,'running',NULL,?,?,NULL,?,NULL,0)",
					id,
					cycle.id,
					cycle.snapshot_id,
					cycle.version + 1,
					iso(),
					new Date(now() + (options.deadlineMs ?? 10_000)).toISOString(),
					get("SELECT value FROM settings WHERE key='scenario'")!.value,
				);
				run(
					"UPDATE cycles SET status='Generating',active_attempt_id=?,version=version+1 WHERE id=?",
					id,
					cycle.id,
				);
				event("generation_started", session.actorId, cycle, { attempt_id: id });
				started = id;
				return {
					status: 202,
					body: {
						attempt_id: id,
						cycle_id: cycle.id,
						status: "Generating",
						cycle_version: cycle.version + 1,
					},
					headers: { Location: `/api/v1/attempts/${id}` },
				};
			},
			cycleAccess(req, true),
		);
		if (started) startWorker(started);
	});
	api.get("/attempts/:attemptId", (req, res) => {
		const attempt = get(
			"SELECT * FROM generation_attempts WHERE id=?",
			String(req.params.attemptId),
		);
		if (!attempt)
			fail(404, "NOT_FOUND", "The requested record is unavailable.");
		const cycle = accessCycle(attempt!.cycle_id, res.locals.session);
		res.json({ ...attemptSafe(attempt), cycle_version: cycle.version });
	});
	api.post("/cycles/:cycleId/revisions", (req, res) => {
		const body = parse(
			z.strictObject({
				expected_cycle_version: version,
				expected_revision_id: uuid,
				content: z.unknown(),
			}),
			req.body,
		);
		mutation(
			req,
			res,
			(session) => {
				role(session, "reviewer");
				const cycle = accessCycle(String(req.params.cycleId), session);
				checkVersion(cycle, body.expected_cycle_version);
				state(cycle, "NeedsReview");
				revisionGuard(cycle, body.expected_revision_id);
				admission("revisions");
				const content = parse(CandidateOutputSchema, body.content, 422);
				screenInput(content);
				const { revision, validation } = saveRevision(
					cycle,
					content,
					"human",
					session.actorId,
					null,
				);
				run(
					"UPDATE cycles SET current_revision_id=?,version=version+1 WHERE id=?",
					revision.id,
					cycle.id,
				);
				event("revision_saved", session.actorId, cycle, {
					revision_id: revision.id,
					validation_run_id: validation.id,
				});
				return {
					status: 201,
					body: {
						revision_id: revision.id,
						findings: validation.findings,
						cycle: cycleMeta(get("SELECT * FROM cycles WHERE id=?", cycle.id)!),
					},
				};
			},
			cycleAccess(req),
		);
	});
	api.post("/cycles/:cycleId/decisions", (req, res) => {
		const body = parse(
			z.strictObject({
				expected_cycle_version: version,
				expected_revision_id: uuid,
				decision: z.enum(["approve", "reject", "request_changes"]),
				reason: z.string().nullable(),
			}),
			req.body,
		);
		mutation(
			req,
			res,
			(session) => {
				role(session, "reviewer");
				const cycle = accessCycle(String(req.params.cycleId), session);
				checkVersion(cycle, body.expected_cycle_version);
				state(cycle, "NeedsReview");
				revisionGuard(cycle, body.expected_revision_id);
				admission();
				let approvalId: string | null = null;
				let reason: string | null = null;
				if (body.decision === "approve") {
					if (body.reason !== null)
						fail(400, "INVALID_REQUEST", "Approval requires a null reason.");
					consent(cycle.snapshot_id);
					const revision = get(
						"SELECT * FROM revisions WHERE id=?",
						cycle.current_revision_id,
					)!;
					const findings = validator(
						source(cycle.snapshot_id),
						JSON.parse(revision.content),
					);
					// Approval recomputes checks and binds a passing immutable run from this validator version.
					const previous = get(
						"SELECT * FROM validation_runs WHERE revision_id=? AND validator_version=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
						revision.id,
						validatorVersion(),
					);
					const validationId =
						previous &&
						previous.content_digest === revision.digest &&
						previous.findings === JSON.stringify(findings)
							? previous.id
							: validate(cycle, revision).id;
					if (validationId !== previous?.id)
						event("revision_revalidated", session.actorId, cycle, {
							revision_id: revision.id,
							validation_run_id: validationId,
						});
					if (findings.some((f) => f.severity === "blocking"))
						return {
							status: 422,
							body: {
								error: {
									code: "VALIDATION_FAILED",
									message: "Resolve all blocking findings before approval.",
									request_id: res.locals.requestId,
								},
							},
						};
					approvalId = randomUUID();
					run(
						"INSERT INTO approvals VALUES (?,?,?,?,?,?,?,?)",
						approvalId,
						cycle.id,
						revision.id,
						cycle.snapshot_id,
						validationId,
						revision.digest,
						session.actorId,
						iso(),
					);
				} else {
					reason = body.reason?.trim().normalize("NFC") ?? null;
					if (
						!reason ||
						[...reason].length > 500 ||
						/[\u0000-\u001f\u007f]/u.test(reason)
					)
						fail(
							422,
							"INVALID_REASON",
							"Provide a single-line reason of 1 to 500 characters.",
						);
					screenInput(reason, true);
				}
				const decisionId = randomUUID();
				run(
					"INSERT INTO review_decisions VALUES (?,?,?,?,?,?,?,?)",
					decisionId,
					cycle.id,
					cycle.current_revision_id,
					session.actorId,
					body.decision,
					reason,
					approvalId,
					iso(),
				);
				const nextState = {
					approve: "Approved",
					reject: "Rejected",
					request_changes: "ChangesRequested",
				}[body.decision];
				run(
					"UPDATE cycles SET status=?,version=version+1 WHERE id=?",
					nextState,
					cycle.id,
				);
				event(
					body.decision === "approve" ? "revision_approved" : "review_decision",
					session.actorId,
					cycle,
					{
						decision_id: decisionId,
						revision_id: cycle.current_revision_id,
						...(approvalId ? { approval_id: approvalId } : {}),
					},
				);
				return {
					status: 200,
					body: {
						cycle: cycleMeta(get("SELECT * FROM cycles WHERE id=?", cycle.id)!),
						approval_id: approvalId,
					},
				};
			},
			cycleAccess(req, body.decision === "approve"),
		);
	});
	api.post("/cycles/:cycleId/children", (req, res) => {
		const body = parse(
			z.strictObject({
				expected_cycle_version: version,
				reason: z.enum([
					"regenerate",
					"correct_source",
					"restart_after_rejection",
				]),
			}),
			req.body,
		);
		mutation(
			req,
			res,
			(session) => {
				const cycle = accessCycle(String(req.params.cycleId), session);
				checkVersion(cycle, body.expected_cycle_version);
				admission("cycles");
				let draft: string | null = null;
				let snapshotId: string | null = null;
				let status = "Draft";
				if (body.reason === "regenerate") {
					role(session, "reviewer");
					state(cycle, "Approved", "ReadyForPublication");
					consent(cycle.snapshot_id);
					snapshotId = cycle.snapshot_id;
					status = "Submitted";
				} else {
					role(session, "contributor");
					if (body.reason === "restart_after_rejection")
						state(cycle, "Rejected");
					else if (cycle.status === "Generating")
						fail(
							409,
							"WRONG_STATE",
							"Wait for generation to finish before correcting the source.",
						);
					draft = JSON.stringify({
						...(cycle.snapshot_id
							? source(cycle.snapshot_id)
							: JSON.parse(cycle.draft)),
						consent: false,
						fictional_data_acknowledged: false,
					});
				}
				const id = randomUUID();
				run(
					"INSERT INTO cycles VALUES (?,?,?,?,?,1,?,?,NULL,NULL,?)",
					id,
					cycle.request_id,
					cycle.id,
					body.reason,
					status,
					draft,
					snapshotId,
					iso(),
				);
				const child = get("SELECT * FROM cycles WHERE id=?", id)!;
				event("cycle_created", session.actorId, child, {
					predecessor_cycle_id: cycle.id,
				});
				return {
					status: 201,
					body: {
						cycle: cycleMeta(child),
						cycle_id: id,
						predecessor_cycle_id: cycle.id,
					},
				};
			},
			cycleAccess(req, body.reason === "regenerate"),
		);
	});
	const accessSnapshot = (id: string, session: Session) => {
		const snapshot = get("SELECT * FROM source_snapshots WHERE id=?", id);
		if (!snapshot)
			fail(404, "NOT_FOUND", "The requested record is unavailable.");
		accessRequest(snapshot!.request_id, session);
		return snapshot!;
	};
	api.post("/snapshots/:snapshotId/withdraw-consent", (req, res) => {
		parse(emptyBody, req.body);
		mutation(
			req,
			res,
			(session) => {
				role(session, "contributor");
				const snapshot = accessSnapshot(String(req.params.snapshotId), session);
				let withdrawal = get(
					"SELECT * FROM consent_withdrawals WHERE snapshot_id=?",
					snapshot.id,
				);
				const cycles = all(
					"SELECT * FROM cycles WHERE snapshot_id=?",
					snapshot.id,
				);
				if (!withdrawal) {
					const id = randomUUID();
					run(
						"INSERT INTO consent_withdrawals VALUES (?,?,?,?)",
						id,
						snapshot.id,
						session.actorId,
						iso(),
					);
					withdrawal = get("SELECT * FROM consent_withdrawals WHERE id=?", id)!;
					for (const cycle of cycles) {
						if (cycle.active_attempt_id)
							failAttempt(
								get(
									"SELECT * FROM generation_attempts WHERE id=?",
									cycle.active_attempt_id,
								)!,
								"CONSENT_WITHDRAWN",
							);
						event("consent_withdrawn", session.actorId, cycle, {
							withdrawal_id: id,
							snapshot_id: snapshot.id,
						});
					}
				}
				return {
					status: 200,
					body: {
						withdrawal_id: withdrawal.id,
						affected_cycle_ids: cycles.map((cycle) => cycle.id),
					},
				};
			},
			(session) => {
				accessSnapshot(String(req.params.snapshotId), session);
			},
		);
	});
	const accessApproval = (id: string, session: Session) => {
		const approval = get("SELECT * FROM approvals WHERE id=?", id);
		if (!approval)
			fail(404, "NOT_FOUND", "The requested record is unavailable.");
		const cycle = accessCycle(approval!.cycle_id, session);
		consent(approval!.snapshot_id);
		if (
			cycle.current_revision_id !== approval!.revision_id ||
			cycle.snapshot_id !== approval!.snapshot_id
		)
			fail(
				409,
				"INTEGRITY_FAILED",
				"The approval references inconsistent records.",
			);
		return { approval: approval!, cycle };
	};
	api.post("/approvals/:approvalId/prepare", (req, res) => {
		const body = parse(versionBody, req.body);
		mutation(
			req,
			res,
			(session) => {
				const { approval, cycle } = accessApproval(
					String(req.params.approvalId),
					session,
				);
				checkVersion(cycle, body.expected_cycle_version);
				state(cycle, "Approved", "ReadyForPublication");
				let artifact = get(
					"SELECT * FROM exports WHERE approval_id=? AND template_version='1'",
					approval.id,
				);
				const existed = Boolean(artifact);
				if (!artifact) {
					admission();
					const revision = get(
						"SELECT * FROM revisions WHERE id=?",
						approval.revision_id,
					)!;
					const content = JSON.parse(revision.content) as CandidateOutput;
					const text = `${FICTIONAL}\n\nInstitution: North Valley University\nProvider mode: mock\nApproval ID: ${approval.id}\nRevision ID: ${approval.revision_id}\nSource ID: ${approval.snapshot_id}\n\nHEADLINE\n${content.headline}\n\nANNOUNCEMENT\n${content.announcement_body}\n\nSHORT SOCIAL VERSION\n${content.short_social_version}\n`;
					const id = randomUUID();
					run(
						"INSERT INTO exports VALUES (?,?,'1',?,?,?,?)",
						id,
						approval.id,
						text,
						createHash("sha256").update(text).digest("hex"),
						session.actorId,
						iso(),
					);
					artifact = get("SELECT * FROM exports WHERE id=?", id)!;
					run(
						"UPDATE cycles SET status='ReadyForPublication',version=version+1 WHERE id=?",
						cycle.id,
					);
					event("artifact_prepared", session.actorId, cycle, {
						export_id: id,
						approval_id: approval.id,
						revision_id: approval.revision_id,
					});
				}
				return {
					status: existed ? 200 : 201,
					body: {
						export_id: artifact.id,
						preview_path: `/api/v1/exports/${artifact.id}`,
						download_path: `/api/v1/exports/${artifact.id}/download`,
						cycle: cycleMeta(get("SELECT * FROM cycles WHERE id=?", cycle.id)!),
					},
				};
			},
			(session) => {
				accessApproval(String(req.params.approvalId), session);
			},
		);
	});
	const accessExport = (id: string, session: Session) => {
		const artifact = get("SELECT * FROM exports WHERE id=?", id);
		if (!artifact)
			fail(404, "NOT_FOUND", "The requested record is unavailable.");
		return {
			artifact: artifact!,
			...accessApproval(artifact!.approval_id, session),
		};
	};
	api.get("/exports/:exportId", (req, res) => {
		const { artifact, approval } = accessExport(
			String(req.params.exportId),
			res.locals.session,
		);
		res.json({
			...artifact,
			revision_id: approval.revision_id,
			snapshot_id: approval.snapshot_id,
			fictional_label: FICTIONAL,
			provider_mode: "mock",
		});
	});
	api.get("/exports/:exportId/download", (req, res) => {
		const { artifact } = transact(() => {
			const result = accessExport(
				String(req.params.exportId),
				res.locals.session,
			);
			admission();
			event(
				"artifact_download_requested",
				res.locals.session.actorId,
				result.cycle,
				{ export_id: result.artifact.id, approval_id: result.approval.id },
			);
			return result;
		});
		res
			.set({
				"Content-Type": "text/plain; charset=utf-8",
				"Content-Disposition": `attachment; filename="fictional-announcement-${artifact.id}.txt"`,
			})
			.send(artifact.text);
	});
	api.get("/demo/config", (_req, res) => {
		role(res.locals.session, "administrator");
		res.json({
			scenario: get("SELECT value FROM settings WHERE key='scenario'")!.value,
			provider_mode: "mock",
			demo_label: LABEL,
			persistence:
				"Records remain after restart until an administrator resets the dataset.",
		});
	});
	api.put("/demo/scenario", (req, res) => {
		const body = parse(z.strictObject({ scenario: scenarios }), req.body);
		mutation(req, res, (session) => {
			role(session, "administrator");
			admission();
			run("UPDATE settings SET value=? WHERE key='scenario'", body.scenario);
			event(
				"scenario_selected",
				session.actorId,
				undefined,
				{},
				body.scenario.toUpperCase(),
			);
			return {
				status: 200,
				body: { scenario: body.scenario, provider_mode: "mock" },
			};
		});
	});
	api.post("/demo/reset", (req, res) => {
		parse(
			z.strictObject({ confirmation: z.literal("RESET FICTIONAL DEMO") }),
			req.body,
		);
		role(res.locals.session, "administrator");
		terminalKeyGuard(req, res.locals.session);
		// A synchronous exclusive transaction establishes the single-process reset boundary.
		db.transaction(() => {}).exclusive();
		unavailable = true;
		dataset = randomUUID();
		for (const timer of workers.values()) clearTimeout(timer);
		workers.clear();
		try {
			db.close();
			if (databasePath !== ":memory:")
				for (const suffix of ["", "-journal", "-wal", "-shm"])
					rmSync(databasePath + suffix, { force: true });
			db = openDatabase(databasePath);
			app.locals.db = db;
			sessions.clear();
			sessionCreations.clear();
			unavailable = false;
			res
				.clearCookie("demo_session", {
					path: "/",
					httpOnly: true,
					sameSite: "strict",
				})
				.json({
					reset: true,
					message:
						"The fictional dataset is empty. Select a simulated role to continue.",
				});
		} catch {
			fail(
				503,
				"STORAGE_UNAVAILABLE",
				"Reset could not finish. Restart the local application to recover storage.",
			);
		}
	});
	api.use((_req, _res, next) =>
		next(
			new ApiError(404, "NOT_FOUND", "The requested endpoint is unavailable."),
		),
	);
	app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
		let safe = error instanceof ApiError ? error : undefined;
		if (error.type === "entity.too.large")
			safe = new ApiError(
				413,
				"PAYLOAD_TOO_LARGE",
				"The request exceeds the 128 KiB size limit.",
			);
		else if (error.type === "entity.parse.failed")
			safe = new ApiError(
				400,
				"INVALID_JSON",
				"The request body is not valid JSON.",
			);
		else if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED")
			safe = new ApiError(
				503,
				"STORAGE_BUSY",
				"Storage is busy. Retry this request with the same idempotency key.",
			);
		safe ??= new ApiError(
			500,
			"INTERNAL_ERROR",
			"The operation could not be completed.",
		);
		if (safe.status === 401)
			res.clearCookie("demo_session", {
				path: "/",
				httpOnly: true,
				sameSite: "strict",
			});
		if (safe.retryAfter) res.set("Retry-After", String(safe.retryAfter));
		res
			.status(safe.status)
			.json({
				error: {
					code: safe.code,
					message: safe.message,
					...(safe.fields ? { fields: safe.fields } : {}),
					request_id: res.locals.requestId,
				},
			});
	});
	app.locals.db = db;
	app.locals.close = () => {
		clearInterval(sweep);
		for (const timer of workers.values()) clearTimeout(timer);
		workers.clear();
		dataset = randomUUID();
		sessions.clear();
		db.close();
	};
	app.locals.sweep = () =>
		transact(() => {
			for (const attempt of all(
				"SELECT * FROM generation_attempts WHERE state='running' AND deadline_at<=?",
				iso(),
			))
				failAttempt(attempt, "TIMEOUT");
		});
	return app;
}
