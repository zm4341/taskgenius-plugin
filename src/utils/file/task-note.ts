import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import type { TaskProgressBarSettings } from "@/common/setting-definition";
import { t } from "@/translations/helper";

/** Where the New Task button puts task notes, one note per task */
export interface TaskNoteSettings {
	/** Root folder of task notes; each subfolder is a project named by its path */
	folder: string;
	/** Note whose properties and body new task notes start from */
	templateFile: string;
	/** Frontmatter key that holds a note's project */
	projectKey: string;
	/** How dates are written on the task line; Tasks emoji by default */
	metadataFormat?: "tasks" | "dataview";
}

export interface TaskNoteDates {
	start?: Date;
	scheduled?: Date;
	due?: Date;
}

export interface TaskNoteInput {
	title: string;
	description?: string;
	/** Folder relative to the root, e.g. "Development/AKG"; created if missing */
	folder: string;
	/** Dates written on the task line */
	dates?: TaskNoteDates;
}

const TIMESTAMP_FORMAT = "YYYY-MM-DD HH:mm:ss";
const CREATED_KEYS = ["createdAt", "created"];
const UPDATED_KEYS = ["updatedAt", "updated"];
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/;
const TASK_LINE = /^\s*(?:[-*+]|\d+\.)\s+\[.\]/m;

export function getTaskNoteSettings(
	settings: TaskProgressBarSettings,
): TaskNoteSettings {
	const saved = settings.quickCapture?.taskNote;
	return {
		folder: saved?.folder ?? "",
		templateFile: saved?.templateFile ?? "",
		projectKey:
			settings.projectConfig?.metadataConfig?.metadataKey || "project",
		metadataFormat:
			settings.preferMetadataFormat === "dataview" ? "dataview" : "tasks",
	};
}

/** Dates as the task line carries them: Tasks emoji, or Dataview fields */
export function formatTaskDates(
	dates: TaskNoteDates | undefined,
	format: "tasks" | "dataview" = "tasks",
): string {
	if (!dates) return "";
	const two = (n: number) => ("0" + n).slice(-2);
	const day = (date: Date) =>
		`${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
	// In the order the Tasks plugin writes them
	const fields: Array<[Date | undefined, string, string]> = [
		[dates.start, "🛫", "start"],
		[dates.scheduled, "⏳", "scheduled"],
		[dates.due, "📅", "due"],
	];
	return fields
		.filter(([date]) => date)
		.map(([date, emoji, key]) =>
			format === "dataview"
				? `[${key}:: ${day(date!)}]`
				: `${emoji} ${day(date!)}`,
		)
		.join(" ");
}

/** Replaces characters that break file names or links */
export function sanitizeName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, "-")
		.replace(/\s+/g, " ")
		.trim();
}

/** Cleans a folder typed relative to the root, e.g. " Dev//AKG/ " → "Dev/AKG" */
export function cleanFolderInput(value: string): string {
	return value
		.split("/")
		.map(sanitizeName)
		.filter((part) => part !== "")
		.join("/");
}

function joinPath(...parts: string[]): string {
	const joined = parts.filter((part) => part !== "").join("/");
	// normalizePath("") would give "/", which is not a usable path
	return joined === "" ? "" : normalizePath(joined);
}

/** Vault path of a folder given relative to the root */
export function resolveTaskNoteFolder(
	settings: TaskNoteSettings,
	folder: string,
): string {
	return joinPath(settings.folder, cleanFolderInput(folder));
}

/** Folders under the root, relative to it, e.g. ["AI", "AI/Agent"] */
export function listTaskNoteFolders(
	app: App,
	settings: TaskNoteSettings,
): string[] {
	const rootPath = joinPath(settings.folder);
	const root =
		rootPath === ""
			? app.vault.getRoot()
			: app.vault.getAbstractFileByPath(rootPath);
	if (!(root instanceof TFolder)) return [];

	const folders: string[] = [];
	const walk = (folder: TFolder) => {
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				folders.push(
					rootPath === ""
						? child.path
						: child.path.slice(rootPath.length + 1),
				);
				walk(child);
			}
		}
	};
	walk(root);
	return folders.sort((a, b) => a.localeCompare(b));
}

/** The note's folder relative to the root, or null when it is outside it */
export function taskNoteFolderOf(
	settings: TaskNoteSettings,
	file: TFile,
): string | null {
	const rootPath = joinPath(settings.folder);
	const parentPath = file.parent?.path === "/" ? "" : file.parent?.path ?? "";
	if (rootPath === "") return parentPath;
	if (parentPath === rootPath) return "";
	return parentPath.startsWith(rootPath + "/")
		? parentPath.slice(rootPath.length + 1)
		: null;
}

/** How many tasks the note holds; a task note holds one */
export function countTasks(content: string): number {
	const frontmatter = content.match(FRONTMATTER)?.[0] ?? "";
	return content
		.slice(frontmatter.length)
		.split("\n")
		.filter((line) => TASK_LINE.test(line)).length;
}

/** Whether the note already has a task, which would make a second one */
export async function noteHasTask(app: App, file: TFile): Promise<boolean> {
	return countTasks(await app.vault.read(file)) > 0;
}

/** Creates a note holding just this task, from the template, in its folder */
export async function createTaskNote(
	app: App,
	settings: TaskNoteSettings,
	input: TaskNoteInput,
): Promise<TFile> {
	const folderPath = resolveTaskNoteFolder(settings, input.folder);
	const path = joinPath(folderPath, `${sanitizeName(input.title)}.md`);
	if (app.vault.getAbstractFileByPath(path)) {
		throw new Error(
			t("A note with this name already exists: {{path}}", {
				interpolation: { path },
			}),
		);
	}

	const template = await readTemplate(app, settings);
	await ensureFolder(app, folderPath);
	const file = await app.vault.create(
		path,
		withTaskAtTop(template, taskBlock(input, settings)),
	);
	await applyTaskNoteProperties(app, settings, file, input.folder);
	return file;
}

/**
 * Turns a note without tasks into the note of this task: the task goes above
 * its content, and it gets the template's properties it lacks
 */
export async function convertToTaskNote(
	app: App,
	settings: TaskNoteSettings,
	input: TaskNoteInput & { file: TFile; move: boolean },
): Promise<TFile> {
	const { file } = input;
	if (await noteHasTask(app, file)) {
		throw new Error(
			t("This note already has a task: {{path}}", {
				interpolation: { path: file.path },
			}),
		);
	}

	if (input.move) {
		const folderPath = resolveTaskNoteFolder(settings, input.folder);
		const parentPath =
			file.parent?.path === "/" ? "" : file.parent?.path ?? "";
		if (parentPath !== folderPath) {
			const newPath = joinPath(folderPath, file.name);
			if (app.vault.getAbstractFileByPath(newPath)) {
				throw new Error(
					t("A note with this name already exists: {{path}}", {
						interpolation: { path: newPath },
					}),
				);
			}
			await ensureFolder(app, folderPath);
			// Moves through Obsidian so links to the note are updated
			await app.fileManager.renameFile(file, newPath);
		}
	}

	await app.vault.process(file, (content) =>
		withTaskAtTop(content, taskBlock(input, settings)),
	);
	await applyTaskNoteProperties(app, settings, file, input.folder);
	return file;
}

function taskBlock(input: TaskNoteInput, settings: TaskNoteSettings): string {
	const description = input.description?.trim();
	const dates = formatTaskDates(input.dates, settings.metadataFormat);
	const taskLine = `- [ ] ${input.title.trim()}${dates ? " " + dates : ""}`;
	return `${taskLine}\n${description ? description + "\n" : ""}`;
}

/** Puts the task first in the body; the rest follows after a blank line */
function withTaskAtTop(content: string, block: string): string {
	let frontmatter = content.match(FRONTMATTER)?.[0] ?? "";
	if (frontmatter && !frontmatter.endsWith("\n")) frontmatter += "\n";
	const body = content.slice(frontmatter.length).trim();
	return frontmatter + block + (body ? `\n${body}\n` : "");
}

async function readTemplate(
	app: App,
	settings: TaskNoteSettings,
): Promise<string> {
	if (!settings.templateFile) return "";
	const file = app.vault.getAbstractFileByPath(
		normalizePath(settings.templateFile),
	);
	if (!(file instanceof TFile)) {
		throw new Error(
			t("Task note template not found: {{path}}", {
				interpolation: { path: settings.templateFile },
			}),
		);
	}
	return app.vault.read(file);
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
	let current = "";
	for (const part of folderPath.split("/").filter(Boolean)) {
		current = joinPath(current, part);
		const existing = app.vault.getAbstractFileByPath(current);
		if (!existing) {
			await app.vault.createFolder(current);
		} else if (!(existing instanceof TFolder)) {
			throw new Error(
				t("Not a folder: {{path}}", { interpolation: { path: current } }),
			);
		}
	}
}

/**
 * Sets the project from the folder and adds the template's missing
 * properties. Empty created/updated times are filled in, as the plugins that
 * keep them only do so on the first edit.
 */
async function applyTaskNoteProperties(
	app: App,
	settings: TaskNoteSettings,
	file: TFile,
	folder: string,
): Promise<void> {
	const templateFile = settings.templateFile
		? app.vault.getAbstractFileByPath(normalizePath(settings.templateFile))
		: null;
	const templateProperties =
		templateFile instanceof TFile
			? (app.metadataCache.getFileCache(templateFile)?.frontmatter ?? {})
			: {};
	const project = cleanFolderInput(folder);
	const created = moment(file.stat.ctime).format(TIMESTAMP_FORMAT);
	const now = moment().format(TIMESTAMP_FORMAT);
	const isEmpty = (value: unknown) =>
		value === null || value === undefined || value === "";

	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		for (const [key, value] of Object.entries(templateProperties)) {
			if (!(key in frontmatter)) frontmatter[key] = value;
		}
		// A note in the root folder belongs to no project
		frontmatter[settings.projectKey] = project === "" ? null : project;
		for (const key of CREATED_KEYS) {
			if (key in frontmatter && isEmpty(frontmatter[key])) {
				frontmatter[key] = created;
			}
		}
		for (const key of UPDATED_KEYS) {
			if (key in frontmatter && isEmpty(frontmatter[key])) {
				frontmatter[key] = now;
			}
		}
	});
}
