import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import type { TaskProgressBarSettings } from "@/common/setting-definition";
import { t } from "@/translations/helper";
import { mergeTagNames, noteTagsOf } from "@/utils/file/note-tags";

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
	/** Prefix of the project on the task line: #project/Dev or [project:: Dev] */
	projectTagPrefix?: string;
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
	/** Tags added to the note's tags property, so the task has them too */
	tags?: string[];
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
	const dataview = settings.preferMetadataFormat === "dataview";
	return {
		folder: saved?.folder ?? "",
		templateFile: saved?.templateFile ?? "",
		projectKey:
			settings.projectConfig?.metadataConfig?.metadataKey || "project",
		metadataFormat: dataview ? "dataview" : "tasks",
		projectTagPrefix:
			(dataview
				? settings.projectTagPrefix?.dataview
				: settings.projectTagPrefix?.tasks) || "project",
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

/**
 * The note's tags and project as the task line carries them, written the way
 * WriteAPI writes them, e.g. "#写作脚手架 #project/Development/Vernify"
 */
export function formatNoteMetadata(
	tags: string[],
	project: string,
	settings: Pick<TaskNoteSettings, "metadataFormat" | "projectTagPrefix">,
): string {
	const prefix = settings.projectTagPrefix || "project";
	const parts: string[] = [];
	if (settings.metadataFormat === "dataview") {
		if (tags.length > 0) {
			parts.push(`[tags:: ${tags.map((tag) => `#${tag}`).join(", ")}]`);
		}
		if (project) parts.push(`[${prefix}:: ${project}]`);
	} else {
		parts.push(...tags.map((tag) => `#${tag.replace(/\s+/g, "-")}`));
		if (project) parts.push(`#${prefix}/${project.replace(/\s+/g, "-")}`);
	}
	return parts.join(" ");
}

const TASK_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s*/;
const TOP_LEVEL_TASK = /^(?:[-*+]|\d+[.)])\s+\[.\]/;
/** Where the line's context, priority, dates or Dataview fields start */
const LINE_METADATA = /(?:^|\s)@\S|[🔺⏫🔼🔽⏬🛫⏳📅✅❌➕🔁🆔⛔🏁]|\[[^[\]]+::/u;

/** The text with links and inline code blanked out, so a "#" or "@" in them doesn't count */
function maskLinksAndCode(text: string): string {
	const blank = (match: string) => "x".repeat(match.length);
	return text
		.replace(/\[\[[^\]]*\]\]/g, blank)
		.replace(/\[[^\]]*\]\([^)]*\)/g, blank)
		.replace(/`[^`]*`/g, blank);
}

/**
 * The task line with the note's tags and project, as New Task writes them:
 * missing tags are added, a different project is replaced, and both go
 * before the line's context, priority and dates. Tasks format only.
 */
export function withNoteMetadata(
	line: string,
	tags: string[],
	project: string,
	settings: Pick<TaskNoteSettings, "projectTagPrefix">,
): string {
	const prefix = line.match(TASK_PREFIX)?.[0];
	if (prefix === undefined) return line;
	let body = line.slice(prefix.length);

	const prefixName = settings.projectTagPrefix || "project";
	// Tags ignore case, so "#Project/x" is the project too
	const projectHead = `${prefixName}/`.toLowerCase();
	const projectTag = project
		? `#${prefixName}/${project.trim().replace(/\s+/g, "-")}`
		: "";
	const lineTags = new Set<string>();
	let projectAt: { start: number; end: number } | null = null;
	for (const match of maskLinksAndCode(body).matchAll(/(^|\s)#([^\s#]+)/g)) {
		const start = match.index! + match[1].length;
		const name = match[2].replace(/[,.;:!?，。；：！？、)）\]】]+$/, "");
		if (!name.toLowerCase().startsWith(projectHead)) {
			lineTags.add(name.toLowerCase());
		} else if (!projectAt) {
			projectAt = { start, end: start + 1 + name.length };
		}
	}

	if (projectTag && projectAt) {
		body = body.slice(0, projectAt.start) + projectTag + body.slice(projectAt.end);
		projectAt.end = projectAt.start + projectTag.length;
	}
	const added = [
		...mergeTagNames(tags)
			.filter((tag) => !lineTags.has(tag.toLowerCase()))
			.filter((tag) => !tag.toLowerCase().startsWith(projectHead))
			.map((tag) => `#${tag.replace(/\s+/g, "-")}`),
		...(projectTag && !projectAt ? [projectTag] : []),
	];
	if (added.length > 0) {
		// Tags go before the project; both before the rest of the metadata
		const metadataAt = maskLinksAndCode(body).search(LINE_METADATA);
		const at = Math.min(
			projectAt?.start ?? body.length,
			metadataAt === -1
				? body.length
				: metadataAt + (/\s/.test(body[metadataAt]) ? 1 : 0),
		);
		body = [body.slice(0, at).trimEnd(), ...added, body.slice(at).trimStart()]
			.filter(Boolean)
			.join(" ");
	}
	return prefix + body;
}

/** Maps each task line that isn't nested, outside the properties and code blocks */
function mapTopLevelTasks(content: string, map: (line: string) => string): string {
	const frontmatter = content.match(FRONTMATTER)?.[0] ?? "";
	let inCode = false;
	const lines = content
		.slice(frontmatter.length)
		.split("\n")
		.map((line) => {
			if (/^\s*(?:```|~~~)/.test(line)) inCode = !inCode;
			if (inCode || !TOP_LEVEL_TASK.test(line)) return line;
			const cr = line.endsWith("\r") ? "\r" : "";
			return map(line.slice(0, line.length - cr.length)) + cr;
		});
	return frontmatter + lines.join("\n");
}

/** The note with its tags and project on each task line that isn't nested */
export function withNoteMetadataOnTasks(
	content: string,
	tags: string[],
	project: string,
	settings: Pick<TaskNoteSettings, "projectTagPrefix">,
): string {
	return mapTopLevelTasks(content, (line) =>
		withNoteMetadata(line, tags, project, settings),
	);
}

/**
 * Puts the note's tags and project on its task lines, for tasks typed by
 * hand or properties changed after the task was made. Returns how many task
 * lines the note has and how many changed; null when the note has neither
 * tags nor a project.
 */
export async function addNoteMetadataToTasks(
	app: App,
	settings: TaskNoteSettings,
	file: TFile,
): Promise<{ tasks: number; changed: number } | null> {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const tags = noteTagsOf(frontmatter);
	const project = String(frontmatter?.[settings.projectKey] ?? "").trim();
	if (tags.length === 0 && project === "") return null;

	const update = (content: string) =>
		withNoteMetadataOnTasks(content, tags, project, settings);
	const before = await app.vault.read(file);
	let tasks = 0;
	mapTopLevelTasks(before, (line) => {
		tasks++;
		return line;
	});
	if (update(before) === before) return { tasks, changed: 0 };

	let changed = 0;
	await app.vault.process(file, (content) => {
		const next = update(content);
		const old = content.split("\n");
		changed = next.split("\n").filter((line, i) => line !== old[i]).length;
		return next;
	});
	return { tasks, changed };
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
	const tags = mergeTagNames(
		noteTagsOf(templateProperties(app, settings)),
		input.tags ?? [],
	);
	const file = await app.vault.create(
		path,
		withTaskAtTop(template, taskBlock(input, settings, tags)),
	);
	await applyTaskNoteProperties(app, settings, file, input);
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
	// The note keeps its tags; one without the property gets the template's
	const own = app.metadataCache.getFileCache(file)?.frontmatter;
	const tags = mergeTagNames(
		noteTagsOf(own && "tags" in own ? own : templateProperties(app, settings)),
		input.tags ?? [],
	);

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
		withTaskAtTop(content, taskBlock(input, settings, tags)),
	);
	await applyTaskNoteProperties(app, settings, file, input);
	return file;
}

/**
 * The task line ends with the note's tags and project, which the task
 * inherits anyway, so the line shows them too; dates follow
 */
function taskBlock(
	input: TaskNoteInput,
	settings: TaskNoteSettings,
	tags: string[],
): string {
	const description = input.description?.trim();
	const taskLine = [
		"- [ ]",
		input.title.trim(),
		formatNoteMetadata(tags, cleanFolderInput(input.folder), settings),
		formatTaskDates(input.dates, settings.metadataFormat),
	]
		.filter(Boolean)
		.join(" ");
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

/** The template's properties, empty without a template */
function templateProperties(
	app: App,
	settings: TaskNoteSettings,
): Record<string, unknown> {
	const file = settings.templateFile
		? app.vault.getAbstractFileByPath(normalizePath(settings.templateFile))
		: null;
	return file instanceof TFile
		? (app.metadataCache.getFileCache(file)?.frontmatter ?? {})
		: {};
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
 * Sets the project from the folder, adds the tags picked in the window and
 * the template's missing properties. Empty created/updated times are filled
 * in, as the plugins that keep them only do so on the first edit.
 */
async function applyTaskNoteProperties(
	app: App,
	settings: TaskNoteSettings,
	file: TFile,
	input: TaskNoteInput,
): Promise<void> {
	const fromTemplate = templateProperties(app, settings);
	const project = cleanFolderInput(input.folder);
	const created = moment(file.stat.ctime).format(TIMESTAMP_FORMAT);
	const now = moment().format(TIMESTAMP_FORMAT);
	const isEmpty = (value: unknown) =>
		value === null || value === undefined || value === "";

	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		for (const [key, value] of Object.entries(fromTemplate)) {
			if (!(key in frontmatter)) frontmatter[key] = value;
		}
		if (input.tags?.length) {
			frontmatter.tags = mergeTagNames(noteTagsOf(frontmatter), input.tags);
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
