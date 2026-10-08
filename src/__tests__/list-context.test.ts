/**
 * Contexts in the list view.
 *
 * Regression: a task's context showed nowhere in the list. Its badge was
 * never drawn, and the task's text has the context removed. The text kept
 * a context in Chinese, "@办公室", which the task parser reads, and lost
 * part of an email, "me@example.com" → "me.com", which it doesn't.
 */

import { TaskListItemComponent } from "@/components/features/task/view/listItem";
import { TaskTreeItemComponent } from "@/components/features/task/view/treeItem";
import { clearAllMarks } from "@/components/ui/renderers/MarkdownRenderer";
import type { Task } from "@/types/task";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	class AbstractInputSuggest {}
	return {
		...actual,
		AbstractInputSuggest,
		getLinkpath: (linktext: string) => linktext.split("#")[0],
		Keymap: { isModEvent: () => false },
	};
});

// What the items use besides their metadata, which these tests don't reach
jest.mock("@/components/features/task/view/details", () => ({}));
jest.mock("@/components/features/task/view/BulkOperationsMenu", () => ({}));
jest.mock("@/components/features/task/view/InlineEditor", () => ({}));
jest.mock("@/components/features/task/view/InlineEditorManager", () => ({}));
jest.mock("@/components/features/task/view/TaskStatusIndicator", () => ({}));
jest.mock("@/managers/timer-manager", () => ({}));
jest.mock("@/commands/sortTaskCommands", () => ({}));

// Minimal stand-ins for the DOM helpers Obsidian adds to HTMLElement
const proto = HTMLElement.prototype as any;
proto.createEl = function (tag: string, o?: any) {
	const el = document.createElement(tag);
	if (typeof o === "string") o = { cls: o };
	if (o?.cls) el.className = o.cls;
	if (o?.text !== undefined) el.textContent = String(o.text);
	for (const [name, value] of Object.entries(o?.attr ?? {})) {
		el.setAttribute(name, String(value));
	}
	this.appendChild(el);
	return el;
};
proto.createDiv = function (o?: any) {
	return this.createEl("div", o);
};
proto.addClass = function (...cls: string[]) {
	this.classList.add(...cls);
};
proto.empty = function () {
	this.replaceChildren();
};

function taskWith(context: string): Task {
	return {
		id: "a.md-L0",
		content: "AI 教师可以看图",
		filePath: "Tasks/a.md",
		line: 0,
		completed: false,
		status: " ",
		originalMarkdown: `- [ ] AI 教师可以看图 @${context}`,
		metadata: { tags: [], children: [], context },
	} as unknown as Task;
}

const openLinkText = jest.fn();
const app: any = {
	metadataCache: {
		getFirstLinkpathDest: (linkpath: string) =>
			linkpath === "实现多角色" ? { path: "实现多角色.md" } : null,
	},
	workspace: { openLinkText, trigger: jest.fn() },
};

/** Draws the metadata of a list or tree item showing the task */
function metadataOf(kind: "list" | "tree", task: Task): HTMLElement {
	const metadataEl = document.createElement("div");
	const Item: any = kind === "list" ? TaskListItemComponent : TaskTreeItemComponent;
	const item = Object.assign(Object.create(Item.prototype), {
		task,
		app,
		viewMode: "inbox",
		metadataEl,
		plugin: { settings: { enableInlineEditor: false } },
	});
	item.renderMetadata(metadataEl);
	return metadataEl;
}

for (const kind of ["list", "tree"] as const) {
	describe(`Context in the ${kind} view`, () => {
		it("shows its name, after an @ the style adds", () => {
			const badge = metadataOf(kind, taskWith("Dev")).querySelector(".task-context");
			expect(badge?.textContent).toBe("Dev");
		});

		it("shows a note as a link that opens it", () => {
			const badge = metadataOf(kind, taskWith("[[实现多角色]]")).querySelector(
				".task-context",
			)!;
			const link = badge.querySelector("a.internal-link") as HTMLAnchorElement;
			expect(link.textContent).toBe("实现多角色");
			expect(link.dataset.href).toBe("实现多角色");
			expect(link.classList.contains("is-unresolved")).toBe(false);

			link.click();
			expect(openLinkText).toHaveBeenLastCalledWith("实现多角色", "Tasks/a.md", false);
		});

		it("marks a link to a note not written yet", () => {
			const link = metadataOf(kind, taskWith("[[新笔记|别名]]")).querySelector(
				".task-context a.internal-link",
			)!;
			expect(link.textContent).toBe("别名");
			expect(link.classList.contains("is-unresolved")).toBe(true);
		});

		it("is left out when the task has none", () => {
			const task = taskWith("Dev");
			delete task.metadata.context;
			expect(metadataOf(kind, task).querySelector(".task-context")).toBeNull();
		});
	});
}

describe("Text of a task without its marks", () => {
	for (const [markdown, text] of [
		["- [ ] 练习钢琴 #project/Audio/Music @Music", "练习钢琴"],
		["- [ ] 整理资料 @办公室 明天", "整理资料 明天"],
		["- [ ] 改善示意图 @[[改善手绘风格]] 🔺", "改善示意图"],
	]) {
		it(`drops the context: ${markdown}`, () => {
			expect(clearAllMarks(markdown)).toBe(text);
		});
	}

	for (const [markdown, text] of [
		["- [ ] 联系 me@example.com", "联系 me@example.com"],
		["- [ ] 看 [文档](https://a.b/@x) @Dev", "看 [文档](https://a.b/@x)"],
		["- [ ] 运行 `npm i @scope/pkg`", "运行 `npm i @scope/pkg`"],
	]) {
		it(`keeps an @ the task parser doesn't read as a context: ${markdown}`, () => {
			expect(clearAllMarks(markdown)).toBe(text);
		});
	}
});
