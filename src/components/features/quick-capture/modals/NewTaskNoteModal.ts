import {
	AbstractInputSuggest,
	App,
	Modal,
	Notice,
	prepareFuzzySearch,
	Setting,
	TextComponent,
	TFile,
} from "obsidian";
import type TaskProgressBarPlugin from "@/index";
import { SimpleFileSuggest } from "@/components/ui/inputs/AutoComplete";
import { t } from "@/translations/helper";
import {
	cleanFolderInput,
	convertToTaskNote,
	createTaskNote,
	getTaskNoteSettings,
	listTaskNoteFolders,
	noteHasTask,
	resolveTaskNoteFolder,
	sanitizeName,
	taskNoteFolderOf,
	type TaskNoteDates,
	type TaskNoteSettings,
} from "@/utils/file/task-note";
import "@/styles/new-task-note.scss";

const LAST_FOLDER_KEY = "task-genius-new-task-folder";

type DateType = keyof TaskNoteDates;

/** Suggests folders under the task notes root by their path relative to it */
class TaskNoteFolderSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly textInputEl: HTMLInputElement,
		private readonly folders: string[],
	) {
		super(app, textInputEl);
	}

	getSuggestions(query: string): string[] {
		const search = prepareFuzzySearch(query.trim());
		return this.folders
			.filter((folder) => query.trim() === "" || search(folder))
			.slice(0, 50);
	}

	renderSuggestion(folder: string, el: HTMLElement): void {
		el.setText(folder);
	}

	selectSuggestion(folder: string): void {
		this.setValue(folder);
		this.textInputEl.trigger("input");
		this.close();
	}
}

export interface NewTaskNoteOptions {
	/** Project selected in the sidebar; its folder is used by default */
	project?: string | null;
}

/**
 * New Task: creates one note per task in a project folder, or turns an
 * existing note without tasks into the task's note
 */
export class NewTaskNoteModal extends Modal {
	private readonly settings: TaskNoteSettings;
	private readonly folders: string[];
	private title = "";
	private description = "";
	private dateType: DateType = "scheduled";
	/** YYYY-MM-DD, or empty for no date */
	private dateValue = "";
	private folder: string;
	private useExistingNote = false;
	private existingNote: TFile | null = null;
	private moveNote = true;
	private submitting = false;

	private titleInput: TextComponent | null = null;
	private dateInput: TextComponent | null = null;
	private folderInput: TextComponent | null = null;
	private folderHintEl: HTMLElement | null = null;
	private existingNoteSetting: Setting | null = null;
	private moveSetting: Setting | null = null;
	private summaryEl: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly plugin: TaskProgressBarPlugin,
		options: NewTaskNoteOptions = {},
	) {
		super(app);
		this.settings = getTaskNoteSettings(plugin.settings);
		this.folders = listTaskNoteFolders(app, this.settings);
		this.folder = this.defaultFolder(options.project);
	}

	onOpen(): void {
		this.titleEl.setText(t("New Task"));
		this.modalEl.addClass("tg-new-task-note-modal");
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl).setName(t("Task")).addText((text) => {
			this.titleInput = text;
			text.setPlaceholder(t("What needs to be done?"))
				.setValue(this.title)
				.onChange((value) => {
					this.title = value;
					this.refresh();
				});
			text.inputEl.addEventListener("keydown", (event) => {
				// Enter also confirms IME candidates, which must not submit
				if (event.key === "Enter" && !event.isComposing) {
					event.preventDefault();
					void this.submit();
				}
			});
		});

		new Setting(contentEl)
			.setName(t("Description"))
			.addTextArea((text) => {
				text.setPlaceholder(t("Optional, written below the task"));
				text.setValue(this.description).onChange((value) => {
					this.description = value;
				});
			});

		new Setting(contentEl)
			.setName(t("Date"))
			.addDropdown((dropdown) => {
				dropdown
					.addOption("scheduled", t("Scheduled"))
					.addOption("due", t("Due"))
					.addOption("start", t("Start"))
					.setValue(this.dateType)
					.onChange((value) => {
						this.dateType = value as DateType;
					});
			})
			.addText((text) => {
				this.dateInput = text;
				text.inputEl.type = "date";
				text.setValue(this.dateValue).onChange((value) => {
					this.dateValue = value;
				});
			})
			.addExtraButton((button) => {
				button
					.setIcon("x")
					.setTooltip(t("Clear date"))
					.onClick(() => {
						this.dateValue = "";
						this.dateInput?.setValue("");
					});
			});

		const folderSetting = new Setting(contentEl)
			.setName(t("Folder"))
			.setDesc(t("Pick a folder, or type a new path to create it"))
			.addText((text) => {
				this.folderInput = text;
				text.setPlaceholder(t("Root folder"))
					.setValue(this.folder)
					.onChange((value) => {
						this.folder = value;
						this.refresh();
					});
				new TaskNoteFolderSuggest(this.app, text.inputEl, this.folders);
			});
		this.folderHintEl = folderSetting.descEl.createDiv({
			cls: "tg-new-task-note-hint",
		});

		new Setting(contentEl).setName(t("Note")).addDropdown((dropdown) => {
			dropdown
				.addOption("new", t("Create a note for the task"))
				.addOption("existing", t("Use an existing note"))
				.setValue("new")
				.onChange((value) => {
					this.useExistingNote = value === "existing";
					this.refresh();
				});
		});

		this.existingNoteSetting = new Setting(contentEl)
			.setName(t("Existing note"))
			.setDesc(t("A note without tasks; the task goes above its content"))
			.addText((text) => {
				text.setPlaceholder(t("Search notes")).onChange((value) => {
					const file = this.app.vault.getAbstractFileByPath(
						value.trim(),
					);
					this.existingNote = file instanceof TFile ? file : null;
					this.refresh();
				});
				new SimpleFileSuggest(text.inputEl, this.plugin, (file) =>
					this.pickNote(file),
				);
			});

		this.moveSetting = new Setting(contentEl)
			.setName(t("Move it to the folder"))
			.addToggle((toggle) => {
				toggle.setValue(this.moveNote).onChange((value) => {
					this.moveNote = value;
					this.refresh();
				});
			});

		this.summaryEl = contentEl.createDiv({
			cls: "tg-new-task-note-summary",
		});
		this.errorEl = contentEl.createDiv({ cls: "tg-new-task-note-error" });

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText(t("Cancel")).onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText(t("Create"))
					.setCta()
					.onClick(() => void this.submit()),
			);

		this.refresh();
		window.setTimeout(() => this.titleInput?.inputEl.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private defaultFolder(project?: string | null): string {
		if (project && this.folders.includes(project)) return project;
		const last = this.app.loadLocalStorage(LAST_FOLDER_KEY);
		return typeof last === "string" && this.folders.includes(last)
			? last
			: "";
	}

	private pickNote(file: TFile): void {
		this.existingNote = file;
		// A note already under the root stays in its folder unless changed
		const folder = taskNoteFolderOf(this.settings, file);
		if (folder !== null) {
			this.folder = folder;
			this.folderInput?.setValue(folder);
		}
		if (!this.title.trim()) {
			this.title = file.basename;
			this.titleInput?.setValue(file.basename);
		}
		this.refresh();

		void noteHasTask(this.app, file).then((hasTask) => {
			if (hasTask && this.existingNote === file) {
				this.showError(
					t("This note already has a task: {{path}}", {
						interpolation: { path: file.path },
					}),
				);
			}
		});
	}

	private refresh(): void {
		this.existingNoteSetting?.settingEl.toggle(this.useExistingNote);
		this.moveSetting?.settingEl.toggle(this.useExistingNote);
		this.showError("");

		const folder = cleanFolderInput(this.folder);
		const folderPath = resolveTaskNoteFolder(this.settings, folder);
		this.folderHintEl?.setText(
			folder === ""
				? t("No project, so the task goes to the Inbox")
				: this.folders.includes(folder)
					? t("Project: {{project}}", {
							interpolation: { project: folder },
						})
					: t("Creates the folder, a new project: {{path}}", {
							interpolation: { path: folderPath },
						}),
		);

		this.summaryEl?.setText(this.summary(folderPath));
	}

	private summary(folderPath: string): string {
		if (!this.useExistingNote) {
			const name = sanitizeName(this.title) || "…";
			const path = folderPath ? `${folderPath}/${name}.md` : `${name}.md`;
			return t("Creates {{path}}", { interpolation: { path } });
		}
		const note = this.existingNote;
		if (!note) return t("Pick the note that becomes the task's note");

		const parentPath = note.parent?.path === "/" ? "" : note.parent?.path;
		return this.moveNote && parentPath !== folderPath
			? t("Adds the task to {{note}} and moves it to {{folder}}", {
					interpolation: {
						note: note.path,
						folder: folderPath || "/",
					},
				})
			: t("Adds the task to {{note}}", {
					interpolation: { note: note.path },
				});
	}

	private showError(message: string): void {
		this.errorEl?.setText(message);
	}

	/** The date picked in the window, as the task's dates */
	private selectedDates(): TaskNoteDates | undefined {
		const match = this.dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!match) return undefined;
		const date = new Date(
			Number(match[1]),
			Number(match[2]) - 1,
			Number(match[3]),
		);
		return { [this.dateType]: date };
	}

	private async submit(): Promise<void> {
		if (this.submitting) return;
		const title = this.title.trim();
		if (!title) {
			this.showError(t("Enter the task first"));
			return;
		}
		if (this.useExistingNote && !this.existingNote) {
			this.showError(t("Pick the note that becomes the task's note"));
			return;
		}

		const folder = cleanFolderInput(this.folder);
		const input = {
			title,
			description: this.description,
			folder,
			dates: this.selectedDates(),
		};
		this.submitting = true;
		try {
			if (this.useExistingNote && this.existingNote) {
				await convertToTaskNote(this.app, this.settings, {
					...input,
					file: this.existingNote,
					move: this.moveNote,
				});
			} else {
				await createTaskNote(this.app, this.settings, input);
			}
			this.app.saveLocalStorage(LAST_FOLDER_KEY, folder);
			new Notice(
				t("Task created: {{task}}", { interpolation: { task: title } }),
			);
			this.close();
		} catch (error) {
			this.showError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			this.submitting = false;
		}
	}
}
