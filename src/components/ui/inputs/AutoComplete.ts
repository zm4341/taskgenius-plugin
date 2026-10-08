import {
	AbstractInputSuggest,
	App,
	prepareFuzzySearch,
	Scope,
	TFile,
} from "obsidian";
import TaskProgressBarPlugin from "@/index";
import { QuickCaptureOptions } from "@/editor-extensions/core/quick-capture-panel";
import { currentTagOf, isTaskTag, parseTagNames } from "@/utils/file/note-tags";

// Global cache for autocomplete data to avoid repeated expensive operations
interface GlobalAutoCompleteCache {
	tags: string[];
	projects: string[];
	contexts: string[];
	lastUpdate: number;
}

let globalCache: GlobalAutoCompleteCache | null = null;
const CACHE_DURATION = 30000; // 30 seconds

// Helper function to get cached data
export async function getCachedData(
	plugin: TaskProgressBarPlugin,
	forceRefresh: boolean = false,
): Promise<GlobalAutoCompleteCache> {
	const now = Date.now();

	if (forceRefresh) {
		globalCache = null;
	}

	if (!globalCache || now - globalCache.lastUpdate > CACHE_DURATION) {
		// Fetch fresh data
		const tags = Object.keys(plugin.app.metadataCache.getTags() || {}).map(
			(tag) => tag.substring(1), // Remove # prefix
		);

		// Get projects and contexts from dataflow using the new convenience method
		let projects: string[] = [];
		let contexts: string[] = [];

		if (plugin.dataflowOrchestrator) {
			try {
				const queryAPI = plugin.dataflowOrchestrator.getQueryAPI();
				const data = await queryAPI.getAvailableContextsAndProjects();
				projects = data.projects;
				contexts = data.contexts;
			} catch (error) {
				console.warn(
					"Failed to get projects/contexts from dataflow:",
					error,
				);
			}
		}

		// Merge settings-defined projects so newly added ones appear immediately
		try {
			const cfg = plugin.settings?.projectConfig;
			if (cfg) {
				// Custom projects (V2)
				const custom = (cfg.customProjects || [])
					.map((p) => p.name)
					.filter(Boolean);
				projects.push(...custom);
				// Path mappings
				const mapped = (cfg.pathMappings || [])
					.filter((m) => (m as any).enabled !== false)
					.map((m) => m.projectName)
					.filter(Boolean);
				projects.push(...mapped);
			}
		} catch (e) {
			console.warn("Failed to merge settings-defined projects:", e);
		}

		// Deduplicate and sort
		const uniq = (arr: string[]) =>
			Array.from(new Set(arr.filter(Boolean)));
		projects = uniq(projects).sort();
		contexts = uniq(contexts).sort();

		globalCache = {
			tags,
			projects,
			contexts,
			lastUpdate: now,
		};
	}

	return globalCache;
}

abstract class BaseSuggest<T> extends AbstractInputSuggest<T> {
	constructor(
		app: App,
		public inputEl: HTMLInputElement,
	) {
		super(app, inputEl);
	}

	// Common method to render suggestions
	renderSuggestion(item: T, el: HTMLElement): void {
		el.setText(this.getSuggestionText(item));
	}

	// Common method to select suggestion
	selectSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void {
		if (!this.inputEl) {
			console.warn("BaseSuggest: inputEl is undefined, cannot set value");
			this.close();
			return;
		}
		this.inputEl.value = this.getSuggestionValue(item);
		this.inputEl.trigger("input"); // Trigger change event
		this.close();
	}

	// Abstract methods to be implemented by subclasses
	abstract getSuggestionText(item: T): string;
	abstract getSuggestionValue(item: T): string;
}

class CustomSuggest extends BaseSuggest<string> {
	protected availableChoices: string[] = [];

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		availableChoices: string[],
	) {
		super(app, inputEl);
		this.availableChoices = availableChoices;
	}

	getSuggestions(query: string): string[] {
		if (!query) {
			return this.availableChoices.slice(0, 100); // Limit initial suggestions
		}
		const fuzzySearch = prepareFuzzySearch(query.toLowerCase());
		return this.availableChoices
			.filter(
				(
					cmd: string, // Add type to cmd
				) => fuzzySearch(cmd.toLowerCase()), // Call the returned function
			)
			.slice(0, 100);
	}

	getSuggestionText(item: string): string {
		return item;
	}

	getSuggestionValue(item: string): string {
		return item;
	}
}

/**
 * ProjectSuggest - Provides autocomplete for project names
 */
export class ProjectSuggest extends CustomSuggest {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		plugin: TaskProgressBarPlugin,
	) {
		// Initialize with empty list, will be populated asynchronously
		super(app, inputEl, []);

		// Load fresh data immediately so newly added projects appear
		getCachedData(plugin, true).then((cachedData) => {
			this.availableChoices = cachedData.projects;
		});

		// Refresh on focus to pick up recent changes (settings/index updates)
		inputEl.addEventListener("focus", async () => {
			try {
				const data = await getCachedData(plugin, true);
				this.availableChoices = data.projects;
			} catch (e) {
				console.warn(
					"ProjectSuggest: failed to refresh projects on focus",
					e,
				);
			}
		});
	}
}

/**
 * ContextSuggest - Provides autocomplete for context names, and for notes
 * after "[[", since a note can be the context: @[[Note]]
 */
export class ContextSuggest extends CustomSuggest {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		plugin: TaskProgressBarPlugin,
	) {
		// Initialize with empty list, will be populated asynchronously
		super(app, inputEl, []);

		// Load cached data asynchronously
		getCachedData(plugin).then((cachedData) => {
			this.availableChoices = cachedData.contexts;
		});
	}

	getSuggestions(query: string): string[] {
		const link = query.trim().replace(/^@/, "").match(/^\[\[([^[\]|#]*)/);
		return link
			? noteLinkSuggestions(this.app, link[1].trim())
			: super.getSuggestions(query);
	}
}

/** Links to the notes whose names match, best match first, e.g. "[[Note]]" */
function noteLinkSuggestions(app: App, query: string): string[] {
	const search = prepareFuzzySearch(query);
	return app.vault
		.getMarkdownFiles()
		.map((file) => ({ file, match: query ? search(file.basename) : null }))
		.filter(({ match }) => !query || match)
		.sort(
			(a, b) =>
				(b.match?.score ?? 0) - (a.match?.score ?? 0) ||
				b.file.stat.mtime - a.file.stat.mtime,
		)
		.slice(0, 50)
		.map(({ file }) => `[[${app.metadataCache.fileToLinktext(file, "")}]]`);
}

/**
 * Tags matching what was typed, best first: the same tag, else what was
 * typed as a new tag, so Enter keeps it; then tags starting with it, then
 * the other fuzzy matches
 */
function rankTags(tags: string[], typed: string): string[] {
	const query = typed.toLowerCase();
	const search = prepareFuzzySearch(query);
	const matches = tags
		.map((tag) => ({ tag, lower: tag.toLowerCase() }))
		.map((m) => ({ ...m, score: search(m.lower)?.score }))
		.filter((m) => m.score !== undefined && m.lower !== query)
		.sort(
			(a, b) =>
				Number(b.lower.startsWith(query)) -
					Number(a.lower.startsWith(query)) ||
				(a.lower.startsWith(query) ? a.tag.length - b.tag.length : 0) ||
				b.score! - a.score!,
		)
		.map((m) => m.tag);
	const same = tags.find((tag) => tag.toLowerCase() === query);
	return [same ?? typed, ...matches].slice(0, 100);
}

/**
 * TagSuggest - Provides autocomplete for tag names
 */
export const TAG_COMMIT_EVENT = "task-progress-bar:tag-commit";

export class TagSuggest extends CustomSuggest {
	private readonly detailedKeydownHandler = (event: KeyboardEvent) => {
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			this.commitDetailedTag();
		}
	};

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		plugin: TaskProgressBarPlugin,
		readonly isDetailed: boolean = false,
	) {
		// Initialize with empty list, will be populated asynchronously
		super(app, inputEl, []);

		// Load cached data asynchronously
		getCachedData(plugin).then((cachedData) => {
			this.availableChoices = cachedData.tags;
		});

		if (this.isDetailed) {
			inputEl.addEventListener("keydown", this.detailedKeydownHandler);
		}
	}

	// Suggests for the tag being typed, the last one of the list
	getSuggestions(query: string): string[] {
		const typed = this.isDetailed
			? query.trim().replace(/^#+/, "")
			: currentTagOf(query);
		// Leaves out the tags already in the list
		const entered = new Set(
			this.isDetailed
				? []
				: parseTagNames(query.slice(0, query.length - typed.length)).map(
						(tag) => tag.toLowerCase(),
					),
		);
		// Tags the task line can't hold, such as "#a；b", would break it
		const tags = this.availableChoices.filter(
			(tag) => isTaskTag(tag) && !entered.has(tag.toLowerCase()),
		);
		return typed ? rankTags(tags, typed) : tags.slice(0, 100);
	}

	// Override to add # prefix and keep previous tags
	getSuggestionValue(item: string): string {
		if (this.isDetailed) {
			return `#${item}`;
		}

		// Replace the tag being typed, then leave room for the next one
		const before = this.inputEl.value
			.replace(/#*[^,，、;；\s#]*$/, "")
			.replace(/[,，、;；\s]+$/, "");
		return `${before ? `${before}, ` : ""}#${item}, `;
	}

	// Override to display full tag
	getSuggestionText(item: string): string {
		return `#${item}`;
	}

	// Override to intercept selection in detailed mode
	selectSuggestion(item: string, evt: MouseEvent | KeyboardEvent): void {
		super.selectSuggestion(item, evt);
		if (this.isDetailed) {
			this.commitDetailedTag();
		}
	}

	private commitDetailedTag(): void {
		if (!this.isDetailed) {
			return;
		}

		const rawValue = this.inputEl.value.trim();
		if (!rawValue) {
			this.resetDetailedInput();
			return;
		}

		const normalized = rawValue
			.replace(/^#+/, "")
			.replace(/[,\s]+$/g, "")
			.trim();

		if (!normalized) {
			this.resetDetailedInput();
			return;
		}

		this.inputEl.dispatchEvent(
			new CustomEvent(TAG_COMMIT_EVENT, {
				detail: { tag: normalized },
				bubbles: true,
			}),
		);

		this.resetDetailedInput();
	}

	private resetDetailedInput(): void {
		this.inputEl.value = "";
		this.inputEl.trigger("input");
		this.close();
	}
}

export class SingleFolderSuggest extends CustomSuggest {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		plugin: TaskProgressBarPlugin,
	) {
		const folders = app.vault.getAllFolders();
		const paths = folders.map((file) => file.path);
		super(app, inputEl, ["/", ...paths]);
	}
}

/**
 * PathSuggest - Provides autocomplete for file paths
 */
export class FolderSuggest extends CustomSuggest {
	private plugin: TaskProgressBarPlugin;
	private outputType: "single" | "multiple";

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		plugin: TaskProgressBarPlugin,
		outputType: "single" | "multiple" = "multiple",
	) {
		// Get all markdown files in the vault
		const folders = app.vault.getAllFolders();
		const paths = folders.map((file) => file.path);
		super(app, inputEl, paths);
		this.plugin = plugin;
		this.outputType = outputType;
	}

	// Override getSuggestions to handle comma-separated paths
	getSuggestions(query: string): string[] {
		if (this.outputType === "multiple") {
			const parts = query.split(",");
			const currentPathInput = parts[parts.length - 1].trim();

			if (!currentPathInput) {
				return this.availableChoices.slice(0, 20);
			}

			const fuzzySearch = prepareFuzzySearch(
				currentPathInput.toLowerCase(),
			);
			return this.availableChoices
				.filter((path) => fuzzySearch(path.toLowerCase()))
				.sort((a, b) => {
					// Sort by path length (shorter paths first)
					// This helps prioritize files in the root or with shorter paths
					return a.length - b.length;
				})
				.slice(0, 20);
		} else {
			// Single mode - search the entire query
			if (!query.trim()) {
				return this.availableChoices.slice(0, 20);
			}

			const fuzzySearch = prepareFuzzySearch(query.toLowerCase());
			return this.availableChoices
				.filter((path) => fuzzySearch(path.toLowerCase()))
				.sort((a, b) => {
					// Sort by path length (shorter paths first)
					// This helps prioritize files in the root or with shorter paths
					return a.length - b.length;
				})
				.slice(0, 20);
		}
	}

	// Override to display the path with folder structure
	getSuggestionText(item: string): string {
		return item;
	}

	// Override to keep previous paths and add the selected one
	getSuggestionValue(item: string): string {
		if (this.outputType === "multiple") {
			const currentValue = this.inputEl.value;
			const parts = currentValue.split(",");

			// Replace the last part with the selected path
			parts[parts.length - 1] = item;

			// Join back with commas but don't add trailing comma
			return parts.join(",");
		} else {
			// Single mode - just return the selected item
			return item;
		}
	}
}

/**
 * ImageSuggest - Provides autocomplete for image paths
 */
export class ImageSuggest extends CustomSuggest {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		plugin: TaskProgressBarPlugin,
	) {
		// Get all images in the vault
		const images = app.vault
			.getFiles()
			.filter(
				(file) =>
					file.extension === "png" ||
					file.extension === "jpg" ||
					file.extension === "jpeg" ||
					file.extension === "gif" ||
					file.extension === "svg" ||
					file.extension === "webp",
			);
		const paths = images.map((file) => file.path);
		super(app, inputEl, paths);
	}
}

/**
 * A class that provides file suggestions for the quick capture target field
 */
export class FileSuggest extends AbstractInputSuggest<TFile> {
	private currentTarget: string = "Quick Capture.md";
	scope: Scope;
	onFileSelected: (file: TFile) => void;

	constructor(
		app: App,
		inputEl: HTMLInputElement | HTMLDivElement,
		options: QuickCaptureOptions,
		onFileSelected?: (file: TFile) => void,
	) {
		super(app, inputEl);
		this.suggestEl.addClass("quick-capture-file-suggest");
		this.currentTarget = options.targetFile || "Quick Capture.md";
		this.onFileSelected =
			onFileSelected ||
			((file: TFile) => {
				this.setValue(file.path);
			});

		// Register Alt+X hotkey to focus target input
		this.scope.register(["Alt"], "x", (e: KeyboardEvent) => {
			inputEl.focus();
			return true;
		});

		// Set initial value
		this.setValue(this.currentTarget);

		// Register callback for selection
		this.onSelect((file, evt) => {
			this.onFileSelected(file);
		});
	}

	getSuggestions(query: string): TFile[] {
		const files = this.app.vault.getMarkdownFiles();
		const lowerCaseQuery = query.toLowerCase();

		// Use fuzzy search for better matching
		const fuzzySearcher = prepareFuzzySearch(lowerCaseQuery);

		// Filter and sort results
		return files
			.map((file) => {
				const result = fuzzySearcher(file.path);
				return result ? { file, score: result.score } : null;
			})
			.filter(
				(match): match is { file: TFile; score: number } =>
					match !== null,
			)
			.sort((a, b) => {
				// Sort by score (higher is better)
				return b.score - a.score;
			})
			.map((match) => match.file)
			.slice(0, 10); // Limit results
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		// Display filename prominently, with folder path in muted color
		const container = el.createDiv({ cls: "file-suggest-item" });
		const fileName = file.name;
		const folderPath = file.parent?.path || "";
		
		container.createSpan({ text: fileName, cls: "file-suggest-name" });
		if (folderPath) {
			container.createSpan({ text: ` — ${folderPath}`, cls: "file-suggest-path" });
		}
	}

	selectSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(file.path);
		this.onFileSelected(file);
		this.close();
	}
}

/**
 * SimpleFileSuggest - Provides autocomplete for file paths
 */
export class SimpleFileSuggest extends AbstractInputSuggest<TFile> {
	private onFileSelected: (file: TFile) => void;

	constructor(
		inputEl: HTMLInputElement,
		plugin: TaskProgressBarPlugin,
		onFileSelected?: (file: TFile) => void,
	) {
		super(plugin.app, inputEl);
		this.onFileSelected = onFileSelected || (() => {});
	}

	getSuggestions(query: string): TFile[] {
		const files = this.app.vault.getMarkdownFiles();
		const lowerCaseQuery = query.toLowerCase();

		// Use fuzzy search for better matching
		const fuzzySearcher = prepareFuzzySearch(lowerCaseQuery);

		// Filter and sort results
		return files
			.map((file) => {
				const result = fuzzySearcher(file.path);
				return result ? { file, score: result.score } : null;
			})
			.filter(
				(match): match is { file: TFile; score: number } =>
					match !== null,
			)
			.sort((a, b) => {
				// Sort by score (higher is better)
				return b.score - a.score;
			})
			.map((match) => match.file)
			.slice(0, 10); // Limit results
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(file.path);
		this.onFileSelected?.(file);
		this.close();
	}
}
