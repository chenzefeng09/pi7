import { AlertCircle, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonClass } from "./buttons";
import { Modal } from "./Modal";

/**
 * Confirmation for handing pi the full-permission mode.
 *
 * The gate is a policy layer, not a sandbox (pi has none), so leaving it unenforced is the one
 * choice in this menu that can touch anything the user can. It therefore takes a deliberate
 * acknowledgement on top of the mode itself: the confirm button only opens once the risk box is
 * ticked, and the box resets with every visit rather than remembering consent.
 *
 * Lowering the mode — back to 工作区内修改 or 仅可查看 — asks nothing; restricting is not a risk.
 */
export function PermissionConfirmDialog({
	onCancel,
	onConfirm,
	open,
}: {
	onCancel: () => void;
	onConfirm: () => void;
	open: boolean;
}) {
	const [acknowledged, setAcknowledged] = useState(false);

	useEffect(() => {
		if (!open) setAcknowledged(false);
	}, [open]);

	return (
		<Modal
			className="w-full max-w-[460px] rounded-2xl border border-black/[0.06] bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.2)]"
			onClose={onCancel}
			open={open}
		>
			<>
				<div className="text-[17px] font-semibold tracking-[-0.01em] text-[#111827]">确认启用完全权限？</div>
				<div className="mt-4 flex gap-3">
					<AlertCircle className="mt-0.5 shrink-0 text-[#f04438]" size={20} />
					<div className="text-[13px] leading-5 text-[#475467]">
						启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。
					</div>
				</div>
				<label className="mt-5 flex cursor-pointer items-center gap-2.5 text-[13px] text-[#1f2937]">
					<input
						checked={acknowledged}
						className="peer sr-only"
						onChange={(event) => setAcknowledged(event.target.checked)}
						type="checkbox"
					/>
					<span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border border-black/[0.2] bg-white transition-colors peer-checked:border-[#2f7df6] peer-checked:bg-[#2f7df6] peer-focus-visible:ring-2 peer-focus-visible:ring-[#2f7df6]/40">
						{acknowledged ? <Check className="text-white" size={12} /> : null}
					</span>
					我已了解风险，并愿意继续
				</label>
				<div className="mt-6 flex justify-end gap-2">
					<button className={buttonClass()} onClick={onCancel} type="button">
						取消
					</button>
					<button
						className={buttonClass("primary")}
						disabled={!acknowledged}
						onClick={onConfirm}
						type="button"
					>
						启用完全权限
					</button>
				</div>
			</>
		</Modal>
	);
}
