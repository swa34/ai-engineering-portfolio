export class ApiError extends Error {
	constructor(
		public code: string,
		message: string,
		public fields: unknown = null,
		public retryAfter = 0,
		public status = 0,
	) {
		super(message);
	}
}

let readPauseUntil = 0;
// Retain each uncertain delivery independently until its result is known. Never
// evict an unresolved key: a lost successful response may already have committed.
const uncertainMutations = new Map<string, string>();
let mutationSession: string | undefined;
const maxUncertainMutations = 64;

function setRetrySession(scope: string) {
	if (mutationSession !== scope) {
		uncertainMutations.clear();
		mutationSession = scope;
	}
}
export async function api<T>(
	path: string,
	options: {
		method?: string;
		body?: unknown;
		csrf?: string;
		signal?: AbortSignal;
		automatic?: boolean;
	} = {},
): Promise<T> {
	if (options.automatic && Date.now() < readPauseUntil)
		throw new ApiError(
			"READ_BACKOFF",
			"Automatic refresh is paused briefly.",
			null,
			Math.ceil((readPauseUntil - Date.now()) / 1000),
			429,
		);
	const method = options.method ?? "GET";
	const mutation = method !== "GET";
	const body = mutation ? JSON.stringify(options.body ?? {}) : undefined;
	if (mutation) setRetrySession(options.csrf ?? "initial");
	const issuingSession = mutationSession;
	const signature = `${method} ${path} ${body ?? ""}`;
	let key = "";
	if (mutation) {
		const pending = uncertainMutations.get(signature);
		if (!pending && uncertainMutations.size >= maxUncertainMutations)
			throw new ApiError(
				"PENDING_REQUEST_LIMIT",
				"Too many requests have an unknown result. Reconnect and retry a pending action before starting another.",
			);
		key = pending ?? crypto.randomUUID();
		uncertainMutations.set(signature, key);
	}
	const response = await fetch(`/api/v1${path}`, {
		method,
		credentials: "same-origin",
		signal: options.signal,
		headers: mutation
			? {
					"Content-Type": "application/json",
					"Idempotency-Key": key,
					...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
				}
			: {},
		...(mutation ? { body } : {}),
	});
	const data = response.status === 204 ? null : await response.json();
	if (mutationSession === issuingSession) {
		if (
			mutation &&
			response.status !== 503 &&
			uncertainMutations.get(signature) === key
		)
			uncertainMutations.delete(signature);
		if (
			response.status === 401 ||
			(response.ok &&
				((path === "/session" && method === "DELETE") ||
					path === "/demo/reset"))
		) {
			uncertainMutations.clear();
			mutationSession = undefined;
		} else if (response.ok && typeof data?.csrf_token === "string") {
			setRetrySession(data.csrf_token);
		}
	}
	if (!response.ok) {
		const retryAfter = Math.max(
			1,
			Number(response.headers.get("Retry-After")) || 1,
		);
		if (response.status === 429)
			readPauseUntil = Date.now() + retryAfter * 1000;
		throw new ApiError(
			data?.error?.code ?? "REQUEST_FAILED",
			data?.error?.message ?? "The request could not be completed.",
			data?.error?.fields,
			retryAfter,
			response.status,
		);
	}
	return data as T;
}
