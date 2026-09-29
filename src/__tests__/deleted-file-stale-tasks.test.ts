/**
 * Tasks of a deleted file must not survive in the persisted index.
 *
 * Regression: removeFile() only updated the in-memory index, so the deleted
 * file's tasks came back from the consolidated snapshot on the next startup.
 * Nothing reconciled the snapshot with the vault, and deleting such a task
 * from a view failed with "File not found", so it could never be removed.
 */

import { App, TFile } from "obsidian";
import { Repository } from "@/dataflow/indexer/Repository";
import { WriteAPI } from "@/dataflow/api/WriteAPI";
import { Events } from "@/dataflow/events/Events";
import type { Task } from "@/types/task";

// In-memory stand-in for the IndexedDB-backed Storage
const mockStorages: MockStorage[] = [];

class MockStorage {
	/** Task ids and file paths of every persisted snapshot, captured at write time */
	persistedSnapshots: { taskIds: string[]; files: string[] }[] = [];
	persistedFileTasks: string[][] = [];
	storeConsolidatedHook: () => Promise<void> = async () => {};

	constructor() {
		mockStorages.push(this);
	}

	async storeConsolidated(snapshot: any): Promise<void> {
		this.persistedSnapshots.push({
			taskIds: Array.from(snapshot.tasks.keys()),
			files: Array.from(snapshot.files.keys()),
		});
		await this.storeConsolidatedHook();
	}

	async storeFileTasks(tasks: Map<string, Task>): Promise<void> {
		this.persistedFileTasks.push(Array.from(tasks.keys()));
	}

	async clearFile(): Promise<void> {}
	async loadAugmented(): Promise<null> {
		return null;
	}
	async storeAugmented(): Promise<void> {}
}

jest.mock("@/dataflow/persistence/Storage", () => ({
	Storage: jest.fn().mockImplementation(() => new MockStorage()),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeTask(id: string, filePath: string, sourceType?: string): Task {
	return {
		id,
		content: id,
		filePath,
		line: 0,
		completed: false,
		status: " ",
		originalMarkdown: `- [ ] ${id}`,
		metadata: { tags: [], children: [], sourceType } as any,
	} as Task;
}

function createRepository(existingPaths: Set<string>) {
	const app = new App() as any;
	app.workspace.trigger = jest.fn();
	app.vault.getAbstractFileByPath = (path: string) =>
		existingPaths.has(path) ? Object.assign(new (TFile as any)(), { path }) : null;

	const repository = new Repository(app, app.vault, app.metadataCache);
	const storage = mockStorages[mockStorages.length - 1];
	return { app, repository, storage };
}

describe("Repository: tasks of deleted files", () => {
	it("persists the removal when a file is deleted", async () => {
		const existing = new Set(["keep.md", "gone.md"]);
		const { repository, storage } = createRepository(existing);
		await repository.updateFile("keep.md", [makeTask("keep-L0", "keep.md")]);
		await repository.updateFile("gone.md", [makeTask("gone-L0", "gone.md")]);
		await repository.cleanup();
		await flush();
		expect(storage.persistedSnapshots.at(-1)!.taskIds).toContain("gone-L0");

		existing.delete("gone.md");
		await repository.removeFile("gone.md");
		// Plugin unload flushes whatever is queued for persistence
		await repository.cleanup();
		await flush();

		const last = storage.persistedSnapshots.at(-1)!;
		expect(last.taskIds).toEqual(["keep-L0"]);
		expect(last.files).not.toContain("gone.md");
	});

	it("prunes tasks of files missing from the vault and persists the result", async () => {
		const { repository, storage, app } = createRepository(
			new Set(["keep.md"]),
		);
		// Snapshot restored at startup still holds a file deleted while Obsidian was closed
		repository
			.getIndexer()
			.updateIndexWithTasks("keep.md", [makeTask("keep-L0", "keep.md")]);
		repository
			.getIndexer()
			.updateIndexWithTasks("gone.md", [makeTask("gone-L8", "gone.md")]);
		(repository as any).fileTasks.set(
			"gone-file-task.md",
			makeTask("gone-file-task", "gone-file-task.md"),
		);

		const pruned = await repository.pruneMissingFiles();

		expect(pruned.sort()).toEqual(["gone-file-task.md", "gone.md"]);
		expect((await repository.all()).map((t) => t.id)).toEqual(["keep-L0"]);
		expect(storage.persistedSnapshots.at(-1)!.taskIds).toEqual(["keep-L0"]);
		expect(storage.persistedSnapshots.at(-1)!.files).toEqual(["keep.md"]);
		expect(storage.persistedFileTasks.at(-1)).toEqual([]);
		expect(app.workspace.trigger).toHaveBeenCalledWith(
			Events.TASK_CACHE_UPDATED,
			expect.objectContaining({
				changedFiles: expect.arrayContaining(["gone.md"]),
			}),
		);
	});

	it("prunes tasks whose file is not tracked in the files map", async () => {
		const { repository } = createRepository(new Set(["keep.md"]));
		repository
			.getIndexer()
			.getCache()
			.tasks.set("orphan-L3", makeTask("orphan-L3", "orphan.md"));

		expect(await repository.pruneMissingFiles()).toEqual(["orphan.md"]);
		expect(await repository.all()).toEqual([]);
	});

	it("does not persist when every indexed file still exists", async () => {
		const { repository, storage } = createRepository(new Set(["keep.md"]));
		repository
			.getIndexer()
			.updateIndexWithTasks("keep.md", [makeTask("keep-L0", "keep.md")]);

		expect(await repository.pruneMissingFiles()).toEqual([]);
		expect(storage.persistedSnapshots).toHaveLength(0);
	});

	it("keeps changes queued during an in-flight persist queued", async () => {
		const { repository, storage } = createRepository(new Set());
		let finishWrite!: () => void;
		storage.storeConsolidatedHook = () =>
			new Promise<void>((resolve) => (finishWrite = resolve));

		const queue: Set<string> = (repository as any).persistQueue;
		queue.add("a.md");
		const inFlight = (repository as any).executePersist();
		await flush();

		queue.add("b.md");
		finishWrite();
		await inFlight;

		expect(queue.has("b.md")).toBe(true);
	});
});

describe("WriteAPI.deleteTask on a task whose file is gone", () => {
	function createWriteAPI(task: Task) {
		const app = new App() as any;
		app.workspace.trigger = jest.fn();
		const vault: any = {
			getAbstractFileByPath: jest.fn(() => null),
			read: jest.fn(),
			modify: jest.fn(),
		};
		const plugin: any = { settings: {} };
		const writeAPI = new WriteAPI(
			app,
			vault,
			app.metadataCache,
			plugin,
			async (id: string) => (id === task.id ? task : null),
		);
		return { app, vault, writeAPI };
	}

	const cases: [string, Task][] = [
		["markdown", makeTask("主框架.md-L8", "AKG/主框架.md")],
		["canvas", makeTask("board-node-1", "board.canvas", "canvas")],
	];

	for (const [kind, task] of cases) {
		it(`drops the stale ${kind} task from the index instead of failing`, async () => {
			const { app, vault, writeAPI } = createWriteAPI(task);

			const result = await writeAPI.deleteTask({ taskId: task.id });

			expect(result).toEqual({ success: true });
			expect(app.workspace.trigger).toHaveBeenCalledWith(
				Events.FILE_UPDATED,
				expect.objectContaining({
					path: task.filePath,
					reason: "delete",
				}),
			);
			expect(vault.read).not.toHaveBeenCalled();
			expect(vault.modify).not.toHaveBeenCalled();
		});
	}
});
