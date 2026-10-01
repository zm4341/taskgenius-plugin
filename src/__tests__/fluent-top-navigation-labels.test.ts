/**
 * The Fluent top bar speaks the user's language.
 *
 * Regression: the view tabs were written in English, the search box, the
 * overdue menu and the view title had no translations, and the bell and
 * settings buttons had no tooltip at all.
 */

import { TopNavigation } from "@/components/features/fluent/components/FluentTopNavigation";
import { translationManager } from "@/translations/manager";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	class SearchComponent {
		inputEl: HTMLInputElement;
		constructor(containerEl: HTMLElement) {
			this.inputEl = containerEl.appendChild(
				document.createElement("input"),
			);
		}
		setPlaceholder(placeholder: string) {
			this.inputEl.placeholder = placeholder;
			return this;
		}
		onChange() {
			return this;
		}
	}
	// Keeps the titles of the items added to each menu
	class Menu {
		static titles: string[] = [];
		addItem(build: (item: any) => void) {
			const item: any = {
				setTitle: (title: string) => {
					Menu.titles.push(title);
					return item;
				},
				setDisabled: () => item,
				setIcon: () => item,
				onClick: () => item,
			};
			build(item);
			return this;
		}
		addSeparator() {
			return this;
		}
		showAtMouseEvent() {}
	}
	return {
		...actual,
		SearchComponent,
		Menu,
		Platform: { isPhone: false, isMobile: false },
		ExtraButtonComponent: class {},
	};
});

jest.mock("@/components/features/settings/SettingsModal", () => ({
	SettingsModal: class {},
}));

// Obsidian's DOM helpers, as far as the top bar uses them
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
proto.show = function () {
	this.style.display = "";
};
proto.hide = function () {
	this.style.display = "none";
};

function openTopBar() {
	const plugin: any = {
		settings: { taskStatuses: { completed: "x", abandoned: "-" } },
		app: { workspace: { on: () => ({}) } },
		dataflowOrchestrator: {
			getQueryAPI: () => ({ getAllTasks: async () => [] }),
		},
	};
	const containerEl = document.createElement("div");
	const noop = () => {};
	new TopNavigation(containerEl, plugin, noop, noop, noop, noop, noop);
	return containerEl;
}

beforeEach(() => {
	translationManager.setLocale("zh-cn");
});

afterEach(() => {
	translationManager.setLocale("en");
});

describe("Fluent top bar in Chinese", () => {
	it("names the view tabs and the search box", () => {
		const bar = openTopBar();

		expect(
			Array.from(bar.querySelectorAll(".fluent-view-tab")).map(
				(tab) => tab.textContent,
			),
		).toEqual(["列表", "看板", "树状", "日历"]);
		expect(bar.querySelector("input")?.placeholder).toBe("搜索任务、项目…");
	});

	it("gives the bell and settings buttons a tooltip", () => {
		const bar = openTopBar();

		expect(
			Array.from(bar.querySelectorAll(".fluent-nav-icon-button")).map(
				(button) => button.getAttribute("aria-label"),
			),
		).toEqual(["逾期任务", "设置"]);
	});

	it("lists overdue tasks under the bell", async () => {
		const { Menu } = jest.requireMock("obsidian");
		Menu.titles.length = 0;
		const bar = openTopBar();

		(bar.querySelector(".fluent-nav-icon-button") as HTMLElement).click();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(Menu.titles).toEqual(["没有逾期任务"]);
	});
});
