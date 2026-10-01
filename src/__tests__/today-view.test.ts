/**
 * The Today view lists the day's tasks: due, scheduled or starting today,
 * completed today, overdue, and created today. Its calendar shows the ones
 * without dates on today.
 *
 * Regression: Today took only tasks dated today and hid completed ones, so a
 * day's finished work and new undated tasks never showed in any of its
 * panels.
 */

import { filterTasks } from "@/utils/task/task-filter-utils";
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

describe("Today view", () => {
	const tasks = [
		task("due today", { dueDate: day(0) }),
		task("due tomorrow", { dueDate: day(1) }),
		task("scheduled today", { scheduledDate: day(0) }),
		task("done today", { completedDate: day(0, 9) }, "x"),
		task("done yesterday", { completedDate: day(-1) }, "x"),
		task("overdue", { dueDate: day(-2) }),
		task(
			"overdue but done",
			{ dueDate: day(-2), completedDate: day(-1) },
			"x",
		),
		task("overdue but dropped", { dueDate: day(-2) }, "-"),
		task("note made today", {}, " ", "2026-10-01 07:33:16"),
		task("note made yesterday", {}, " ", "2026-09-30 22:00:00"),
		task("created today", { createdDate: day(0, 8) }),
		task("archived today", { completedDate: day(0) }, "a"),
		task("undated", {}),
	];

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
	it("are left out, unless the view gives them a day to sit on", () => {
		const undated = task("undated");

		expect(tasksToCalendarEvents([undated])).toEqual([]);
		expect(
			tasksToCalendarEvents([undated], new Date(2026, 9, 1, 15, 30)),
		).toEqual([
			expect.objectContaining({
				start: "2026-10-01",
				end: "2026-10-01",
				allDay: true,
			}),
		]);
	});

	it("leave tasks with dates on their own day", () => {
		const dated = task("due later", { dueDate: day(4) });

		expect(
			tasksToCalendarEvents([dated], new Date(2026, 9, 1))[0].start,
		).toBe("2026-10-05");
	});
});
