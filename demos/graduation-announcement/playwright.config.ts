import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/browser",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 45_000,
	expect: { timeout: 10_000 },
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: "http://localhost:3001",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		...devices["Desktop Chrome"],
	},
	webServer: {
		command: "npm run build && npm start",
		url: "http://localhost:3001",
		timeout: 120_000,
		reuseExistingServer: false,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			PORT: "3001",
			UI_ORIGIN: "http://localhost:3001",
			DATABASE_PATH: `/tmp/graduation-browser-${process.pid}.sqlite`,
		},
	},
});
