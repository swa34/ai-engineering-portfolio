import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type FormEvent,
	type ReactNode,
} from "react";
import {
	compose,
	emptyDraft,
	type CandidateOutput,
	type DraftSource,
	type SourceInput,
} from "../shared/contracts";
import { api, ApiError } from "./api";

type Role = "contributor" | "reviewer" | "administrator";
type Session = {
	actor: string;
	role: Role;
	csrf_token: string;
	demo_label: string;
};
type Finding = {
	code: string;
	severity: string;
	path: string;
	message: string;
};
type Cycle = {
	id: string;
	request_id: string;
	status: string;
	version: number;
	draft_source: DraftSource | null;
	snapshot_id: string | null;
	current_revision_id: string | null;
	active_attempt_id: string | null;
	created_at?: string;
	withdrawn?: boolean;
	validation_status?: "pass" | "fail" | null;
	approval_id?: string | null;
};
type Revision = {
	id: string;
	sequence: number;
	origin: string;
	content: CandidateOutput;
	created_at?: string;
};
type RevisionPage = {
	revisions: Omit<Revision, "content">[];
	next_cursor: string | null;
};
type Attempt = {
	id?: string;
	attempt_id?: string;
	state: string;
	failure_code?: string;
	safe_failure_code?: string;
};
type Detail = {
	cycle: Cycle;
	snapshot: { id: string; source: SourceInput; withdrawn: boolean } | null;
	current_revision: Revision | null;
	findings: Finding[];
	approval: { id: string; revision_id: string } | null;
	active_attempt: Attempt | null;
};
type RequestSummary = { id: string; created_at: string; cycles: Cycle[] };
type History = {
	revisions: Revision[];
	decisions: {
		id: string;
		decision: string;
		reason: string | null;
		created_at: string;
	}[];
	attempts: Attempt[];
	events: { id: string; event_type: string; created_at: string }[];
	next_cursor: string | null;
};
type ExportArtifact = {
	id: string;
	text: string;
	approval_id: string;
	revision_id: string;
	snapshot_id: string;
	digest: string;
	fictional_label: string;
};
type Modal =
	| "roles"
	| "approve"
	| "request_changes"
	| "reject"
	| "restore"
	| "withdraw"
	| "reset"
	| null;
const roles: Role[] = ["contributor", "reviewer", "administrator"];
const roleDescriptions = {
	contributor: "Create fictional source records and submit them for review.",
	reviewer: "Compare drafts with their source, resolve findings, and approve.",
	administrator: "Select a mock failure scenario or reset the local dataset.",
};
const statusLabel = (status: string) =>
	status.replace(/([a-z])([A-Z])/g, "$1 $2");
const shortId = (id: string) => id.slice(0, 8);
const dateLabel = (value?: string) =>
	value
		? new Date(value).toLocaleString([], {
				dateStyle: "medium",
				timeStyle: "short",
			})
		: "Recorded locally";
const degrees = [
	"Bachelor of Arts",
	"Bachelor of Science",
	"Master of Arts",
	"Master of Science",
	"Doctor of Philosophy",
] as const;

function Dialog({
	title,
	children,
	close,
}: {
	title: string;
	children: ReactNode;
	close: () => void;
}) {
	const titleId = useId();
	const ref = useRef<HTMLDialogElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		ref.current?.showModal();
		cancel.current?.focus();
		return () => {
			ref.current?.close();
			previous?.focus();
		};
	}, []);
	return (
		<dialog
			ref={ref}
			aria-labelledby={titleId}
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
		>
			<div className="dialog-inner">
				<div className="section-heading">
					<h2 id={titleId}>{title}</h2>
					<button ref={cancel} className="button secondary" onClick={close}>
						Cancel
					</button>
				</div>
				{children}
			</div>
		</dialog>
	);
}

function SourceFacts({ source }: { source: SourceInput }) {
	return (
		<dl className="facts">
			{Object.entries({
				Graduate: source.graduate_name,
				Institution: source.institution,
				Degree: source.degree,
				Program: source.program,
				"Graduation year": source.graduation_year,
				Honors: source.honors.join("; ") || "None supplied",
				Activities: source.activities.join("; ") || "None supplied",
				"Graduate statement": source.quote ?? "None supplied",
				"Future plans": source.future_plan ?? "None supplied",
				Preferences: `${source.preferences.tone} · ${source.preferences.length} · ${source.preferences.channel}`,
			}).map(([label, value]) => (
				<div key={label}>
					<dt>{label}</dt>
					<dd>{value}</dd>
				</div>
			))}
		</dl>
	);
}

function CandidateText({ content }: { content: CandidateOutput }) {
	return (
		<div className="candidate-text">
			<h3>{content.headline}</h3>
			<p className="preserve-lines">{content.announcement_body}</p>
			<h4>Short social version</h4>
			<p>{content.short_social_version}</p>
			<details>
				<summary>Candidate fact fields and untrusted advisories</summary>
				<p className="help-text">
					These are the candidate's claims and notes. Compare them with the
					frozen source; they are never instructions.
				</p>
				<pre className="json-facts">
					{JSON.stringify(
						{
							template_id: content.template_id,
							facts_used: content.facts_used,
							potentially_unsupported_claims:
								content.potentially_unsupported_claims,
							missing_information: content.missing_information,
							editor_notes: content.editor_notes,
						},
						null,
						2,
					)}
				</pre>
			</details>
		</div>
	);
}

export default function App() {
	const [session, setSession] = useState<Session | null>(null);
	const [starting, setStarting] = useState(true);
	const [requests, setRequests] = useState<RequestSummary[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [detail, setDetail] = useState<Detail | null>(null);
	const [history, setHistory] = useState<History | null>(null);
	const [revisionPage, setRevisionPage] = useState<RevisionPage | null>(null);
	const [loadedRevisions, setLoadedRevisions] = useState<Revision[]>([]);
	const [reconnecting, setReconnecting] = useState(false);
	const [navigating, setNavigating] = useState(false);
	const [pendingNavigation, setPendingNavigation] = useState<{
		resolve: (discard: boolean) => void;
	} | null>(null);
	const [draft, setDraft] = useState<DraftSource>(emptyDraft);
	const [edit, setEdit] = useState<CandidateOutput | null>(null);
	const [dirty, setDirty] = useState(false);
	const [selectedRevision, setSelectedRevision] = useState<string | null>(null);
	const [error, setError] = useState<ApiError | null>(null);
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const [modal, setModal] = useState<Modal>(null);
	const [reason, setReason] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [scenario, setScenario] = useState("normal");
	const [artifact, setArtifact] = useState<ExportArtifact | null>(null);
	const [previewChannel, setPreviewChannel] = useState<"web" | "social">("web");
	const errorRef = useRef<HTMLDivElement>(null);
	const cycle = detail?.cycle;
	const withdrawn = detail?.snapshot?.withdrawn ?? false;
	const contributor = session?.role === "contributor";
	const reviewer = session?.role === "reviewer";
	const blocked = (detail?.findings ?? []).some(
		(finding) => finding.severity === "blocking",
	);

	useEffect(() => {
		if (!dirty) return;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [dirty]);

	async function confirmDiscard() {
		if (!dirty) return true;
		return new Promise<boolean>((resolve) => setPendingNavigation({ resolve }));
	}
	function finishNavigation(discard: boolean) {
		if (discard) {
			setDirty(false);
			setDraft(detail?.cycle.draft_source ?? emptyDraft());
			setEdit(detail?.current_revision?.content ?? null);
		}
		pendingNavigation?.resolve(discard);
		setPendingNavigation(null);
	}
	async function navigate(work: () => Promise<void>) {
		if (!(await confirmDiscard())) return;
		setNavigating(true);
		await run(work);
		setNavigating(false);
	}

	const report = useCallback((err: unknown) => {
		if (err instanceof DOMException && err.name === "AbortError") return;
		const next =
			err instanceof ApiError
				? err
				: new ApiError(
						"CONNECTION_FAILED",
						"Unable to reach the local server. Check that it is running, then try again.",
					);
		if (next.status === 401) {
			setSession(null);
			setDetail(null);
			setHistory(null);
			setArtifact(null);
			setModal(null);
			setDirty(false);
		}
		setError(next);
	}, []);
	useEffect(() => {
		if (error) errorRef.current?.focus();
	}, [error]);
	useEffect(() => {
		api<Session>("/session")
			.then(setSession)
			.catch((err) => {
				if (!(err instanceof ApiError && err.status === 401)) report(err);
			})
			.finally(() => setStarting(false));
	}, [report]);

	const loadQueue = useCallback(async (more?: string, automatic = false) => {
		const data = await api<{
			requests: RequestSummary[];
			next_cursor: string | null;
		}>(`/requests${more ? `?cursor=${encodeURIComponent(more)}` : ""}`, {
			automatic,
		});
		setRequests((previous) =>
			more ? [...previous, ...data.requests] : data.requests,
		);
		setCursor(data.next_cursor);
	}, []);
	useEffect(() => {
		if (session && session.role !== "administrator") loadQueue().catch(report);
		else if (session)
			api<{ scenario: string }>("/demo/config")
				.then((config) => setScenario(config.scenario))
				.catch(report);
	}, [session, loadQueue, report]);

	const readRevisions = useCallback(
		async (id: string, signal?: AbortSignal, automatic = false) => {
			const page = await api<RevisionPage>(`/cycles/${id}/revisions`, {
				signal,
				automatic,
			});
			const original = page.revisions.find(
				(revision) => revision.origin === "mock",
			);
			const loaded = original
				? [
						(
							await api<{ revision: Revision }>(
								`/cycles/${id}/revisions/${original.id}`,
								{ signal, automatic },
							)
						).revision,
					]
				: [];
			return { page, loaded };
		},
		[],
	);

	async function loadCycle(id: string, preserve = false) {
		const [data, records, revisions] = await Promise.all([
			api<Detail>(`/cycles/${id}`),
			api<History>(`/cycles/${id}/history`),
			readRevisions(id),
		]);
		setDetail(data);
		if (preserve) setSelectedRevision(data.current_revision?.id ?? null);
		if (!preserve) {
			setDraft(data.cycle.draft_source ?? emptyDraft());
			setEdit(data.current_revision?.content ?? null);
			setDirty(false);
			setSelectedRevision(data.current_revision?.id ?? null);
			setArtifact(null);
			setPreviewChannel(data.snapshot?.source.preferences.channel ?? "web");
		}
		setHistory(records);
		setRevisionPage(revisions.page);
		setLoadedRevisions(revisions.loaded);
	}

	async function run(work: () => Promise<void>) {
		setBusy(true);
		setError(null);
		try {
			await work();
		} catch (err) {
			report(err);
		} finally {
			setBusy(false);
		}
	}
	async function mutate<T>(path: string, body: unknown = {}, method = "POST") {
		return api<T>(path, { method, body, csrf: session?.csrf_token });
	}
	async function chooseRole(role: Role) {
		await navigate(async () => {
			const data = await mutate<Session>("/demo-session", { actor: role });
			setSession(data);
			setModal(null);
			setArtifact(null);
			setDirty(false);
			setNotice(`Local ${role} role selected.`);
			if (role === "administrator") {
				setDetail(null);
				setHistory(null);
			} else if (cycle) await loadCycle(cycle.id);
		});
	}

	// Retry only reads; generation always requires an explicit action.
	useEffect(() => {
		setReconnecting(false);
		if (
			navigating ||
			!session ||
			!cycle?.active_attempt_id ||
			cycle.status !== "Generating"
		)
			return;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		let stopped = false;
		let failures = 0;
		const attemptId = cycle.active_attempt_id;
		const cycleId = cycle.id;
		const stop = () => {
			stopped = true;
			clearTimeout(timer);
			controller.abort();
		};
		const poll = async () => {
			let delay = document.visibilityState === "hidden" ? 5000 : 1000;
			try {
				const result = await api<Attempt>(`/attempts/${attemptId}`, {
					signal: controller.signal,
					automatic: true,
				});
				if (stopped) return;
				if (result.state !== "running") {
					const [data, records, revisions] = await Promise.all([
						api<Detail>(`/cycles/${cycleId}`, {
							signal: controller.signal,
							automatic: true,
						}),
						api<History>(`/cycles/${cycleId}/history`, {
							signal: controller.signal,
							automatic: true,
						}),
						readRevisions(cycleId, controller.signal, true),
					]);
					if (stopped) return;
					// Apply the completed cycle locally; no queue refresh can restart polling.
					stopped = true;
					setReconnecting(false);
					setDetail(data);
					setHistory(records);
					setRevisionPage(revisions.page);
					setLoadedRevisions(revisions.loaded);
					setEdit(data.current_revision?.content ?? null);
					setSelectedRevision(data.current_revision?.id ?? null);
					setNotice(
						result.state === "succeeded"
							? "Mock generation complete. The candidate is ready for human review."
							: `Generation failed: ${result.failure_code ?? result.safe_failure_code ?? "attempt interrupted"}. The source is preserved. Choose Generate candidate to retry.`,
					);
					setRequests((previous) =>
						previous.map((request) => ({
							...request,
							cycles: request.cycles.map((item) =>
								item.id === cycleId
									? {
											...item,
											...data.cycle,
											withdrawn: data.snapshot?.withdrawn ?? false,
											approval_id: data.approval?.id ?? null,
											validation_status: data.current_revision
												? data.findings.some(
														(finding) => finding.severity === "blocking",
													)
													? "fail"
													: "pass"
												: null,
										}
									: item,
							),
						})),
					);
					return;
				}
				failures = 0;
				setReconnecting(false);
			} catch (err) {
				if (stopped || controller.signal.aborted) return;
				const status = err instanceof ApiError ? err.status : 0;
				if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
					stop();
					setReconnecting(false);
					report(err);
					return;
				}
				failures += 1;
				delay = Math.max(
					delay,
					Math.min(30000, 1000 * 2 ** Math.min(failures, 5)),
				);
				if (err instanceof ApiError && status === 429)
					delay = Math.max(delay, err.retryAfter * 1000);
				setReconnecting(true);
			}
			if (!stopped) timer = setTimeout(poll, delay);
		};
		timer = setTimeout(
			poll,
			document.visibilityState === "hidden" ? 5000 : 1000,
		);
		return stop;
	}, [
		session,
		cycle?.id,
		cycle?.active_attempt_id,
		cycle?.status,
		navigating,
		readRevisions,
		report,
	]);

	async function createRequest() {
		await navigate(async () => {
			const result = await mutate<Detail>("/requests");
			await loadQueue();
			await loadCycle(result.cycle.id);
			setNotice(
				"New fictional request created. Complete the source information.",
			);
		});
	}
	async function saveDraft(submit = false) {
		if (!cycle) return;
		await run(async () => {
			const saved = await mutate<Detail>(
				`/cycles/${cycle.id}/draft`,
				{ expected_cycle_version: cycle.version, source: draft },
				"PUT",
			);
			setDetail((previous) =>
				previous ? { ...previous, cycle: saved.cycle } : previous,
			);
			setDirty(false);
			if (submit)
				await mutate(`/cycles/${cycle.id}/submit`, {
					expected_cycle_version: saved.cycle.version,
				});
			await loadCycle(cycle.id);
			await loadQueue();
			setNotice(
				submit
					? "Source submitted and frozen. Select Generate candidate when ready."
					: "Fictional source saved. It has not been submitted.",
			);
		});
	}
	async function generate() {
		if (cycle)
			await run(async () => {
				await mutate(`/cycles/${cycle.id}/generations`, {
					expected_cycle_version: cycle.version,
				});
				await loadCycle(cycle.id);
				await loadQueue();
				setNotice(
					"Mock generation started. No external provider is contacted.",
				);
			});
	}
	async function saveRevision(content = edit) {
		if (cycle && content)
			await run(async () => {
				await mutate(`/cycles/${cycle.id}/revisions`, {
					expected_cycle_version: cycle.version,
					expected_revision_id: cycle.current_revision_id,
					content,
				});
				setModal(null);
				await loadCycle(cycle.id);
				await loadQueue();
				setNotice(
					"A new revision was saved and validated. Earlier revisions remain in history.",
				);
			});
	}
	async function decide(decision: "approve" | "reject" | "request_changes") {
		if (cycle)
			await run(async () => {
				await mutate(`/cycles/${cycle.id}/decisions`, {
					expected_cycle_version: cycle.version,
					expected_revision_id: cycle.current_revision_id,
					decision,
					reason: decision === "approve" ? null : reason,
				});
				setModal(null);
				setReason("");
				await loadCycle(cycle.id);
				await loadQueue();
				setNotice(
					decision === "approve"
						? "This exact revision is approved for local preparation."
						: "Review decision recorded. The previous source and revisions are preserved.",
				);
			});
	}
	async function child(
		reasonValue: "correct_source" | "regenerate" | "restart_after_rejection",
	) {
		if (cycle)
			await navigate(async () => {
				const result = await mutate<{
					cycle?: Cycle;
					cycle_id?: string;
					id?: string;
				}>(`/cycles/${cycle.id}/children`, {
					expected_cycle_version: cycle.version,
					reason: reasonValue,
				});
				const id = result.cycle?.id ?? result.cycle_id ?? result.id;
				if (!id) throw Error("Missing cycle");
				await loadQueue();
				await loadCycle(id);
				setNotice(
					"A separate review cycle was created. Prior cycles are preserved.",
				);
			});
	}
	async function prepare() {
		const approvalId = detail?.approval?.id;
		if (cycle && approvalId)
			await run(async () => {
				const prepared = await mutate<{ export_id: string }>(
					`/approvals/${approvalId}/prepare`,
					{ expected_cycle_version: cycle.version },
				);
				const preview = await api<ExportArtifact>(
					`/exports/${prepared.export_id}`,
				);
				await loadCycle(cycle.id);
				setArtifact(preview);
				await loadQueue();
				setNotice(
					"Approved artifact prepared for local handoff. No publication or distribution has occurred.",
				);
			});
	}

	function changeDraft<K extends keyof DraftSource>(
		key: K,
		value: DraftSource[K],
	) {
		setDraft((previous) => ({ ...previous, [key]: value }));
		setDirty(true);
	}
	function changeEdit<K extends keyof CandidateOutput>(
		key: K,
		value: CandidateOutput[K],
	) {
		setEdit((previous) =>
			previous ? { ...previous, [key]: value } : previous,
		);
		setDirty(true);
	}
	async function selectRevision(id: string) {
		if (busy || id === selectedRevision || !(await confirmDiscard()) || !cycle)
			return;
		await run(async () => {
			if (
				id !== detail.current_revision?.id &&
				!loadedRevisions.some((revision) => revision.id === id)
			) {
				const result = await api<{ revision: Revision }>(
					`/cycles/${cycle.id}/revisions/${id}`,
				);
				setLoadedRevisions((previous) => [...previous, result.revision]);
			}
			setSelectedRevision(id);
		});
	}
	async function loadMoreRevisions() {
		if (!cycle || !revisionPage?.next_cursor) return;
		await run(async () => {
			const next = await api<RevisionPage>(
				`/cycles/${cycle.id}/revisions?cursor=${encodeURIComponent(revisionPage.next_cursor!)}`,
			);
			setRevisionPage({
				revisions: [...revisionPage.revisions, ...next.revisions],
				next_cursor: next.next_cursor,
			});
		});
	}
	const fieldErrors: { path: string; message: string }[] =
		error?.fields && Array.isArray(error.fields)
			? error.fields.map((value) =>
					typeof value === "string"
						? { path: value, message: "Review this field." }
						: {
								path: String(value.path ?? value.field ?? ""),
								message: String(value.message ?? "Review this field."),
							},
				)
			: error?.fields && typeof error.fields === "object"
				? Object.entries(error.fields).map(([path, value]) => ({
						path,
						message: typeof value === "string" ? value : "Review this field.",
					}))
				: [];
	function fieldTarget(path: string) {
		const parts = path
			.replace(/\[\d+\]/g, "")
			.split(".")
			.filter((part) => !/^\d+$/.test(part));
		return parts.includes("facts_used")
			? "candidate-facts"
			: (parts.at(-1) ?? "");
	}
	function fieldError(key: string) {
		return fieldErrors.find((item) => fieldTarget(item.path) === key);
	}
	function fieldProps(key: string) {
		return {
			id: key,
			"aria-invalid": !!fieldError(key),
			...(fieldError(key) ? { "aria-describedby": `${key}-error` } : {}),
		};
	}
	function FieldMessage({ name }: { name: string }) {
		const finding = fieldError(name);
		return finding ? (
			<span id={`${name}-error`} className="field-error">
				{finding.message}
			</span>
		) : null;
	}

	const revisionOptions = [
		...new Map(
			[
				...(revisionPage?.revisions ?? []),
				...(detail?.current_revision ? [detail.current_revision] : []),
			].map((revision) => [revision.id, revision]),
		).values(),
	].sort((a, b) => a.sequence - b.sequence);
	const historicalRevision = loadedRevisions.find(
		(revision) => revision.id === selectedRevision,
	);
	const displayRevision = historicalRevision ?? detail?.current_revision;
	const originalRevision = loadedRevisions.find(
		(revision) => revision.origin === "mock",
	);
	const restore = detail?.snapshot ? compose(detail.snapshot.source) : null;
	const isCurrent =
		!selectedRevision || selectedRevision === cycle?.current_revision_id;
	const canReview =
		reviewer && cycle?.status === "NeedsReview" && !withdrawn && isCurrent;

	return (
		<>
			<a className="skip-link" href="#main">
				Skip to main content
			</a>
			<div
				className="demo-banner"
				role="region"
				aria-label="Demonstration boundaries"
			>
				<span className="banner-dot" aria-hidden="true" />
				Fictional demonstration <span className="banner-separator">/</span>{" "}
				Local only <span className="banner-separator">/</span> Mock provider
			</div>
			<header className="site-header">
				<a
					className="brand"
					href="#main"
					aria-label="North Valley University announcement studio"
				>
					<span className="brand-mark" aria-hidden="true">
						N<span>V</span>
					</span>
					<span>
						North Valley
						<span className="brand-subtitle">UNIVERSITY · FICTIONAL</span>
					</span>
				</a>
				<div className="header-right">
					<span className="local-label">
						Local demo — roles are simulated, not verified identities
					</span>
					{session && (
						<button
							className="role-button"
							onClick={() => setModal("roles")}
							disabled={busy}
						>
							<span className="role-dot" aria-hidden="true" />
							{session.role}
							<span aria-hidden="true">⌄</span>
						</button>
					)}
				</div>
			</header>
			<main id="main" tabIndex={-1}>
				<div className="page-intro">
					<div>
						<p className="eyebrow">THE ANNOUNCEMENT STUDIO</p>
						<h1>A milestone, thoughtfully told.</h1>
						<p className="intro-copy">
							From submitted facts to an approved announcement.
							<br className="wide-only" /> Every word grounded in its source.
							Every approval yours.
						</p>
					</div>
					<div className="intro-note">
						<span className="small-label">HUMAN REVIEW, BY DESIGN</span>
						<p>
							Fictional information only.
							<br />
							No real student records or credentials.
						</p>
					</div>
				</div>
				<div
					className="live-status"
					role="status"
					aria-live="polite"
					aria-atomic="true"
				>
					{notice}
				</div>
				{reconnecting && (
					<p role="status">Connection interrupted. Reconnecting…</p>
				)}
				{error && (
					<div
						className="error-summary"
						role="alert"
						tabIndex={-1}
						ref={errorRef}
					>
						<h2>Action could not be completed</h2>
						<p>
							{error.message} <span className="code">({error.code})</span>
						</p>
						{error.status === 409 && (
							<p>
								Another action may have changed this cycle. Your unsaved text is
								preserved. Refresh the record to compare before making another
								decision.
							</p>
						)}
						{error.status === 429 && (
							<p>
								Wait at least {error.retryAfter} seconds before retrying.
								Automatic reads also pause.
							</p>
						)}
						{fieldErrors.length > 0 && (
							<ul>
								{fieldErrors.map((item, index) => (
									<li key={`${item.path}-${index}`}>
										<a href={`#${fieldTarget(item.path)}`}>
											{item.path}: {item.message}
										</a>
									</li>
								))}
							</ul>
						)}
						{cycle && error.status === 409 && (
							<button
								className="button secondary"
								onClick={() =>
									run(async () => {
										await loadCycle(cycle.id, true);
										setNotice(
											"Server state refreshed. Unsaved text is preserved; compare it with the current revision before saving.",
										);
									})
								}
							>
								Refresh and preserve edits
							</button>
						)}
					</div>
				)}
				{starting ? (
					<div className="empty-state">
						<p>Opening local workspace…</p>
					</div>
				) : !session ? (
					<section className="role-selection">
						<div>
							<p className="eyebrow">01 / CHOOSE YOUR PERSPECTIVE</p>
							<h2>
								A complete review workflow,
								<br />
								in a local sandbox.
							</h2>
							<p>
								Select a simulated role to explore the process. Switch roles at
								any time. Your fictional records remain until an administrator
								resets the dataset.
							</p>
						</div>
						<div className="role-cards">
							{roles.map((role, index) => (
								<button
									key={role}
									className="role-card"
									onClick={() => chooseRole(role)}
									disabled={busy}
								>
									<span className="role-number">0{index + 1}</span>
									<span>
										<strong>{role}</strong>
										<span>{roleDescriptions[role]}</span>
									</span>
									<span className="role-arrow" aria-hidden="true">
										↗
									</span>
								</button>
							))}
						</div>
					</section>
				) : session.role === "administrator" ? (
					<section className="admin-panel panel">
						<p className="eyebrow">DEMONSTRATION CONTROLS</p>
						<h2>Test the safeguards.</h2>
						<p>
							The administrator can select predefined mock behavior and reset
							fictional data. Reading source records and approving announcements
							require the corresponding simulated role.
						</p>
						<div className="admin-controls">
							<label htmlFor="scenario">Mock scenario</label>
							<select
								id="scenario"
								value={scenario}
								onChange={(event) => setScenario(event.target.value)}
							>
								{[
									"normal",
									"timeout",
									"malformed",
									"altered_program",
									"invented_honor",
									"unsupported_quote",
									"narrative_invention",
									"inappropriate_tone",
								].map((value) => (
									<option key={value} value={value}>
										{value.replaceAll("_", " ")}
									</option>
								))}
							</select>
							<button
								className="button primary"
								disabled={busy}
								onClick={() =>
									run(async () => {
										await mutate("/demo/scenario", { scenario }, "PUT");
										setNotice(
											`Mock scenario set to ${scenario.replaceAll("_", " ")}. It applies to attempts started after this change.`,
										);
									})
								}
							>
								Apply scenario
							</button>
						</div>
						<div className="danger-zone">
							<h3>Reset the fictional dataset</h3>
							<p>
								Stopping or restarting the server does not delete records. Reset
								removes all local requests, revisions, approvals, events, and
								sessions. Downloaded files are unaffected.
							</p>
							<button
								className="button danger"
								onClick={() => {
									setConfirmation("");
									setModal("reset");
								}}
							>
								Reset dataset…
							</button>
						</div>
					</section>
				) : (
					<div className="workspace">
						<aside className="queue" aria-labelledby="queue-heading">
							<div className="section-heading">
								<h2 id="queue-heading">Review queue</h2>
								<button
									className="text-button"
									onClick={() => run(() => loadQueue())}
									disabled={busy}
								>
									Refresh
								</button>
							</div>
							<p className="queue-description">
								Each cycle keeps its own source, revisions, and approval.
							</p>
							{contributor && (
								<button
									className="button primary new-request"
									onClick={createRequest}
									disabled={busy}
								>
									<span aria-hidden="true">＋</span> New announcement
								</button>
							)}
							<nav aria-label="Announcement cycles">
								{requests.length === 0 ? (
									<div className="queue-empty">
										<span aria-hidden="true">↳</span>
										<p>
											No announcements yet.
											<br />
											Start with a fictional source.
										</p>
									</div>
								) : (
									requests.map((request, index) => (
										<div className="request-group" key={request.id}>
											<p className="request-label">
												REQUEST {shortId(request.id)}
												<span>{String(index + 1).padStart(2, "0")}</span>
											</p>
											{request.cycles.map((item, cycleIndex) => (
												<button
													className={`queue-item ${cycle?.id === item.id ? "selected" : ""}`}
													key={item.id}
													aria-current={
														cycle?.id === item.id ? "page" : undefined
													}
													disabled={busy}
													onClick={() => {
														if (cycle?.id !== item.id)
															void navigate(async () => {
																await loadCycle(item.id);
																setError(null);
															});
													}}
												>
													<span className="queue-title">
														Cycle {cycleIndex + 1}
														<span aria-hidden="true">↗</span>
													</span>
													<span
														className={`status-badge status-${item.status.toLowerCase()}`}
													>
														{statusLabel(item.status)}
													</span>
													<span className="queue-meta">
														Mock provider · v{item.version}
													</span>
													<span className="queue-meta">
														Validation:{" "}
														{item.validation_status === "pass"
															? "passed"
															: item.validation_status === "fail"
																? "blocking findings"
																: "not run"}
													</span>
													{item.withdrawn && (
														<span className="withdrawn-label">
															Consent withdrawn
														</span>
													)}
													{item.approval_id && (
														<span className="queue-meta">
															Approval {shortId(item.approval_id)}
														</span>
													)}
												</button>
											))}
										</div>
									))
								)}
							</nav>
							{cursor && (
								<button
									className="button secondary"
									onClick={() => run(() => loadQueue(cursor))}
								>
									Load more requests
								</button>
							)}
						</aside>
						<div className="work-area">
							{!detail ? (
								<section className="workspace-welcome panel">
									<span className="welcome-symbol" aria-hidden="true">
										✳
									</span>
									<p className="eyebrow">A CLEAR PATH FROM FACTS TO FINAL</p>
									<h2>
										Good announcements
										<br />
										start with good sources.
									</h2>
									<p>
										{contributor
											? "Create an announcement to add fictional graduate facts. Submission freezes the source; generation begins only when you ask."
											: "Select a cycle from the queue to inspect its source, candidate, and validation findings."}
									</p>
									<ol className="workflow-guide">
										<li>
											<span>01</span>Submit source
										</li>
										<li>
											<span>02</span>Review candidate
										</li>
										<li>
											<span>03</span>Approve & prepare
										</li>
									</ol>
									{contributor && (
										<button
											className="button primary"
											disabled={busy}
											onClick={createRequest}
										>
											Create your first announcement{" "}
											<span aria-hidden="true">→</span>
										</button>
									)}
								</section>
							) : (
								<>
									<div className="record-heading">
										<div>
											<p className="eyebrow">
												CYCLE {shortId(detail.cycle.id)} · VERSION{" "}
												{detail.cycle.version}
											</p>
											<h2>
												{detail.snapshot?.source.graduate_name ??
													detail.cycle.draft_source?.graduate_name ??
													"New announcement"}
											</h2>
										</div>
										<span
											className={`status-badge status-${detail.cycle.status.toLowerCase()}`}
										>
											{statusLabel(detail.cycle.status)}
										</span>
									</div>
									<div
										className="progress-track"
										aria-label="Workflow progress"
									>
										{["Source", "Generation", "Review", "Local handoff"].map(
											(label, index) => {
												const step =
													detail.cycle.status === "Draft"
														? 0
														: ["Submitted", "Generating"].includes(
																	detail.cycle.status,
																)
															? 1
															: [
																		"NeedsReview",
																		"ChangesRequested",
																		"Rejected",
																	].includes(detail.cycle.status)
																? 2
																: 3;
												return (
													<div
														className={
															index === step
																? "active"
																: index < step
																	? "completed"
																	: ""
														}
														key={label}
													>
														<span>{String(index + 1).padStart(2, "0")}</span>
														{label}
														{index === step && (
															<span className="sr-only"> — current step</span>
														)}
													</div>
												);
											},
										)}
									</div>
									{withdrawn && (
										<div className="warning">
											<strong>Consent withdrawn</strong>
											<p>
												Generation, approval, preparation, and artifact access
												are blocked for this source. History is preserved.
												Already downloaded files cannot be recalled. A new
												source submission requires fresh acknowledgment.
											</p>
										</div>
									)}
									<p className="print-draft-label">
										Unapproved fictional draft
									</p>
									{detail.cycle.status === "Draft" ? (
										<section className="panel source-form-panel">
											<div className="panel-heading">
												<p className="eyebrow">01 / THE SOURCE</p>
												<h3>Tell us about the graduate.</h3>
												<p>
													Use fictional information only. Required fields are
													marked *. Never enter real student records, contact
													information, or credentials.
												</p>
											</div>
											{!contributor ? (
												<p>
													Only the contributor can edit and submit this source.
													Switch to the contributor role to continue.
												</p>
											) : (
												<form
													onSubmit={(event: FormEvent) => {
														event.preventDefault();
														void saveDraft(true);
													}}
													noValidate
												>
													<fieldset>
														<legend>Graduate information</legend>
														<div className="form-grid">
															<label>
																Graduate name *
																<input
																	{...fieldProps("graduate_name")}
																	autoComplete="off"
																	value={draft.graduate_name ?? ""}
																	onChange={(event) =>
																		changeDraft(
																			"graduate_name",
																			event.target.value || null,
																		)
																	}
																/>
																<FieldMessage name="graduate_name" />
																<small>
																	Fictional name · maximum 80 characters
																</small>
															</label>
															<label>
																Graduation year *
																<input
																	{...fieldProps("graduation_year")}
																	type="number"
																	min={2000}
																	max={2100}
																	value={draft.graduation_year ?? ""}
																	onChange={(event) =>
																		changeDraft(
																			"graduation_year",
																			event.target.value === ""
																				? null
																				: Number(event.target.value),
																		)
																	}
																/>
																<FieldMessage name="graduation_year" />
															</label>
															<label>
																Degree *
																<select
																	{...fieldProps("degree")}
																	value={draft.degree ?? ""}
																	onChange={(event) =>
																		changeDraft(
																			"degree",
																			(event.target.value ||
																				null) as DraftSource["degree"],
																		)
																	}
																>
																	<option value="">Select a degree</option>
																	{degrees.map((value) => (
																		<option key={value}>{value}</option>
																	))}
																</select>
																<FieldMessage name="degree" />
															</label>
															<label>
																Program *
																<input
																	{...fieldProps("program")}
																	autoComplete="off"
																	value={draft.program ?? ""}
																	onChange={(event) =>
																		changeDraft(
																			"program",
																			event.target.value || null,
																		)
																	}
																/>
																<FieldMessage name="program" />
																<small>Maximum 100 characters</small>
															</label>
														</div>
														<div className="institution-line">
															<span className="small-label">INSTITUTION</span>
															<span>
																North Valley University{" "}
																<span className="muted">(fictional)</span>
															</span>
														</div>
													</fieldset>
													<fieldset>
														<legend>
															A little more context <span>optional</span>
														</legend>
														<div className="form-grid">
															<label>
																Honors
																<textarea
																	{...fieldProps("honors")}
																	rows={3}
																	value={draft.honors.join("\n")}
																	onChange={(event) =>
																		changeDraft(
																			"honors",
																			event.target.value === ""
																				? []
																				: event.target.value.split("\n"),
																		)
																	}
																/>
																<FieldMessage name="honors" />
																<small>
																	One per line. Up to 3 honors, 60 characters
																	each. Leave empty if none.
																</small>
															</label>
															<label>
																Activities
																<textarea
																	{...fieldProps("activities")}
																	rows={3}
																	value={draft.activities.join("\n")}
																	onChange={(event) =>
																		changeDraft(
																			"activities",
																			event.target.value === ""
																				? []
																				: event.target.value.split("\n"),
																		)
																	}
																/>
																<FieldMessage name="activities" />
																<small>
																	One per line. Up to 3 activities, 100
																	characters each.
																</small>
															</label>
															<label className="full-width">
																Graduate statement
																<input
																	{...fieldProps("quote")}
																	value={draft.quote ?? ""}
																	onChange={(event) =>
																		changeDraft(
																			"quote",
																			event.target.value || null,
																		)
																	}
																/>
																<FieldMessage name="quote" />
																<small>
																	Exact fictional wording only · maximum 240
																	characters · single line
																</small>
															</label>
															<label className="full-width">
																Future plans
																<input
																	{...fieldProps("future_plan")}
																	value={draft.future_plan ?? ""}
																	onChange={(event) =>
																		changeDraft(
																			"future_plan",
																			event.target.value || null,
																		)
																	}
																/>
																<FieldMessage name="future_plan" />
																<small>
																	As supplied, with no inferred destination or
																	employer · maximum 160 characters
																</small>
															</label>
														</div>
													</fieldset>
													<fieldset>
														<legend>Announcement preferences</legend>
														<div className="form-grid three-columns">
															{(["tone", "length", "channel"] as const).map(
																(key) => (
																	<label key={key}>
																		{key === "channel"
																			? "Initial preview"
																			: key[0].toUpperCase() +
																				key.slice(1)}{" "}
																		*
																		<select
																			{...fieldProps(key)}
																			value={draft.preferences?.[key] ?? ""}
																			onChange={(event) =>
																				changeDraft("preferences", {
																					...(draft.preferences ?? {
																						tone: "professional",
																						length: "standard",
																						channel: "web",
																					}),
																					[key]: event.target.value,
																				} as SourceInput["preferences"])
																			}
																		>
																			<option value="" disabled>
																				Select {key}
																			</option>
																			{(key === "tone"
																				? ["professional", "warm"]
																				: key === "length"
																					? ["standard", "brief"]
																					: ["web", "social"]
																			).map((value) => (
																				<option key={value}>{value}</option>
																			))}
																		</select>
																		<FieldMessage name={key} />
																	</label>
																),
															)}
														</div>
														<p className="help-text">
															Both web and social versions are generated. Brief
															omits optional facts; standard includes all
															supplied details.
														</p>
													</fieldset>
													<fieldset className="acknowledgments">
														<legend>Before you save or submit</legend>
														<p>
															Copied source information must be acknowledged
															again. These controls are independent and start
															unchecked.
														</p>
														<label className="checkbox-label">
															<input
																{...fieldProps("fictional_data_acknowledged")}
																type="checkbox"
																checked={draft.fictional_data_acknowledged}
																onChange={(event) =>
																	changeDraft(
																		"fictional_data_acknowledged",
																		event.target.checked,
																	)
																}
															/>
															<span>
																I confirm this record contains fictional
																information only. *
																<small>
																	Required to save and submit. Screening cannot
																	detect every real person or secret.
																</small>
															</span>
														</label>
														<FieldMessage name="fictional_data_acknowledged" />
														<label className="checkbox-label">
															<input
																{...fieldProps("consent")}
																type="checkbox"
																checked={draft.consent === true}
																onChange={(event) =>
																	changeDraft("consent", event.target.checked)
																}
															/>
															<span>
																I give fictional demo permission to generate and
																review this announcement. *
																<small>
																	Required to submit. This is not legally
																	verified consent.
																</small>
															</span>
														</label>
														<FieldMessage name="consent" />
													</fieldset>
													<div className="form-actions">
														<button
															type="button"
															className="text-button"
															onClick={() => {
																setDraft({
																	...emptyDraft(),
																	graduate_name: "Avery Example",
																	degree: "Bachelor of Science",
																	program: "Environmental Studies",
																	graduation_year: 2026,
																	honors: ["Fictional Faculty Recognition"],
																	activities: ["Campus Garden Club"],
																	quote:
																		"I enjoyed learning with my classmates.",
																	future_plan:
																		"Continue studying community gardens.",
																	preferences: {
																		tone: "professional",
																		length: "standard",
																		channel: "web",
																	},
																});
																setDirty(true);
																setNotice(
																	"Fictional example loaded. Read and select each acknowledgment before saving.",
																);
															}}
														>
															Use fictional example
														</button>
														<div className="button-group">
															<button
																type="button"
																className="button secondary"
																disabled={busy}
																onClick={() => saveDraft()}
															>
																Save draft
															</button>
															<button
																type="submit"
																className="button primary"
																disabled={busy}
															>
																Submit source <span aria-hidden="true">→</span>
															</button>
														</div>
													</div>
												</form>
											)}
										</section>
									) : (
										<>
											{detail.snapshot && (
												<section className="panel source-snapshot">
													<div className="section-heading">
														<div>
															<p className="eyebrow">01 / FROZEN SOURCE</p>
															<h3>Submitted facts</h3>
														</div>
														<span className="small-label">
															SOURCE {shortId(detail.snapshot.id)}
														</span>
													</div>
													<SourceFacts source={detail.snapshot.source} />
													{detail.snapshot.source.preferences.length ===
														"brief" && (
														<p className="info-note">
															Brief wording intentionally omits optional honors,
															activities, quotes, and future plans. All source
															facts remain visible here.
														</p>
													)}
												</section>
											)}
											{["Submitted", "Generating", "ChangesRequested"].includes(
												detail.cycle.status,
											) && (
												<section className="panel generation-panel">
													<div>
														<p className="eyebrow">02 / MOCK GENERATION</p>
														<h3>
															{detail.cycle.status === "Generating"
																? "Preparing a source-based candidate…"
																: detail.cycle.status === "ChangesRequested"
																	? "Changes requested"
																	: "Your source is ready."}
														</h3>
														<p>
															{detail.cycle.status === "Generating"
																? "The mock is working locally. You can leave and return; the server owns the attempt."
																: "Generation uses a fixed, versioned template. A mock candidate is always unapproved until a reviewer accepts its exact revision."}
														</p>
														{detail.cycle.status === "ChangesRequested" && (
															<p>
																The same submitted facts will be used. To change
																facts, the contributor must create a source
																correction.
															</p>
														)}
													</div>
													{detail.cycle.status !== "Generating" && (
														<button
															className="button primary"
															disabled={busy || withdrawn}
															onClick={generate}
														>
															Generate candidate{" "}
															<span aria-hidden="true">→</span>
														</button>
													)}
												</section>
											)}
											{detail.current_revision && (
												<>
													{originalRevision && (
														<section className="panel original-panel">
															<details>
																<summary>
																	02 / Original generated candidate · revision{" "}
																	{originalRevision.sequence}
																</summary>
																<p className="help-text">
																	Original mock output, retained unchanged.
																	Revision {originalRevision.id}
																</p>
																<CandidateText
																	content={originalRevision.content}
																/>
															</details>
														</section>
													)}
													<section className="panel review-panel">
														<div className="section-heading">
															<div>
																<p className="eyebrow">03 / EDITORIAL REVIEW</p>
																<h3>
																	{isCurrent ? "Current" : "Historical"}{" "}
																	revision{" "}
																	{displayRevision?.sequence ??
																		detail.current_revision.sequence}
																</h3>
															</div>
															<div className="revision-controls">
																<label className="revision-select">
																	View revision
																	<select
																		aria-disabled={busy}
																		value={
																			selectedRevision ??
																			detail.current_revision.id
																		}
																		onChange={(event) =>
																			selectRevision(event.target.value)
																		}
																	>
																		{revisionOptions.map((revision) => (
																			<option
																				key={revision.id}
																				value={revision.id}
																			>
																				#{revision.sequence} · {revision.origin}
																				{revision.id ===
																				detail.cycle.current_revision_id
																					? " · current"
																					: ""}
																				{revision.id ===
																				detail.approval?.revision_id
																					? " · approved"
																					: ""}
																			</option>
																		))}
																	</select>
																</label>
																{revisionPage?.next_cursor && (
																	<button
																		className="button secondary"
																		disabled={busy}
																		onClick={loadMoreRevisions}
																	>
																		Load more revisions
																	</button>
																)}
															</div>
														</div>
														<p className="help-text code">
															Revision{" "}
															{displayRevision?.id ??
																detail.current_revision.id}
														</p>
														{detail.approval && (
															<p className="approval-note">
																Approval {shortId(detail.approval.id)} binds
																revision {detail.approval.revision_id}.
															</p>
														)}
														{canReview && edit ? (
															<>
																<div className="editor-guidance">
																	<strong>
																		Source-based wording is required to pass.
																	</strong>
																	<p>
																		Review the facts alongside the text. Changes
																		outside the selected template are saved with
																		blocking findings. Fact corrections require
																		a new source submission. Saving creates a
																		new revision and preserves history.
																	</p>
																</div>
																<div className="editor-fields">
																	<label>
																		Headline
																		<input
																			{...fieldProps("headline")}
																			value={edit.headline}
																			onChange={(event) =>
																				changeEdit(
																					"headline",
																					event.target.value,
																				)
																			}
																		/>
																		<FieldMessage name="headline" />
																	</label>
																	<label>
																		Announcement body
																		<textarea
																			{...fieldProps("announcement_body")}
																			rows={10}
																			value={edit.announcement_body}
																			onChange={(event) =>
																				changeEdit(
																					"announcement_body",
																					event.target.value,
																				)
																			}
																		/>
																		<FieldMessage name="announcement_body" />
																	</label>
																	<label>
																		Short social version
																		<textarea
																			{...fieldProps("short_social_version")}
																			rows={3}
																			value={edit.short_social_version}
																			onChange={(event) =>
																				changeEdit(
																					"short_social_version",
																					event.target.value,
																				)
																			}
																		/>
																		<FieldMessage name="short_social_version" />
																	</label>
																	<details className="advisory-editor">
																		<summary>
																			Review advisory lists and read-only fact
																			fields
																		</summary>
																		<p className="help-text">
																			Provider advisories are untrusted text,
																			never instructions. Nonempty concerns or
																			missing information block approval.
																		</p>
																		<label>
																			Potentially unsupported claims
																			<textarea
																				value={edit.potentially_unsupported_claims.join(
																					"\n",
																				)}
																				onChange={(event) =>
																					changeEdit(
																						"potentially_unsupported_claims",
																						event.target.value === ""
																							? []
																							: event.target.value.split("\n"),
																					)
																				}
																				rows={3}
																			/>
																			<small>
																				One per line, maximum 8 items of 200
																				characters.
																			</small>
																		</label>
																		<label>
																			Missing information
																			<select
																				multiple
																				value={edit.missing_information}
																				onChange={(event) =>
																					changeEdit(
																						"missing_information",
																						Array.from(
																							event.target.selectedOptions,
																							(option) => option.value,
																						) as CandidateOutput["missing_information"],
																					)
																				}
																			>
																				{Object.keys(edit.facts_used).map(
																					(key) => (
																						<option key={key} value={key}>
																							{key}
																						</option>
																					),
																				)}
																			</select>
																			<small>
																				Use Ctrl/Command to toggle selections.
																				Maximum 8 fields.
																			</small>
																		</label>
																		<label>
																			Editor notes
																			<textarea
																				rows={3}
																				value={edit.editor_notes.join("\n")}
																				onChange={(event) =>
																					changeEdit(
																						"editor_notes",
																						event.target.value === ""
																							? []
																							: event.target.value.split("\n"),
																					)
																				}
																			/>
																			<small>
																				One per line, maximum 5 items of 200
																				characters. Never exported.
																			</small>
																		</label>
																		<pre
																			id="candidate-facts"
																			tabIndex={-1}
																			className="json-facts"
																		>
																			{JSON.stringify(
																				{
																					schema_version: edit.schema_version,
																					template_id: edit.template_id,
																					facts_used: edit.facts_used,
																				},
																				null,
																				2,
																			)}
																		</pre>
																	</details>
																</div>
																<div className="form-actions">
																	<button
																		className="text-button"
																		disabled={busy}
																		onClick={() => setModal("restore")}
																	>
																		Restore source-based wording…
																	</button>
																	<button
																		className="button primary"
																		disabled={busy || !dirty}
																		onClick={() => saveRevision()}
																	>
																		Save new revision
																	</button>
																</div>
															</>
														) : (
															displayRevision && (
																<CandidateText
																	content={displayRevision.content}
																/>
															)
														)}
													</section>
													<section
														className={`panel findings-panel ${blocked ? "has-findings" : ""}`}
														aria-labelledby="findings-heading"
													>
														<div className="section-heading">
															<div>
																<p className="eyebrow">
																	VALIDATION · CURRENT REVISION
																</p>
																<h3 id="findings-heading">
																	{blocked
																		? "Resolve blocking findings"
																		: "Source checks passed"}
																</h3>
															</div>
															<span
																className="validation-mark"
																aria-hidden="true"
															>
																{blocked ? "!" : "✓"}
															</span>
														</div>
														{!isCurrent && (
															<p>
																These findings belong to the current revision,
																not the historical revision displayed above.
															</p>
														)}
														{detail.findings.length > 0 ? (
															<ul className="findings-list">
																{detail.findings.map((finding, index) => (
																	<li key={`${finding.code}-${index}`}>
																		<strong>
																			{finding.severity}: {finding.code}
																		</strong>
																		<p>
																			{finding.path}: {finding.message}
																		</p>
																	</li>
																))}
															</ul>
														) : (
															<p>
																The current content matches the submitted source
																and template. This checks correspondence to
																fictional input, not real-world truth.
															</p>
														)}
														{detail.current_revision.content.editor_notes
															.length > 0 && (
															<div className="untrusted-notes">
																<h4>Untrusted provider/editor notes</h4>
																<ul>
																	{detail.current_revision.content.editor_notes.map(
																		(note, index) => (
																			<li key={index}>{note}</li>
																		),
																	)}
																</ul>
															</div>
														)}
														{canReview && (
															<div className="review-actions">
																<p id="approval-explanation">
																	{dirty
																		? "Save or restore your edits before approving. Approval binds the saved revision."
																		: blocked
																			? "Approval is unavailable until a new revision resolves every blocking finding."
																			: "Approval records this exact saved revision. Preparation is a separate action."}
																</p>
																<div className="button-group">
																	<button
																		className="button secondary"
																		disabled={busy || dirty}
																		onClick={() => {
																			setReason("");
																			setModal("request_changes");
																		}}
																	>
																		Request changes…
																	</button>
																	<button
																		className="button danger-text"
																		disabled={busy || dirty}
																		onClick={() => {
																			setReason("");
																			setModal("reject");
																		}}
																	>
																		Reject…
																	</button>
																	<button
																		className="button primary"
																		disabled={busy || blocked || dirty}
																		aria-describedby="approval-explanation"
																		onClick={() => setModal("approve")}
																	>
																		Approve revision…
																	</button>
																</div>
															</div>
														)}
														{contributor &&
															detail.cycle.status === "NeedsReview" && (
																<p className="info-note">
																	A reviewer must make the next decision. Use
																	the role selector to switch to the simulated
																	reviewer.
																</p>
															)}
													</section>
												</>
											)}
											{["Approved", "ReadyForPublication"].includes(
												detail.cycle.status,
											) && (
												<section className="panel handoff-panel">
													<div>
														<p className="eyebrow">04 / LOCAL HANDOFF</p>
														<h3>
															{detail.cycle.status === "Approved"
																? "Approved. Ready to prepare."
																: "Ready for local handoff."}
														</h3>
														<p>
															Prepare an artifact from the approval-bound
															revision. “Ready for publication” means local
															handoff only; this app never publishes or sends
															anything.
														</p>
													</div>
													<button
														className="button primary"
														onClick={prepare}
														disabled={busy || withdrawn}
													>
														{detail.cycle.status === "ReadyForPublication"
															? "Open approved artifact"
															: "Prepare approved artifact"}{" "}
														<span aria-hidden="true">↗</span>
													</button>
												</section>
											)}
											{artifact && !withdrawn && (
												<section className="panel artifact-panel">
													<div className="section-heading">
														<div>
															<p className="eyebrow">APPROVED ARTIFACT</p>
															<h3>Local preview</h3>
														</div>
														<span className="status-badge">
															Approved revision {shortId(artifact.revision_id)}
														</span>
													</div>
													<fieldset className="preview-options">
														<legend>Preview layout</legend>
														{(["web", "social"] as const).map((channel) => (
															<label key={channel}>
																<input
																	type="radio"
																	name="preview-channel"
																	value={channel}
																	checked={previewChannel === channel}
																	onChange={() => setPreviewChannel(channel)}
																/>
																{channel === "web"
																	? "Web announcement"
																	: "Social version"}
															</label>
														))}
													</fieldset>
													<div className="approved-content-preview">
														{detail.current_revision?.id ===
															artifact.revision_id && (
															<>
																<p className="small-label">
																	FICTIONAL DEMONSTRATION — NOT FOR REAL
																	DISTRIBUTION
																</p>
																{previewChannel === "web" ? (
																	<>
																		<h4>
																			{detail.current_revision.content.headline}
																		</h4>
																		<p className="preserve-lines">
																			{
																				detail.current_revision.content
																					.announcement_body
																			}
																		</p>
																	</>
																) : (
																	<p>
																		{
																			detail.current_revision.content
																				.short_social_version
																		}
																	</p>
																)}
															</>
														)}
													</div>
													<h4>Exact downloadable artifact</h4>
													<p className="help-text">
														Both versions, the fictional notice, and all
														identifiers are retained in this stored text.
													</p>
													<pre className="artifact-text">{artifact.text}</pre>
													<p className="help-text code">
														Content digest: {artifact.digest}
													</p>
													<div className="button-group">
														<a
															className="button primary"
															href={`/api/v1/exports/${artifact.id}/download`}
														>
															Download approved text{" "}
															<span aria-hidden="true">↓</span>
														</a>
														<button
															className="button secondary"
															onClick={() => window.print()}
														>
															Print approved preview
														</button>
													</div>
												</section>
											)}
										</>
									)}
									<section className="cycle-actions panel">
										<h3>Continue this request</h3>
										<p>
											New cycles preserve previous source snapshots, revisions,
											and approvals.
										</p>
										<div className="button-group">
											{contributor && detail.cycle.status !== "Generating" && (
												<button
													className="button secondary"
													disabled={busy}
													onClick={() =>
														child(
															detail.cycle.status === "Rejected"
																? "restart_after_rejection"
																: "correct_source",
														)
													}
												>
													{detail.cycle.status === "Rejected"
														? "Restart after rejection"
														: "Correct source in new cycle"}
												</button>
											)}
											{reviewer &&
												["Approved", "ReadyForPublication"].includes(
													detail.cycle.status,
												) && (
													<button
														className="button secondary"
														disabled={busy || withdrawn}
														onClick={() => child("regenerate")}
													>
														Create regeneration cycle
													</button>
												)}
											{contributor && detail.snapshot && !withdrawn && (
												<button
													className="button danger-text"
													disabled={busy}
													onClick={() => setModal("withdraw")}
												>
													Withdraw source consent…
												</button>
											)}
										</div>
									</section>
									{history && (
										<section className="panel history-panel">
											<details>
												<summary>History & provenance</summary>
												<p className="help-text">
													Append-only application records in a disposable
													dataset. They are not tamper-proof against the local
													host owner.
												</p>
												{history.decisions.map((decision) => (
													<div className="history-entry" key={decision.id}>
														<strong>
															{statusLabel(
																decision.decision.replaceAll("_", " "),
															)}
														</strong>
														<time>{dateLabel(decision.created_at)}</time>
														{decision.reason && <p>{decision.reason}</p>}
													</div>
												))}
												{history.attempts.map((attempt, index) => (
													<div
														className="history-entry"
														key={attempt.id ?? index}
													>
														<strong>Mock attempt · {attempt.state}</strong>
														{(attempt.failure_code ??
															attempt.safe_failure_code) && (
															<p>
																Failure:{" "}
																{attempt.failure_code ??
																	attempt.safe_failure_code}
															</p>
														)}
													</div>
												))}
												{history.events.map((event) => (
													<div className="history-entry" key={event.id}>
														<strong>
															{(event.event_type ?? "Event").replaceAll(
																"_",
																" ",
															)}
														</strong>
														<time>{dateLabel(event.created_at)}</time>
													</div>
												))}
												{history.next_cursor && (
													<button
														className="button secondary"
														onClick={() =>
															run(async () => {
																const next = await api<History>(
																	`/cycles/${detail.cycle.id}/history?cursor=${encodeURIComponent(history.next_cursor!)}`,
																);
																setHistory({
																	revisions: [
																		...history.revisions,
																		...next.revisions,
																	],
																	decisions: [
																		...history.decisions,
																		...next.decisions,
																	],
																	attempts: [
																		...history.attempts,
																		...next.attempts,
																	],
																	events: [...history.events, ...next.events],
																	next_cursor: next.next_cursor,
																});
															})
														}
													>
														Load more history
													</button>
												)}
											</details>
										</section>
									)}
								</>
							)}
						</div>
					</div>
				)}
			</main>
			<footer>
				<span>NORTH VALLEY UNIVERSITY · FICTIONAL DEMONSTRATION</span>
				<span>Source → Review → Approval → Local handoff</span>
				{session && (
					<button
						className="text-button"
						disabled={busy}
						onClick={() =>
							navigate(async () => {
								await mutate("/session", {}, "DELETE");
								setSession(null);
								setDetail(null);
								setHistory(null);
								setArtifact(null);
								setNotice("Session ended. The fictional dataset is retained.");
							})
						}
					>
						End session
					</button>
				)}
			</footer>
			{pendingNavigation && (
				<Dialog
					title="Discard unsaved changes?"
					close={() => finishNavigation(false)}
				>
					<p>Your changes have not been saved. Discard them to continue?</p>
					<button
						className="button danger"
						onClick={() => finishNavigation(true)}
					>
						Discard changes
					</button>
				</Dialog>
			)}
			{modal && (
				<Dialog
					title={
						modal === "roles"
							? "Switch simulated role"
							: modal === "approve"
								? "Approve this exact revision?"
								: modal === "request_changes"
									? "Request changes"
									: modal === "reject"
										? "Reject this cycle?"
										: modal === "restore"
											? "Preview restored wording"
											: modal === "withdraw"
												? "Withdraw source consent?"
												: "Reset the fictional dataset?"
					}
					close={() => {
						if (!busy) setModal(null);
					}}
				>
					{error && (
						<div
							className="dialog-error"
							role="alert"
							tabIndex={-1}
							ref={errorRef}
						>
							{error.message} ({error.code})
						</div>
					)}
					{modal === "roles" && (
						<>
							<p>
								Local demo — roles are simulated, not verified identities.
								Switching replaces the current session. You can cancel before
								discarding any unsaved edits.
							</p>
							<div className="role-cards">
								{roles.map((role) => (
									<button
										className="role-card"
										key={role}
										disabled={busy}
										onClick={() => chooseRole(role)}
									>
										<span>
											<strong>{role}</strong>
											<span>{roleDescriptions[role]}</span>
										</span>
										<span aria-hidden="true">→</span>
									</button>
								))}
							</div>
						</>
					)}
					{modal === "approve" && (
						<>
							<p>
								Approve revision{" "}
								<strong>{detail?.current_revision?.sequence}</strong> for{" "}
								<strong>{detail?.snapshot?.source.graduate_name}</strong>?
							</p>
							<p className="code">Revision ID: {cycle?.current_revision_id}</p>
							<p>
								The server rechecks consent and validation before recording your
								decision. The approved content remains unchanged, and
								preparation happens separately.
							</p>
							<button
								className="button primary"
								disabled={busy}
								onClick={() => decide("approve")}
							>
								Confirm approval of revision{" "}
								{detail?.current_revision?.sequence}
							</button>
						</>
					)}
					{(modal === "request_changes" || modal === "reject") && (
						<>
							<p>
								{modal === "reject"
									? "Rejection is terminal for this cycle. The contributor can begin a separate restart cycle."
									: "Record what should change. Review notes do not change the frozen facts or become mock-provider instructions."}
							</p>
							<label>
								Reason *
								<textarea
									autoComplete="off"
									rows={5}
									value={reason}
									onChange={(event) => setReason(event.target.value)}
								/>
								<small>1–500 characters. Fictional information only.</small>
							</label>
							<button
								className={`button ${modal === "reject" ? "danger" : "primary"}`}
								disabled={busy || !reason.trim()}
								onClick={() => decide(modal)}
							>
								Confirm{" "}
								{modal === "reject" ? "rejection" : "request for changes"}
							</button>
						</>
					)}
					{modal === "restore" && restore && (
						<>
							<p>
								This proposed replacement is built from the frozen source. It
								restores all text and read-only facts, clears advisory lists,
								and creates a new revision only when you save.
							</p>
							<CandidateText content={restore} />
							<button
								className="button primary"
								disabled={busy}
								onClick={() => saveRevision(restore)}
							>
								Save restored wording as new revision
							</button>
						</>
					)}
					{modal === "withdraw" && (
						<>
							<p>
								This permanently withdraws fictional consent for source{" "}
								<strong>{detail?.snapshot?.id}</strong> within this dataset.
								Related generation, approval, preparation, preview, and download
								will be blocked. Historical records remain.
							</p>
							<p>
								Already downloaded files cannot be recalled. A new source
								submission requires fresh acknowledgment.
							</p>
							<button
								className="button danger"
								disabled={busy}
								onClick={() =>
									run(async () => {
										await mutate(
											`/snapshots/${detail!.snapshot!.id}/withdraw-consent`,
										);
										setModal(null);
										await loadCycle(cycle!.id);
										await loadQueue();
										setNotice(
											"Consent withdrawn. Protected actions and artifact access are blocked for this source.",
										);
									})
								}
							>
								Withdraw consent for this source
							</button>
						</>
					)}
					{modal === "reset" && (
						<>
							<p>
								Remove every local fictional request, source, revision,
								approval, artifact, and audit event. All sessions will end.
								Downloaded files remain on your device. This is application
								deletion, not forensic secure erasure.
							</p>
							<label>
								Type RESET FICTIONAL DEMO to confirm
								<input
									autoComplete="off"
									value={confirmation}
									onChange={(event) => setConfirmation(event.target.value)}
								/>
							</label>
							<button
								className="button danger"
								disabled={busy || confirmation !== "RESET FICTIONAL DEMO"}
								onClick={() =>
									run(async () => {
										await mutate("/demo/reset", { confirmation });
										setModal(null);
										setSession(null);
										setDetail(null);
										setHistory(null);
										setArtifact(null);
										setRequests([]);
										setNotice(
											"The fictional dataset was reset. Select a role to start again.",
										);
									})
								}
							>
								Permanently reset fictional dataset
							</button>
						</>
					)}
				</Dialog>
			)}
		</>
	);
}
