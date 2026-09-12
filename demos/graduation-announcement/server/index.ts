import express from "express";
import { resolve } from "node:path";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
	throw new Error("PORT must be an integer from 1 to 65535.");
const origin =
	process.env.UI_ORIGIN ??
	(process.env.NODE_ENV === "production"
		? `http://localhost:${port}`
		: "http://localhost:5173");
const app = createApp({
	databasePath: process.env.DATABASE_PATH ?? "data/demo.sqlite",
	origin,
	allowedHosts: [
		new URL(origin).host,
		`localhost:${port}`,
		`127.0.0.1:${port}`,
	],
});
if (process.env.NODE_ENV === "production") {
	app.use(express.static(resolve("dist/web")));
	app.get("/{*path}", (_req, res) =>
		res.sendFile(resolve("dist/web/index.html")),
	);
}
const server = app.listen(port, "127.0.0.1", (error?: Error) => {
	if (error) {
		console.error(
			"The local demo could not bind its loopback port. Check port availability and permissions.",
		);
		app.locals.close();
		process.exitCode = 1;
		return;
	}
	console.info(
		`Fictional mock demo API: http://localhost:${port} (loopback only)`,
	);
});
const stop = () => {
	server.close(() => {
		app.locals.close();
		process.exit(0);
	});
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
