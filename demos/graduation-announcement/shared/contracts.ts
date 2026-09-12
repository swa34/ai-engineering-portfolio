import { z } from "zod";

export type Finding = {
	code: string;
	severity: "blocking" | "advisory";
	path: string;
	message: string;
};
const length = (value: string) => [...value].length;
const bounded = (max: number) =>
	z
		.string()
		.refine(
			(value) => length(value) >= 1 && length(value) <= max,
			`Use 1–${max} characters.`,
		);
const sourceText = (max: number) =>
	z
		.string()
		.transform((value) => value.trim().normalize("NFC"))
		.pipe(bounded(max))
		.refine(
			(value) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value),
			"Use single-line text without control characters.",
		);
const optionalText = (max: number) =>
	z.preprocess(
		(value) => (typeof value === "string" && !value.trim() ? null : value),
		sourceText(max).nullable(),
	);
const uniqueArray = (max: number) =>
	z
		.array(sourceText(max))
		.max(3)
		.refine(
			(values) => new Set(values).size === values.length,
			"Use distinct items.",
		);
const degree = z.enum([
	"Bachelor of Arts",
	"Bachelor of Science",
	"Master of Arts",
	"Master of Science",
	"Doctor of Philosophy",
]);
const preferences = z.strictObject({
	tone: z.enum(["professional", "warm"]),
	length: z.enum(["brief", "standard"]),
	channel: z.enum(["web", "social"]),
});
const fields = {
	institution: z.literal("North Valley University"),
	graduate_name: sourceText(80),
	degree,
	program: sourceText(100),
	graduation_year: z.number().int().min(2000).max(2100),
	honors: uniqueArray(60),
	activities: uniqueArray(100),
	quote: optionalText(240),
	future_plan: optionalText(160),
	preferences,
	consent: z.boolean(),
	fictional_data_acknowledged: z.boolean(),
};
export const SourceInputSchema = z
	.strictObject(fields)
	.superRefine((value, context) => {
		for (const key of ["consent", "fictional_data_acknowledged"] as const) {
			if (!value[key])
				context.addIssue({
					code: "custom",
					path: [key],
					message: "Confirm this acknowledgment before submitting.",
				});
		}
	});
export const DraftSourceSchema = z.strictObject({
	...fields,
	graduate_name: fields.graduate_name.nullable(),
	degree: degree.nullable(),
	program: fields.program.nullable(),
	graduation_year: fields.graduation_year.nullable(),
	preferences: preferences.nullable(),
	consent: z.boolean().nullable(),
});
export const factNames = [
	"graduate_name",
	"degree",
	"program",
	"graduation_year",
	"honors",
	"activities",
	"quote",
	"future_plan",
] as const;
export const CandidateOutputSchema = z.strictObject({
	schema_version: z.literal("1"),
	template_id: z.enum(["professional-v1", "warm-v1"]),
	headline: bounded(180),
	announcement_body: bounded(3000),
	short_social_version: bounded(500),
	facts_used: z.strictObject({
		graduate_name: bounded(80),
		degree,
		program: bounded(100),
		graduation_year: fields.graduation_year,
		honors: z.array(bounded(60)).max(3),
		activities: z.array(bounded(100)).max(3),
		quote: bounded(240).nullable(),
		future_plan: bounded(160).nullable(),
	}),
	potentially_unsupported_claims: z.array(bounded(200)).max(8),
	missing_information: z
		.array(z.enum(factNames))
		.max(8)
		.refine(
			(values) => new Set(values).size === values.length,
			"Use distinct field names.",
		),
	editor_notes: z.array(bounded(200)).max(5),
});
export type SourceInput = z.infer<typeof SourceInputSchema>;
export type DraftSource = z.infer<typeof DraftSourceSchema>;
export type CandidateOutput = z.infer<typeof CandidateOutputSchema>;
export const sourceInputSchema = SourceInputSchema;
export const draftSourceSchema = DraftSourceSchema;
export const candidateOutputSchema = CandidateOutputSchema;

export function emptyDraft(): DraftSource {
	return {
		institution: "North Valley University",
		graduate_name: null,
		degree: null,
		program: null,
		graduation_year: null,
		honors: [],
		activities: [],
		quote: null,
		future_plan: null,
		preferences: null,
		consent: null,
		fictional_data_acknowledged: false,
	};
}

/** Literal composition from the frozen source, never provider-supplied templates. */
export function compose(
	source: Omit<SourceInput, "consent" | "fictional_data_acknowledged">,
): CandidateOutput {
	const {
		graduate_name: name,
		degree,
		program,
		graduation_year: year,
	} = source;
	const standard = source.preferences.length === "standard";
	const warm = source.preferences.tone === "warm";
	const paragraphs = [
		`${name} graduates from North Valley University in ${year} with a ${degree} in ${program}.`,
	];
	if (standard) {
		if (source.honors.length)
			paragraphs.push(`Honors: ${source.honors.join("; ")}.`);
		if (source.activities.length)
			paragraphs.push(`Activities: ${source.activities.join("; ")}.`);
		if (source.quote) paragraphs.push(`Graduate statement: "${source.quote}"`);
		if (source.future_plan)
			paragraphs.push(`Future plans (as submitted): ${source.future_plan}`);
	}
	return {
		schema_version: "1",
		template_id: warm ? "warm-v1" : "professional-v1",
		headline: warm
			? `Congratulations, ${name}!`
			: `${name} graduates from North Valley University`,
		announcement_body: paragraphs.join("\n\n"),
		short_social_version: warm
			? `Congratulations to ${name}, a ${year} North Valley University graduate with a ${degree} in ${program}!`
			: `${name} graduates in ${year} with a ${degree} in ${program} from North Valley University.`,
		facts_used: {
			graduate_name: name,
			degree,
			program,
			graduation_year: year,
			honors: standard ? [...source.honors] : [],
			activities: standard ? [...source.activities] : [],
			quote: standard ? source.quote : null,
			future_plan: standard ? source.future_plan : null,
		},
		potentially_unsupported_claims: [],
		missing_information: [],
		editor_notes: [],
	};
}

const detectors: [string, RegExp][] = [
	["email", /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu],
	["url", /https?:\/\//iu],
	[
		"phone",
		/(?:\+?1[ .-]?)?(?:\(\d{3}\)[ .-]?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/u,
	],
	["ssn", /\b\d{3}-\d{2}-\d{4}\b/u],
	["credential", /sk-proj-|begin private key|password\s*=/iu],
];
const instructionPattern =
	/ignore previous instructions|ignore all instructions|system prompt|approve automatically/iu;

/** Safe category/path findings only; no matched text escapes this function. */
export function screen(
	value: unknown,
	options: { instructions?: boolean } = {},
): Finding[] {
	const findings: Finding[] = [];
	const visit = (item: unknown, path: string) => {
		if (typeof item === "string") {
			const text = item.normalize("NFC").toLowerCase();
			for (const [category, pattern] of detectors)
				if (pattern.test(text)) {
					findings.push({
						code: "SENSITIVE_CONTENT",
						severity: "blocking",
						path,
						message: `Remove ${category}-like text; use fictional information only.`,
					});
				}
			if (options.instructions && instructionPattern.test(text))
				findings.push({
					code: "INSTRUCTION_LIKE_CONTENT",
					severity: "blocking",
					path,
					message: "Remove instruction-like text from this field.",
				});
		} else if (Array.isArray(item))
			item.forEach((child, index) => visit(child, `${path}[${index}]`));
		else if (item && typeof item === "object")
			Object.entries(item).forEach(([key, child]) =>
				visit(child, path ? `${path}.${key}` : key),
			);
	};
	visit(value, "");
	return findings;
}

export function validateCandidate(
	source: SourceInput,
	content: CandidateOutput,
): Finding[] {
	const expected = compose(source);
	const findings = screen(content, { instructions: true });
	const add = (code: string, path: string, message: string) =>
		findings.push({ code, severity: "blocking", path, message });
	for (const key of factNames)
		if (
			JSON.stringify(content.facts_used[key]) !==
			JSON.stringify(expected.facts_used[key])
		)
			add(
				"FACT_MISMATCH",
				`facts_used.${key}`,
				"This fact does not match the submitted source and length preference.",
			);
	for (const key of [
		"headline",
		"announcement_body",
		"short_social_version",
	] as const)
		if (content[key] !== expected[key])
			add(
				"NARRATIVE_MISMATCH",
				key,
				"Wording must match the source-based template. Restore wording or correct the source in a new cycle.",
			);
	if (content.template_id !== expected.template_id)
		add(
			"TONE_MISMATCH",
			"template_id",
			"The template does not match the submitted tone.",
		);
	if (content.potentially_unsupported_claims.length)
		add(
			"PROVIDER_CONCERN",
			"potentially_unsupported_claims",
			"Resolve every unsupported-claim concern before approval.",
		);
	if (content.missing_information.length)
		add(
			"MISSING_INFORMATION",
			"missing_information",
			"Resolve every missing-information concern before approval.",
		);
	return findings;
}
