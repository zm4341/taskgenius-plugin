/**
 * Tags in a note's `tags` property. Every task of the note inherits them
 * (see Augmentor), so a task can lose one only if the note does.
 */

/** A tag's name: without "#" and surrounding spaces */
export function tagName(tag: string): string {
	return tag.trim().replace(/^#/, "");
}

/** Tag names of the note: a list, or a string of comma or space separated tags */
export function noteTagsOf(
	frontmatter: Record<string, unknown> | null | undefined,
): string[] {
	const value = frontmatter?.tags;
	const raw = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(/[,\s]+/)
			: [];
	return raw
		.filter((tag) => typeof tag === "string" || typeof tag === "number")
		.map((tag) => tagName(String(tag)))
		.filter((tag) => tag.length > 0);
}

/** What separates tags typed as a list: commas and semicolons (also full-width), "、", spaces, "#" */
const TAG_SEPARATORS = /[,，、;；\s#]+/;

/** Tag names in what the user typed, each once: "a，b #c" → ["a", "b", "c"] */
export function parseTagNames(text: string): string[] {
	return mergeTagNames(text.split(TAG_SEPARATORS));
}

/** The tag being typed at the end of the list, without "#": "a, #te" → "te" */
export function currentTagOf(text: string): string {
	return text.split(TAG_SEPARATORS).pop() ?? "";
}

/**
 * Whether a task line can hold the tag: the task parser ends a tag at
 * spaces and at ASCII or full-width punctuation other than "/", "-" and "_"
 */
export function isTaskTag(name: string): boolean {
	return /^(?:[\w/-]|[^\x00-\x7F，。；：！？、「」『』（）【】“”‘’])+$/u.test(name);
}

/** Tag names of all the lists, each once; tags ignore case, so the first spelling stays */
export function mergeTagNames(...lists: string[][]): string[] {
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const tag of lists.flat().map(tagName)) {
		const key = tag.toLowerCase();
		if (tag === "" || seen.has(key)) continue;
		seen.add(key);
		merged.push(tag);
	}
	return merged;
}

/** Drops these tags from the note's tags property; an emptied one stays as `tags:` */
export function removeNoteTags(
	frontmatter: Record<string, unknown>,
	tags: string[],
): void {
	const drop = new Set(tags.map(tagName));
	const value = frontmatter.tags;
	if (!Array.isArray(value) && typeof value !== "string") return;
	const kept = (Array.isArray(value) ? value : value.split(/[,\s]+/)).filter(
		(tag) =>
			(typeof tag === "string" || typeof tag === "number") &&
			tagName(String(tag)) !== "" &&
			!drop.has(tagName(String(tag))),
	);
	frontmatter.tags = kept.length > 0 ? kept : null;
}
