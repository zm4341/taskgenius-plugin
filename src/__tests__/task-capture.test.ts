/**
 * Text typed in the timeline's quick capture, read as tasks: one per line,
 * dated by its date words, and scheduled for today when it has none.
 */

import {
	DEFAULT_TIME_PARSING_CONFIG,
	TimeParsingService,
} from "@/services/time-parsing-service";
import {
	readCapturedDraft,
	readCapturedTasks,
} from "@/utils/file/task-capture";

// Thursday 2026-10-01, 10:00
const NOW = new Date(2026, 9, 1, 10, 0, 0);

const parser = () => new TimeParsingService(DEFAULT_TIME_PARSING_CONFIG);
const day = (date?: Date) =>
	date ? `${date.getMonth() + 1}-${date.getDate()}` : undefined;

beforeEach(() => {
	jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
	jest.useRealTimers();
});

describe("Captured text", () => {
	it("gives one task per line, without list marks or blank lines", () => {
		const tasks = readCapturedTasks(
			"- [ ] Buy milk\n\n  * Call Bob\n1. Pay rent\n- ",
			parser(),
			NOW,
		);

		expect(tasks.map((task) => task.title)).toEqual([
			"Buy milk",
			"Call Bob",
			"Pay rent",
		]);
		// The line as typed, to put back if its note can't be made
		expect(tasks[1].line).toBe("  * Call Bob");
	});

	it("dates each task by its words, and schedules the rest for today", () => {
		const [milk, shelf] = readCapturedTasks(
			"买牛奶 明天\n整理书架",
			parser(),
			NOW,
		);

		expect(milk.title).toBe("买牛奶");
		expect(day(milk.dates.due)).toBe("10-2");
		expect(milk.dates.scheduled).toBeUndefined();
		expect(shelf.title).toBe("整理书架");
		expect(day(shelf.dates.scheduled)).toBe("10-1");
	});

	it("keeps a line of date words only as its title", () => {
		const [task] = readCapturedTasks("明天", parser(), NOW);

		expect(task.title).toBe("明天");
		expect(day(task.dates.due)).toBe("10-2");
	});
});

describe("Captured draft for the New Task window", () => {
	it("takes the first line as the task and the rest as its description", () => {
		const draft = readCapturedDraft(
			"\n买牛奶 明天\n带两瓶\n  全脂的",
			parser(),
			NOW,
		);

		expect(draft.title).toBe("买牛奶");
		expect(draft.description).toBe("带两瓶\n  全脂的");
		expect(day(draft.dates.due)).toBe("10-2");
	});

	it("is scheduled for today when nothing was typed", () => {
		const draft = readCapturedDraft("", parser(), NOW);

		expect(draft.title).toBe("");
		expect(draft.description).toBe("");
		expect(day(draft.dates.scheduled)).toBe("10-1");
	});
});
