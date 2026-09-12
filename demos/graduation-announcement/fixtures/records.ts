import type { SourceInput } from "../shared/contracts.js";

export const completeStandard: SourceInput = {
	institution: "North Valley University",
	graduate_name: "Avery Example",
	degree: "Bachelor of Science",
	program: "Environmental Studies",
	graduation_year: 2026,
	honors: ["Fictional Faculty Recognition"],
	activities: ["Campus Garden Club"],
	quote: "I enjoyed learning with my classmates.",
	future_plan: "Continue studying community gardens.",
	preferences: { tone: "professional", length: "standard", channel: "web" },
	consent: true,
	fictional_data_acknowledged: true,
};
export const minimalBrief: SourceInput = {
	institution: "North Valley University",
	graduate_name: "Jordan Sample",
	degree: "Bachelor of Arts",
	program: "History",
	graduation_year: 2026,
	honors: [],
	activities: [],
	quote: null,
	future_plan: null,
	preferences: { tone: "warm", length: "brief", channel: "social" },
	consent: true,
	fictional_data_acknowledged: true,
};
