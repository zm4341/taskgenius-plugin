/**
 * The timeline sidebar: header buttons and day groups. New tasks are made
 * with New Task, so the timeline has no quick capture of its own.
 *
 * Regressions: refresh redrew before the tasks had loaded, so it showed the
 * old list; focus only dimmed other days and never lit its button; with
 * nothing due today there was no today group for "Go to today" to reach.
 */

import { TimelineSidebarView } from "@/components/features/timeline-sidebar/TimelineSidebarView";
import { translationManager } from "@/translations/manager";
import type { Task } from "@/types/task";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	const two = (n: number) => ("0" + n).slice(-2);
	// Local-time moment, covering what the timeline uses
	const moment: any = (input?: Date | string | number) => {
		let date: Date;
		if (input === undefined) {
			date = new Date();
		} else if (typeof input === "string") {
			const [year, month, day] = input.split("-").map(Number);
			date = new Date(year, month - 1, day);
		} else {
			date = new Date(input);
		}
		const self: any = {
			format: (format?: string) =>
				format === "HH:mm"
					? `${two(date.getHours())}:${two(date.getMinutes())}`
					: `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(
							date.getDate(),
						)}`,
			isSame: (other: any) => self.format() === other.format(),
			add: (days: number) =>
				moment(
					new Date(
						date.getFullYear(),
						date.getMonth(),
						date.getDate() + days,
					),
				),
			subtract: (days: number) => self.add(-days),
			fromNow: () => "",
		};
		return self;
	};
	moment.locale = () => "en";
	class ItemView extends actual.Component {
		app: any;
		containerEl = document.createElement("div");
		contentEl = document.createElement("div");
		constructor(leaf: any) {
			super();
			this.app = leaf.app;
		}
	}
	return { ...actual, moment, ItemView };
});

jest.mock("@/components/features/task/view/details", () => ({
	createTaskCheckbox: (_status: string, _task: unknown, el: HTMLElement) =>
		el.appendChild(document.createElement("input")),
}));

jest.mock("@/components/ui/renderers/MarkdownRenderer", () => ({
	MarkdownRendererComponent: class {
		constructor(
			_app: unknown,
			private readonly el: HTMLElement,
		) {}
		setFile() {}
		load() {}
		unload() {}
		render(content: string) {
			this.el.textContent = content;
			return Promise.resolve();
		}
	},
}));

// Obsidian's DOM helpers, as far as the timeline uses them
const proto = HTMLElement.prototype as any;
proto.createEl = function (
	tag: string,
	o?: any,
	callback?: (el: any) => void,
) {
	const el = document.createElement(tag) as any;
	if (typeof o === "string") o = { cls: o };
	if (o?.cls) el.className = o.cls;
	if (o?.text !== undefined) el.textContent = String(o.text);
	if (o?.type) el.type = o.type;
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
proto.setText = function (text: string) {
	this.textContent = text;
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
proto.hasClass = function (cls: string) {
	return this.classList.contains(cls);
};
proto.show = function () {
	this.style.display = "";
};
proto.hide = function () {
	this.style.display = "none";
};
proto.scrollIntoView = jest.fn();

/** Midnight of the day `offset` days from today */
function day(offset: number): number {
	const now = new Date();
	return new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() + offset,
	).getTime();
}

function task(content: string, dueDate?: number, status = " "): Task {
	return {
		id: content,
		content,
		status,
		completed: status === "x",
		filePath: `${content}.md`,
		line: 0,
		originalMarkdown: `- [${status}] ${content}`,
		metadata: { tags: [], children: [], dueDate },
	} as unknown as Task;
}

async function openTimeline(
	tasks: Task[],
	timeline: Record<string, unknown> = {},
) {
	// Workspace events reach the handlers registered for them
	const handlers: Record<string, Array<() => void>> = {};
	const app = {
		vault: { on: () => ({}), getFileByPath: () => null },
		workspace: {
			on: (name: string, handler: () => void) => {
				(handlers[name] = handlers[name] || []).push(handler);
				return {};
			},
			trigger: (name: string) =>
				handlers[name]?.forEach((handler) => handler()),
		},
	};
	const plugin: any = {
		app,
		saveSettings: jest.fn(),
		settings: {
			timelineSidebar: {
				showCompletedTasks: true,
				focusModeByDefault: false,
				maxEventsToShow: 100,
				...timeline,
			},
			taskStatuses: {
				completed: "x|X",
				abandoned: "-",
				archived: "a",
				notStarted: " ",
				inProgress: "/|d",
				planned: ">|?",
			},
		},
		dataflowOrchestrator: {
			getQueryAPI: () => ({ getAllTasks: async () => [...tasks] }),
		},
	};
	const view = new TimelineSidebarView({ app } as any, plugin);
	await view.onOpen();
	const el = (view as any).contentEl as HTMLElement;
	const button = (name: string) =>
		el.querySelector(`.timeline-${name}-btn`) as HTMLElement;
	return { view, plugin, app, el, button };
}

function dayTitles(el: HTMLElement): string[] {
	return Array.from(el.querySelectorAll(".timeline-date-header")).map(
		(header) => header.textContent ?? "",
	);
}

function eventTexts(el: HTMLElement): string[] {
	return Array.from(el.querySelectorAll(".timeline-event-content-text")).map(
		(text) => text.textContent ?? "",
	);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 700));

describe("Timeline day groups", () => {
	it("keep today between later and earlier days, even with nothing due", async () => {
		const { el } = await openTimeline([
			task("Ship it", day(1)),
			task("Review", day(-1)),
		]);

		expect(dayTitles(el)).toEqual(["Tomorrow", "Today", "Yesterday"]);
		expect(el.querySelector(".is-today")?.textContent).toContain(
			"Nothing planned for today",
		);
	});

	it("load the tasks once the index is ready", async () => {
		// On startup the view opens before the index has loaded
		const tasks: Task[] = [];
		const { app, el } = await openTimeline(tasks);
		tasks.push(task("Ship it", day(0)));

		app.workspace.trigger("task-genius:cache-ready");
		await settle();

		expect(eventTexts(el)).toEqual(["Ship it"]);
	});

	it("still show today when no task has a date", async () => {
		const { el } = await openTimeline([task("Someday")]);

		expect(dayTitles(el)).toEqual(["Today"]);
	});

	it("keep the events closest to now past the maximum", async () => {
		const { el } = await openTimeline(
			[
				task("Far past", day(-10)),
				task("Yesterday's", day(-1)),
				task("Tomorrow's", day(1)),
				task("Far future", day(10)),
			],
			{ maxEventsToShow: 2 },
		);

		expect(eventTexts(el)).toEqual(["Tomorrow's", "Yesterday's"]);
	});

	it("show abandoned tasks as finished, like completed ones", async () => {
		const { el } = await openTimeline([
			task("Dropped", day(0), "-"),
			task("Done", day(0), "x"),
		]);
		const eventFor = (text: string) =>
			Array.from(el.querySelectorAll(".timeline-event")).find((event) =>
				event.textContent?.includes(text),
			);

		expect(eventFor("Dropped")?.classList.contains("is-abandoned")).toBe(
			true,
		);
		expect(eventFor("Done")?.classList.contains("is-completed")).toBe(true);
	});

	it("list planned tasks without a date under today, the most important first", async () => {
		const planned = (content: string, priority: number, dueDate?: number) => {
			const t = task(content, dueDate, "?");
			t.metadata.priority = priority;
			return t;
		};
		const { el } = await openTimeline([
			task("Someday"),
			task("Started", day(0), "/"),
			planned("Sketch it", 3),
			planned("Pick a framework", 5),
			planned("Ship it", 5, day(1)),
		]);
		const today = el.querySelector(".timeline-date-group.is-today")!;
		const section = today.querySelector(".timeline-planned-section")!;

		expect(section.querySelector(".timeline-date-only-header")?.textContent).toBe(
			"Planned2 planned tasks without a date",
		);
		expect(eventTexts(section as HTMLElement)).toEqual([
			"Pick a framework",
			"Sketch it",
		]);
		// Dated tasks stay on their day; tasks that aren't planned stay out
		expect(eventTexts(today as HTMLElement)).toEqual([
			"Started",
			"Pick a framework",
			"Sketch it",
		]);
		expect(eventTexts(el)).toContain("Ship it");
		expect(eventTexts(el)).not.toContain("Someday");
	});

	it("list in-progress tasks without a date under today, before planned ones", async () => {
		const { el } = await openTimeline([
			task("Started", day(0), "/"),
			task("Next up", undefined, "?"),
			task("Half done", undefined, "/"),
		]);
		const today = el.querySelector(".timeline-date-group.is-today")!;
		const sections = Array.from(
			today.querySelectorAll(".timeline-date-only-section"),
		).map((section) => ({
			header: section.querySelector(".timeline-date-only-header")?.textContent,
			tasks: eventTexts(section as HTMLElement),
		}));

		expect(sections).toEqual([
			{ header: "All day1 all-day event", tasks: ["Started"] },
			{
				header: "In Progress1 in-progress task without a date",
				tasks: ["Half done"],
			},
			{ header: "Planned1 planned task without a date", tasks: ["Next up"] },
		]);
	});

	it("show planned tasks rather than an empty today", async () => {
		const { el } = await openTimeline([task("Pick a framework", undefined, "?")]);
		const today = el.querySelector(".timeline-date-group.is-today")!;

		expect(today.textContent).not.toContain("Nothing planned for today");
		expect(eventTexts(today as HTMLElement)).toEqual(["Pick a framework"]);
	});

	it("show each task's priority beside it, as the table does", async () => {
		const withPriority = (content: string, priority?: number) => {
			const t = task(content, day(0));
			t.metadata.priority = priority;
			return t;
		};
		const { el } = await openTimeline([
			withPriority("Laundry", 5),
			withPriority("Groceries"),
			withPriority("10:00 standup", 3),
			withPriority("10:00 call", 1),
		]);
		const priorityOf = (text: string) => {
			const event = Array.from(el.querySelectorAll(".timeline-event")).find(
				(event) => event.textContent?.includes(text),
			);
			const priority = event?.querySelector(".timeline-event-priority");
			return priority && [priority.className, priority.textContent];
		};

		expect(priorityOf("Laundry")).toEqual([
			"timeline-event-priority priority-highest",
			"Highest",
		]);
		expect(priorityOf("Groceries")).toBeFalsy();
		// Tasks at the same time are shown as a group, with their priorities too
		expect(priorityOf("standup")).toEqual([
			"timeline-event-priority priority-medium",
			"Medium",
		]);
		expect(priorityOf("call")).toEqual([
			"timeline-event-priority priority-lowest",
			"Lowest",
		]);
	});

	it("label all-day and same-time groups in the user's language", async () => {
		translationManager.setLocale("zh-cn");
		try {
			const { el } = await openTimeline([
				task("Laundry", day(0)),
				task("Groceries", day(0)),
				task("10:00 standup", day(0)),
				task("10:00 call", day(0)),
			]);

			expect(
				el.querySelector(".timeline-date-only-header")?.textContent,
			).toBe("全天2 项全天任务");
			expect(
				el.querySelector(".timeline-time-group-count")?.textContent,
			).toBe("2 项");
		} finally {
			translationManager.setLocale("en");
		}
	});
});

describe("Timeline header buttons", () => {
	it("Go to today scrolls to today and pulses it", async () => {
		const { el, button } = await openTimeline([task("Ship it", day(1))]);
		const scrollIntoView = proto.scrollIntoView;
		scrollIntoView.mockClear();

		button("today").click();

		const today = el.querySelector(".timeline-date-group.is-today");
		expect(scrollIntoView.mock.contexts).toEqual([today]);
		expect(today?.classList.contains("is-flashing")).toBe(true);
	});

	it("Refresh redraws with the tasks loaded again", async () => {
		const tasks = [task("Old", day(0))];
		const { el, button } = await openTimeline(tasks);
		tasks.push(task("New", day(0)));

		button("refresh").click();
		expect(button("refresh").classList.contains("is-loading")).toBe(true);
		await settle();

		expect(eventTexts(el)).toEqual(["New", "Old"]);
		expect(button("refresh").classList.contains("is-loading")).toBe(false);
	});

	it("Focus shows only today and lights its button while on", async () => {
		const { el, button } = await openTimeline([task("Ship it", day(1))]);
		const content = el.querySelector(".timeline-content")!;

		button("focus").click();
		expect(content.classList.contains("focus-mode")).toBe(true);
		expect(button("focus").classList.contains("is-active")).toBe(true);
		expect(button("focus").getAttribute("aria-pressed")).toBe("true");

		button("focus").click();
		expect(content.classList.contains("focus-mode")).toBe(false);
		expect(button("focus").classList.contains("is-active")).toBe(false);
	});

	it("Focus starts from the default setting and follows its changes", async () => {
		const { view, plugin, button } = await openTimeline([], {
			focusModeByDefault: true,
		});
		const isOn = () => button("focus").classList.contains("is-active");
		expect(isOn()).toBe(true);

		// Switching by hand holds while the setting stays the same
		button("focus").click();
		await view.triggerViewUpdate();
		expect(isOn()).toBe(false);

		plugin.settings.timelineSidebar.focusModeByDefault = false;
		await view.triggerViewUpdate();
		expect(isOn()).toBe(false);

		plugin.settings.timelineSidebar.focusModeByDefault = true;
		await view.triggerViewUpdate();
		expect(isOn()).toBe(true);
	});
});

describe("Timeline sidebar", () => {
	it("has no quick capture of its own: New Task makes tasks", async () => {
		const { el } = await openTimeline([task("due today", day(0))]);

		expect(el.querySelector(".timeline-quick-input")).toBeNull();
		expect(el.querySelector(".quick-input-header-collapsed")).toBeNull();
		expect(eventTexts(el)).toEqual(["due today"]);
	});
});
