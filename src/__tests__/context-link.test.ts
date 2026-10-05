/**
 * A note as a task's context: @[[Note]]
 *
 * The parser stopped at "[", so the link stayed in the task's text and the
 * table's context column was empty.
 */

import { MarkdownTaskParser } from "@/dataflow/core/ConfigurableTaskParser";
import { getConfig } from "@/common/task-parser-config";
import { WriteAPI } from "@/dataflow/api/WriteAPI";
import { ContextSuggest } from "@/components/ui/inputs/AutoComplete";
import { TableRenderer } from "@/components/features/table/TableRenderer";
import {
	contextForLine,
	contextLinkTarget,
	contextLinkText,
} from "@/utils/task/context-link";
import { createMockPlugin } from "./mockUtils";
import type { Task } from "@/types/task";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	class AbstractInputSuggest {
		constructor(
			public app: any,
			public inputEl: HTMLInputElement,
		) {}
	}
	// Matches when the letters of the query appear in order
	const prepareFuzzySearch = (query: string) => (text: string) => {
		let at = 0;
		for (const char of text.toLowerCase()) {
			if (char === query.toLowerCase()[at]) at++;
		}
		return at === query.length ? { score: -text.length, matches: [] } : null;
	};
	const Keymap = {
		isModEvent: (event: MouseEvent) =>
			event.metaKey || event.ctrlKey ? "tab" : false,
	};
	const getLinkpath = (linktext: string) => linktext.replace(/#.*$/, "");
	return {
		...actual,
		AbstractInputSuggest,
		prepareFuzzySearch,
		Keymap,
		getLinkpath,
	};
});

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
proto.empty = function () {
	this.replaceChildren();
};
proto.addClass = function (...cls: string[]) {
	this.classList.add(...cls);
};

const plugin = createMockPlugin({
	preferMetadataFormat: "tasks",
	projectTagPrefix: { tasks: "project", dataview: "project" },
	contextTagPrefix: { tasks: "@", dataview: "context" },
	areaTagPrefix: { tasks: "area", dataview: "area" },
} as any);

function parse(line: string): Task {
	const parser = new MarkdownTaskParser(getConfig("tasks", plugin));
	return parser.parseLegacy(line, "Tasks/note.md")[0];
}

describe("Parsing a note as the context", () => {
	it("takes @[[Note]] as the context, keeping the link", () => {
		const task = parse("- [ ] 写作业 @[[笔记名字]]");

		expect(task.metadata.context).toBe("[[笔记名字]]");
		expect(task.content).toBe("写作业");
	});

	it("keeps spaces, headings and aliases in the link", () => {
		const task = parse("- [ ] Call @[[Bob Smith#Phone|Bob]] 📅 2026-10-10");

		expect(task.metadata.context).toBe("[[Bob Smith#Phone|Bob]]");
		expect(task.content).toBe("Call");
		expect(task.metadata.dueDate).toBeDefined();
	});

	it("keeps the tags and project written before the context", () => {
		const task = parse(
			"- [ ] 中英作文 #写作脚手架 #project/Development/Vernify/Add @[[OpenDots]]",
		);

		expect(task.metadata.tags).toEqual(["#写作脚手架"]);
		expect(task.metadata.project).toBe("Development/Vernify/Add");
		expect(task.metadata.context).toBe("[[OpenDots]]");
		expect(task.content).toBe("中英作文");
	});

	it("does the same for a plain context after tags", () => {
		const task = parse("- [ ] 3D 动态漫画 #project/Development/AKG  @Dev");

		expect(task.metadata.project).toBe("Development/AKG");
		expect(task.metadata.context).toBe("Dev");
		expect(task.content).toBe("3D 动态漫画");
	});

	it("looks past an @ that starts no context", () => {
		const task = parse("- [ ] Mail me@example.com @home");

		expect(task.metadata.context).toBe("home");
		expect(task.content).toBe("Mail me@example.com");
	});

	it("ignores an @ inside a link or inline code", () => {
		const task = parse("- [ ] See [[Notes @ work]] and `a @b` @office");

		expect(task.metadata.context).toBe("office");
		expect(task.content).toBe("See [[Notes @ work]] and `a @b`");
	});

	it("takes no context from a link glued to a word", () => {
		const task = parse("- [ ] foo@[[Bar]]");

		expect(task.metadata.context).toBeUndefined();
		expect(task.content).toBe("foo@[[Bar]]");
	});
});

describe("context-link helpers", () => {
	it("writes a link as it is and other contexts without spaces or @", () => {
		expect(contextForLine("[[Bob Smith]]")).toBe("[[Bob Smith]]");
		expect(contextForLine("@[[Bob Smith]]")).toBe("[[Bob Smith]]");
		expect(contextForLine("@home office")).toBe("home-office");
	});

	it("shows a link as Obsidian does", () => {
		expect(contextLinkText("[[Bob Smith]]")).toBe("Bob Smith");
		expect(contextLinkText("[[Bob Smith|Bob]]")).toBe("Bob");
		expect(contextLinkText("[[Bob Smith#Phone]]")).toBe("Bob Smith > Phone");
	});

	it("finds the note a link context points to", () => {
		expect(contextLinkTarget("[[Bob Smith#Phone|Bob]]")).toBe(
			"Bob Smith#Phone",
		);
		expect(contextLinkTarget("home")).toBeNull();
		expect(contextLinkTarget("[[a]] and [[b]]")).toBeNull();
	});
});

describe("Writing a note as the context", () => {
	function setup(content: string, task: Task) {
		const vault: any = {
			content,
			getAbstractFileByPath: () => ({ path: task.filePath }),
			read: async () => vault.content,
			modify: async (_file: unknown, next: string) => {
				vault.content = next;
			},
		};
		const app: any = {
			workspace: { trigger: jest.fn(), on: jest.fn() },
			fileManager: { processFrontMatter: jest.fn() },
		};
		const metadataCache: any = { getFileCache: () => ({}) };
		const writeAPI = new WriteAPI(app, vault, metadataCache, plugin, async () => task);
		return { writeAPI, vault };
	}

	it("keeps the spaces in the link and adds no second @", async () => {
		const task = parse("- [ ] Call #phone");
		const { writeAPI, vault } = setup("- [ ] Call #phone\n", task);

		const result = await writeAPI.updateTask({
			taskId: task.id,
			updates: { metadata: { ...task.metadata, context: "@[[Bob Smith]]" } },
		});

		expect(result.success).toBe(true);
		expect(vault.content).toBe("- [ ] Call #phone @[[Bob Smith]]\n");
	});

	it("leaves the link alone when another field changes", async () => {
		const line = "- [ ] Call @[[Bob Smith]] #phone";
		const task = parse(line);
		const { writeAPI, vault } = setup(`${line}\n`, task);

		await writeAPI.updateTask({
			taskId: task.id,
			updates: { metadata: { ...task.metadata, priority: 4 } },
		});

		expect(vault.content).toBe("- [ ] Call #phone @[[Bob Smith]] ⏫\n");
	});
});

describe("Context suggestions", () => {
	const note = (basename: string, mtime: number) => ({
		basename,
		path: `People/${basename}.md`,
		stat: { mtime },
	});

	function suggest(contexts: string[]) {
		const app: any = {
			vault: {
				getMarkdownFiles: () => [
					note("Bob Smith", 1),
					note("Alice", 3),
					note("Bobby Tables", 2),
				],
			},
			metadataCache: {
				fileToLinktext: (file: { basename: string }) => file.basename,
				getTags: () => ({}),
			},
		};
		const input = document.createElement("input");
		const s = new ContextSuggest(app, input, { app, settings: {} } as any);
		(s as any).availableChoices = contexts;
		return s;
	}

	it("suggests contexts as before", () => {
		expect(suggest(["home", "office"]).getSuggestions("off")).toEqual([
			"office",
		]);
	});

	it("suggests notes after [[, as links", () => {
		expect(suggest([]).getSuggestions("[[bob")).toEqual([
			"[[Bob Smith]]",
			"[[Bobby Tables]]",
		]);
		expect(suggest([]).getSuggestions("@[[")).toEqual([
			"[[Alice]]",
			"[[Bobby Tables]]",
			"[[Bob Smith]]",
		]);
	});
});

describe("Context column in the table", () => {
	function render(value: string, editable = true) {
		const app: any = {
			workspace: { openLinkText: jest.fn(), trigger: jest.fn() },
			metadataCache: {
				getFirstLinkpathDest: (path: string) =>
					path === "Missing" ? null : { path: `${path}.md` },
				getTags: () => ({}),
			},
		};
		const div = () => document.createElement("div");
		const renderer = new TableRenderer(div(), div(), div(), [], {} as any, app, {
			app,
		} as any);
		const onCellChange = jest.fn();
		(renderer as any).onCellChange = onCellChange;

		const cellEl = document.createElement("td");
		cellEl.dataset.rowId = "Tasks/a.md-L0";
		document.body.appendChild(cellEl);
		const cell = { columnId: "context", value, displayValue: value, editable };
		(renderer as any).renderTextCell(cellEl, cell, {
			task: { filePath: "Tasks/a.md", metadata: {} },
		});
		return { app, renderer, cellEl, onCellChange };
	}
	const click = (el: Element, init: MouseEventInit = {}) =>
		el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));

	it("shows a note as a link with its name, which opens the note", () => {
		const { app, cellEl } = render("[[Bob Smith|Bob]]");
		const link = cellEl.querySelector("a.internal-link")!;

		expect(link.textContent).toBe("Bob");
		expect(cellEl.querySelector("input")).toBeNull();

		click(link);
		expect(app.workspace.openLinkText).toHaveBeenCalledWith(
			"Bob Smith",
			"Tasks/a.md",
			false,
		);
		click(link, { metaKey: true });
		expect(app.workspace.openLinkText).toHaveBeenLastCalledWith(
			"Bob Smith",
			"Tasks/a.md",
			"tab",
		);
	});

	it("marks a link to a missing note", () => {
		const { cellEl } = render("[[Missing]]");

		expect(cellEl.querySelector("a")!.classList).toContain("is-unresolved");
	});

	it("asks Obsidian for a preview of the note on hover", () => {
		const { app, renderer, cellEl } = render("[[Bob Smith]]");
		const link = cellEl.querySelector("a")!;

		link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

		expect(app.workspace.trigger).toHaveBeenCalledWith(
			"hover-link",
			expect.objectContaining({
				source: "task-genius",
				hoverParent: renderer,
				targetEl: link,
				linktext: "Bob Smith",
				sourcePath: "Tasks/a.md",
			}),
		);
	});

	it("edits the link as written when clicked beside it, and shows it again if unchanged", () => {
		const { cellEl, onCellChange } = render("[[Bob Smith]]");

		click(cellEl.querySelector(".task-table-context-link")!);
		const input = cellEl.querySelector("input")!;
		expect(input.value).toBe("[[Bob Smith]]");
		expect(document.activeElement).toBe(input);

		input.dispatchEvent(new FocusEvent("blur"));
		expect(onCellChange).not.toHaveBeenCalled();
		expect(cellEl.querySelector("input")).toBeNull();
		expect(cellEl.querySelector("a")!.textContent).toBe("Bob Smith");
	});

	it("saves an edited link", () => {
		const { cellEl, onCellChange } = render("[[Bob Smith]]");

		click(cellEl.querySelector(".task-table-context-link")!);
		const input = cellEl.querySelector("input")!;
		input.value = "[[Alice]]";
		input.dispatchEvent(new FocusEvent("blur"));

		expect(onCellChange).toHaveBeenCalledWith(
			"Tasks/a.md-L0",
			"context",
			"[[Alice]]",
		);
	});

	it("only opens the link in a cell that can't be edited", () => {
		const { cellEl } = render("[[Bob Smith]]", false);

		click(cellEl.querySelector(".task-table-context-link")!);

		expect(cellEl.querySelector("input")).toBeNull();
	});

	it("keeps other contexts in an input", () => {
		const { cellEl } = render("home");

		expect(cellEl.querySelector("input")!.value).toBe("home");
		expect(cellEl.querySelector("a")).toBeNull();
	});
});
