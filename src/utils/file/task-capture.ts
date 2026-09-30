import type { TimeParsingService } from "@/services/time-parsing-service";
import type { TaskNoteDates } from "@/utils/file/task-note";

/** A line of captured text, read as a task */
export interface CapturedTask {
	/** The line as typed, kept to put back if the task can't be created */
	line: string;
	title: string;
	dates: TaskNoteDates;
}

/** A single task drafted from captured text, for the New Task window */
export interface CapturedDraft {
	title: string;
	description: string;
	dates: TaskNoteDates;
}

// "- ", "1. " or "* [ ] " in front of a line
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\](?:\s+|$))?/;

function readLine(
	line: string,
	parser: TimeParsingService,
	today: Date,
): CapturedTask | null {
	const text = line.replace(LIST_MARKER, "").trim();
	if (!text) return null;

	const parsed = parser.parseTimeExpressionsForLine(text);
	const dates: TaskNoteDates = {
		start: parsed.startDate,
		scheduled: parsed.scheduledDate,
		due: parsed.dueDate,
	};
	// Captured from the timeline, a task without a date is for today
	if (!dates.start && !dates.scheduled && !dates.due) {
		dates.scheduled = today;
	}
	// A line of date words only keeps them as its title
	const title = parsed.cleanedLine.trim() || text;
	return { line, title, dates };
}

/**
 * Reads captured text as one task per line. Date words such as 明天 or
 * "next Friday" become the task's dates.
 */
export function readCapturedTasks(
	text: string,
	parser: TimeParsingService,
	today = new Date(),
): CapturedTask[] {
	const tasks: CapturedTask[] = [];
	for (const line of text.split("\n")) {
		const task = readLine(line, parser, today);
		if (task) tasks.push(task);
	}
	return tasks;
}

/** Reads the first line as the task, and the lines after it as its description */
export function readCapturedDraft(
	text: string,
	parser: TimeParsingService,
	today = new Date(),
): CapturedDraft {
	const lines = text.split("\n");
	const first = lines.findIndex((line) => line.trim() !== "");
	const task = first === -1 ? null : readLine(lines[first], parser, today);
	return {
		title: task?.title ?? "",
		description: first === -1 ? "" : lines.slice(first + 1).join("\n").trim(),
		dates: task?.dates ?? { scheduled: today },
	};
}
