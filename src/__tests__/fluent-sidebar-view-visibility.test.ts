/**
 * The Fluent sidebar lists only the views shown in settings, and follows
 * changes made there.
 *
 * Regression: the sidebar drew its view lists once and never listened to the
 * settings, so views hidden under Manage views stayed in the sidebar until
 * the whole view was reopened.
 */

import { FluentSidebar } from "@/components/features/fluent/components/FluentSidebar";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	return {
		...actual,
		Platform: { isPhone: false, isMobile: false },
		Menu: class {},
	};
});

jest.mock("sortablejs", () => ({
	__esModule: true,
	default: { create: () => ({ destroy() {} }) },
}));

jest.mock("@/components/features/fluent/components/WorkspaceSelector", () => ({
	WorkspaceSelector: class {
		setWorkspace() {}
	},
}));

jest.mock("@/components/features/fluent/components/ProjectList", () => ({
	ProjectList: class {},
}));

jest.mock("@/components/features/task/view/modals/ViewConfigModal", () => ({
	ViewConfigModal: class {},
}));

jest.mock("@/pages/TaskSpecificView", () => ({
	TASK_SPECIFIC_VIEW_TYPE: "task-genius-specific-view",
}));

// Obsidian's DOM helpers, as far as the sidebar uses them
const proto = HTMLElement.prototype as any;
proto.createEl = function (
	tag: string,
	o?: any,
	callback?: (el: any) => void,
) {
	const el = document.createElement(tag) as any;
	if (typeof o === "string") o = { cls: o };
	if (o?.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
	if (o?.text !== undefined) el.textContent = String(o.text);
	for (const [key, value] of Object.entries(o?.attr ?? {})) {
		el.setAttribute(key, String(value));
	}
	this.appendChild(el);
	callback?.(el);
	return el;
};
proto.createDiv = function (o?: any, callback?: (el: any) => void) {
	return this.createEl("div", o, callback);
};
proto.createSpan = function (o?: any, callback?: (el: any) => void) {
	return this.createEl("span", o, callback);
};
proto.empty = function () {
	this.innerHTML = "";
};
proto.addClass = function (...cls: string[]) {
	this.classList.add(...cls);
};
proto.removeClass = function (...cls: string[]) {
	this.classList.remove(...cls);
};
proto.toggleClass = function (cls: string, on: boolean) {
	this.classList.toggle(cls, on);
};
proto.toggle = function (show: boolean) {
	this.style.display = show ? "" : "none";
};
proto.hide = function () {
	this.style.display = "none";
};

function view(id: string, visible: boolean, region: "top" | "bottom") {
	return { id, name: id, icon: "list", type: "default", visible, region };
}

function openSidebar() {
	// Workspace events reach the handlers registered for them
	const handlers: Record<string, Array<(payload?: unknown) => void>> = {};
	const app = {
		workspace: {
			on: (name: string, handler: (payload?: unknown) => void) => {
				(handlers[name] = handlers[name] || []).push(handler);
				return {};
			},
			trigger: (name: string, payload?: unknown) =>
				handlers[name]?.forEach((handler) => handler(payload)),
		},
		loadLocalStorage: () => null,
	};
	const plugin: any = {
		app,
		saveSettings: jest.fn(),
		settings: {
			changelog: { lastVersion: "9.14.0" },
			viewConfiguration: [
				view("today", true, "top"),
				view("upcoming", true, "top"),
				view("flagged", false, "top"),
				view("inbox", true, "top"),
				view("table", true, "top"),
				view("calendar", false, "bottom"),
				view("kanban", false, "bottom"),
			],
		},
		workspaceManager: {
			getActiveWorkspace: () => ({ id: "default" }),
			isViewHidden: () => false,
			// The project list is left out of these tests
			isSidebarComponentHidden: (id: string) => id === "projects-list",
		},
	};
	const containerEl = document.createElement("div");
	const sidebar = new FluentSidebar(containerEl, plugin, jest.fn(), jest.fn());
	sidebar.load();

	/** Changes a view the way Manage views in settings does */
	const setVisible = (id: string, visible: boolean) => {
		plugin.settings.viewConfiguration.find(
			(v: { id: string }) => v.id === id,
		).visible = visible;
		app.workspace.trigger("task-genius:view-config-changed", {
			reason: "visibility-changed",
			viewId: id,
		});
	};
	const shownViews = () =>
		Array.from(
			containerEl.querySelectorAll(".fluent-navigation-item"),
		).map((item) => item.getAttribute("data-view-id"));
	const otherViews = () =>
		containerEl.querySelector(".other-views") as HTMLElement;

	return { sidebar, containerEl, setVisible, shownViews, otherViews };
}

describe("Fluent sidebar views", () => {
	it("list only the views shown in settings", () => {
		const { shownViews } = openSidebar();

		expect(shownViews()).toEqual(["today", "upcoming", "inbox", "table"]);
	});

	it("follow views hidden or shown in settings", () => {
		const { setVisible, shownViews } = openSidebar();

		setVisible("upcoming", false);
		expect(shownViews()).toEqual(["today", "inbox", "table"]);

		setVisible("flagged", true);
		expect(shownViews()).toEqual(["today", "flagged", "inbox", "table"]);
	});

	it("leave out Other Views while none of them is shown", () => {
		const { setVisible, otherViews, shownViews } = openSidebar();
		expect(otherViews().style.display).toBe("none");

		setVisible("kanban", true);
		expect(otherViews().style.display).toBe("");
		expect(otherViews().textContent).toContain("Other Views");
		expect(shownViews()).toContain("kanban");
	});

	it("keep the current view highlighted when redrawn", () => {
		const { sidebar, containerEl, setVisible } = openSidebar();
		sidebar.setActiveItem("table");

		setVisible("upcoming", false);

		const active = containerEl.querySelector(".fluent-navigation-item.is-active");
		expect(active?.getAttribute("data-view-id")).toBe("table");
	});
});
