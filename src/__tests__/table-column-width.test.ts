/**
 * Column widths the user sets in the table view must be saved to settings.
 *
 * Regression: dragging a column border only changed the width in memory, so
 * it was lost on the next reload or column toggle.
 */

import { TableView } from "@/components/features/table/TableView";
import { TableRenderer } from "@/components/features/table/TableRenderer";
import type { TableSpecificConfig } from "@/common/setting-definition";

// The table's autocomplete inputs extend an Obsidian class the test mock lacks
jest.mock("@/components/ui/inputs/AutoComplete", () => ({
	ContextSuggest: class {},
	ProjectSuggest: class {},
	TagSuggest: class {},
}));

function makeTableConfig(columnWidths: Record<string, number>) {
	return {
		viewType: "table",
		enableTreeView: false,
		enableLazyLoading: false,
		pageSize: 50,
		enableInlineEditing: true,
		visibleColumns: ["status", "content"],
		columnWidths,
		sortableColumns: true,
		resizableColumns: true,
		showRowNumbers: true,
		enableRowSelection: true,
		enableMultiSelect: true,
		defaultSortField: "",
		defaultSortOrder: "asc",
	} as unknown as TableSpecificConfig;
}

function makePlugin(viewConfiguration: any[]) {
	return {
		settings: { viewConfiguration },
		saveSettings: jest.fn(),
	} as any;
}

describe("TableView saves column widths", () => {
	it("writes the width into this view's saved config, leaving shared objects alone", () => {
		// Stands in for DEFAULT_SETTINGS' widths, which the merged config can share
		const sharedWidths = { status: 80, content: 300 };
		const saved = makeTableConfig(sharedWidths);
		const plugin = makePlugin([{ id: "table", specificConfig: saved }]);
		// getViewSettingOrDefault hands the view a shallow merge of the saved config
		const merged = { ...saved };

		const view = new TableView({} as any, plugin, document.createElement("div"), merged, {}, "table");
		(view as any).saveColumnWidth("status", 128);

		expect(saved.columnWidths).toEqual({ status: 128, content: 300 });
		expect(merged.columnWidths).toEqual({ status: 128, content: 300 });
		expect(sharedWidths).toEqual({ status: 80, content: 300 });
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("saves into the table view it belongs to", () => {
		const defaultTable = makeTableConfig({ status: 80 });
		const customTable = makeTableConfig({ status: 80 });
		const plugin = makePlugin([
			{ id: "table", specificConfig: defaultTable },
			{ id: "my-table", specificConfig: customTable },
		]);

		const view = new TableView({} as any, plugin, document.createElement("div"), { ...customTable }, {}, "my-table");
		(view as any).saveColumnWidth("status", 150);

		expect(customTable.columnWidths.status).toBe(150);
		expect(defaultTable.columnWidths.status).toBe(80);
	});
});

describe("TableView row number column", () => {
	function rowNumberColumn(columnWidths: Record<string, number>) {
		const view = new TableView({} as any, makePlugin([]), document.createElement("div"), makeTableConfig(columnWidths), {}, "table");
		return (view as any).columns.find((c: any) => c.id === "rowNumber");
	}

	it("is resizable and centered, using the saved width", () => {
		expect(rowNumberColumn({ rowNumber: 72 })).toMatchObject({
			width: 72,
			resizable: true,
			align: "center",
		});
	});

	it("falls back to the default width when none is saved", () => {
		expect(rowNumberColumn({}).width).toBe(60);
	});
});

describe("TableRenderer reports finished column resizes", () => {
	function makeRenderer() {
		const tableEl = { addClass: jest.fn(), removeClass: jest.fn() } as any;
		const columns = [{ id: "status", width: 80 }] as any[];
		const renderer = new TableRenderer(
			tableEl,
			document.createElement("thead"),
			document.createElement("tbody"),
			columns,
			makeTableConfig({}),
			{} as any,
			{} as any,
		);
		const onColumnResize = jest.fn();
		renderer.onColumnResize = onColumnResize;
		return { renderer: renderer as any, onColumnResize };
	}

	it("reports the new width when a drag ends", () => {
		const { renderer, onColumnResize } = makeRenderer();
		renderer.startResize(new MouseEvent("mousedown", { clientX: 100 }), "status", 80);
		renderer.handleMouseMove(new MouseEvent("mousemove", { clientX: 148 }));
		renderer.handleMouseUp();

		expect(onColumnResize).toHaveBeenCalledWith("status", 128);
	});

	it("does not report a press without movement, like the clicks of a double-click", () => {
		const { renderer, onColumnResize } = makeRenderer();
		renderer.startResize(new MouseEvent("mousedown", { clientX: 100 }), "status", 80);
		renderer.handleMouseUp();

		expect(onColumnResize).not.toHaveBeenCalled();
	});
});
