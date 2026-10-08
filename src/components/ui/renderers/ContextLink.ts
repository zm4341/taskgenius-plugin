import { App, getLinkpath, HoverParent, Keymap } from "obsidian";
import {
	contextLinkTarget,
	contextLinkText,
	HOVER_LINK_SOURCE,
} from "@/utils/task/context-link";

/**
 * A note as the context, @[[Note]], shown the way Obsidian shows a link:
 * clicking it opens the note, and Mod+hover previews it
 */
export function createContextLink(
	app: App,
	containerEl: HTMLElement,
	context: string,
	sourcePath: string,
	hoverParent: HoverParent,
): HTMLAnchorElement {
	const { metadataCache, workspace } = app;
	const target = contextLinkTarget(context)!;
	const link = containerEl.createEl("a", {
		cls: "internal-link",
		text: contextLinkText(context),
		attr: { href: target, "data-href": target },
	});
	if (!metadataCache.getFirstLinkpathDest(getLinkpath(target), sourcePath)) {
		link.addClass("is-unresolved");
	}
	link.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		void workspace.openLinkText(target, sourcePath, Keymap.isModEvent(e));
	});
	link.addEventListener("mouseover", (e) => {
		workspace.trigger("hover-link", {
			event: e,
			source: HOVER_LINK_SOURCE,
			hoverParent,
			targetEl: link,
			linktext: target,
			sourcePath,
		});
	});
	return link;
}
