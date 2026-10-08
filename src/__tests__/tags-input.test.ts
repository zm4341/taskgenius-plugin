/**
 * Adding several tags at once in the table's tags column.
 *
 * Regression: only "," separated tags. "测试甲，测试乙" (full-width comma) or
 * "测试甲 测试乙" became one tag, and the task line got "#测试甲，测试乙", so
 * the task parser took "#测试甲" and left "，测试乙" in the task's text. And
 * Enter in the suggestions took the first fuzzy match, not the tag typed:
 * typing "测试乙" could insert "#测试甲，测试乙" or a stray "#286；…" tag.
 */

import { TagSuggest } from "@/components/ui/inputs/AutoComplete";
import { TableRenderer } from "@/components/features/table/TableRenderer";
import { WriteAPI } from "@/dataflow/api/WriteAPI";
import { currentTagOf, isTaskTag, parseTagNames } from "@/utils/file/note-tags";
import type { Task } from "@/types/task";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	class AbstractInputSuggest {
		constructor(
			public app: any,
			public inputEl: HTMLInputElement,
		) {}
	}
	// Matches when the letters of the query appear in order; shorter is better
	const prepareFuzzySearch = (query: string) => (text: string) => {
		let at = 0;
		for (const char of text.toLowerCase()) {
			if (char === query.toLowerCase()[at]) at++;
		}
		return at === query.length ? { score: -text.length, matches: [] } : null;
	};
	return { ...actual, AbstractInputSuggest, prepareFuzzySearch };
});

// Minimal stand-ins for the DOM helpers Obsidian adds to HTMLElement
const proto = HTMLElement.prototype as any;
proto.createEl = function (tag: string, o?: any) {
	const el = document.createElement(tag);
	if (typeof o === "string") o = { cls: o };
	if (o?.cls) el.className = o.cls;
	if (o?.text !== undefined) el.textContent = String(o.text);
	this.appendChild(el);
	return el;
};
proto.createDiv = function (o?: any) {
	return this.createEl("div", o);
};
proto.addClass = function (...cls: string[]) {
	this.classList.add(...cls);
};

describe("Tags typed as a list", () => {
	it("are separated by commas, full-width commas, 、, semicolons or spaces", () => {
		expect(parseTagNames("测试甲，测试乙 #c、d;e；f,")).toEqual([
			"测试甲",
			"测试乙",
			"c",
			"d",
			"e",
			"f",
		]);
		expect(parseTagNames("#a#b")).toEqual(["a", "b"]);
	});

	it("are kept once, as tags ignore case", () => {
		expect(parseTagNames("AI教师, ai教师, project/x")).toEqual([
			"AI教师",
			"project/x",
		]);
	});

	it("end with the one being typed", () => {
		expect(currentTagOf("#测试甲，测")).toBe("测");
		expect(currentTagOf("#测试甲, #")).toBe("");
		expect(currentTagOf("#测试甲, ")).toBe("");
	});

	it("are only suggested when a task line can hold them", () => {
		expect(isTaskTag("AI教师")).toBe(true);
		expect(isTaskTag("project/Dev-1_a")).toBe(true);
		expect(isTaskTag("286；起测试栈")).toBe(false);
		expect(isTaskTag("测试甲，测试乙")).toBe(false);
		expect(isTaskTag("a b")).toBe(false);
		expect(isTaskTag("a.b")).toBe(false);
	});
});

describe("Tag suggestions", () => {
	function suggest(value: string) {
		const app: any = { metadataCache: { getTags: () => ({}) } };
		const input = document.createElement("input");
		input.value = value;
		const s = new TagSuggest(app, input, { app, settings: {} } as any);
		(s as any).availableChoices = [
			"测试甲，测试乙",
			"286；起测试栈、导测试栈地址",
			"测试乙丙",
			"测试乙",
			"测试甲",
		];
		return s;
	}

	it("put the tag typed first when it exists, then tags starting with it", () => {
		expect(suggest("").getSuggestions("#测试甲，测试乙")).toEqual([
			"测试乙",
			"测试乙丙",
		]);
	});

	it("put what was typed first when it is a new tag, so Enter keeps it", () => {
		// Tags that rank the same keep their order
		expect(suggest("").getSuggestions("测试")).toEqual([
			"测试",
			"测试乙",
			"测试甲",
			"测试乙丙",
		]);
		expect(suggest("").getSuggestions("新标签")).toEqual(["新标签"]);
	});

	it("leave out the tags already in the list", () => {
		expect(suggest("").getSuggestions("#测试甲, #测试乙丙, 测试")).toEqual([
			"测试",
			"测试乙",
		]);
	});

	it("replace only the tag being typed and leave room for the next", () => {
		expect(suggest("#测试甲，测").getSuggestionValue("测试乙")).toBe(
			"#测试甲, #测试乙, ",
		);
		expect(suggest("测").getSuggestionValue("测试乙")).toBe("#测试乙, ");
	});
});

describe("Tags column in the table", () => {
	it("saves each tag of the list", () => {
		const div = () => document.createElement("div");
		const renderer = new TableRenderer(div(), div(), div(), [], {} as any, {} as any, {} as any);
		const onCellChange = jest.fn();
		(renderer as any).onCellChange = onCellChange;
		const cellEl = document.createElement("td");
		cellEl.dataset.rowId = "Tasks/a.md-L0";

		(renderer as any).renderTagsCell(cellEl, {
			columnId: "tags",
			value: [],
			displayValue: "",
			editable: true,
		});
		const input = cellEl.querySelector("input")!;
		input.value = "测试甲，测试乙 #c";
		input.dispatchEvent(new FocusEvent("blur"));

		expect(onCellChange).toHaveBeenCalledWith("Tasks/a.md-L0", "tags", [
			"#测试甲",
			"#测试乙",
			"#c",
		]);
	});

	it("writes a tag that holds separators as several tags", async () => {
		const line = "- [ ] 代码检索 #project/AI/Agent 🔼";
		const task = {
			id: "a.md-L0",
			content: "代码检索",
			filePath: "a.md",
			line: 0,
			completed: false,
			status: " ",
			originalMarkdown: line,
			metadata: { tags: [], children: [], project: "AI/Agent", priority: 3 },
		} as unknown as Task;
		const vault: any = {
			content: `${line}\n`,
			getAbstractFileByPath: () => ({ path: "a.md" }),
			read: async () => vault.content,
			modify: async (_file: unknown, next: string) => {
				vault.content = next;
			},
		};
		const app: any = {
			workspace: { trigger: jest.fn(), on: jest.fn() },
			fileManager: { processFrontMatter: jest.fn() },
		};
		const plugin: any = {
			settings: {
				preferMetadataFormat: "tasks",
				projectTagPrefix: { tasks: "project" },
				contextTagPrefix: { tasks: "@" },
				taskStatuses: { completed: "x" },
				autoDateManager: {},
			},
		};
		const writeAPI = new WriteAPI(app, vault, { getFileCache: () => ({}) } as any, plugin, async () => task);

		await writeAPI.updateTask({
			taskId: task.id,
			updates: { metadata: { ...task.metadata, tags: ["#测试甲，测试乙 c"] } },
		});

		expect(vault.content).toBe(
			"- [ ] 代码检索 #测试甲 #测试乙 #c #project/AI/Agent 🔼\n",
		);
	});
});
