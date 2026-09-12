import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

type ApiModule = typeof import("../web/api.js");
async function freshApi(): Promise<ApiModule> {
	return import(
		`${new URL("../web/api.ts", import.meta.url).href}?test=${randomUUID()}`
	);
}
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
const requestKey = (init?: RequestInit) =>
	new Headers(init?.headers).get("Idempotency-Key");

test("client retry preserves a lost committed creation across an intervening mutation without duplicate effects", async () => {
	const { api } = await freshApi();
	const original = globalThis.fetch;
	const receipts = new Map<string, unknown>();
	const keys: string[] = [];
	let effects = 0;
	globalThis.fetch = async (url, init) => {
		if (String(url).endsWith("/requests")) {
			const key = requestKey(init)!;
			keys.push(key);
			if (receipts.has(key)) return json(receipts.get(key), 201);
			const outcome = { cycle: { id: `created-${++effects}` } };
			receipts.set(key, outcome);
			if (effects === 1)
				throw new TypeError("Simulated lost committed response");
			return json(outcome, 201);
		}
		return json({ saved: true });
	};
	try {
		const options = { method: "POST", body: {}, csrf: "session-one" };
		await assert.rejects(api("/requests", options));
		await api("/cycles/example/draft", {
			method: "PUT",
			body: { source: "different fictional action" },
			csrf: "session-one",
		});
		assert.deepEqual(await api("/requests", options), {
			cycle: { id: "created-1" },
		});
		assert.equal(effects, 1);
		assert.equal(keys[1], keys[0]);
		await api("/requests", options);
		assert.equal(effects, 2);
		assert.notEqual(keys[2], keys[0]);
	} finally {
		globalThis.fetch = original;
	}
});

test("client retains independent 503 keys while retiring known outcomes and separating changed payloads", async () => {
	const { api } = await freshApi();
	const original = globalThis.fetch;
	const deliveries: { path: string; key: string; body: string }[] = [];
	let unavailable = true;
	globalThis.fetch = async (url, init) => {
		deliveries.push({
			path: String(url),
			key: requestKey(init)!,
			body: String(init?.body),
		});
		return unavailable
			? json({ error: { code: "STORAGE_BUSY", message: "Retry later." } }, 503)
			: json({ saved: true });
	};
	try {
		const options = { method: "POST", csrf: "session-one" };
		await assert.rejects(api("/first", { ...options, body: { value: "one" } }));
		await assert.rejects(
			api("/second", { ...options, body: { value: "two" } }),
		);
		unavailable = false;
		await api("/first", { ...options, body: { value: "changed" } });
		await api("/first", { ...options, body: { value: "one" } });
		await api("/second", { ...options, body: { value: "two" } });
		assert.notEqual(deliveries[0].key, deliveries[2].key);
		assert.equal(deliveries[0].key, deliveries[3].key);
		assert.equal(deliveries[1].key, deliveries[4].key);
	} finally {
		globalThis.fetch = original;
	}
});

test("client does not reuse unresolved keys across session replacement or expiry", async () => {
	const { api } = await freshApi();
	const original = globalThis.fetch;
	const keys: string[] = [];
	globalThis.fetch = async (url, init) => {
		if (String(url).endsWith("/demo-session"))
			return json({ csrf_token: "session-two" }, 201);
		if (String(url).endsWith("/session"))
			return json(
				{ error: { code: "SESSION_REQUIRED", message: "Select a role." } },
				401,
			);
		keys.push(requestKey(init)!);
		throw new TypeError("Simulated lost response");
	};
	try {
		await assert.rejects(
			api("/requests", { method: "POST", csrf: "session-one" }),
		);
		await api("/demo-session", {
			method: "POST",
			csrf: "session-one",
			body: { actor: "reviewer" },
		});
		await assert.rejects(
			api("/requests", { method: "POST", csrf: "session-two" }),
		);
		assert.notEqual(keys[1], keys[0]);
		await assert.rejects(api("/session"));
		await assert.rejects(
			api("/requests", { method: "POST", csrf: "session-two" }),
		);
		assert.notEqual(keys[2], keys[1]);
	} finally {
		globalThis.fetch = original;
	}
});

test("client bounds unresolved deliveries without evicting keys needed for an explicit retry", async () => {
	const { api } = await freshApi();
	const original = globalThis.fetch;
	const keys: string[] = [];
	globalThis.fetch = async (_url, init) => {
		keys.push(requestKey(init)!);
		throw new TypeError("Offline");
	};
	try {
		for (let i = 0; i < 64; i++)
			await assert.rejects(
				api("/requests", {
					method: "POST",
					csrf: "session-one",
					body: { item: i },
				}),
			);
		await assert.rejects(
			api("/requests", {
				method: "POST",
				csrf: "session-one",
				body: { item: 64 },
			}),
			(error) =>
				error instanceof Error &&
				"code" in error &&
				error.code === "PENDING_REQUEST_LIMIT",
		);
		assert.equal(keys.length, 64);
		await assert.rejects(
			api("/requests", {
				method: "POST",
				csrf: "session-one",
				body: { item: 0 },
			}),
		);
		assert.equal(keys[64], keys[0]);
	} finally {
		globalThis.fetch = original;
	}
});
