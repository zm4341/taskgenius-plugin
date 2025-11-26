/**
 * TaskCalendarAdapter - Adapter for converting Task objects to CalendarEvent format
 *
 * This adapter handles the conversion between Task objects (from TaskGenius)
 * and CalendarEvent objects (expected by @taskgenius/calendar).
 *
 * Multi-day span priority (as per user requirements):
 * 1. startDate → dueDate (highest priority)
 * 2. startDate → scheduledDate
 * 3. scheduledDate → dueDate (lowest priority)
 */

import { Task, StandardTaskMetadata } from "@/types/task";
import { format } from "date-fns";
import { isDateOnly } from "@/utils/date/date-utils";

/**
 * CalendarEvent interface as expected by @taskgenius/calendar
 * Note: 'end' is required by the library, for single-day events it should equal 'start'
 */
export interface CalendarEvent {
	id: string;
	title: string;
	start: string; // ISO 8601 format: 'YYYY-MM-DD HH:mm'
	end: string; // ISO 8601 format: 'YYYY-MM-DD HH:mm' (required, use start for single-day)
	allDay?: boolean;
	color?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Date range for a task
 */
interface TaskDateRange {
	start: number;
	end?: number;
}

/**
 * Convert a Task to a CalendarEvent
 *
 * @param task - The task to convert
 * @returns CalendarEvent object or null if task has no date
 */
export function taskToCalendarEvent(task: Task): CalendarEvent | null {
	const dateRange = calculateTaskDateRange(task);

	if (!dateRange.start) {
		return null; // No date information, skip this task
	}

	const isStartDateOnly = isDateOnly(dateRange.start);
	const isEndDateOnly = !dateRange.end || isDateOnly(dateRange.end);
	const isAllDay = isStartDateOnly && isEndDateOnly;

	const startFormatted = formatDateForCalendar(dateRange.start, isAllDay);
	const endFormatted = dateRange.end
		? formatDateForCalendar(dateRange.end, isAllDay)
		: startFormatted; // For single-day tasks, end = start

	return {
		id: task.id,
		title: task.content,
		start: startFormatted,
		end: endFormatted,
		allDay: isAllDay,
		color: getTaskColor(task),
		metadata: {
			originalTask: task,
			priority: task.metadata.priority,
			tags: task.metadata.tags,
			project: task.metadata.project,
		},
	};
}

/**
 * Convert multiple tasks to calendar events
 * Filters out tasks without dates
 *
 * @param tasks - Array of tasks
 * @returns Array of CalendarEvent objects
 */
export function tasksToCalendarEvents(tasks: Task[]): CalendarEvent[] {
	return tasks
		.map((task) => taskToCalendarEvent(task))
		.filter((event): event is CalendarEvent => event !== null);
}

/**
 * Calculate the date range for a task
 *
 * Priority for multi-day span:
 * 1. startDate → dueDate (highest priority)
 * 2. startDate → scheduledDate
 * 3. scheduledDate → dueDate (lowest priority)
 *
 * For single-day tasks:
 * - Priority: dueDate > scheduledDate > startDate
 *
 * @param task - The task to analyze
 * @returns Object with start and optional end timestamp
 */
function calculateTaskDateRange(task: Task): TaskDateRange {
	const { startDate, dueDate, scheduledDate } = task.metadata;

	// Priority 1: startDate → dueDate (multi-day span)
	if (startDate && dueDate && startDate !== dueDate && startDate < dueDate) {
		return { start: startDate, end: dueDate };
	}

	// Priority 2: startDate → scheduledDate (multi-day span)
	if (
		startDate &&
		scheduledDate &&
		startDate !== scheduledDate &&
		startDate < scheduledDate
	) {
		return { start: startDate, end: scheduledDate };
	}

	// Priority 3: scheduledDate → dueDate (multi-day span)
	if (
		scheduledDate &&
		dueDate &&
		scheduledDate !== dueDate &&
		scheduledDate < dueDate
	) {
		return { start: scheduledDate, end: dueDate };
	}

	// Single-day task: priority dueDate > scheduledDate > startDate
	const singleDate = dueDate || scheduledDate || startDate;

	if (singleDate) {
		return { start: singleDate };
	}

	// No date information
	return { start: 0 };
}

/**
 * Get the display color for a task based on its status and priority
 *
 * @param task - The task
 * @returns CSS color value
 */
function getTaskColor(task: Task): string {
	// Completed tasks use muted color
	if (task.completed) {
		return "var(--text-muted)";
	}

	// Cancelled tasks
	if (task.metadata.cancelledDate) {
		return "var(--text-faint)";
	}

	// Color by priority
	const priority = task.metadata.priority ?? 3; // Default to medium priority

	switch (priority) {
		case 1: // Highest
			return "var(--color-red)";
		case 2: // High
			return "var(--color-orange)";
		case 3: // Medium
			return "var(--color-yellow)";
		case 4: // Low
			return "var(--color-green)";
		case 5: // Lowest
			return "var(--color-blue)";
		default:
			return "var(--interactive-accent)";
	}
}

/**
 * Format a timestamp to ISO 8601 date-time string for calendar
 * Format: 'YYYY-MM-DD HH:mm'
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date string
 */
function formatDateForCalendar(timestamp: number, isAllDay: boolean): string {
	const date = new Date(timestamp);
	if (isAllDay) {
		return format(date, "yyyy-MM-dd");
	}
	return format(date, "yyyy-MM-dd HH:mm");
}

/**
 * Extract the Task object from a CalendarEvent's metadata
 *
 * @param event - The calendar event
 * @returns Original Task object or null
 */
export function getTaskFromEvent(event: CalendarEvent): Task | null {
	return (event.metadata?.originalTask as Task) ?? null;
}

/**
 * Check if a task has any date information
 *
 * @param task - The task to check
 * @returns true if task has at least one date field
 */
export function hasDateInformation(task: Task): boolean {
	const { startDate, dueDate, scheduledDate } = task.metadata;
	return !!(startDate || dueDate || scheduledDate);
}

/**
 * Get the primary date for a task (for sorting purposes)
 * Priority: dueDate > scheduledDate > startDate
 *
 * @param task - The task
 * @returns Primary date timestamp or null
 */
export function getPrimaryDate(task: Task): number | null {
	const { startDate, dueDate, scheduledDate } = task.metadata;
	return dueDate ?? scheduledDate ?? startDate ?? null;
}

/**
 * Check if a task spans multiple days
 *
 * @param task - The task to check
 * @returns true if task has valid start and end dates that differ
 */
export function isMultiDayTask(task: Task): boolean {
	const dateRange = calculateTaskDateRange(task);
	return !!(
		dateRange.start &&
		dateRange.end &&
		dateRange.start !== dateRange.end
	);
}
