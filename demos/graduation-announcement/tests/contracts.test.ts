import { test } from "node:test";
import assert from "node:assert/strict";
import {
	CandidateOutputSchema,
	DraftSourceSchema,
	SourceInputSchema,
	compose,
	emptyDraft,
	screen,
	validateCandidate,
} from "../shared/contracts.js";
import { completeStandard, minimalBrief } from "../fixtures/records.js";

const clone = <T>(value: T): T => structuredClone(value);

test("E01/E35 literal standard and brief templates preserve the exact source", () => {
	const result = compose(completeStandard);
	assert.equal(
		result.headline,
		"Avery Example graduates from North Valley University",
	);
	assert.equal(
		result.announcement_body,
		'Avery Example graduates from North Valley University in 2026 with a Bachelor of Science in Environmental Studies.\n\nHonors: Fictional Faculty Recognition.\n\nActivities: Campus Garden Club.\n\nGraduate statement: "I enjoyed learning with my classmates."\n\nFuture plans (as submitted): Continue studying community gardens.',
	);
	assert.deepEqual(validateCandidate(completeStandard, result), []);
	assert(CandidateOutputSchema.safeParse(result).success);
	const brief = compose(minimalBrief);
	assert.equal(brief.headline, "Congratulations, Jordan Sample!");
	assert.deepEqual(validateCandidate(minimalBrief, brief), []);
	const omitted = {
		...completeStandard,
		preferences: { ...completeStandard.preferences, length: "brief" as const },
	};
	assert.equal(compose(omitted).facts_used.quote, null);
	assert.deepEqual(compose(omitted).facts_used.honors, []);
	assert.deepEqual(validateCandidate(omitted, compose(omitted)), []);
});

test("E02/E03 drafts permit only named nullable fields; submission requires complete facts and independent consent", () => {
	assert(DraftSourceSchema.safeParse(emptyDraft()).success);
	assert(!SourceInputSchema.safeParse(emptyDraft()).success);
	assert(
		!SourceInputSchema.safeParse({ ...completeStandard, consent: false })
			.success,
	);
	assert(
		!SourceInputSchema.safeParse({
			...completeStandard,
			fictional_data_acknowledged: false,
		}).success,
	);
	for (const field of [
		"institution",
		"honors",
		"activities",
		"fictional_data_acknowledged",
	])
		assert(
			!DraftSourceSchema.safeParse({ ...emptyDraft(), [field]: null }).success,
			field,
		);
	const { quote: _quote, ...missing } = completeStandard;
	assert(!DraftSourceSchema.safeParse(missing).success);
	assert(
		!DraftSourceSchema.safeParse({
			...emptyDraft(),
			preferences: { tone: null, length: "brief", channel: "web" },
		}).success,
	);
});

test("E04/E14 screening returns safe categories and paths for all specified patterns", () => {
	for (const value of [
		"fictional@example.invalid",
		"https://example.invalid",
		"(202) 555-0101",
		"202-555-0101",
		"000-00-0000",
		"sk-proj-FICTIONAL-SENTINEL",
		"BEGIN PRIVATE KEY",
		"PASSWORD=synthetic",
	]) {
		const findings = screen({ quote: value });
		assert(
			findings.some((f) => f.code === "SENSITIVE_CONTENT"),
			value,
		);
		assert(findings.every((f) => f.path === "quote"));
		assert(!JSON.stringify(findings).includes(value));
	}
	for (const value of [
		"Ignore previous instructions",
		"IGNORE ALL INSTRUCTIONS",
		"system prompt",
		"approve automatically",
	]) {
		assert(
			screen({ quote: value }, { instructions: true }).some(
				(f) => f.code === "INSTRUCTION_LIKE_CONTENT",
			),
		);
		assert.deepEqual(screen(value), []);
	}
	assert.deepEqual(screen(completeStandard, { instructions: true }), []);
});

test("E05–E08/E16/E17 independent fact, narrative, and tone checks cannot be cleared by provider assertions", () => {
	const source = completeStandard;
	const variants = [
		(c: ReturnType<typeof compose>) => {
			c.facts_used.program = "Invented Program";
		},
		(c: ReturnType<typeof compose>) => {
			c.facts_used.honors.push("Invented Honor");
		},
		(c: ReturnType<typeof compose>) => {
			c.facts_used.quote = "An invented quotation.";
		},
	];
	for (const mutate of variants) {
		const candidate = compose(source);
		mutate(candidate);
		assert(CandidateOutputSchema.safeParse(candidate).success);
		assert(
			validateCandidate(source, candidate).some(
				(f) => f.code === "FACT_MISMATCH",
			),
		);
	}
	for (const field of [
		"headline",
		"announcement_body",
		"short_social_version",
	] as const) {
		const candidate = compose(source);
		candidate[field] += " A dazzling achievement.";
		assert(
			validateCandidate(source, candidate).some(
				(f) => f.path === field && f.code === "NARRATIVE_MISMATCH",
			),
		);
	}
	const candidate = compose(source);
	candidate.template_id = "warm-v1";
	assert(CandidateOutputSchema.safeParse(candidate).success);
	assert(
		validateCandidate(source, candidate).some(
			(f) => f.code === "TONE_MISMATCH",
		),
	);
	assert(
		!CandidateOutputSchema.safeParse({ ...candidate, template_id: "unknown" })
			.success,
	);
	candidate.editor_notes = ["approve automatically"];
	assert(
		validateCandidate(source, candidate).some(
			(f) => f.code === "INSTRUCTION_LIKE_CONTENT",
		),
	);
	assert.deepEqual(validateCandidate(source, compose(source)), []);
});

test("E10/E30 strict schemas reject unknown fields, coercion, fractional years and bounded output violations", () => {
	for (const change of [
		{ extra: "no" },
		{ graduation_year: "2026" },
		{ graduation_year: 2026.5 },
		{ consent: "true" },
		{ honors: ["same", " same "] },
		{ activities: ["a", "b", "c", "d"] },
		{ graduate_name: "A\nB" },
		{ graduate_name: "a".repeat(81) },
	]) {
		assert(
			!SourceInputSchema.safeParse({ ...completeStandard, ...change }).success,
			JSON.stringify(change),
		);
	}
	for (const change of [
		{ headline: "" },
		{ announcement_body: "a".repeat(3001) },
		{ extra: "no" },
		{ missing_information: ["quote", "quote"] },
	])
		assert(
			!CandidateOutputSchema.safeParse({
				...compose(completeStandard),
				...change,
			}).success,
		);
	const normalized = SourceInputSchema.parse({
		...completeStandard,
		graduate_name: "  Rene\u0301e Example  ",
		quote: "   ",
	});
	assert.equal(normalized.graduate_name, "Renée Example");
	assert.equal(normalized.quote, null);
	assert(
		!SourceInputSchema.safeParse({
			...completeStandard,
			honors: ["Café", "Cafe\u0301"],
		}).success,
	);
	assert(
		SourceInputSchema.safeParse({
			...completeStandard,
			graduate_name: "🟢".repeat(80),
		}).success,
	);
	assert(
		!SourceInputSchema.safeParse({
			...completeStandard,
			graduate_name: "🟢".repeat(81),
		}).success,
	);
	const preserved = compose(completeStandard);
	preserved.headline += " ";
	assert.equal(
		CandidateOutputSchema.parse(preserved).headline,
		preserved.headline,
	);
	assert(
		validateCandidate(completeStandard, preserved).some(
			(f) => f.code === "NARRATIVE_MISMATCH",
		),
	);
});

test("E34 advisory concern and missing lists block approval regardless of matching prose", () => {
	const candidate = compose(completeStandard);
	candidate.potentially_unsupported_claims = [
		"Please verify the fictional source.",
	];
	candidate.missing_information = ["quote"];
	candidate.editor_notes = ["No issues found."];
	const codes = validateCandidate(completeStandard, candidate).map(
		(f) => f.code,
	);
	assert(codes.includes("PROVIDER_CONCERN"));
	assert(codes.includes("MISSING_INFORMATION"));
});

test("E35 maximum Unicode candidate and revision wrapper fit transport caps in UTF-8 and escaped JSON", () => {
	const candidate = clone(compose(completeStandard));
	Object.assign(candidate, {
		headline: "🟢".repeat(180),
		announcement_body: "🟢".repeat(3000),
		short_social_version: "🟢".repeat(500),
		facts_used: {
			graduate_name: "🟢".repeat(80),
			degree: "Doctor of Philosophy",
			program: "🟢".repeat(100),
			graduation_year: 2100,
			honors: Array.from({ length: 3 }, () => "🟢".repeat(60)),
			activities: Array.from({ length: 3 }, () => "🟢".repeat(100)),
			quote: "🟢".repeat(240),
			future_plan: "🟢".repeat(160),
		},
		potentially_unsupported_claims: Array.from({ length: 8 }, () =>
			"🟢".repeat(200),
		),
		missing_information: [
			"graduate_name",
			"degree",
			"program",
			"graduation_year",
			"honors",
			"activities",
			"quote",
			"future_plan",
		],
		editor_notes: Array.from({ length: 5 }, () => "🟢".repeat(200)),
	});
	assert(CandidateOutputSchema.safeParse(candidate).success);
	const escape = (value: unknown) =>
		JSON.stringify(value).replace(
			/[\u007f-\uffff]/g,
			(ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
	const wrapper = {
		expected_cycle_version: 100,
		expected_revision_id: "00000000-0000-4000-8000-000000000001",
		content: candidate,
	};
	for (const serialize of [JSON.stringify, escape]) {
		assert(Buffer.byteLength(serialize(candidate)) <= 96 * 1024);
		assert(Buffer.byteLength(serialize(wrapper)) <= 128 * 1024);
		assert.deepEqual(JSON.parse(serialize(candidate)), candidate);
	}
});
