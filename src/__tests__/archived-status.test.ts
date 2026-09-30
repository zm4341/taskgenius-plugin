/**
 * Archived tasks (`- [a]`) stay out of every view. The table view is the one
 * place to see them: its status column filter lists "Archived", and picking
 * it shows them.
 */

import { filterTasks } from "@/utils/task/task-filter-utils";
import { isTableView } from "@/utils/task/archived-status";
import { migrateArchivedStatus } from "@/utils/settings-migration";
import { TableView } from "@/components/features/table/TableView";
import { TableRenderer } from "@/components/features/table/TableRenderer";
import type { Task } from "@/types/task";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	class MenuItem {
		title = "";
		titleEl = document.createElement("div");
		clickHandler: (() => unknown) | null = null;
		setTitle(title: string) {
			this.title = title;
			return this;
		}
		setIcon() {
			return this;
		}
		onClick(handler: () => unknown) {
			this.clickHandler = handler;
			return this;
		}
	}
	class Menu {
		static last: Menu | null = null;
		entries: Array<MenuItem | "separator"> = [];
		constructor() {
			Menu.last = this;
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
	return { ...actual, Menu };
});

// The table's autocomplete inputs extend an Obsidian class the test mock lacks
jest.mock("@/components/ui/inputs/AutoComplete", () => ({
	ContextSuggest: class {},
	ProjectSuggest: class {},
	TagSuggest: class {},
}));

// Minimal stand-ins for the DOM helpers Obsidian adds to HTMLElement
const proto = HTMLElement.prototype as any;
proto.createEl = function (tag: string, o?: any, callback?: (el: any) => void) {
	const el = document.createElement(tag) as any;
	if (typeof o === "string") o = { cls: o };
	if (o?.cls) el.className = o.cls;
	if (o?.text !== undefined) el.textContent = String(o.text);
	if (o?.type) el.type = o.type;
	this.appendChild(el);
	callback?.(el);
	return el;
};

const taskStatuses = {
	completed: "x|X",
	inProgress: ">|/",
	abandoned: "-",
	planned: "?",
	notStarted: " ",
	archived: "a",
};

function makeTask(id: string, status: string): Task {
	return {
		id,
		content: id,
		filePath: `${id}.md`,
		line: 0,
		completed: status === "x",
		status,
		originalMarkdown: `- [${status}] ${id}`,
		metadata: { tags: [], children: [] },
	} as unknown as Task;
}

const todo = makeTask("todo", " ");
const archived = makeTask("old", "a");

function makePlugin(settings: Record<string, unknown> = {}) {
	return {
		settings: {
			taskStatuses,
			viewConfiguration: [],
			globalFilterRules: {},
			...settings,
		},
		saveSettings: jest.fn(),
	} as any;
}

function menuLabels(): string[] {
	const { Menu } = jest.requireMock("obsidian");
	return Menu.last.entries.map((entry: any) =>
		entry === "separator" ? "---" : entry.title || entry.titleEl.textContent,
	);
}

describe("Archived tasks in views", () => {
	it("are left out by default", () => {
		const shown = filterTasks([todo, archived], "my-list", makePlugin());
		expect(shown.map((task) => task.id)).toEqual(["todo"]);
	});

	it("are kept for views that ask for them", () => {
		const shown = filterTasks([todo, archived], "my-list", makePlugin(), {
			includeArchived: true,
		});
		expect(shown.map((task) => task.id)).toEqual(["todo", "old"]);
	});

	it("only go to table views", () => {
		const plugin = makePlugin();
		expect(isTableView(plugin, "table")).toBe(true);
		expect(isTableView(plugin, "inbox")).toBe(false);
	});
});

describe("Archived status in older settings", () => {
	it("is added with the mark a", () => {
		const settings: any = {
			taskStatuses: { completed: "x", notStarted: " " },
		};
		migrateArchivedStatus(settings);
		expect(settings.taskStatuses.archived).toBe("a");
	});

	it("is left without a mark when a is taken", () => {
		const settings: any = {
			taskStatuses: { completed: "x", notStarted: " |a" },
		};
		migrateArchivedStatus(settings);
		expect(settings.taskStatuses.archived).toBe("");
	});

	it("keeps marks the user set", () => {
		const settings: any = { taskStatuses: { archived: "z" } };
		migrateArchivedStatus(settings);
		expect(settings.taskStatuses.archived).toBe("z");
	});
});

describe("Archived tasks in the table view", () => {
	function makeView() {
		const config = {
			viewType: "table",
			visibleColumns: ["status", "content"],
			columnWidths: {},
			sortableColumns: true,
			resizableColumns: true,
			showRowNumbers: false,
		} as any;
		const view = new TableView(
			{} as any,
			makePlugin(),
			document.createElement("div"),
			config,
			{},
			"table",
		) as any;
		view.allTasks = [todo, archived];
		return view;
	}

	function shownIds(view: any): string[] {
		view.applyFiltersAndSort();
		return view.filteredTasks.map((task: Task) => task.id);
	}

	it("stay hidden until the status filter asks for them", () => {
		const view = makeView();
		expect(shownIds(view)).toEqual(["todo"]);

		view.columnFilters.set("status", new Set(["a"]));
		expect(shownIds(view)).toEqual(["old"]);

		view.columnFilters.set("status", new Set([" ", "a"]));
		expect(shownIds(view)).toEqual(["todo", "old"]);
	});

	it("are listed last in the status filter menu", () => {
		const view = makeView();
		view.showColumnFilterMenu(new MouseEvent("click"), "status");

		expect(menuLabels()).toEqual([
			"Show All",
			"---",
			"Not Started (1)",
			"---",
			"Archived (1)",
		]);
	});
});

describe("Table status menu", () => {
	it("offers Archived, which sets the archived mark", () => {
		const plugin = makePlugin({
			statusCycles: [
				{
					id: "default",
					name: "Default",
					priority: 0,
					enabled: true,
					cycle: ["Not Started", "Completed"],
					marks: { "Not Started": " ", Completed: "x" },
				},
			],
		});
		const renderer = new TableRenderer(
			document.createElement("table"),
			document.createElement("thead"),
			document.createElement("tbody"),
			[],
			{} as any,
			{} as any,
			plugin,
		) as any;
		const onCellChange = jest.fn();
		renderer.onCellChange = onCellChange;

		const cellEl = document.createElement("td");
		cellEl.dataset.rowId = "todo";
		renderer.openStatusMenu(cellEl, { columnId: "status", value: " " });

		expect(menuLabels()).toEqual([
			"Not Started",
			"Completed",
			"---",
			"Archived",
		]);
		const { Menu } = jest.requireMock("obsidian");
		Menu.last.entries[3].clickHandler();
		expect(onCellChange).toHaveBeenCalledWith("todo", "status", "a");
	});
});
