// Shared menu styling, measured against the Codex menus: ~230px panel, 28px rows,
// 14px labels, 12px shortcuts, translucent blurred surface, full-width separators.
export const MENU_PANEL_CLASS =
	"popup-fade absolute z-50 w-[230px] rounded-xl border border-black/[0.04] bg-white/95 px-1 py-1 shadow-[0_12px_40px_rgba(15,23,42,0.18),0_2px_8px_rgba(15,23,42,0.06)] backdrop-blur-xl";

export const MENU_ITEM_CLASS =
	"flex w-full items-center gap-6 rounded-lg px-2.5 py-1 text-left text-[14px] leading-5 text-[#1f2937] hover:bg-black/[0.05]";

export const MENU_ITEM_DANGER_CLASS =
	"flex w-full items-center gap-6 rounded-lg px-2.5 py-1 text-left text-[14px] leading-5 text-[#b42318] hover:bg-[#b42318]/[0.08]";

export const MENU_LABEL_CLASS = "min-w-0 flex-1 truncate";

export const MENU_SHORTCUT_CLASS = "shrink-0 text-[12px] text-[#4b5563]";

export const MENU_SEPARATOR_CLASS = "mx-1 my-1 h-px bg-black/[0.08]";
