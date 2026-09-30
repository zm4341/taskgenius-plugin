import type TaskProgressBarPlugin from "@/index";
import { getViewSettingOrDefault } from "@/common/setting-definition";

/**
 * Marks of the archived status, e.g. "a" for `- [a]`.
 * Archived tasks are hidden everywhere except table views, which show them
 * when the status column is filtered to them.
 */
export function getArchivedMarks(taskStatuses?: Record<string, string>): string[] {
	return (taskStatuses?.archived ?? "")
		.split("|")
		.filter((mark) => mark !== "");
}

/** Returns a copy of the tasks without the archived ones */
export function withoutArchivedTasks<T extends { status: string }>(
	tasks: T[],
	taskStatuses?: Record<string, string>,
): T[] {
	const archivedMarks = getArchivedMarks(taskStatuses);
	return tasks.filter((task) => !archivedMarks.includes(task.status));
}

/** Table views receive archived tasks and hide them until filtered for */
export function isTableView(
	plugin: TaskProgressBarPlugin,
	viewId: string,
): boolean {
	return (
		getViewSettingOrDefault(plugin, viewId).specificConfig?.viewType ===
		"table"
	);
}
