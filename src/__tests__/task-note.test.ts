/**
 * The New Task button creates one note per task: a note from the template in
 * a project folder, or an existing note without tasks turned into one.
 */

import { TFile, TFolder } from "obsidian";
import {
	convertToTaskNote,
	createTaskNote,
	listTaskNoteFolders,
	taskNoteFolderOf,
	type TaskNoteSettings,
} from "@/utils/file/task-note";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	const two = (n: number) => ("0" + n).slice(-2);
	class TFolder {
		path = "";
		name = "";
		parent: TFolder | null = null;
		children: unknown[] = [];
	}
	return {
		...actual,
		TFolder,
		normalizePath: (path: string) =>
			path
				.replace(/\\/g, "/")
				.replace(/\/+/g, "/")
				.replace(/^\/+|\/+$/g, ""),
		// Now is 2026-10-01 09:30:00; a timestamp gives that moment
		moment: (input?: number) => {
			const date =
				input === undefined
					? new Date(2026, 9, 1, 9, 30, 0)
					: new Date(input);
			return {
				format: () =>
					`${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(
						date.getDate(),
					)} ${two(date.getHours())}:${two(date.getMinutes())}:${two(
						date.getSeconds(),
					)}`,
			};
		},
	};
});

const TEMPLATE = [
	"---",
	"aliases:",
	"tags:",
	"categories: Task",
	"createdAt:",
	"updatedAt:",
	"Project: other",
	"---",
	"",
].join("\n");

const settings: TaskNoteSettings = {
	folder: "Tasks/Projects",
	templateFile: "Templates/Task.md",
	projectKey: "Project",
};

/** Frontmatter as Obsidian keeps it: key order, and empty values as `key:` */
function parseFrontmatter(content: string) {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
	const data: Record<string, unknown> = {};
	for (const line of (match?.[1] ?? "").split("\n").filter(Boolean)) {
		const [key, ...rest] = line.split(":");
		const value = rest.join(":").trim();
		data[key] = value === "" ? null : value;
	}
	return { data, body: content.slice(match?.[0].length ?? 0) };
}

function stringifyFrontmatter(data: Record<string, unknown>, body: string) {
	const lines = Object.entries(data).map(([key, value]) =>
		value === null || value === undefined ? `${key}:` : `${key}: ${value}`,
	);
	return `---\n${lines.join("\n")}\n---\n${body}`;
}

function createApp() {
	const entries = new Map<string, any>();
	const contents = new Map<string, string>();
	const root = new TFolder();
	root.path = "/";

	const parentOf = (path: string) => {
		const parentPath = path.split("/").slice(0, -1).join("/");
		return parentPath === "" ? root : entries.get(parentPath);
	};
	const attach = (entry: any, path: string) => {
		entry.path = path;
		entry.name = path.split("/").pop();
		entry.parent = parentOf(path);
		entry.parent.children.push(entry);
		entries.set(path, entry);
	};

	const vault = {
		getRoot: () => root,
		getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
		createFolder: jest.fn(async (path: string) => {
			const folder = new TFolder();
			attach(folder, path);
			return folder;
		}),
		create: jest.fn(async (path: string, content: string) => {
			if (entries.has(path)) throw new Error("File already exists");
			const file: any = new TFile();
			attach(file, path);
			file.basename = file.name.replace(/\.md$/, "");
			file.stat = { ctime: new Date(2026, 9, 1, 9, 30, 0).getTime() };
			contents.set(path, content);
			return file;
		}),
		read: async (file: any) => contents.get(file.path)!,
		process: async (file: any, fn: (content: string) => string) => {
			const next = fn(contents.get(file.path)!);
			contents.set(file.path, next);
			return next;
		},
	};

	const app: any = {
		vault,
		metadataCache: {
			getFileCache: (file: any) => ({
				frontmatter: parseFrontmatter(contents.get(file.path)!).data,
			}),
		},
		fileManager: {
			processFrontMatter: async (file: any, fn: (fm: any) => void) => {
				const { data, body } = parseFrontmatter(contents.get(file.path)!);
				fn(data);
				contents.set(file.path, stringifyFrontmatter(data, body));
			},
			renameFile: jest.fn(async (file: any, newPath: string) => {
				const content = contents.get(file.path)!;
				contents.delete(file.path);
				entries.delete(file.path);
				file.parent.children.splice(file.parent.children.indexOf(file), 1);
				attach(file, newPath);
				contents.set(newPath, content);
			}),
		},
	};

	/** Adds folders and notes; paths ending in "/" are folders */
	async function add(files: Record<string, string>) {
		for (const [path, content] of Object.entries(files)) {
			const parts = path.replace(/\/$/, "").split("/");
			for (let i = 1; i <= parts.length; i++) {
				const partial = parts.slice(0, i).join("/");
				const isFolder = i < parts.length || path.endsWith("/");
				if (isFolder && !entries.has(partial)) {
					await vault.createFolder(partial);
				}
			}
			if (!path.endsWith("/")) {
				const file = await vault.create(path, content);
				file.stat = { ctime: new Date(2026, 5, 1, 8, 0, 0).getTime() };
			}
		}
		vault.createFolder.mockClear();
	}

	const read = (path: string) => contents.get(path);
	return { app, add, read };
}

describe("New task notes", () => {
	it("are made from the template in the project folder", async () => {
		const { app, add, read } = createApp();
		await add({
			"Templates/Task.md": TEMPLATE,
			"Tasks/Projects/Dev/AKG/": "",
		});

		await createTaskNote(app, settings, {
			title: "Write the GDD",
			description: "Chapters one to three",
			folder: "Dev/AKG",
		});

		expect(read("Tasks/Projects/Dev/AKG/Write the GDD.md")).toBe(
			[
				"---",
				"aliases:",
				"tags:",
				"categories: Task",
				"createdAt: 2026-10-01 09:30:00",
				"updatedAt: 2026-10-01 09:30:00",
				"Project: Dev/AKG",
				"---",
				"- [ ] Write the GDD",
				"Chapters one to three",
				"",
			].join("\n"),
		);
	});

	it("create the folder when it is new, as a new project", async () => {
		const { app, add, read } = createApp();
		await add({ "Templates/Task.md": TEMPLATE, "Tasks/Projects/Dev/": "" });

		await createTaskNote(app, settings, {
			title: "Sketch levels",
			folder: " Dev//NewGame/ ",
		});

		expect(app.vault.createFolder).toHaveBeenCalledWith(
			"Tasks/Projects/Dev/NewGame",
		);
		const content = read("Tasks/Projects/Dev/NewGame/Sketch levels.md");
		expect(content).toContain("Project: Dev/NewGame\n");
		expect(content).toContain("---\n- [ ] Sketch levels\n");
	});

	it("belong to no project in the root folder", async () => {
		const { app, add, read } = createApp();
		await add({ "Templates/Task.md": TEMPLATE, "Tasks/Projects/": "" });

		await createTaskNote(app, settings, { title: "Loose end", folder: "" });

		expect(read("Tasks/Projects/Loose end.md")).toContain("\nProject:\n");
	});

	it("keep the task text but drop characters file names cannot have", async () => {
		const { app, add, read } = createApp();
		await add({ "Templates/Task.md": TEMPLATE, "Tasks/Projects/": "" });

		await createTaskNote(app, settings, {
			title: "Fix: A/B test?",
			folder: "",
		});

		expect(read("Tasks/Projects/Fix- A-B test-.md")).toContain(
			"- [ ] Fix: A/B test?\n",
		);
	});

	it("never replace a note with the same name", async () => {
		const { app, add, read } = createApp();
		await add({
			"Templates/Task.md": TEMPLATE,
			"Tasks/Projects/Dev/Ship it.md": "keep me",
		});

		await expect(
			createTaskNote(app, settings, { title: "Ship it", folder: "Dev" }),
		).rejects.toThrow("Tasks/Projects/Dev/Ship it.md");
		expect(read("Tasks/Projects/Dev/Ship it.md")).toBe("keep me");
	});
});

describe("Existing notes turned into task notes", () => {
	const inboxNote = [
		"---",
		"id: of-123",
		"createdAt: 2026-06-01 08:00:00",
		"updatedAt: 2026-06-02 11:00:00",
		"---",
		"Notes from the call",
		"",
	].join("\n");

	it("get the task on top, the template's missing properties, and a move to the folder", async () => {
		const { app, add, read } = createApp();
		await add({
			"Templates/Task.md": TEMPLATE,
			"_Inbox/Call Bob.md": inboxNote,
			"Tasks/Projects/Dev/AKG/": "",
		});

		await convertToTaskNote(app, settings, {
			file: app.vault.getAbstractFileByPath("_Inbox/Call Bob.md"),
			title: "Call Bob",
			folder: "Dev/AKG",
			move: true,
		});

		expect(read("_Inbox/Call Bob.md")).toBeUndefined();
		expect(read("Tasks/Projects/Dev/AKG/Call Bob.md")).toBe(
			[
				"---",
				"id: of-123",
				"createdAt: 2026-06-01 08:00:00",
				"updatedAt: 2026-06-02 11:00:00",
				"aliases:",
				"tags:",
				"categories: Task",
				"Project: Dev/AKG",
				"---",
				"- [ ] Call Bob",
				"",
				"Notes from the call",
				"",
			].join("\n"),
		);
	});

	it("can stay where they are", async () => {
		const { app, add, read } = createApp();
		await add({ "Templates/Task.md": TEMPLATE, "_Inbox/Call Bob.md": inboxNote });

		await convertToTaskNote(app, settings, {
			file: app.vault.getAbstractFileByPath("_Inbox/Call Bob.md"),
			title: "Call Bob",
			folder: "Dev/AKG",
			move: false,
		});

		expect(app.fileManager.renameFile).not.toHaveBeenCalled();
		expect(read("_Inbox/Call Bob.md")).toContain("Project: Dev/AKG\n");
	});

	it("must not have a task already", async () => {
		const { app, add, read } = createApp();
		const withTask = "---\nProject: Dev\n---\n- [x] Done already\n";
		await add({ "Templates/Task.md": TEMPLATE, "_Inbox/Old.md": withTask });

		await expect(
			convertToTaskNote(app, settings, {
				file: app.vault.getAbstractFileByPath("_Inbox/Old.md"),
				title: "Old",
				folder: "Dev",
				move: true,
			}),
		).rejects.toThrow("_Inbox/Old.md");
		expect(app.fileManager.renameFile).not.toHaveBeenCalled();
		expect(read("_Inbox/Old.md")).toBe(withTask);
	});
});

describe("Task note folders", () => {
	it("are listed relative to the root", async () => {
		const { app, add } = createApp();
		await add({
			"Tasks/Projects/Dev/AKG/": "",
			"Tasks/Projects/AI/": "",
			"Elsewhere/": "",
		});

		expect(listTaskNoteFolders(app, settings)).toEqual([
			"AI",
			"Dev",
			"Dev/AKG",
		]);
	});

	it("tell where a note sits under the root", async () => {
		const { app, add } = createApp();
		await add({
			"Tasks/Projects/Dev/a.md": "",
			"Tasks/Projects/b.md": "",
			"_Inbox/c.md": "",
		});
		const folderOf = (path: string) =>
			taskNoteFolderOf(settings, app.vault.getAbstractFileByPath(path));

		expect(folderOf("Tasks/Projects/Dev/a.md")).toBe("Dev");
		expect(folderOf("Tasks/Projects/b.md")).toBe("");
		expect(folderOf("_Inbox/c.md")).toBeNull();
	});
});
