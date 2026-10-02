/**
 * Tasks of files excluded by the file filter must not survive in the persisted index.
 *
 * Regression: pruneByFilter() only cleared the in-memory index, so after
 * narrowing the filter (e.g. a whitelist of one folder) the excluded files'
 * tasks came back from the consolidated snapshot on the next startup, and
 * nothing at startup applied the filter to the restored snapshot.
 */

import { App } from "obsidian";
import { Repository } from "@/dataflow/indexer/Repository";
import { DataflowOrchestrator } from "@/dataflow/Orchestrator";
import { FileFilterManager } from "@/managers/file-filter-manager";
import { FilterMode } from "@/common/setting-definition";
import type { Task } from "@/types/task";

// In-memory stand-in for the IndexedDB-backed Storage
const mockStorages: MockStorage[] = [];

class MockStorage {
	/** Task ids of every persisted snapshot, captured at write time */
	persistedSnapshots: string[][] = [];
	storeAugmented = jest.fn(async () => {});

	constructor() {
		mockStorages.push(this);
	}

	async storeConsolidated(snapshot: any): Promise<void> {
		this.persistedSnapshots.push(Array.from(snapshot.tasks.keys()));
	}

	async storeFileTasks(): Promise<void> {}
	async loadAugmented(): Promise<null> {
		return null;
	}
}

jest.mock("@/dataflow/persistence/Storage", () => ({
	Storage: jest.fn().mockImplementation(() => new MockStorage()),
}));

function makeTask(id: string, filePath: string): Task {
	return {
		id,
		content: id,
		filePath,
		line: 0,
		completed: false,
		status: " ",
		originalMarkdown: `- [ ] ${id}`,
		metadata: { tags: [], children: [] } as any,
	} as Task;
}

const KEPT = "Spaces/2.Area/Tasks/Projects/plan.md";
const EXCLUDED = "Spaces/2.Area/Work/notes.md";
const EMPTY_EXCLUDED = "Cards/no-tasks.md";

function setup() {
	const app = new App() as any;
	app.workspace.trigger = jest.fn();
	const repository = new Repository(app, app.vault, app.metadataCache);
	const storage = mockStorages[mockStorages.length - 1];

	// Index as restored from the snapshot at startup
	const indexer = repository.getIndexer();
	indexer.updateIndexWithTasks(KEPT, [makeTask("kept-L0", KEPT)]);
	indexer.updateIndexWithTasks(EXCLUDED, [makeTask("excluded-L3", EXCLUDED)]);
	indexer.updateIndexWithTasks(EMPTY_EXCLUDED, []);

	// The parts of the orchestrator pruneByFilter() works with
	const orchestrator = {
		repository,
		fileFilterManager: new FileFilterManager({
			enabled: true,
			mode: FilterMode.WHITELIST,
			rules: [
				{ type: "folder", path: "Spaces/2.Area/Tasks", enabled: true },
			],
		}),
		storage: { saveMeta: jest.fn(async () => {}) },
		suppressedInline: new Set<string>(),
		suppressedFileTasks: new Set<string>(),
	};
	const pruneByFilter = () =>
		(DataflowOrchestrator.prototype as any).pruneByFilter.call(
			orchestrator,
		);

	return { repository, storage, orchestrator, pruneByFilter };
}

describe("DataflowOrchestrator.pruneByFilter", () => {
	it("persists the index without the excluded files' tasks", async () => {
		const { repository, storage, pruneByFilter } = setup();

		await pruneByFilter();

		expect((await repository.all()).map((t) => t.id)).toEqual(["kept-L0"]);
		expect(storage.persistedSnapshots.at(-1)).toEqual(["kept-L0"]);
	});

	it("keeps the per-file caches so loosening the filter can restore the tasks", async () => {
		const { storage, orchestrator, pruneByFilter } = setup();

		await pruneByFilter();

		expect(storage.storeAugmented).not.toHaveBeenCalled();
		expect(orchestrator.storage.saveMeta).toHaveBeenCalledWith(
			"filter:suppressedInline",
			expect.arrayContaining([EXCLUDED]),
		);
	});

	it("only visits files that have tasks", async () => {
		const { orchestrator, pruneByFilter } = setup();

		await pruneByFilter();

		expect(orchestrator.suppressedInline.has(EMPTY_EXCLUDED)).toBe(false);
	});

	it("writes nothing when no file with tasks is excluded", async () => {
		const { storage, orchestrator, pruneByFilter } = setup();
		await pruneByFilter();
		storage.persistedSnapshots.length = 0;
		orchestrator.storage.saveMeta.mockClear();

		// Second run, as on every later startup
		await pruneByFilter();

		expect(storage.persistedSnapshots).toHaveLength(0);
		expect(orchestrator.storage.saveMeta).not.toHaveBeenCalled();
	});
});
