import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Each checkpoint records evidence separately; a pass covers only this DOM state. */
export async function checkAccessibility(page: Page, checkpoint: string) {
	const result = await new AxeBuilder({ page }).analyze();
	await test.info().attach(`accessibility-${checkpoint}`, {
		body: JSON.stringify(
			{
				checkpoint,
				browser: await page.evaluate(() => navigator.userAgent),
				viewport: page.viewportSize(),
				axeVersion: result.testEngine.version,
				violations: result.violations,
				incomplete: result.incomplete.map(({ id, impact }) => ({ id, impact })),
				passedRules: result.passes.map(({ id }) => id),
			},
			null,
			2,
		),
		contentType: "application/json",
	});
	expect(
		result.violations,
		`Accessibility violations at ${checkpoint}`,
	).toEqual([]);
}

export async function checkNarrowReflow(page: Page) {
	await page.setViewportSize({ width: 320, height: 900 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	const dimensions = await page.evaluate(() => ({
		viewport: document.documentElement.clientWidth,
		content: document.documentElement.scrollWidth,
		body: document.body.scrollWidth,
	}));
	expect(
		dimensions.content,
		"Page must not scroll horizontally at 320 CSS pixels",
	).toBeLessThanOrEqual(dimensions.viewport);
	expect(
		dimensions.body,
		"Body must reflow at 320 CSS pixels",
	).toBeLessThanOrEqual(dimensions.viewport);
}

export function monitorExternalRequests(page: Page) {
	const unexpected: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (
			["http:", "https:"].includes(url.protocol) &&
			url.origin !== "http://localhost:3001"
		) {
			unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
		}
	});
	return unexpected;
}
