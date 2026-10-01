/**
 * Project counts in the Fluent sidebar must not grow with re-renders.
 *
 * Regression: the tree view added each child's count into its parent's
 * Project object, which is shared with the flat list, and the tree is rebuilt
 * on every render. A project with its own tasks and sub-projects (and every
 * ancestor above it) went up by the children's total on each expand/collapse.
 */

import { ProjectList } from "@/components/features/fluent/components/ProjectList";
import type { Task } from "@/types/task";

// Minimal stand-ins for the DOM helpers Obsidian adds to HTMLElement
const proto = HTMLElement.prototype as any;
proto.createEl = function (tag: string, o?: any) {
	const el = document.createElement(tag);
	if (typeof o === "string") o = { cls: o };
	if (o?.cls) el.className = o.cls;
	if (o?.text !== undefined) el.textContent = String(o.text);
	for (const [key, value] of Object.entries(o?.attr ?? {})) {
		el.setAttribute(key, String(value));
	}
	this.appendChild(el);
	return el;
};
proto.createDiv = function (o?: any) {
	return this.createEl("div", o);
};
proto.createSpan = function (o?: any) {
	return this.createEl("span", o);
};
proto.empty = function () {
	this.replaceChildren();
};
proto.addClass = function (...cls: string[]) {
	this.classList.add(...cls);
};
proto.removeClass = function (...cls: string[]) {
	this.classList.remove(...cls);
};

function makeTask(id: string, project: string): Task {
	return {
		id,
		content: id,
		filePath: `${id}.md`,
		line: 0,
		completed: false,
		status: " ",
		originalMarkdown: `- [ ] ${id}`,
		metadata: { tags: [], children: [], project } as any,
	} as Task;
}

const tasks = [
	makeTask("vernify", "Dev/Vernify"),
	...[1, 2, 3, 4, 5].map((i) => makeTask(`add-${i}`, "Dev/Vernify/Add")),
	makeTask("enhance-1", "Dev/Vernify/Enhance"),
	makeTask("enhance-2", "Dev/Vernify/Enhance"),
	...[1, 2, 3].map((i) => makeTask(`akg-${i}`, "Dev/AKG")),
];

async function createList(isTreeView: boolean, listTasks: Task[] = tasks) {
	const storage = new Map<string, unknown>([
		["task-genius-project-expanded", ["Dev", "Dev/Vernify"]],
	]);
	const plugin: any = {
		settings: {
			projectPathSeparator: "/",
			projectConfig: { customProjects: [] },
			taskStatuses: { archived: "a" },
		},
		app: {
			loadLocalStorage: (key: string) => storage.get(key) ?? null,
			saveLocalStorage: (key: string, value: unknown) =>
				storage.set(key, value),
			workspace: { on: () => ({}) },
		},
		dataflowOrchestrator: {
			getQueryAPI: () => ({ getAllTasks: async () => listTasks }),
		},
	};
	const containerEl = document.createElement("div");
	const list = new ProjectList(containerEl, plugin, () => {}, isTreeView);
	await list.onload();
	return { list, containerEl };
}

function shownCounts(containerEl: HTMLElement) {
	const counts: Record<string, number> = {};
	containerEl
		.querySelectorAll<HTMLElement>(".fluent-project-item[data-project-id]")
		.forEach((el) => {
			counts[el.dataset.projectId!] = Number(
				el.querySelector(".fluent-project-count")?.textContent,
			);
		});
	return counts;
}

describe("Fluent sidebar project counts", () => {
	it("totals descendants in the tree and stays the same across re-renders", async () => {
		const { list, containerEl } = await createList(true);
		const expected = {
			Dev: 11,
			"Dev/AKG": 3,
			"Dev/Vernify": 8,
			"Dev/Vernify/Add": 5,
			"Dev/Vernify/Enhance": 2,
		};
		expect(shownCounts(containerEl)).toEqual(expected);

		// Expanding or collapsing any node re-renders the whole tree
		(list as any).render();
		(list as any).render();
		expect(shownCounts(containerEl)).toEqual(expected);
	});

	it("shows each project's own tasks in the flat list after tree renders", async () => {
		const { list, containerEl } = await createList(true);

		list.setViewMode(false);

		expect(shownCounts(containerEl)).toEqual({
			"Dev/AKG": 3,
			"Dev/Vernify": 1,
			"Dev/Vernify/Add": 5,
			"Dev/Vernify/Enhance": 2,
		});
	});

	it("leaves archived tasks out, as they are hidden everywhere", async () => {
		const archived = { ...makeTask("akg-old", "Dev/AKG"), status: "a" };
		const { containerEl } = await createList(false, [...tasks, archived]);

		expect(shownCounts(containerEl)["Dev/AKG"]).toBe(3);
	});
});

describe("Fluent sidebar project list", () => {
	// Projects come from task note folders, so the list has no add button
	it("offers no Add Project button", async () => {
		const { containerEl } = await createList(false);

		expect(containerEl.querySelector(".fluent-add-project")).toBeNull();
		expect(containerEl.textContent).not.toContain("Add Project");
	});
});
