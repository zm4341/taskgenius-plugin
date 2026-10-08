/**
 * Tasks on the calendar are colored by priority.
 *
 * Regression: the colors went the wrong way round, red for 1 and blue for
 * 5, while 5 is the highest priority (🔺), so the most urgent tasks were
 * blue, the color of the least urgent.
 */

import { taskToCalendarEvent } from "@/utils/adapters/TaskCalendarAdapter";
import type { Task } from "@/types/task";

/** The color of a task due on 9 October with the given priority */
function colorOf(priority?: number, more: Partial<Task> = {}): string | undefined {
	const task = {
		id: "a.md-L0",
		content: "代码检索",
		filePath: "a.md",
		line: 0,
		completed: false,
		status: " ",
		originalMarkdown: "- [ ] 代码检索",
		metadata: {
			tags: [],
			children: [],
			priority,
			dueDate: new Date(2026, 9, 9).getTime(),
		},
		...more,
	} as unknown as Task;
	return taskToCalendarEvent(task)?.color;
}

describe("Colors of tasks on the calendar", () => {
	it("go from red for the highest priority to blue for the lowest", () => {
		expect(colorOf(5)).toBe("var(--color-red)");
		expect(colorOf(4)).toBe("var(--color-orange)");
		expect(colorOf(3)).toBe("var(--color-yellow)");
		expect(colorOf(2)).toBe("var(--color-green)");
		expect(colorOf(1)).toBe("var(--color-blue)");
	});

	it("are muted for completed tasks, whatever their priority", () => {
		expect(colorOf(5, { completed: true, status: "x" })).toBe(
			"var(--text-muted)",
		);
	});
});
