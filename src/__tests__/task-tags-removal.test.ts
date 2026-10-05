/**
 * Tags removed in the table or the details panel must stay removed.
 *
 * Regression: a task shows the tags of its note's tags property too, but only
 * the task line was rewritten, so removing such a tag did nothing: it came
 * back from the property at once. Tags could be added but not removed.
 */

import { Notice } from "obsidian";
import { WriteAPI } from "@/dataflow/api/WriteAPI";
import { TableView } from "@/components/features/table/TableView";
import { FluentActionHandlers } from "@/components/features/fluent/managers/FluentActionHandlers";
import type { Task } from "@/types/task";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	// Base of suggest inputs that modules on the import path extend
	class AbstractInputSuggest {}
	return { ...actual, Notice: jest.fn(), AbstractInputSuggest };
});

// The table's autocomplete inputs extend an Obsidian class the test mock lacks
jest.mock("@/components/ui/inputs/AutoComplete", () => ({
	ContextSuggest: class {},
	ProjectSuggest: class {},
	TagSuggest: class {},
}));

/** Frontmatter as Obsidian keeps it: `key: value`, `key:` when empty, lists as `  - item` */
function parseFrontmatter(content: string) {
	const match = content.match(/^---\n([\s\S]*?)\n---\n/);
	const data: Record<string, any> = {};
	let lastKey = "";
	for (const line of (match?.[1] ?? "").split("\n")) {
		const item = line.match(/^\s*-\s+(.*)$/);
		if (item) {
			data[lastKey] = [...(data[lastKey] ?? []), item[1]];
			continue;
		}
		const [key, ...rest] = line.split(":");
		const value = rest.join(":").trim();
		data[key] = value === "" ? null : value;
		lastKey = key;
	}
	return { data, body: content.slice(match?.[0].length ?? 0) };
}

function stringifyFrontmatter(data: Record<string, any>, body: string) {
	const lines = Object.entries(data).flatMap(([key, value]) =>
		Array.isArray(value)
			? [`${key}:`, ...value.map((item) => `  - ${item}`)]
			: value === null || value === undefined
				? [`${key}:`]
				: [`${key}: ${value}`],
	);
	return `---\n${lines.join("\n")}\n---\n${body}`;
}

const NOTE = "Tasks/Vernify/题目卡片化.md";

function makeTask(line: number, metadata: Record<string, any>): Task {
	return {
		id: `${NOTE}-L${line}`,
		content: "题目卡片化",
		filePath: NOTE,
		line,
		completed: false,
		status: " ",
		originalMarkdown: "",
		metadata: { tags: [], children: [], ...metadata },
	} as Task;
}

/** WriteAPI over one in-memory note */
function setup(content: string, task: Task) {
	const file = { path: NOTE };
	const vault: any = {
		content,
		getAbstractFileByPath: () => file,
		read: async () => vault.content,
		modify: async (_file: unknown, next: string) => {
			vault.content = next;
		},
	};
	const app: any = {
		workspace: { trigger: jest.fn(), on: jest.fn() },
		fileManager: {
			processFrontMatter: jest.fn(
				async (_file: unknown, fn: (fm: any) => void) => {
					const { data, body } = parseFrontmatter(vault.content);
					fn(data);
					vault.content = stringifyFrontmatter(data, body);
				},
			),
		},
	};
	const metadataCache: any = {
		getFileCache: () => ({
			frontmatter: parseFrontmatter(vault.content).data,
		}),
	};
	const plugin: any = {
		settings: {
			preferMetadataFormat: "tasks",
			projectTagPrefix: { tasks: "project", dataview: "project" },
			contextTagPrefix: { tasks: "@", dataview: "context" },
			taskStatuses: { completed: "x" },
			autoDateManager: {},
		},
	};
	const writeAPI = new WriteAPI(app, vault, metadataCache, plugin, async (id) =>
		id === task.id ? task : null,
	);
	return { writeAPI, vault, app };
}

const lineOf = (content: string, n: number) => content.split("\n")[n];

describe("WriteAPI.updateTask with removedTags", () => {
	beforeEach(() => jest.clearAllMocks());

	it("takes a tag the task inherits off the note's tags property", async () => {
		const content = [
			"---",
			"tags:",
			"  - 学科相关",
			"Project: Development/Vernify/Add",
			"---",
			"- [ ] 题目卡片化 #学科功能 #project/Development/Vernify/Add",
			"",
		].join("\n");
		const task = makeTask(5, {
			tags: ["#学科功能", "#学科相关"],
			project: "Development/Vernify/Add",
		});
		const { writeAPI, vault } = setup(content, task);

		const result = await writeAPI.updateTask({
			taskId: task.id,
			updates: { metadata: { ...task.metadata, tags: ["#学科功能"] } },
			removedTags: ["#学科相关"],
		});

		expect(result.success).toBe(true);
		expect(vault.content).toBe(
			[
				"---",
				"tags:",
				"Project: Development/Vernify/Add",
				"---",
				"- [ ] 题目卡片化 #学科功能 #project/Development/Vernify/Add",
				"",
			].join("\n"),
		);
	});

	it("takes a tag off both the task line and the property when both hold it", async () => {
		const content = [
			"---",
			"tags:",
			"  - 写作脚手架",
			"  - AI教师",
			"Project: Development/Vernify/Add",
			"---",
			"- [ ] 中英作文写作辅助 #写作脚手架 #AI教师 #project/Development/Vernify/Add @OpenDots",
			"",
		].join("\n");
		const task = makeTask(6, {
			tags: ["#写作脚手架", "#AI教师"],
			project: "Development/Vernify/Add",
			context: "OpenDots",
		});
		const { writeAPI, vault } = setup(content, task);

		await writeAPI.updateTask({
			taskId: task.id,
			updates: { metadata: { ...task.metadata, tags: ["#AI教师"] } },
			removedTags: ["#写作脚手架"],
		});

		expect(parseFrontmatter(vault.content).data.tags).toEqual(["AI教师"]);
		expect(lineOf(vault.content, 5)).toBe(
			"- [ ] 中英作文写作辅助 #AI教师 #project/Development/Vernify/Add @OpenDots",
		);
	});

	it("takes a removed tag out of the middle of the task text", async () => {
		const content = "- [ ] Read #book chapter one #later\n";
		const task = makeTask(0, { tags: ["#book", "#later"] });
		const { writeAPI, vault } = setup(content, task);

		await writeAPI.updateTask({
			taskId: task.id,
			updates: { metadata: { ...task.metadata, tags: ["#later"] } },
			removedTags: ["#book"],
		});

		expect(vault.content).toBe("- [ ] Read chapter one #later\n");
	});

	it("leaves the property of a note with other tasks alone and says why", async () => {
		const content = [
			"---",
			"tags:",
			"  - 学科相关",
			"---",
			"- [ ] 题目卡片化 #学科功能",
			"- [ ] 编程题",
			"",
		].join("\n");
		const task = makeTask(4, { tags: ["#学科功能", "#学科相关"] });
		const { writeAPI, vault, app } = setup(content, task);

		await writeAPI.updateTask({
			taskId: task.id,
			updates: { metadata: { ...task.metadata, tags: ["#学科功能"] } },
			removedTags: ["#学科相关"],
		});

		expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
		expect(parseFrontmatter(vault.content).data.tags).toEqual(["学科相关"]);
		expect(Notice).toHaveBeenCalledWith(
			expect.stringContaining("#学科相关"),
		);
	});

	it("leaves the property alone when no tags were removed", async () => {
		const content = [
			"---",
			"tags:",
			"  - 学科相关",
			"---",
			"- [ ] 题目卡片化 #学科功能",
			"",
		].join("\n");
		// Parsed straight from the line, as the editor's details popover may
		// do, so it lacks the inherited tag
		const task = makeTask(4, { tags: ["#学科功能"] });
		const { writeAPI, vault, app } = setup(content, task);

		await writeAPI.updateTask({
			taskId: task.id,
			updates: {
				metadata: { ...task.metadata, dueDate: new Date(2026, 9, 9).getTime() },
			},
		});

		expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
		expect(parseFrontmatter(vault.content).data.tags).toEqual(["学科相关"]);
	});
});

describe("Table tags column", () => {
	function editTags(task: Task, newValue: string[]) {
		const updateTask = jest.fn(async () => ({ success: true }));
		const view: any = {
			allTasks: [task],
			plugin: { writeAPI: { updateTask } },
			applyFiltersAndSort: jest.fn(),
			refreshDisplay: jest.fn(),
		};
		const done = (TableView.prototype as any).handleCellChange.call(
			view,
			task.id,
			"tags",
			newValue,
		);
		return { view, updateTask, done };
	}

	it("tells WriteAPI which tags were removed, with or without #", async () => {
		const task = makeTask(5, { tags: ["#学科功能", "#学科相关"] });

		const { updateTask, done } = editTags(task, ["学科功能", "新标签"]);
		await done;

		expect(updateTask).toHaveBeenCalledWith({
			taskId: task.id,
			updates: {
				metadata: expect.objectContaining({ tags: ["#学科功能", "#新标签"] }),
			},
			removedTags: ["#学科相关"],
		});
	});

	it("shows the new tags at once without touching the indexed task", async () => {
		const task = makeTask(5, { tags: ["#学科功能", "#学科相关"] });

		const { view, done } = editTags(task, ["#学科功能"]);
		await done;

		expect(view.allTasks[0].metadata.tags).toEqual(["#学科功能"]);
		expect(task.metadata.tags).toEqual(["#学科功能", "#学科相关"]);
		expect(view.refreshDisplay).toHaveBeenCalled();
	});
});

describe("Details panel tags", () => {
	function update(original: Task, updated: Task) {
		const updateTask = jest.fn(async () => ({ success: true }));
		const handlers: any = {
			plugin: { writeAPI: { updateTask } },
			extractChangedFields: (FluentActionHandlers.prototype as any)
				.extractChangedFields,
			onTaskUpdated: jest.fn(),
		};
		const done = (
			FluentActionHandlers.prototype as any
		).handleTaskUpdate.call(handlers, original, updated);
		return { updateTask, done };
	}

	it("tell WriteAPI which tags were removed", async () => {
		const original = makeTask(5, { tags: ["#学科功能", "#学科相关"] });
		const updated = {
			...original,
			metadata: { ...original.metadata, tags: ["#学科功能"] },
		};

		const { updateTask, done } = update(original, updated);
		await done;

		expect(updateTask).toHaveBeenCalledWith(
			expect.objectContaining({ removedTags: ["#学科相关"] }),
		);
	});

	it("remove none when only another field changed", async () => {
		const original = makeTask(5, { tags: ["#学科功能", "#学科相关"] });
		const updated = {
			...original,
			metadata: { ...original.metadata, priority: 4 },
		};

		const { updateTask, done } = update(original, updated);
		await done;

		expect(updateTask).toHaveBeenCalledWith(
			expect.objectContaining({ removedTags: [] }),
		);
	});
});
