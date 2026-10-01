/**
 * The Events view's month calendar shows how many tasks each day has, and
 * a day's count lists them.
 *
 * Regression: the month view drew every task of a day, so a day with dozens
 * of tasks stretched its week into a column taller than the screen.
 */

import { CalendarComponent } from "@/components/features/calendar";
import { ViewComponentManager } from "@/components/ui/behavior/ViewComponentManager";
import { Component } from "obsidian";

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

	class ButtonComponent {
		buttonEl: HTMLButtonElement;
		constructor(containerEl: HTMLElement) {
			this.buttonEl = containerEl.appendChild(
				document.createElement("button"),
			);
		}
		setIcon() {
			return this;
		}
		setButtonText(text: string) {
			this.buttonEl.textContent = text;
			return this;
		}
		onClick(callback: () => void) {
			this.buttonEl.addEventListener("click", callback);
			return this;
		}
	}
	class DropdownComponent {
		selectEl = document.createElement("select");
		constructor(containerEl: HTMLElement) {
			containerEl.appendChild(this.selectEl);
		}
		addOption() {
			return this;
		}
		onChange() {
			return this;
		}
		setValue() {
			return this;
		}
	}
	return { ...actual, moment, ButtonComponent, DropdownComponent };
});

// Counts the quick capture windows opened, as pressing on a day does
jest.mock(
	"@/components/features/quick-capture/modals/QuickCaptureModalWithSwitch",
	() => ({
		QuickCaptureModal: class {
			static opened = 0;
			open() {
				(this.constructor as any).opened++;
			}
		},
	}),
);

jest.mock("@/components/features/task/view/details", () => ({
	createTaskCheckbox: () => document.createElement("input"),
}));

// The other views the Events view's manager can make
jest.mock("@/components/features/kanban/kanban", () => ({
	KanbanComponent: class {},
}));
jest.mock("@/components/features/gantt/gantt", () => ({
	GanttComponent: class {},
}));
jest.mock("@/components/features/task/view/TaskPropertyTwoColumnView", () => ({
	TaskPropertyTwoColumnView: class {},
}));
jest.mock("@/components/features/task/view/forecast", () => ({
	ForecastComponent: class {},
}));
jest.mock("@/components/features/table/TableViewAdapter", () => ({
	TableViewAdapter: class {},
}));
jest.mock("@/components/features/quadrant/quadrant", () => ({
	QuadrantComponent: class {},
}));

// Obsidian's DOM helpers, as far as the calendar uses them
const proto = HTMLElement.prototype as any;
proto.createEl = function (tag: string, o?: any, callback?: (el: any) => void) {
	const el = document.createElement(tag);
	if (typeof o === "string") o = { cls: o };
	if (o?.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
	if (o?.text !== undefined) el.textContent = String(o.text);
	for (const [key, value] of Object.entries(o?.attr ?? {})) {
		el.setAttribute(key, String(value));
	}
	this.appendChild(el);
	callback?.(el);
	return el;
};
proto.createDiv = function (o?: any, callback?: (el: any) => void) {
	return this.createEl("div", o, callback);
};
proto.createSpan = function (o?: any, callback?: (el: any) => void) {
	return this.createEl("span", o, callback);
};
proto.empty = function () {
	this.innerHTML = "";
};
proto.addClass = function (...cls: string[]) {
	this.classList.add(...cls);
};
proto.removeClass = function (...cls: string[]) {
	this.classList.remove(...cls);
};
proto.toggleClass = function (cls: string, on: boolean) {
	this.classList.toggle(cls, on);
};
proto.hide = function () {
	this.style.display = "none";
};

/** A task in a note of its own, created at the given time */
function task(
	content: string,
	createdAt: string,
	metadata: Record<string, unknown> = {},
) {
	return {
		id: content,
		content,
		status: " ",
		completed: false,
		filePath: `${content}.md`,
		line: 0,
		originalMarkdown: `- [ ] ${content}`,
		metadata: { tags: [], children: [], ...metadata },
		createdAt,
	} as any;
}

const tasks = [
	task("draw icons", "2026-09-30 10:00:00"),
	task("fix menu", "2026-09-30 11:00:00"),
	task("write docs", "2026-09-30 12:00:00"),
	task("ship it", "2026-09-20 09:00:00", {
		dueDate: new Date(2026, 9, 5).getTime(),
	}),
];

/** The app and plugin, with the tasks' notes and when they were made */
function setUp() {
	const notes = new Map(tasks.map((t) => [t.filePath, t.createdAt]));
	const app: any = {
		workspace: { on: () => ({}), trigger: () => {} },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
		vault: {
			getFileByPath: (path: string) => (notes.has(path) ? { path } : null),
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => ({
				frontmatter: { createdAt: notes.get(file.path) },
			}),
		},
	};
	const plugin: any = {
		app,
		settings: {
			viewConfiguration: [],
			customCalendarViews: [],
			taskStatuses: { completed: "x", abandoned: "-" },
		},
	};
	return { app, plugin };
}

function openCalendar(countsInMonth: boolean) {
	const { app, plugin } = setUp();
	const onTaskSelected = jest.fn();
	const parentEl = document.createElement("div");
	document.body.appendChild(parentEl);
	const calendar = new CalendarComponent(app, plugin, parentEl, [], {
		persistViewMode: false,
		onTaskSelected,
		monthShowsCounts: countsInMonth,
	});
	calendar.load();
	calendar.setTasks(tasks);

	/** The count in the cell of the given day of October's month view */
	const countOn = (day: string) => {
		const cell = Array.from(
			parentEl.querySelectorAll<HTMLElement>(".tg-month-cell"),
		).find(
			(c) => c.querySelector(".tg-date-number")?.textContent === day,
		);
		return cell?.querySelector<HTMLElement>(".tg-event-count-badge");
	};

	return { calendar, parentEl, countOn, onTaskSelected };
}

const QuickCapture = () =>
	jest.requireMock(
		"@/components/features/quick-capture/modals/QuickCaptureModalWithSwitch",
	).QuickCaptureModal;

beforeEach(() => {
	jest.useFakeTimers({ now: new Date(2026, 9, 1, 10, 0, 0) });
	QuickCapture().opened = 0;
});

afterEach(() => {
	jest.useRealTimers();
	document.body.innerHTML = "";
});

describe("Events view month calendar", () => {
	it("shows each day's number of tasks instead of the tasks", () => {
		const { parentEl, countOn } = openCalendar(true);

		expect(parentEl.querySelectorAll(".tg-event-bar")).toHaveLength(0);
		expect(
			parentEl.querySelector(".calendar-view-container")?.classList,
		).toContain("is-month-counts");

		expect(countOn("30")?.textContent).toBe("3");
		expect(countOn("30")?.getAttribute("aria-label")).toBe("3 Tasks");
		// Those three have no dates: they sit on the day they were created
		expect(countOn("30")?.classList).toContain("is-undated");

		expect(countOn("5")?.textContent).toBe("1");
		expect(countOn("5")?.classList).not.toContain("is-undated");
	});

	it("lists a day's tasks from its count, and opens the one picked", () => {
		const { countOn, onTaskSelected } = openCalendar(true);

		countOn("30")!.click();

		const list = document.body.querySelector(".tg-day-tasks");
		expect(list?.querySelector(".tg-day-tasks-header")?.textContent).toBe(
			"September 30, 2026 · 3 Tasks",
		);
		const items = Array.from(
			list!.querySelectorAll<HTMLElement>(".tg-day-tasks-item"),
		);
		expect(items.map((item) => item.textContent)).toEqual([
			"draw icons",
			"fix menu",
			"write docs",
		]);

		items[1].click();

		expect(onTaskSelected).toHaveBeenCalledWith(tasks[1]);
		expect(document.body.querySelector(".tg-day-tasks")).toBeNull();
	});

	it("closes the list from the count again, or on a press elsewhere", () => {
		const { countOn } = openCalendar(true);

		countOn("30")!.click();
		countOn("30")!.click();
		expect(document.body.querySelector(".tg-day-tasks")).toBeNull();

		countOn("30")!.click();
		document.body.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true }),
		);
		expect(document.body.querySelector(".tg-day-tasks")).toBeNull();
	});

	it("leaves pressing on the count out of picking days for a new task", () => {
		const { countOn } = openCalendar(true);
		const press = (el: HTMLElement) => {
			el.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true, button: 0 }),
			);
			document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
		};

		press(countOn("30")!);
		expect(QuickCapture().opened).toBe(0);

		// The rest of the day still starts a new task
		press(countOn("30")!.parentElement!);
		expect(QuickCapture().opened).toBe(1);
	});
});

describe("Other calendars", () => {
	it("draw the tasks in the month view", () => {
		const { parentEl } = openCalendar(false);

		expect(parentEl.querySelectorAll(".tg-event-bar")).toHaveLength(4);
		expect(
			parentEl.querySelector(".calendar-view-container")?.classList,
		).not.toContain("is-month-counts");
	});

	it("draw them in the week view of the Events view too", () => {
		const { calendar, parentEl } = openCalendar(true);

		calendar.setView("week");

		expect(
			parentEl.querySelector(".calendar-view-container")?.classList,
		).not.toContain("is-month-counts");
		expect(
			parentEl.querySelectorAll(".tg-event-base").length,
		).toBeGreaterThan(0);
	});
});


describe("The Events view", () => {
	it("gets a calendar that counts each day's tasks in its month view", () => {
		const { app, plugin } = setUp();
		const parentEl = document.createElement("div");
		const manager = new ViewComponentManager(
			new Component(),
			app,
			plugin,
			parentEl,
			{},
		);

		const calendar = manager.getOrCreateComponent(
			"calendar",
		) as CalendarComponent;
		calendar.setTasks(tasks);

		expect(
			parentEl.querySelector(".calendar-view-container")?.classList,
		).toContain("is-month-counts");
		expect(parentEl.querySelectorAll(".tg-event-bar")).toHaveLength(0);
	});
});
