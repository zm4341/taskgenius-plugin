import { Component, App, debounce, Menu } from "obsidian";
import { Task } from "@/types/task";
import {
	TableSpecificConfig,
	SortCriterion,
} from "../../../common/setting-definition";
import TaskProgressBarPlugin from "@/index";
import { t } from "@/translations/helper";
import { TableColumn, TableRow, TableCell } from "./TableTypes";
import { TableRenderer } from "./TableRenderer";
import { TableEditor } from "./TableEditor";
import { TreeManager } from "./TreeManager";
import { VirtualScrollManager } from "./VirtualScrollManager";
import { TableHeader, TableHeaderCallbacks } from "./TableHeader";
import { sortTasks } from "@/commands/sortTaskCommands";
import { isProjectReadonly } from "@/utils/task/task-operations";
import "@/styles/table.scss";

export interface TableViewCallbacks {
	onTaskSelected?: (task: Task | null) => void;
	onTaskCompleted?: (task: Task) => void;
	onTaskContextMenu?: (event: MouseEvent, task: Task) => void;
	onTaskUpdated?: (task: Task) => void;
}

/**
 * Main table view component for displaying tasks in an editable table format
 * Supports both flat list and hierarchical tree view with lazy loading
 */
export class TableView extends Component {
	public containerEl: HTMLElement;
	private tableEl: HTMLElement;
	private headerEl: HTMLElement;
	private bodyEl: HTMLElement;
	private loadingEl: HTMLElement;
	private tableWrapper: HTMLElement;

	// Child components
	private tableHeader: TableHeader;
	private renderer: TableRenderer;
	private editor: TableEditor;
	private treeManager: TreeManager;
	private virtualScroll: VirtualScrollManager;

	// Data management
	private allTasks: Task[] = [];
	private filteredTasks: Task[] = [];
	private displayedRows: TableRow[] = [];
	private columns: TableColumn[] = [];
	private selectedRows: Set<string> = new Set();
	private editingCell: { rowId: string; columnId: string } | null = null;

	// State
	private isTreeView: boolean = false;
	private currentSortField: string = "";
	private currentSortOrder: "asc" | "desc" = "asc";
	private isLoading: boolean = false;

	// Column filters: columnId -> Set of selected values (empty set means no filter)
	private columnFilters: Map<string, Set<any>> = new Map();

	// Performance optimization
	private scrollRAF: number | null = null;
	private lastScrollTime: number = 0;
	private scrollVelocity: number = 0;
	private lastViewport: { startIndex: number; endIndex: number } | null =
		null;
	private renderThrottleRAF: number | null = null;
	private lastRenderTime: number = 0;

	// Callbacks
	public onTaskSelected?: (task: Task | null) => void;
	public onTaskCompleted?: (task: Task) => void;
	public onTaskContextMenu?: (event: MouseEvent, task: Task) => void;
	public onTaskUpdated?: (task: Task) => void;

	constructor(
		private app: App,
		private plugin: TaskProgressBarPlugin,
		private parentEl: HTMLElement,
		private config: TableSpecificConfig,
		private callbacks: TableViewCallbacks = {}
	) {
		super();
		this.setupCallbacks();
		this.initializeConfig();
	}

	private setupCallbacks() {
		// 对于表格视图，我们不自动触发任务选择，让父组件决定是否显示详情
		// this.onTaskSelected = this.callbacks.onTaskSelected;
		this.onTaskCompleted = this.callbacks.onTaskCompleted;
		this.onTaskContextMenu = this.callbacks.onTaskContextMenu;
		this.onTaskUpdated = this.callbacks.onTaskUpdated;
	}

	private initializeConfig() {
		this.isTreeView = this.config.enableTreeView;
		this.currentSortField = this.config.defaultSortField;
		this.currentSortOrder = this.config.defaultSortOrder;
		this.initializeColumns();
	}

	private initializeColumns() {
		// Define all available columns
		const allColumns: TableColumn[] = [
			{
				id: "rowNumber",
				title: t("No."),
				width: 60,
				sortable: false,
				resizable: false,
				type: "number",
				visible: this.config.showRowNumbers,
			},
			{
				id: "status",
				title: t("Status"),
				width: this.config.columnWidths.status || 80,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "status",
				visible: this.config.visibleColumns.includes("status"),
			},
			{
				id: "content",
				title: t("Content"),
				width: this.config.columnWidths.content || 300,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "text",
				visible: this.config.visibleColumns.includes("content"),
			},
			{
				id: "priority",
				title: t("Priority"),
				width: this.config.columnWidths.priority || 100,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "priority",
				visible: this.config.visibleColumns.includes("priority"),
			},
			{
				id: "dueDate",
				title: t("Due Date"),
				width: this.config.columnWidths.dueDate || 120,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "date",
				visible: this.config.visibleColumns.includes("dueDate"),
			},
			{
				id: "startDate",
				title: t("Start Date"),
				width: this.config.columnWidths.startDate || 120,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "date",
				visible: this.config.visibleColumns.includes("startDate"),
			},
			{
				id: "scheduledDate",
				title: t("Scheduled Date"),
				width: this.config.columnWidths.scheduledDate || 120,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "date",
				visible: this.config.visibleColumns.includes("scheduledDate"),
			},
			{
				id: "createdDate",
				title: t("Created Date"),
				width: this.config.columnWidths.createdDate || 120,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "date",
				visible: this.config.visibleColumns.includes("createdDate"),
			},
			{
				id: "completedDate",
				title: t("Completed Date"),
				width: this.config.columnWidths.completedDate || 120,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "date",
				visible: this.config.visibleColumns.includes("completedDate"),
			},
			{
				id: "tags",
				title: t("Tags"),
				width: this.config.columnWidths.tags || 150,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "tags",
				visible: this.config.visibleColumns.includes("tags"),
			},
			{
				id: "project",
				title: t("Project"),
				width: this.config.columnWidths.project || 150,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "text",
				visible: this.config.visibleColumns.includes("project"),
			},
			{
				id: "context",
				title: t("Context"),
				width: this.config.columnWidths.context || 120,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "text",
				visible: this.config.visibleColumns.includes("context"),
			},
			{
				id: "recurrence",
				title: t("Recurrence"),
				width: this.config.columnWidths.recurrence || 120,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "text",
				visible: this.config.visibleColumns.includes("recurrence"),
			},
			{
				id: "filePath",
				title: t("File"),
				width: this.config.columnWidths.filePath || 200,
				sortable: this.config.sortableColumns,
				resizable: this.config.resizableColumns,
				type: "text",
				visible: this.config.visibleColumns.includes("filePath"),
			},
		];

		this.columns = allColumns.filter((col) => col.visible);
	}

	onload() {
		this.createTableStructure();
		this.initializeChildComponents();
		this.setupEventListeners();

		// Initialize table header with current state
		this.updateTableHeaderInfo();
	}

	onunload() {
		this.cleanup();
	}

	private createTableStructure() {
		this.containerEl = this.parentEl.createDiv("task-table-container");

		// Create table header bar (not the table header)
		this.tableHeader = new TableHeader(this.containerEl, {
			onTreeModeToggle: (enabled: boolean) => {
				this.isTreeView = enabled;
				this.config.enableTreeView = enabled;
				this.refreshDisplay();
			},
			onRefresh: () => {
				this.refreshData();
			},
			onColumnToggle: (columnId: string, visible: boolean) => {
				this.toggleColumnVisibility(columnId, visible);
			},
		});
		this.addChild(this.tableHeader);

		// Create table wrapper for proper scrolling
		this.tableWrapper = this.containerEl.createDiv("task-table-wrapper");

		// Create table element
		this.tableEl = this.tableWrapper.createEl("table", "task-table");

		// Create header
		this.headerEl = this.tableEl.createEl("thead", "task-table-header");

		// Create body
		this.bodyEl = this.tableEl.createEl("tbody", "task-table-body");

		// Create loading indicator
		this.loadingEl = this.tableWrapper.createDiv("task-table-loading");
		this.loadingEl.textContent = t("Loading...");
		this.loadingEl.toggle(false);
	}

	private initializeChildComponents() {
		// Initialize renderer
		this.renderer = new TableRenderer(
			this.tableEl,
			this.headerEl,
			this.bodyEl,
			this.columns,
			this.config,
			this.app,
			this.plugin
		);
		this.addChild(this.renderer);

		// Set up date change callback
		this.renderer.onDateChange = (
			rowId: string,
			columnId: string,
			newDate: string | null
		) => {
			this.handleDateChange(rowId, columnId, newDate);
		};

		// Set up row expansion callback
		this.renderer.onRowExpand = (rowId: string) => {
			this.handleRowExpansion(rowId);
		};

		// Set up cell change callback
		this.renderer.onCellChange = (
			rowId: string,
			columnId: string,
			newValue: any
		) => {
			this.handleCellChange(rowId, columnId, newValue);
		};

		// Initialize editor if inline editing is enabled
		if (this.config.enableInlineEditing) {
			this.editor = new TableEditor(this.app, this.plugin, this.config, {
				onCellEdit: this.handleCellEdit.bind(this),
				onEditComplete: this.handleEditComplete.bind(this),
				onEditCancel: this.handleEditCancel.bind(this),
			});
			this.addChild(this.editor);
		}

		// Initialize tree manager if tree view is enabled
		if (this.config.enableTreeView) {
			this.treeManager = new TreeManager(
				this.columns,
				this.plugin.settings
			);
			this.addChild(this.treeManager);
		}

		// Initialize virtual scroll if lazy loading is enabled
		if (this.config.enableLazyLoading) {
			this.virtualScroll = new VirtualScrollManager(
				this.tableWrapper,
				this.config.pageSize,
				{
					onLoadMore: this.loadMoreRows.bind(this),
					onScroll: this.handleScroll.bind(this),
				}
			);
			this.addChild(this.virtualScroll);
		}
	}

	private setupEventListeners() {
		// Table click events
		this.registerDomEvent(
			this.tableEl,
			"click",
			this.handleTableClick.bind(this)
		);
		this.registerDomEvent(
			this.tableEl,
			"dblclick",
			this.handleTableDoubleClick.bind(this)
		);
		this.registerDomEvent(
			this.tableEl,
			"contextmenu",
			this.handleTableContextMenu.bind(this)
		);

		// Keyboard events
		this.registerDomEvent(
			this.containerEl,
			"keydown",
			this.handleKeyDown.bind(this)
		);

		// Header events for sorting and resizing
		this.registerDomEvent(
			this.headerEl,
			"click",
			this.handleHeaderClick.bind(this)
		);
	}

	/**
	 * Update the table with new task data
	 */
	public updateTasks(tasks: Task[]) {
		this.allTasks = tasks;
		this.applyFiltersAndSort();
		this.refreshDisplay();
		this.updateTableHeaderInfo();
	}

	/**
	 * Force a complete table refresh - useful when sorting issues are detected
	 */
	public forceRefresh() {
		// Clear all cached rows and force complete re-render
		if (this.renderer) {
			this.renderer.forceClearCache();
		}

		// Reset virtual scroll if enabled
		if (this.virtualScroll) {
			this.virtualScroll.reset();
		}

		// Clear selections
		this.selectedRows.clear();

		// Re-apply sorting and refresh
		this.applyFiltersAndSort();
		this.refreshDisplay();
		this.updateSortIndicators();
	}

	/**
	 * Apply current filters and sorting to the task list
	 */
	private applyFiltersAndSort() {
		// Start with all tasks
		this.filteredTasks = [...this.allTasks];

		// Apply column filters
		if (this.columnFilters.size > 0) {
			this.filteredTasks = this.filteredTasks.filter((task) => {
				// Task must match ALL column filters
				for (const [columnId, filterValues] of this.columnFilters) {
					if (filterValues.size === 0) continue;

					const { value } = this.getTaskValueForColumn(task, columnId);
					const taskValue = value ?? null;

					// Check if task value matches any of the filter values
					if (!filterValues.has(taskValue)) {
						return false;
					}
				}
				return true;
			});
		}

		// Sort tasks using the centralized sorting function
		if (this.currentSortField) {
			const sortCriteria: SortCriterion[] = [
				{
					field: this.currentSortField as SortCriterion["field"],
					order: this.currentSortOrder,
				},
			];
			this.filteredTasks = sortTasks(
				this.filteredTasks,
				sortCriteria,
				this.plugin.settings
			);
		}
	}

	/**
	 * Refresh the table display
	 */
	private refreshDisplay() {
		// Ensure tree manager is initialized if we're in tree view
		if (this.isTreeView && !this.treeManager) {
			this.treeManager = new TreeManager(
				this.columns,
				this.plugin.settings
			);
			this.addChild(this.treeManager);
		}

		if (this.isTreeView && this.treeManager) {
			// Pass current sort parameters to tree manager
			this.displayedRows = this.treeManager.buildTreeRows(
				this.filteredTasks,
				this.currentSortField,
				this.currentSortOrder
			);
		} else {
			this.displayedRows = this.buildFlatRows(this.filteredTasks);
		}

		// Clear any existing selection that might be invalid after sorting
		this.selectedRows.clear();

		// If virtual scrolling is enabled and we have many rows, use virtual rendering
		if (
			this.virtualScroll &&
			this.displayedRows.length > this.config.pageSize
		) {
			this.virtualScroll.updateContent(this.displayedRows.length);
			const viewport = this.virtualScroll.getViewport();
			const visibleRows = this.displayedRows.slice(
				viewport.startIndex,
				viewport.endIndex + 1
			);
			this.renderer.renderTable(
				visibleRows,
				this.selectedRows,
				viewport.startIndex,
				this.displayedRows.length
			);
		} else {
			// Render all rows normally
			this.renderer.renderTable(this.displayedRows, this.selectedRows);
		}
	}

	/**
	 * Build flat table rows from tasks
	 */
	private buildFlatRows(tasks: Task[]): TableRow[] {
		return tasks.map((task, index) => ({
			id: task.id,
			task: task,
			level: 0,
			expanded: false,
			hasChildren: false,
			cells: this.buildCellsForTask(task, index + 1),
		}));
	}

	/**
	 * Build table cells for a task
	 */
	private buildCellsForTask(task: Task, rowNumber: number): TableCell[] {
		return this.columns.map((column) => {
			let value: any;
			let displayValue: string;

			switch (column.id) {
				case "rowNumber":
					value = rowNumber;
					displayValue = rowNumber.toString();
					break;
				case "status":
					value = task.status;
					displayValue = this.formatStatus(task.status);
					break;
				case "content":
					value = task.content;
					displayValue = task.content;
					break;
				case "priority":
					const metadata = task.metadata || {};
					value = metadata.priority;
					displayValue = this.formatPriority(metadata.priority);
					break;
				case "dueDate":
					const metadataDue = task.metadata || {};
					value = metadataDue.dueDate;
					displayValue = this.formatDate(metadataDue.dueDate);
					break;
				case "startDate":
					const metadataStart = task.metadata || {};
					value = metadataStart.startDate;
					displayValue = this.formatDate(metadataStart.startDate);
					break;
				case "scheduledDate":
					const metadataScheduled = task.metadata || {};
					value = metadataScheduled.scheduledDate;
					displayValue = this.formatDate(
						metadataScheduled.scheduledDate
					);
					break;
				case "createdDate":
					value = task.metadata.createdDate;
					displayValue = this.formatDate(task.metadata.createdDate);
					break;
				case "completedDate":
					value = task.metadata.completedDate;
					displayValue = this.formatDate(task.metadata.completedDate);
					break;
				case "tags":
					value = task.metadata.tags;
					displayValue = task.metadata.tags?.join(", ") || "";
					break;
				case "project":
					value = task.metadata.project;
					displayValue = task.metadata.project || "";
					break;
				case "context":
					value = task.metadata.context;
					displayValue = task.metadata.context || "";
					break;
				case "recurrence":
					value = task.metadata.recurrence;
					displayValue = task.metadata.recurrence || "";
					break;
				case "filePath":
					value = task.filePath;
					displayValue = this.formatFilePath(task.filePath);
					break;
				default:
					value = "";
					displayValue = "";
			}

			return {
				columnId: column.id,
				value: value,
				displayValue: displayValue,
				editable:
					column.id !== "rowNumber" &&
					this.config.enableInlineEditing,
			};
		});
	}

	// Formatting methods
	private formatStatus(status: string): string {
		// Convert status symbols to readable text
		const statusMap: Record<string, string> = {
			" ": t("Not Started"),
			x: t("Completed"),
			X: t("Completed"),
			"/": t("In Progress"),
			">": t("In Progress"),
			"-": t("Abandoned"),
			"?": t("Planned"),
		};
		return statusMap[status] || status;
	}

	private formatPriority(priority?: number): string {
		if (!priority) return "";
		const priorityMap: Record<number, string> = {
			5: t("Highest"),
			4: t("High"),
			3: t("Medium"),
			2: t("Low"),
			1: t("Lowest"),
		};
		return priorityMap[priority] || priority.toString();
	}

	private formatDate(timestamp?: number): string {
		if (!timestamp) return "";
		return new Date(timestamp).toLocaleDateString();
	}

	private formatFilePath(filePath: string): string {
		// Extract just the filename
		const parts = filePath.split("/");
		return parts[parts.length - 1].replace(/\.md$/, "");
	}

	// Event handlers
	private handleTableClick(event: MouseEvent) {
		const target = event.target as HTMLElement;
		const row = target.closest("tr");
		if (!row) return;

		const rowId = row.dataset.rowId;
		if (!rowId) return;

		const task = this.allTasks.find((t) => t.id === rowId);
		if (!task) return;

		// Handle row selection
		if (this.config.enableRowSelection) {
			if (event.ctrlKey || event.metaKey) {
				// Multi-select
				if (this.config.enableMultiSelect) {
					if (this.selectedRows.has(rowId)) {
						this.selectedRows.delete(rowId);
					} else {
						this.selectedRows.add(rowId);
					}
				}
			} else {
				// Single select
				this.selectedRows.clear();
				this.selectedRows.add(rowId);
			}
			this.updateRowSelection();
		}

		// 表格视图不自动触发任务选择，避免显示详情面板
		// 如果需要显示详情，可以通过右键菜单或其他方式触发
		// if (this.onTaskSelected) {
		// 	this.onTaskSelected(task);
		// }
	}

	private handleTableDoubleClick(event: MouseEvent) {
		const target = event.target as HTMLElement;
		const cell = target.closest("td");
		if (!cell) return;

		const row = cell.closest("tr");
		if (!row) return;

		const rowId = row.dataset.rowId;
		const columnId = cell.dataset.columnId;

		if (rowId && columnId && this.config.enableInlineEditing) {
			this.startCellEdit(rowId, columnId, cell);
		}
	}

	private handleTableContextMenu(event: MouseEvent) {
		event.preventDefault();

		const target = event.target as HTMLElement;
		const row = target.closest("tr");
		if (!row) return;

		const rowId = row.dataset.rowId;
		if (!rowId) return;

		const task = this.allTasks.find((t) => t.id === rowId);
		if (!task) return;

		// 调用原有的上下文菜单回调
		if (this.onTaskContextMenu) {
			this.onTaskContextMenu(event, task);
		}
	}

	private handleHeaderClick(event: MouseEvent) {
		const target = event.target as HTMLElement;

		// Don't handle sort if we're resizing or clicking on a resize handle
		if (target.classList.contains("task-table-resize-handle")) {
			return;
		}

		const header = target.closest("th");
		if (!header) {
			return;
		}

		// Check if the table is currently being resized
		if (this.tableEl.classList.contains("resizing")) {
			return;
		}

		const columnId = header.dataset.columnId;
		if (!columnId) return;

		const column = this.columns.find((c) => c.id === columnId);
		if (!column || !column.sortable) {
			return;
		}

		// Check what was clicked: title or sort icon
		const action = target.dataset.action;

		if (action === "select-sort-field") {
			// Clicked on title - show column filter menu with unique values
			this.showColumnFilterMenu(event, columnId);
			return;
		} else if (action === "toggle-sort-order") {
			// Clicked on sort icon - toggle sort order for current column
			this.toggleSortOrder(columnId);
			return;
		}

		// Fallback: if clicked elsewhere on the header, toggle sort order
		this.toggleSortOrder(columnId);
	}

	/**
	 * Toggle sort order for a column: asc -> desc -> no sort
	 */
	private toggleSortOrder(columnId: string) {
		if (this.currentSortField === columnId) {
			// Same column - cycle through: asc -> desc -> no sort
			if (this.currentSortOrder === "asc") {
				this.currentSortOrder = "desc";
			} else if (this.currentSortOrder === "desc") {
				// Third click: clear sorting
				this.currentSortField = "";
				this.currentSortOrder = "asc";
			}
		} else {
			// Different column - start with asc
			this.currentSortField = columnId;
			this.currentSortOrder = "asc";
		}

		this.applySortAndRefresh();
	}

	/**
	 * Show column filter menu with unique values from that column
	 */
	private showColumnFilterMenu(event: MouseEvent, columnId: string) {
		const menu = new Menu();
		const column = this.columns.find((c) => c.id === columnId);
		if (!column) return;

		// Get unique values for this column
		const uniqueValues = this.getUniqueValuesForColumn(columnId);
		const currentFilter = this.columnFilters.get(columnId) || new Set();

		// Add "Show All" option
		menu.addItem((item) => {
			const isShowAll = currentFilter.size === 0;
			item.setTitle(t("Show All"))
				.setIcon(isShowAll ? "check" : "circle")
				.onClick(() => {
					this.columnFilters.delete(columnId);
					this.applyFiltersAndRefresh();
				});
		});

		menu.addSeparator();

		// Add unique values as filter options
		uniqueValues.forEach(({ value, displayValue, count }) => {
			menu.addItem((item) => {
				const isSelected = currentFilter.has(value);
				item.setTitle(`${displayValue} (${count})`)
					.setIcon(isSelected ? "check" : "circle")
					.onClick(() => {
						// Toggle this value in the filter
						if (!this.columnFilters.has(columnId)) {
							this.columnFilters.set(columnId, new Set());
						}
						const filter = this.columnFilters.get(columnId)!;

						if (isSelected) {
							filter.delete(value);
							if (filter.size === 0) {
								this.columnFilters.delete(columnId);
							}
						} else {
							filter.add(value);
						}

						this.applyFiltersAndRefresh();
					});
			});
		});

		// Add clear filter option if filter is active
		if (currentFilter.size > 0) {
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t("Clear filter"))
					.setIcon("x")
					.onClick(() => {
						this.columnFilters.delete(columnId);
						this.applyFiltersAndRefresh();
					});
			});
		}

		menu.showAtMouseEvent(event);
	}

	/**
	 * Get unique values for a column from all tasks
	 */
	private getUniqueValuesForColumn(
		columnId: string
	): Array<{ value: any; displayValue: string; count: number }> {
		const valueMap = new Map<any, { displayValue: string; count: number }>();

		this.allTasks.forEach((task) => {
			const { value, displayValue } = this.getTaskValueForColumn(
				task,
				columnId
			);

			// Handle null/undefined as a special "empty" value
			const key = value ?? "__empty__";

			if (valueMap.has(key)) {
				valueMap.get(key)!.count++;
			} else {
				valueMap.set(key, {
					displayValue: displayValue || t("(Empty)"),
					count: 1,
				});
			}
		});

		// Convert to array and sort by display value
		return Array.from(valueMap.entries())
			.map(([value, { displayValue, count }]) => ({
				value: value === "__empty__" ? null : value,
				displayValue,
				count,
			}))
			.sort((a, b) => {
				// Put empty values at the end
				if (a.value === null) return 1;
				if (b.value === null) return -1;
				// Sort by display value
				return String(a.displayValue).localeCompare(
					String(b.displayValue)
				);
			});
	}

	/**
	 * Get value and display value for a task column
	 */
	private getTaskValueForColumn(
		task: Task,
		columnId: string
	): { value: any; displayValue: string } {
		switch (columnId) {
			case "status":
				return {
					value: task.status,
					displayValue: this.formatStatus(task.status),
				};
			case "priority":
				return {
					value: task.metadata?.priority,
					displayValue: this.formatPriority(task.metadata?.priority),
				};
			case "dueDate":
				return {
					value: task.metadata?.dueDate,
					displayValue: this.formatDate(task.metadata?.dueDate),
				};
			case "startDate":
				return {
					value: task.metadata?.startDate,
					displayValue: this.formatDate(task.metadata?.startDate),
				};
			case "scheduledDate":
				return {
					value: task.metadata?.scheduledDate,
					displayValue: this.formatDate(task.metadata?.scheduledDate),
				};
			case "createdDate":
				return {
					value: task.metadata?.createdDate,
					displayValue: this.formatDate(task.metadata?.createdDate),
				};
			case "completedDate":
				return {
					value: task.metadata?.completedDate,
					displayValue: this.formatDate(task.metadata?.completedDate),
				};
			case "project":
				return {
					value: task.metadata?.project,
					displayValue: task.metadata?.project || "",
				};
			case "context":
				return {
					value: task.metadata?.context,
					displayValue: task.metadata?.context || "",
				};
			case "tags":
				const tags = task.metadata?.tags || [];
				return {
					value: tags.join(","),
					displayValue: tags.join(", "),
				};
			case "filePath":
				return {
					value: task.filePath,
					displayValue: this.formatFilePath(task.filePath),
				};
			default:
				return { value: null, displayValue: "" };
		}
	}

	/**
	 * Apply filters and refresh display
	 */
	private applyFiltersAndRefresh() {
		// Reset virtual scroll state
		if (this.virtualScroll) {
			this.virtualScroll.reset();
		}

		this.applyFiltersAndSort();
		this.refreshDisplay();
		this.updateTableHeaderInfo();
	}

	/**
	 * Apply sorting and refresh display
	 */
	private applySortAndRefresh() {
		// Reset virtual scroll state when sorting changes
		if (this.virtualScroll) {
			this.virtualScroll.reset();
		}

		this.applyFiltersAndSort();
		this.refreshDisplay();
		this.updateSortIndicators();

		// Debug logging
		console.log(
			`Table sorted by ${this.currentSortField} (${this.currentSortOrder})`
		);

		// Fallback: force refresh if row count mismatch
		setTimeout(() => {
			const currentRowCount =
				this.bodyEl.querySelectorAll("tr[data-row-id]").length;
			const expectedRowCount = this.displayedRows.length;

			if (currentRowCount !== expectedRowCount && expectedRowCount > 0) {
				console.warn(
					`Table row count mismatch detected. Forcing refresh.`
				);
				this.forceRefresh();
			}
		}, 100);
	}

	private handleKeyDown(event: KeyboardEvent) {
		// Handle keyboard shortcuts
		if (event.key === "Escape" && this.editingCell) {
			this.cancelCellEdit();
		}
	}

	private handleScroll = () => {
		// Cancel any pending animation frame
		if (this.scrollRAF) {
			cancelAnimationFrame(this.scrollRAF);
		}

		// Use requestAnimationFrame for smooth scrolling
		this.scrollRAF = requestAnimationFrame(() => {
			// Handle virtual scrolling only if enabled and needed
			if (
				this.virtualScroll &&
				this.displayedRows.length > this.config.pageSize
			) {
				// Calculate scroll velocity for predictive rendering
				const currentTime = performance.now();
				const deltaTime = currentTime - this.lastScrollTime;

				// Remove time-based throttling for immediate responsiveness
				const currentScrollTop = this.tableWrapper.scrollTop;
				const previousScrollTop =
					this.virtualScroll.getViewport().scrollTop;
				this.scrollVelocity =
					(currentScrollTop - previousScrollTop) /
					Math.max(deltaTime, 1);
				this.lastScrollTime = currentTime;

				// Let virtual scroll manager handle the scroll logic first
				this.virtualScroll.handleScroll();

				// Get viewport and check if it actually changed
				const viewport = this.virtualScroll.getViewport();

				// Always render if viewport changed, no matter how small the change
				const viewportChanged =
					!this.lastViewport ||
					this.lastViewport.startIndex !== viewport.startIndex ||
					this.lastViewport.endIndex !== viewport.endIndex;

				// Remove render throttling for immediate response
				if (viewportChanged) {
					this.performRender(viewport, currentTime);
				}
			}

			this.scrollRAF = null;
		});
	};

	/**
	 * Perform actual rendering with throttling
	 */
	private performRender(viewport: any, currentTime: number) {
		// Cancel any pending render
		if (this.renderThrottleRAF) {
			cancelAnimationFrame(this.renderThrottleRAF);
			this.renderThrottleRAF = null;
		}

		// Execute rendering immediately for better responsiveness
		// More aggressive buffer adjustment for fast scrolling
		let bufferAdjustment = 0;
		if (Math.abs(this.scrollVelocity) > 1) {
			// Reduced threshold from 2 to 1 for earlier buffer adjustment
			bufferAdjustment = Math.min(
				8, // Increased from 5 to 8 for even larger buffer
				Math.floor(Math.abs(this.scrollVelocity) / 1.5) // Reduced divisor for more aggressive buffering
			);
		}

		// Calculate visible range with buffer
		let adjustedStartIndex = Math.max(
			0,
			viewport.startIndex - bufferAdjustment
		);

		// Special check: if we're very close to the top, force startIndex to 0
		const currentScrollTop = this.tableWrapper.scrollTop;
		if (currentScrollTop <= 40) {
			// Within one row height of top
			adjustedStartIndex = 0;
		}

		const adjustedEndIndex = Math.min(
			this.displayedRows.length - 1,
			viewport.endIndex + bufferAdjustment
		);

		const visibleRows = this.displayedRows.slice(
			adjustedStartIndex,
			adjustedEndIndex + 1
		);

		// Use the optimized renderer with row recycling
		this.renderer.renderTable(
			visibleRows,
			this.selectedRows,
			adjustedStartIndex,
			this.displayedRows.length
		);

		// Update state
		this.lastViewport = {
			startIndex: adjustedStartIndex,
			endIndex: adjustedEndIndex,
		};
		this.lastRenderTime = currentTime;
	}

	// Cell editing methods
	private startCellEdit(
		rowId: string,
		columnId: string,
		cellEl: HTMLElement
	) {
		if (this.editingCell) {
			this.cancelCellEdit();
		}

		this.editingCell = { rowId, columnId };
		this.editor.startEdit(rowId, columnId, cellEl);
	}

	/**
	 * Handle cell edit from table editor
	 */
	private handleCellEdit(rowId: string, columnId: string, newValue: any) {
		const task = this.allTasks.find((t) => t.id === rowId);
		if (!task) return;

		// Update task property
		const updatedTask = { ...task };
		this.updateTaskProperty(updatedTask, columnId, newValue);

		// Notify task update
		if (this.onTaskUpdated) {
			this.onTaskUpdated(updatedTask);
		}
	}

	private handleEditComplete() {
		this.editingCell = null;
		this.refreshDisplay();
	}

	private handleEditCancel() {
		this.editingCell = null;
	}

	private cancelCellEdit() {
		if (this.editingCell) {
			this.editor.cancelEdit();
			this.editingCell = null;
		}
	}

	private updateTaskProperty(task: Task, property: string, value: any) {
		switch (property) {
			case "status":
				task.status = value;
				task.completed = value === "x" || value === "X";
				break;
			case "content":
				task.content = value;
				break;
			case "priority":
				task.metadata.priority = value
					? parseInt(String(value))
					: undefined;
				break;
			case "dueDate":
				task.metadata.dueDate = value
					? new Date(value).getTime()
					: undefined;
				break;
			case "startDate":
				task.metadata.startDate = value
					? new Date(value).getTime()
					: undefined;
				break;
			case "scheduledDate":
				task.metadata.scheduledDate = value
					? new Date(value).getTime()
					: undefined;
				break;
			case "createdDate":
				task.metadata.createdDate = value
					? new Date(value).getTime()
					: undefined;
				break;
			case "completedDate":
				task.metadata.completedDate = value
					? new Date(value).getTime()
					: undefined;
				break;
			case "tags":
				// Handle both array and string inputs
				if (Array.isArray(value)) {
					task.metadata.tags = value;
				} else if (typeof value === "string") {
					task.metadata.tags = value
						? value
								.split(",")
								.map((t: string) => t.trim())
								.filter((t) => t.length > 0)
						: [];
				} else {
					task.metadata.tags = [];
				}
				break;
			case "project":
				// Only update project if it's not a read-only tgProject
				if (!isProjectReadonly(task)) {
					task.metadata.project = value || undefined;
				}
				break;
			case "context":
				task.metadata.context = value || undefined;
				break;
			case "recurrence":
				task.metadata.recurrence = value || undefined;
				break;
		}
	}

	// UI update methods
	private updateRowSelection() {
		this.renderer.updateSelection(this.selectedRows);
	}

	private updateSortIndicators() {
		// If no sort field is set, clear all indicators
		if (!this.currentSortField) {
			this.renderer.updateSortIndicators("", "asc");
		} else {
			this.renderer.updateSortIndicators(
				this.currentSortField,
				this.currentSortOrder
			);
		}
	}

	private loadMoreRows() {
		// Implement lazy loading logic here
		if (this.virtualScroll) {
			this.virtualScroll.loadNextBatch();
		}
	}

	private cleanup() {
		// Cancel any pending scroll animation
		if (this.scrollRAF) {
			cancelAnimationFrame(this.scrollRAF);
			this.scrollRAF = null;
		}

		// Cancel any pending render
		if (this.renderThrottleRAF) {
			cancelAnimationFrame(this.renderThrottleRAF);
			this.renderThrottleRAF = null;
		}

		// Clear viewport cache
		this.lastViewport = null;

		this.selectedRows.clear();
		this.displayedRows = [];
		this.filteredTasks = [];
		this.allTasks = [];
	}

	/**
	 * Toggle between tree view and flat view
	 */
	public toggleTreeView() {
		this.isTreeView = !this.isTreeView;
		this.refreshDisplay();
	}

	/**
	 * Get currently selected tasks
	 */
	public getSelectedTasks(): Task[] {
		return this.allTasks.filter((task) => this.selectedRows.has(task.id));
	}

	/**
	 * Clear all selections
	 */
	public clearSelection() {
		this.selectedRows.clear();
		this.updateRowSelection();
	}

	/**
	 * Export table data
	 */
	public exportData(): any[] {
		return this.displayedRows.map((row) => {
			const data: any = {};
			row.cells.forEach((cell) => {
				data[cell.columnId] = cell.value;
			});
			return data;
		});
	}

	/**
	 * Refresh table data
	 */
	private refreshData() {
		this.applyFiltersAndSort();
		this.refreshDisplay();
	}

	/**
	 * Toggle column visibility
	 */
	private toggleColumnVisibility(columnId: string, visible: boolean) {
		// Update config
		if (visible && !this.config.visibleColumns.includes(columnId)) {
			this.config.visibleColumns.push(columnId);
		} else if (!visible) {
			const index = this.config.visibleColumns.indexOf(columnId);
			if (index > -1) {
				this.config.visibleColumns.splice(index, 1);
			}
		}

		// Save the updated configuration to plugin settings
		this.saveColumnConfiguration();

		// Reinitialize columns
		this.initializeColumns();

		// Update renderer with new columns
		if (this.renderer) {
			this.renderer.updateColumns(this.columns);
		}

		// Update tree manager with new columns
		if (this.treeManager) {
			this.treeManager.updateColumns(this.columns);
		}

		// Refresh display
		this.refreshDisplay();

		// Update table header with new column info
		this.updateTableHeaderInfo();
	}

	/**
	 * Save column configuration to plugin settings
	 */
	private saveColumnConfiguration() {
		if (this.plugin && this.plugin.settings) {
			// Find the table view configuration
			const tableViewConfig = this.plugin.settings.viewConfiguration.find(
				(view) => view.id === "table"
			);

			if (tableViewConfig && tableViewConfig.specificConfig) {
				const tableConfig = tableViewConfig.specificConfig as any;
				if (tableConfig.viewType === "table") {
					// Update the visible columns in the plugin settings
					tableConfig.visibleColumns = [
						...this.config.visibleColumns,
					];

					// Save settings
					this.plugin.saveSettings();
				}
			}
		}
	}

	/**
	 * Update table header information
	 */
	private updateTableHeaderInfo() {
		if (this.tableHeader) {
			// Update task count
			this.tableHeader.updateTaskCount(this.filteredTasks.length);

			// Update tree mode state
			this.tableHeader.updateTreeMode(this.isTreeView);

			// Update available columns
			const allColumns = this.getAllAvailableColumns();
			this.tableHeader.updateColumns(allColumns);
		}
	}

	/**
	 * Get all available columns with their visibility state
	 */
	private getAllAvailableColumns(): Array<{
		id: string;
		title: string;
		visible: boolean;
	}> {
		return [
			{
				id: "status",
				title: t("Status"),
				visible: this.config.visibleColumns.includes("status"),
			},
			{
				id: "content",
				title: t("Content"),
				visible: this.config.visibleColumns.includes("content"),
			},
			{
				id: "priority",
				title: t("Priority"),
				visible: this.config.visibleColumns.includes("priority"),
			},
			{
				id: "dueDate",
				title: t("Due Date"),
				visible: this.config.visibleColumns.includes("dueDate"),
			},
			{
				id: "startDate",
				title: t("Start Date"),
				visible: this.config.visibleColumns.includes("startDate"),
			},
			{
				id: "scheduledDate",
				title: t("Scheduled Date"),
				visible: this.config.visibleColumns.includes("scheduledDate"),
			},
			{
				id: "createdDate",
				title: t("Created Date"),
				visible: this.config.visibleColumns.includes("createdDate"),
			},
			{
				id: "completedDate",
				title: t("Completed Date"),
				visible: this.config.visibleColumns.includes("completedDate"),
			},
			{
				id: "tags",
				title: t("Tags"),
				visible: this.config.visibleColumns.includes("tags"),
			},
			{
				id: "project",
				title: t("Project"),
				visible: this.config.visibleColumns.includes("project"),
			},
			{
				id: "context",
				title: t("Context"),
				visible: this.config.visibleColumns.includes("context"),
			},
			{
				id: "recurrence",
				title: t("Recurrence"),
				visible: this.config.visibleColumns.includes("recurrence"),
			},
			{
				id: "filePath",
				title: t("File"),
				visible: this.config.visibleColumns.includes("filePath"),
			},
		];
	}

	/**
	 * Handle date change from date picker
	 */
	private handleDateChange(
		rowId: string,
		columnId: string,
		newDate: string | null
	) {
		const task = this.allTasks.find((t) => t.id === rowId);
		if (!task) return;

		// Update task property based on column
		const updatedTask = { ...task };

		// Define valid date column IDs for type safety
		const dateColumns = [
			"dueDate",
			"startDate",
			"scheduledDate",
			"createdDate",
			"completedDate",
		] as const;

		// Check if the column is a valid date column
		if (!dateColumns.includes(columnId as any)) {
			return;
		}

		if (newDate) {
			// Set the date value
			const dateValue = new Date(newDate).getTime();
			(updatedTask.metadata as any)[columnId] = dateValue;
		} else {
			// Clear the date
			delete (updatedTask.metadata as any)[columnId];
		}

		// Notify task update
		if (this.onTaskUpdated) {
			this.onTaskUpdated(updatedTask);
		}

		// Refresh display
		this.refreshDisplay();
	}

	/**
	 * Handle edit start
	 */
	private handleEditStart(rowId: string, columnId: string) {
		this.editingCell = { rowId, columnId };
	}

	/**
	 * Handle row expansion in tree view
	 */
	private handleRowExpansion(rowId: string) {
		if (this.isTreeView && this.treeManager) {
			const wasToggled = this.treeManager.toggleNodeExpansion(rowId);
			if (wasToggled) {
				this.refreshDisplay();
			}
		}
	}

	/**
	 * Handle cell change from inline editing
	 */
	private async handleCellChange(rowId: string, columnId: string, newValue: any) {
		const taskIndex = this.allTasks.findIndex((t) => t.id === rowId);
		if (taskIndex === -1) {
			return;
		}

		const task = this.allTasks[taskIndex];

		// For status changes, use updateTaskStatus API to properly handle date management
		if (columnId === "status" && this.plugin.writeAPI) {
			const newStatusMark = newValue as string;
			const isCompleted = newStatusMark.toLowerCase() === "x";
			
			// Call updateTaskStatus which handles date management correctly
			const result = await this.plugin.writeAPI.updateTaskStatus({
				taskId: task.id,
				status: newStatusMark,
				completed: isCompleted,
			});

			if (!result.success) {
				console.error("Failed to update task status:", result.error);
			}

			// Re-apply filters and sorting
			this.applyFiltersAndSort();
			this.refreshDisplay();
			return;
		}

		// For other columns, use the standard update flow
		// Update task property directly on the original task object
		this.updateTaskProperty(task, columnId, newValue);

		// Create a copy for the callback to maintain the existing interface
		const updatedTask = { ...task };

		// Notify task update
		if (this.onTaskUpdated) {
			this.onTaskUpdated(updatedTask);
		}

		// Re-apply filters and sorting to ensure correct order after property change
		// This is important for fields that affect sorting (priority, dates, etc.)
		this.applyFiltersAndSort();

		// Refresh display with the newly sorted data
		this.refreshDisplay();
	}
}
