/**
 * Enter in the project, context and tags fields keeps what was typed.
 *
 * Regression: Enter took the first suggestion. Typing "De" gave "Dev",
 * "@Dev" had no suggestions at all, and with nothing typed Enter filled in
 * the first one: clearing a project or context and pressing Enter set it
 * to "AI/Agent" or "Dev", and "#AI教师, " got a "#小升初语文" added.
 */

import {
	ContextSuggest,
	ProjectSuggest,
	TagSuggest,
} from "@/components/ui/inputs/AutoComplete";

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");
	// Obsidian's popover, with the undocumented parts the suggests rely on:
	// the list of suggestions and the scope's Enter handler, which takes
	// the highlighted suggestion
	class AbstractInputSuggest {
		scope: any;
		takeHighlighted = jest.fn(() => false);
		suggestions = {
			selectedItem: 0,
			forceSetSelectedItem(index: number) {
				this.selectedItem = index;
			},
		};
		isOpen = false;
		constructor(
			public app: any,
			public inputEl: HTMLInputElement,
		) {
			this.scope = {
				keys: [
					{ key: "ArrowDown", modifiers: "", func: jest.fn() },
					{ key: "Enter", modifiers: "", func: this.takeHighlighted },
				],
			};
		}
		open() {
			this.isOpen = true;
		}
		close() {
			this.isOpen = false;
		}
	}
	// Matches when the letters of the query appear in order; shorter is better
	const prepareFuzzySearch = (query: string) => (text: string) => {
		let at = 0;
		for (const char of text.toLowerCase()) {
			if (char === query.toLowerCase()[at]) at++;
		}
		return at === query.length ? { score: -text.length, matches: [] } : null;
	};
	return { ...actual, AbstractInputSuggest, prepareFuzzySearch };
});

const notes = ["实现多角色", "改善手绘风格", "实现多角色计划"].map((basename, i) => ({
	basename,
	stat: { mtime: i },
}));
const app: any = {
	metadataCache: {
		getTags: () => ({}),
		fileToLinktext: (file: { basename: string }) => file.basename,
	},
	vault: { getMarkdownFiles: () => notes },
};
const plugin: any = { app, settings: {} };

function make<S extends ProjectSuggest | ContextSuggest | TagSuggest>(
	Suggest: new (app: any, input: HTMLInputElement, plugin: any) => S,
	choices: string[],
	value = "",
): S {
	const input = document.createElement("input");
	input.value = value;
	const suggest = new Suggest(app, input, plugin);
	(suggest as any).availableChoices = choices;
	return suggest;
}

const projects = [
	"AI/Agent",
	"Audio/Music",
	"Development/Vernify/Add",
	"Development/Vernify/Enhance",
	"Development/AKG",
];
const contexts = ["Dev", "GDD", "Markting", "Music", "[[实现多角色]]"];

describe("Project suggestions", () => {
	it("put what was typed first, so Enter keeps it", () => {
		expect(make(ProjectSuggest, projects).getSuggestions("Add")).toEqual([
			"Add",
			"Development/Vernify/Add",
		]);
	});

	it("put the project typed first in its own spelling", () => {
		expect(
			make(ProjectSuggest, projects).getSuggestions("ai/agent")[0],
		).toBe("AI/Agent");
	});

	it("rank projects starting with it, then a part after / starting with it", () => {
		expect(make(ProjectSuggest, projects).getSuggestions("a")).toEqual([
			"a",
			"AI/Agent",
			"Audio/Music",
			"Development/AKG",
			"Development/Vernify/Add",
			"Development/Vernify/Enhance",
		]);
	});

	it("list all projects when nothing is typed", () => {
		expect(make(ProjectSuggest, projects).getSuggestions("")).toEqual(projects);
	});
});

describe("Context suggestions", () => {
	it("read past the @ typed", () => {
		expect(make(ContextSuggest, contexts).getSuggestions("@Dev")).toEqual([
			"Dev",
		]);
	});

	it("put what was typed first, so Enter keeps it", () => {
		expect(make(ContextSuggest, contexts).getSuggestions("De")).toEqual([
			"De",
			"Dev",
		]);
	});

	it("complete a note link being typed with the best match", () => {
		expect(make(ContextSuggest, contexts).getSuggestions("[[实现")).toEqual([
			"[[实现多角色]]",
			"[[实现多角色计划]]",
		]);
	});

	it("keep a whole link typed, also to a note not written yet", () => {
		const suggest = make(ContextSuggest, contexts);
		expect(suggest.getSuggestions("@[[实现多角色]]")).toEqual([
			"[[实现多角色]]",
			"[[实现多角色计划]]",
		]);
		expect(suggest.getSuggestions("[[新笔记]]")).toEqual(["[[新笔记]]"]);
	});
});

describe("Enter in the list of suggestions", () => {
	const enterOf = (suggest: any) =>
		suggest.scope.keys.find((key: any) => key.key === "Enter");

	it("takes the highlighted suggestion when something is typed", () => {
		const suggest: any = make(ContextSuggest, contexts, "De");
		suggest.open();
		expect(suggest.suggestions.selectedItem).toBe(0);

		const evt = new KeyboardEvent("keydown", { key: "Enter" });
		expect(enterOf(suggest).func(evt, {})).toBe(false);
		expect(suggest.takeHighlighted).toHaveBeenCalledWith(evt, {});
	});

	const nothingTyped: [string, any, string[], string][] = [
		["a cleared project", ProjectSuggest, projects, ""],
		["a cleared context", ContextSuggest, contexts, " @"],
		["a list of tags ending with a comma", TagSuggest, ["AI教师", "小升初语文"], "#AI教师, "],
	];
	for (const [name, Suggest, choices, value] of nothingTyped) {
		it(`goes to the input for ${name}, with nothing highlighted`, () => {
			const suggest: any = make(Suggest, choices, value);
			suggest.open();
			expect(suggest.suggestions.selectedItem).toBe(-1);

			// Not handled, so the key isn't stopped and the field saves on Enter
			const result = enterOf(suggest).func(
				new KeyboardEvent("keydown", { key: "Enter" }),
				{},
			);
			expect(result).toBeUndefined();
			expect(suggest.takeHighlighted).not.toHaveBeenCalled();
			expect(suggest.isOpen).toBe(false);
		});
	}

	it("takes a suggestion picked with the arrow keys", () => {
		const suggest: any = make(ProjectSuggest, projects, "");
		suggest.open();
		suggest.suggestions.selectedItem = 0; // ArrowDown
		enterOf(suggest).func(new KeyboardEvent("keydown", { key: "Enter" }), {});
		expect(suggest.takeHighlighted).toHaveBeenCalled();
	});
});
