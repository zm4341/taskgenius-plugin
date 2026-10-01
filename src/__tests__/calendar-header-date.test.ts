/**
 * The calendar's header names the period on screen, also after its prev,
 * next and today buttons move the calendar.
 *
 * Regression: the buttons moved the calendar but left the header's date as
 * it was, so it named a month no longer on screen.
 */

import { CalendarComponent } from "@/components/features/calendar";

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

jest.mock("@/components/features/quick-capture/modals/NewTaskNoteModal", () => ({
	NewTaskNoteModal: class {},
}));

jest.mock("@/components/features/task/view/details", () => ({
	createTaskCheckbox: () => document.createElement("input"),
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

function openCalendar() {
	const app: any = {
		workspace: { on: () => ({}), trigger: () => {} },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
		vault: { getFileByPath: () => null },
		metadataCache: { getFileCache: () => null },
	};
	const plugin: any = {
		app,
		settings: {
			viewConfiguration: [],
			customCalendarViews: [],
			taskStatuses: { completed: "x", abandoned: "-" },
		},
	};
	const parentEl = document.createElement("div");
	const calendar = new CalendarComponent(app, plugin, parentEl, [], {
		persistViewMode: false,
	});
	calendar.load();

	const header = () =>
		parentEl.querySelector(".calendar-current-date")?.textContent;
	const click = (button: string) =>
		(parentEl.querySelector(`.${button}-button`) as HTMLElement).click();
	// The date the calendar itself is on
	const shownDate = () => (calendar as any).tgCalendar.getCurrentDate();

	return { calendar, header, click, shownDate };
}

beforeEach(() => {
	jest.useFakeTimers({ now: new Date(2026, 9, 1, 10, 0, 0) });
});

afterEach(() => {
	jest.useRealTimers();
});

describe("Calendar header", () => {
	it("follows the month view's prev, next and today buttons", () => {
		const { header, click, shownDate } = openCalendar();
		expect(header()).toBe("October/2026");

		click("next");
		expect(header()).toBe("November/2026");
		expect(shownDate()).toBe("2026-11-01");

		click("prev");
		click("prev");
		expect(header()).toBe("September/2026");
		expect(shownDate()).toBe("2026-09-01");

		click("today");
		expect(header()).toBe("October/2026");
		expect(shownDate()).toBe("2026-10-01");
	});

	it("follows the week and year views too", () => {
		const { calendar, header, click } = openCalendar();

		calendar.setView("week");
		expect(header()).toBe("Sep 27 - Oct 3, 2026");
		click("next");
		expect(header()).toBe("Oct 4 - 10, 2026");

		calendar.setView("year");
		click("next");
		expect(header()).toBe("2027");
		click("today");
		expect(header()).toBe("2026");
	});
});
