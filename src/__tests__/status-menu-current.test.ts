/**
 * Status menus tick only the task's current status.
 *
 * Regression: each option's checkbox was ticked unless its mark was a space,
 * so the table's status menu showed every status but "Not Started" as
 * selected.
 */

import { TableRenderer } from "@/components/features/table/TableRenderer";
import { FluentActionHandlers } from "@/components/features/fluent/managers/FluentActionHandlers";
import type { Task } from "@/types/task";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	class Menu {
		static created: Menu[] = [];
		entries: Array<MenuItem | "separator"> = [];
		constructor() {
			Menu.created.push(this);
		}
		addItem(build: (item: MenuItem) => void) {
			const item = new MenuItem();
			build(item);
			this.entries.push(item);
			return this;
		}
		addSeparator() {
			this.entries.push("separator");
			return this;
		}
		showAtMouseEvent() {}
		showAtPosition() {}
	}
	class MenuItem {
		title = "";
		titleEl = document.createElement("div");
		submenu: Menu | null = null;
		setTitle(title: string) {
			this.title = title;
			return this;
		}
		setSubmenu() {
			this.submenu = new Menu();
			return this.submenu;
		}
		setIcon() {
			return this;
		}
		setDisabled() {
			return this;
		}
		setChecked() {
			return this;
		}
		onClick() {
			return this;
		}
	}
	// Base of suggest inputs that modules on the import path extend
	class AbstractInputSuggest {}
	return { ...actual, Menu, AbstractInputSuggest };
});

// Minimal stand-in for the DOM helper Obsidian adds to HTMLElement
(HTMLElement.prototype as any).createEl = function (
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

const settings = {
	taskStatuses: { archived: "a" },
	statusCycles: [
		{
			id: "default",
			name: "Default",
			priority: 0,
			enabled: true,
			cycle: ["Not Started", "In Progress", "Completed"],
			marks: { "Not Started": " ", "In Progress": "/", Completed: "x" },
		},
	],
};

/** Labels of the menu options whose checkbox is ticked */
function tickedOptions(menu: any): string[] {
	return menu.entries
		.filter((entry: any) => entry !== "separator")
		.filter((entry: any) => entry.titleEl.querySelector("input")?.checked)
		.map(
			(entry: any) =>
				entry.titleEl.querySelector(".status-option").textContent,
		);
}

/** Menus created while running the function, in order */
function menusCreatedBy(run: () => void): any[] {
	const { Menu } = jest.requireMock("obsidian");
	Menu.created.length = 0;
	run();
	return [...Menu.created];
}

describe("Table status menu", () => {
	function openMenuFor(status: string) {
		const renderer = new TableRenderer(
			document.createElement("table"),
			document.createElement("thead"),
			document.createElement("tbody"),
			[],
			{} as any,
			{} as any,
			{ settings } as any,
		) as any;
		const cellEl = document.createElement("td");
		cellEl.dataset.rowId = "task";
		return menusCreatedBy(() =>
			renderer.openStatusMenu(cellEl, {
				columnId: "status",
				value: status,
			}),
		)[0];
	}

	it("ticks only the task's current status", () => {
		expect(tickedOptions(openMenuFor("/"))).toEqual(["In Progress"]);
		expect(tickedOptions(openMenuFor(" "))).toEqual(["Not Started"]);
		expect(tickedOptions(openMenuFor("a"))).toEqual(["Archived"]);
	});
});

describe("Switch status in the task context menu", () => {
	function openSwitchStatusFor(status: string) {
		const handlers = new FluentActionHandlers(
			{} as any,
			{ settings } as any,
			() => "workspace",
			() => false,
		);
		const task = {
			id: "task",
			content: "Task",
			status,
			completed: status === "x",
			metadata: {},
		} as unknown as Task;
		const [contextMenu] = menusCreatedBy(() =>
			handlers.handleTaskContextMenu(new MouseEvent("contextmenu"), task),
		);
		return contextMenu.entries.find(
			(entry: any) => entry.title === "Switch status",
		).submenu;
	}

	it("ticks only the task's current status", () => {
		// "Cycle to next" previews the next status, which is not current
		expect(tickedOptions(openSwitchStatusFor("x"))).toEqual(["Completed"]);
		expect(tickedOptions(openSwitchStatusFor("a"))).toEqual(["Archived"]);
	});
});
