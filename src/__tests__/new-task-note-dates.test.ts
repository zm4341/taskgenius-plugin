/**
 * New Task opens with the dates it is given, such as the days picked on a
 * calendar: one date row per date, and the task gets them all.
 *
 * Regression: picking days on the calendar opened the old quick capture
 * window, as New Task could not start with dates.
 */

import { NewTaskNoteModal } from "@/components/features/quick-capture/modals/NewTaskNoteModal";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	return {
		...actual,
		// Bases of classes on the import path, and the folder type it checks
		AbstractInputSuggest: class {},
		TFolder: class {},
		normalizePath: (path: string) =>
			path.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
	};
});

function openNewTask(dates?: Record<string, Date>) {
	const app: any = {
		vault: { getRoot: () => null, getAbstractFileByPath: () => null },
		loadLocalStorage: () => null,
	};
	const plugin: any = {
		settings: { quickCapture: { taskNote: { folder: "Tasks" } } },
	};
	return new NewTaskNoteModal(app, plugin, { dates }) as any;
}

describe("New Task with dates", () => {
	it("has one empty row, scheduled, when given none", () => {
		const modal = openNewTask();

		expect(modal.dateRows).toEqual([{ type: "scheduled", value: "" }]);
		expect(modal.selectedDates()).toBeUndefined();
	});

	it("starts on the day it is given", () => {
		const modal = openNewTask({ scheduled: new Date(2026, 9, 5) });

		expect(modal.dateRows).toEqual([
			{ type: "scheduled", value: "2026-10-05" },
		]);
		expect(modal.selectedDates()).toEqual({
			scheduled: new Date(2026, 9, 5),
		});
	});

	it("keeps a start and a due date in rows of their own", () => {
		const modal = openNewTask({
			due: new Date(2026, 9, 7),
			start: new Date(2026, 9, 5),
		});

		expect(modal.dateRows).toEqual([
			{ type: "start", value: "2026-10-05" },
			{ type: "due", value: "2026-10-07" },
		]);
		expect(modal.selectedDates()).toEqual({
			start: new Date(2026, 9, 5),
			due: new Date(2026, 9, 7),
		});
	});

	it("leaves out a row whose date was cleared", () => {
		const modal = openNewTask({
			start: new Date(2026, 9, 5),
			due: new Date(2026, 9, 7),
		});

		modal.dateRows[0].value = "";

		expect(modal.selectedDates()).toEqual({ due: new Date(2026, 9, 7) });
	});
});
