/**
 * The Today view lists the day's tasks: due, scheduled or starting today,
 * completed today, overdue, and created today. Calendars show tasks without
 * dates on the day they were finished, or else created, so Today's calendar
 * shows its undated tasks on today.
 *
 * Regression: Today took only tasks dated today and hid completed ones, so a
 * day's finished work and new undated tasks never showed in any of its
 * panels; and calendars left out every task without dates, so the Events
 * view stayed empty when no task had one.
 */

import { filterTasks, placeUndatedTask } from "@/utils/task/task-filter-utils";
import { tasksToCalendarEvents } from "@/utils/adapters/TaskCalendarAdapter";
import type { Task } from "@/types/task";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	// The real moment, which the shared mock only imitates (in UTC). It is
	// loaded by file path: by name it would map to that mock again.
	const fs = require("fs");
	const path = require("path");
	const obsidianDir = path.dirname(
		fs.realpathSync(
			path.join(process.cwd(), "node_modules/obsidian/package.json"),
		),
	);
	const momentDir = fs.realpathSync(path.join(obsidianDir, "../moment"));
	const moment = require(path.join(momentDir, "moment.js"));
	return { ...actual, moment };
});

// Thursday 2026-10-01, 10:00
const NOW = new Date(2026, 9, 1, 10, 0, 0);

/** A time on the day `offset` days from today */
function day(offset: number, hour = 0): number {
	return new Date(2026, 9, 1 + offset, hour).getTime();
}

function task(
	content: string,
	metadata: Record<string, unknown> = {},
	status = " ",
	noteCreatedAt?: string,
): Task {
	return {
		id: content,
		content,
		status,
		completed: status === "x",
		filePath: noteCreatedAt ? `${content}.md` : "Daily.md",
		line: 0,
		originalMarkdown: `- [${status}] ${content}`,
		metadata: { tags: [], children: [], ...metadata },
		noteCreatedAt,
	} as unknown as Task;
}

function createPlugin(tasks: Task[]) {
	const view = (id: string) => ({
		id,
		name: id,
		icon: "list",
		type: "default",
		visible: true,
		hideCompletedAndAbandonedTasks: true,
		filterBlanks: false,
		filterRules: {},
	});
	// Each task with a creation time sits alone in a note with that createdAt
	const notes = new Map<string, { createdAt?: string }>(
		tasks.map((t: any) => [t.filePath, { createdAt: t.noteCreatedAt }]),
	);
	return {
		settings: {
			viewConfiguration: [view("today"), view("inbox")],
			taskStatuses: {
				completed: "x|X",
				abandoned: "-",
				archived: "a",
				notStarted: " ",
			},
			globalFilterRules: {},
		},
		app: {
			vault: {
				getFileByPath: (filePath: string) =>
					notes.has(filePath) ? { path: filePath } : null,
			},
			metadataCache: {
				getFileCache: (file: { path: string }) => ({
					frontmatter: notes.get(file.path),
				}),
			},
		},
	} as any;
}

beforeEach(() => {
	jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
	jest.useRealTimers();
});

const tasks = [
	task("due today", { dueDate: day(0) }),
	task("due tomorrow", { dueDate: day(1) }),
	task("scheduled today", { scheduledDate: day(0) }),
	task("done today", { completedDate: day(0, 9) }, "x"),
	task("done yesterday", { completedDate: day(-1) }, "x"),
	task("overdue", { dueDate: day(-2) }),
	task("overdue but done", { dueDate: day(-2), completedDate: day(-1) }, "x"),
	task("overdue but dropped", { dueDate: day(-2) }, "-"),
	task("note made today", {}, " ", "2026-10-01 07:33:16"),
	task("note made yesterday", {}, " ", "2026-09-30 22:00:00"),
	task("created today", { createdDate: day(0, 8) }),
	task("archived today", { completedDate: day(0) }, "a"),
	task("undated", {}),
];

describe("Today view", () => {
	it("lists tasks dated, completed, overdue or created today", () => {
		const shown = filterTasks(tasks, "today" as any, createPlugin(tasks));

		expect(shown.map((t) => t.content)).toEqual([
			"due today",
			"scheduled today",
			"done today",
			"overdue",
			"note made today",
			"created today",
		]);
	});

	it("keeps tasks completed today only in Today", () => {
		const shown = filterTasks(tasks, "inbox" as any, createPlugin(tasks));

		expect(shown.map((t) => t.content)).not.toContain("done today");
	});
});

describe("Calendar events for tasks without dates", () => {
	it("sit on the day the task was finished, or else created", () => {
		const undated = [
			task("open", {}, " ", "2026-09-29 07:33:16"),
			task("done", { completedDate: day(-1, 9) }, "x", "2026-09-20 10:00"),
			task("dropped", { cancelledDate: day(0, 9) }, "-", "2026-09-20 10:00"),
			task("done, no date", {}, "x", "2026-09-21 10:00:00"),
			task("no creation date"),
		];
		const plugin = createPlugin(undated);

		const events = tasksToCalendarEvents(undated, (t) =>
			placeUndatedTask(plugin, t),
		);

		expect(
			events.map((e) => [e.title, e.start, e.allDay, e.metadata?.undated]),
		).toEqual([
			["open", "2026-09-29", true, "created"],
			["done", "2026-09-30", true, "finished"],
			["dropped", "2026-10-01", true, "finished"],
			["done, no date", "2026-09-21", true, "created"],
		]);
	});

	it("are left out when nothing gives them a day", () => {
		expect(tasksToCalendarEvents([task("undated")])).toEqual([]);
	});

	it("leave tasks with dates on their own day, unmarked", () => {
		const dated = task("due later", { dueDate: day(4) }, " ", "2026-09-20");
		const plugin = createPlugin([dated]);

		const [event] = tasksToCalendarEvents([dated], (t) =>
			placeUndatedTask(plugin, t),
		);

		expect(event.start).toBe("2026-10-05");
		expect(event.metadata?.undated).toBeUndefined();
	});

	it("put the undated tasks of Today on today", () => {
		const plugin = createPlugin(tasks);
		const shown = filterTasks(tasks, "today" as any, plugin);

		const undated = tasksToCalendarEvents(shown, (t) =>
			placeUndatedTask(plugin, t),
		).filter((e) => e.metadata?.undated);

		expect(undated.map((e) => [e.title, e.start])).toEqual([
			["done today", "2026-10-01"],
			["note made today", "2026-10-01"],
			["created today", "2026-10-01"],
		]);
	});
});
