import { useState } from "react";
import { usePiStore } from "../state/store";
import { buttonClass } from "./buttons";
import { Modal } from "./Modal";

export function BashDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
	const abortBash = usePiStore((state) => state.abortBash);
	const bashOutput = usePiStore((state) => state.bashOutput);
	const bashRunning = usePiStore((state) => state.bashRunning);
	const runBash = usePiStore((state) => state.runBash);
	const [command, setCommand] = useState("");
	const [excludeFromContext, setExcludeFromContext] = useState(false);

	return (
		<Modal
			className="flex max-h-[86vh] w-full max-w-[820px] flex-col rounded-xl border border-line bg-surface shadow-lg"
			onClose={onClose}
			open={open}
		>
			<>
				<div className="flex items-center justify-between border-b border-line px-5 py-3">
					<div className="text-base font-semibold">运行 Bash</div>
					<button
						className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-surface-hover"
						onClick={onClose}
						type="button"
					>
						关闭
					</button>
				</div>
				<div className="space-y-3 p-5">
					<textarea
						className="h-24 w-full resize-none rounded-lg border border-line px-3 py-2 font-mono text-sm outline-none focus:border-accent"
						onChange={(event) => setCommand(event.target.value)}
						placeholder="命令"
						value={command}
					/>
					<label className="flex items-center gap-2 text-sm">
						<input
							checked={excludeFromContext}
							onChange={(event) => setExcludeFromContext(event.target.checked)}
							type="checkbox"
						/>
						输出不加入模型上下文
					</label>
					<div className="flex gap-2">
						<button
							className={buttonClass("primary")}
							disabled={!command.trim() || bashRunning}
							onClick={() => void runBash(command, excludeFromContext)}
							type="button"
						>
							{bashRunning ? "运行中..." : "运行"}
						</button>
						<button
							className={buttonClass()}
							disabled={!bashRunning}
							onClick={() => void abortBash()}
							type="button"
						>
							中止
						</button>
					</div>
					<pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-muted p-3 font-mono text-xs">
						{bashOutput ?? ""}
					</pre>
				</div>
			</>
		</Modal>
	);
}
