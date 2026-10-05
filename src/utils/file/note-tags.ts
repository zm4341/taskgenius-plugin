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
