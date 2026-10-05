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

/** Tag names in what the user typed: separated by commas or spaces, "#" optional */
export function parseTagNames(text: string): string[] {
	return noteTagsOf({ tags: text });
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
