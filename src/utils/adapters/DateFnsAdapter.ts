/**
 * DateFnsAdapter - Adapter for @taskgenius/calendar using date-fns
 *
 * This adapter bridges date-fns with @taskgenius/calendar's DateAdapter interface,
 * allowing the calendar to use date-fns for all date operations.
 */

import {
	parse,
	format,
	startOfDay,
	startOfWeek,
	startOfMonth,
	startOfYear,
	endOfDay,
	endOfWeek,
	endOfMonth,
	endOfYear,
	addDays,
	addWeeks,
	addMonths,
	addYears,
	subDays,
	subWeeks,
	subMonths,
	subYears,
	differenceInDays,
	differenceInWeeks,
	differenceInMonths,
	differenceInYears,
	isSameDay,
	isSameWeek,
	isSameMonth,
	isSameYear,
	isBefore,
	isAfter,
	getDay,
	getDaysInMonth,
	isValid,
	parseISO,
} from "date-fns";

/**
 * Time unit types supported by the adapter
 */
type TimeUnit = "day" | "week" | "month" | "year" | "hour" | "minute";

/**
 * DateAdapter interface that must be implemented
 * This is the contract expected by @taskgenius/calendar
 */
interface DateAdapter<T> {
	create(date?: string | Date | T): T;
	parse(dateStr: string, format?: string): T;
	format(date: T, format: string): string;
	startOf(date: T, unit: TimeUnit): T;
	endOf(date: T, unit: TimeUnit): T;
	add(date: T, amount: number, unit: TimeUnit): T;
	subtract(date: T, amount: number, unit: TimeUnit): T;
	diff(date1: T, date2: T, unit: TimeUnit): number;
	isSame(date1: T, date2: T, unit?: TimeUnit): boolean;
	isBefore(date: T, compare: T): boolean;
	isAfter(date: T, compare: T): boolean;
	getDay(date: T): number;
	getDaysInMonth(date: T): number;
}

/**
 * DateFnsAdapter implementation using date-fns library
 */
export class DateFnsAdapter implements DateAdapter<Date> {
	/**
	 * Create a Date object from various input types
	 */
	create(date?: string | Date): Date {
		if (!date) {
			return new Date();
		}
		if (date instanceof Date) {
			return new Date(date);
		}
		if (typeof date === "string") {
			// Try to parse ISO format first
			const parsed = parseISO(date);
			if (isValid(parsed)) {
				return parsed;
			}
			// Fallback to native Date constructor
			return new Date(date);
		}
		return new Date();
	}

	/**
	 * Parse a date string with optional format
	 */
	parse(dateStr: string, formatStr?: string): Date {
		if (!formatStr) {
			// Default to ISO format
			const parsed = parseISO(dateStr);
			if (isValid(parsed)) {
				return parsed;
			}
			return new Date(dateStr);
		}

		// Use date-fns parse with format
		const parsed = parse(dateStr, formatStr, new Date());
		if (!isValid(parsed)) {
			throw new Error(`Invalid date string: ${dateStr}`);
		}
		return parsed;
	}

	/**
	 * Format a date to string
	 */
	format(date: Date, formatStr: string): string {
		return format(date, formatStr);
	}

	/**
	 * Get the start of a time unit
	 */
	startOf(date: Date, unit: TimeUnit): Date {
		switch (unit) {
			case "day":
				return startOfDay(date);
			case "week":
				return startOfWeek(date);
			case "month":
				return startOfMonth(date);
			case "year":
				return startOfYear(date);
			case "hour":
				// date-fns doesn't have startOfHour, so we set minutes and seconds to 0
				const hourStart = new Date(date);
				hourStart.setMinutes(0, 0, 0);
				return hourStart;
			case "minute":
				// Set seconds and milliseconds to 0
				const minuteStart = new Date(date);
				minuteStart.setSeconds(0, 0);
				return minuteStart;
			default:
				return startOfDay(date);
		}
	}

	/**
	 * Get the end of a time unit
	 */
	endOf(date: Date, unit: TimeUnit): Date {
		switch (unit) {
			case "day":
				return endOfDay(date);
			case "week":
				return endOfWeek(date);
			case "month":
				return endOfMonth(date);
			case "year":
				return endOfYear(date);
			case "hour":
				// Set to last millisecond of the hour
				const hourEnd = new Date(date);
				hourEnd.setMinutes(59, 59, 999);
				return hourEnd;
			case "minute":
				// Set to last millisecond of the minute
				const minuteEnd = new Date(date);
				minuteEnd.setSeconds(59, 999);
				return minuteEnd;
			default:
				return endOfDay(date);
		}
	}

	/**
	 * Add time to a date
	 */
	add(date: Date, amount: number, unit: TimeUnit): Date {
		switch (unit) {
			case "day":
				return addDays(date, amount);
			case "week":
				return addWeeks(date, amount);
			case "month":
				return addMonths(date, amount);
			case "year":
				return addYears(date, amount);
			case "hour":
				return new Date(date.getTime() + amount * 60 * 60 * 1000);
			case "minute":
				return new Date(date.getTime() + amount * 60 * 1000);
			default:
				return addDays(date, amount);
		}
	}

	/**
	 * Subtract time from a date
	 */
	subtract(date: Date, amount: number, unit: TimeUnit): Date {
		switch (unit) {
			case "day":
				return subDays(date, amount);
			case "week":
				return subWeeks(date, amount);
			case "month":
				return subMonths(date, amount);
			case "year":
				return subYears(date, amount);
			case "hour":
				return new Date(date.getTime() - amount * 60 * 60 * 1000);
			case "minute":
				return new Date(date.getTime() - amount * 60 * 1000);
			default:
				return subDays(date, amount);
		}
	}

	/**
	 * Calculate difference between two dates
	 */
	diff(date1: Date, date2: Date, unit: TimeUnit): number {
		switch (unit) {
			case "day":
				return differenceInDays(date1, date2);
			case "week":
				return differenceInWeeks(date1, date2);
			case "month":
				return differenceInMonths(date1, date2);
			case "year":
				return differenceInYears(date1, date2);
			case "hour":
				return Math.floor((date1.getTime() - date2.getTime()) / (60 * 60 * 1000));
			case "minute":
				return Math.floor((date1.getTime() - date2.getTime()) / (60 * 1000));
			default:
				return differenceInDays(date1, date2);
		}
	}

	/**
	 * Check if two dates are the same
	 */
	isSame(date1: Date, date2: Date, unit?: TimeUnit): boolean {
		if (!unit) {
			return date1.getTime() === date2.getTime();
		}

		switch (unit) {
			case "day":
				return isSameDay(date1, date2);
			case "week":
				return isSameWeek(date1, date2);
			case "month":
				return isSameMonth(date1, date2);
			case "year":
				return isSameYear(date1, date2);
			case "hour":
				return (
					isSameDay(date1, date2) &&
					date1.getHours() === date2.getHours()
				);
			case "minute":
				return (
					isSameDay(date1, date2) &&
					date1.getHours() === date2.getHours() &&
					date1.getMinutes() === date2.getMinutes()
				);
			default:
				return isSameDay(date1, date2);
		}
	}

	/**
	 * Check if date is before compare date
	 */
	isBefore(date: Date, compare: Date): boolean {
		return isBefore(date, compare);
	}

	/**
	 * Check if date is after compare date
	 */
	isAfter(date: Date, compare: Date): boolean {
		return isAfter(date, compare);
	}

	/**
	 * Get day of week (0 = Sunday, 6 = Saturday)
	 */
	getDay(date: Date): number {
		return getDay(date);
	}

	/**
	 * Get number of days in the month
	 */
	getDaysInMonth(date: Date): number {
		return getDaysInMonth(date);
	}
}

/**
 * Export a singleton instance for convenience
 */
export const dateFnsAdapter = new DateFnsAdapter();
