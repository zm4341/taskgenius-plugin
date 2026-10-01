/**
 * A project picked in the Fluent sidebar narrows the view it was picked in,
 * and says so next to the title. Going to another view in the sidebar shows
 * all of that view's tasks again.
 *
 * Regression: the project kept filtering every view the user went to, with
 * nothing on screen saying so once the sidebar was collapsed, so Kanban and
 * Events showed only that project's tasks, or none at all.
 */

import { FluentTaskView } from "@/pages/FluentTaskView";
import { FluentLayoutManager } from "@/components/features/fluent/managers/FluentLayoutManager";
import { translationManager } from "@/translations/manager";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	class ItemView extends actual.Component {
		leaf: any;
		app: any;
		containerEl = document.createElement("div");
		contentEl = document.createElement("div");
		constructor(leaf: any) {
			super();
			this.leaf = leaf;
			this.app = leaf.app;
		}
	}
	return {
		...actual,
		ItemView,
		Scope: class {
			register() {}
		},
		ButtonComponent: class {},
		Platform: { isPhone: false, isMobile: false, isDesktop: true },
	};
});

// Narrows the tasks to the selected project, as the real filtering does
jest.mock("@/components/features/fluent/managers/FluentDataManager", () => ({
	FluentDataManager: class {
		constructor(
			_plugin: unknown,
			_getViewId: unknown,
			private getFilterState: () => { selectedProject?: string },
		) {}
		setCallbacks() {}
		applyFilters(tasks: any[]) {
			const project = this.getFilterState().selectedProject;
			return project
				? tasks.filter((task) => task.metadata.project === project)
				: tasks;
		}
	},
}));

// Keeps the callbacks the view hands over, which the sidebar's buttons and
// top bar end up calling
jest.mock("@/components/features/fluent/managers/FluentActionHandlers", () => ({
	FluentActionHandlers: class {
		callbacks: any = {};
		setCallbacks(callbacks: any) {
			this.callbacks = callbacks;
		}
	},
}));

jest.mock(
	"@/components/features/fluent/managers/FluentWorkspaceStateManager",
	() => ({
		FluentWorkspaceStateManager: class {
			saveFilterStateToWorkspace() {}
		},
	}),
);

jest.mock("@/components/features/task/selection/TaskSelectionManager", () => ({
	TaskSelectionManager: class {
		updateTaskCache() {}
	},
}));

jest.mock("@/components/features/fluent/managers/FluentComponentManager", () => ({
	FluentComponentManager: class {},
}));
jest.mock("@/components/features/fluent/managers/FluentGestureManager", () => ({
	FluentGestureManager: class {},
}));
jest.mock("@/components/features/fluent/components/FluentTopNavigation", () => ({
	TopNavigation: class {},
}));
jest.mock("@/components/features/fluent/components/FluentSidebar", () => ({
	FluentSidebar: class {},
}));
jest.mock("@/components/features/task/view/details", () => ({
	TaskDetailsComponent: class {},
}));
jest.mock("@/pages/LeftSidebarView", () => ({
	TG_LEFT_SIDEBAR_VIEW_TYPE: "tg-left-sidebar",
}));
jest.mock(
	"@/components/features/quick-capture/modals/QuickCaptureModalWithSwitch",
	() => ({ QuickCaptureModal: class {} }),
);
jest.mock("@/components/features/task/filter", () => ({
	ViewTaskFilterModal: class {},
	ViewTaskFilterPopover: class {},
}));

// Obsidian's DOM helpers, as far as the title bar uses them
const proto = HTMLElement.prototype as any;
proto.createEl = function (tag: string, o?: any) {
	const el = document.createElement(tag);
	if (typeof o === "string") o = { cls: o };
	if (o?.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
	if (o?.text !== undefined) el.textContent = String(o.text);
	for (const [key, value] of Object.entries(o?.attr ?? {})) {
		el.setAttribute(key, String(value));
	}
	this.appendChild(el);
	return el;
};
proto.createDiv = function (o?: any) {
	return this.createEl("div", o);
};
proto.createSpan = function (o?: any) {
	return this.createEl("span", o);
};
proto.setText = function (text: string) {
	this.textContent = text;
};
proto.empty = function () {
	this.innerHTML = "";
};
(globalThis as any).createDiv = (o?: any) =>
	document.createElement("div").createDiv(o);

const PROJECT = "Development/ob-plugins/TaskGenius";

const projectGroup = {
	id: "fluent-proj-group-1",
	groupCondition: "all",
	filters: [
		{ id: "p", property: "project", condition: "is", value: PROJECT },
	],
};
const tagGroup = {
	id: "tags",
	groupCondition: "all",
	filters: [{ id: "t", property: "tags", condition: "contains", value: "#a" }],
};

function task(content: string, project?: string) {
	return { id: content, content, metadata: { project } } as any;
}

const tasks = [
	task("plugin task", PROJECT),
	task("app task", "Development/Vernify"),
	task("loose task"),
];

/** The view as the sidebar left it: in Today, narrowed to one project */
function openViewWithProject() {
	const app: any = {
		workspace: { trigger: jest.fn(), on: jest.fn() },
		loadLocalStorage: () => null,
		saveLocalStorage: jest.fn(),
	};
	const plugin: any = {
		app,
		settings: { viewConfiguration: [], fluentView: {} },
		preloadedTasks: tasks,
	};
	const view: any = new FluentTaskView({ app } as any, plugin);
	view.initializeManagers();

	const layout = {
		setActiveProject: jest.fn(),
		showSelectedProject: jest.fn(),
		updateTaskMark() {},
		setSidebarActiveItem() {},
		sidebar: null,
	};
	const components = {
		getAvailableModesForView: () => ["list", "kanban", "calendar"],
		switchView: jest.fn(),
	};
	view.layoutManager = layout;
	view.componentManager = components;
	view.topNavigation = { setViewMode() {}, updateAvailableModes() {} };
	view.isInitializing = false;

	view.currentViewId = "today";
	view.viewState.selectedProject = PROJECT;
	view.liveFilterState = {
		rootCondition: "all",
		filterGroups: [tagGroup, projectGroup],
	};
	view.currentFilterState = view.liveFilterState;
	view.filteredTasks = view.dataManager.applyFilters(tasks);

	return { view, layout, components, app };
}

describe("Going to a view in the sidebar", () => {
	it("shows all the view's tasks, no longer narrowed to the project", () => {
		const { view, layout, components } = openViewWithProject();
		expect(view.filteredTasks).toHaveLength(1);

		view.actionHandlers.callbacks.onNavigateToView("kanban");

		expect(view.viewState.selectedProject).toBeUndefined();
		expect(view.filteredTasks).toHaveLength(3);
		expect(components.switchView).toHaveBeenLastCalledWith(
			"kanban",
			tasks,
			tasks,
			expect.anything(),
			expect.anything(),
			undefined,
		);
		// The sidebar no longer marks the project
		expect(layout.setActiveProject).toHaveBeenCalledWith(null);
		expect(layout.showSelectedProject).toHaveBeenLastCalledWith(
			undefined,
		);
	});

	it("keeps the filters set apart from the project", () => {
		const { view, app } = openViewWithProject();

		view.actionHandlers.callbacks.onNavigateToView("calendar");

		expect(view.liveFilterState.filterGroups).toEqual([tagGroup]);
		expect(view.currentFilterState.filterGroups).toEqual([tagGroup]);
		expect(app.workspace.trigger).toHaveBeenCalledWith(
			"task-genius:filter-changed",
			view.liveFilterState,
		);
	});
});

describe("Switching between list, kanban and calendar in the top bar", () => {
	it("keeps the view narrowed to the project", () => {
		const { view, layout } = openViewWithProject();

		view.actionHandlers.callbacks.onViewModeChanged("kanban");

		expect(view.viewState.selectedProject).toBe(PROJECT);
		expect(view.filteredTasks).toHaveLength(1);
		expect(layout.showSelectedProject).toHaveBeenLastCalledWith(PROJECT);
	});
});

describe("The project named next to the title", () => {
	beforeEach(() => {
		translationManager.setLocale("zh-cn");
	});

	afterEach(() => {
		translationManager.setLocale("en");
	});

	function openTitleBar() {
		const headerEl = document.createElement("div");
		const titleContainer = headerEl.createDiv("view-header-title-container");
		const titleEl = titleContainer.createDiv("view-header-title");
		const plugin: any = { settings: { projectPathSeparator: "/" } };
		const view: any = { leaf: {} };
		const layout = new FluentLayoutManager(
			{} as any,
			plugin,
			view,
			document.createElement("div"),
			headerEl,
			titleEl,
			() => 0,
		);
		const onProjectClear = jest.fn();
		layout.setFilterCallbacks({
			onFilterReset: () => {},
			getLiveFilterState: () => null,
			onProjectClear,
		});
		return { layout, titleContainer, onProjectClear };
	}

	it("shows while a project narrows the view, by its last name", () => {
		const { layout, titleContainer } = openTitleBar();

		layout.showSelectedProject(PROJECT);

		const chip = titleContainer.querySelector(".fluent-project-filter-chip");
		expect(chip?.textContent).toBe("项目：TaskGenius");
		expect(chip?.getAttribute("aria-label")).toBe(PROJECT);
		expect(chip?.previousElementSibling?.className).toBe(
			"view-header-title",
		);

		layout.showSelectedProject(undefined);

		expect(
			titleContainer.querySelector(".fluent-project-filter-chip"),
		).toBeNull();
	});

	it("clears the project from its button", () => {
		const { layout, titleContainer, onProjectClear } = openTitleBar();
		layout.showSelectedProject(PROJECT);

		const clear = titleContainer.querySelector(
			".fluent-project-filter-chip-clear",
		) as HTMLElement;
		expect(clear.getAttribute("aria-label")).toBe("清除项目筛选");
		clear.click();

		expect(onProjectClear).toHaveBeenCalled();
	});
});
