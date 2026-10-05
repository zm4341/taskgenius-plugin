/**
 * A context can be a note, linked after "@": @[[Note]], @[[Note|Alias]].
 * The context keeps the link, so the task line gets it back unchanged.
 */

/** A link at the start of the text, as in "[[Note#Heading|Alias]] rest" */
export const CONTEXT_LINK_START = /^\[\[[^[\]\n]+\]\]/;

/** Whether the context is a link to a note, e.g. "[[Note]]" */
export function isContextLink(context: string): boolean {
	const link = context.match(CONTEXT_LINK_START);
	return link !== null && link[0].length === context.length;
}

/** The note a link context points to, "[[Note|Alias]]" → "Note"; null for other contexts */
export function contextLinkTarget(context: string): string | null {
	if (!isContextLink(context)) return null;
	return context.slice(2, -2).split("|")[0].trim() || null;
}

/** What Obsidian shows for the link: its alias, else the note and heading, "[[Note#Part]]" → "Note > Part" */
export function contextLinkText(context: string): string {
	const [target, alias] = context.slice(2, -2).split("|");
	return alias?.trim() || target.split("#").map((part) => part.trim()).filter(Boolean).join(" > ");
}

/** Page preview source of the links in Task Genius views; previews show on Mod+hover by default */
export const HOVER_LINK_SOURCE = "task-genius";

/** The context as the task line writes it after "@": spaces become "-", except in a link */
export function contextForLine(context: string): string {
	const value = context.trim().replace(/^@+/, "");
	return isContextLink(value) ? value : value.replace(/\s+/g, "-");
}
