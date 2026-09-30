/**
 * Chinese date words in captured text land on the right day.
 *
 * Regression: "后天" fell through to a fallback that read its 天 as Sunday,
 * and in "明天 15:00 开会" the default parser took the bare time as today and
 * left 明天 in the text.
 */

import {
	TimeParsingService,
	DEFAULT_TIME_PARSING_CONFIG,
} from "@/services/time-parsing-service";

// Thursday 2026-10-01, 10:00
const NOW = new Date(2026, 9, 1, 10, 0, 0);

/** Text left after the date words, and each date as month-day */
function parse(line: string) {
	const service = new TimeParsingService(DEFAULT_TIME_PARSING_CONFIG);
	const result = service.parseTimeExpressionsForLine(line);
	const day = (date?: Date) =>
		date ? `${date.getMonth() + 1}-${date.getDate()}` : undefined;
	return {
		text: result.cleanedLine,
		due: day(result.dueDate),
		start: day(result.startDate),
		scheduled: day(result.scheduledDate),
		dueHour: result.dueDate?.getHours(),
	};
}

beforeEach(() => {
	jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
	jest.useRealTimers();
});

describe("Chinese date words", () => {
	it("read 后天 and 大后天 as two and three days on", () => {
		expect(parse("后天 复盘")).toMatchObject({ text: "复盘", due: "10-3" });
		expect(parse("大后天 复盘")).toMatchObject({ text: "复盘", due: "10-4" });
	});

	it("keep the day when a time follows it", () => {
		expect(parse("明天 15:00 开会")).toMatchObject({
			text: "开会",
			due: "10-2",
			dueHour: 15,
		});
	});

	it("still read weekdays, relative days and plain dates", () => {
		expect(parse("下周三 交报告").due).toBe("10-7");
		expect(parse("周五 交稿").due).toBe("10-2");
		expect(parse("3天后 复查").due).toBe("10-4");
		expect(parse("10月5日 提交方案").due).toBe("10-5");
		expect(parse("下个月 续费").due).toBe("11-1");
	});

	it("follow the date keywords", () => {
		expect(parse("从明天开始跑步").start).toBe("10-2");
		expect(parse("安排在后天 复盘").scheduled).toBe("10-3");
	});

	it("leave English text to the default parser", () => {
		expect(parse("call Bob tomorrow")).toMatchObject({
			text: "call Bob",
			due: "10-2",
		});
	});
});
