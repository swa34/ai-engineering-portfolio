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
// Keep the same delivery key for an explicit retry after a lost response or a
// pre-commit storage failure. The token scopes this to the issuing session.
let uncertainMutation: { signature: string; key: string } | null = null;
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
	const signature = `${options.csrf ?? "initial"} ${method} ${path} ${body ?? ""}`;
	const key = mutation
		? uncertainMutation?.signature === signature
			? uncertainMutation.key
			: crypto.randomUUID()
		: "";
	if (mutation) uncertainMutation = { signature, key };
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
	if (mutation && response.status !== 503 && uncertainMutation?.key === key)
		uncertainMutation = null;
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
