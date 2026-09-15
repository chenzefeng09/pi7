import { Puzzle, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { usePiStore } from "../state/store";
import { buttonClass } from "./buttons";
import { SETTINGS_INPUT_CLASS, SettingsRow, SettingsSelect } from "./SettingsControls";

/** A source string as pi reports it; a bare string is the common shape. */
function sourceText(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "object" && value !== null && "source" in value) {
		const source = (value as { source?: unknown }).source;
		if (typeof source === "string") return source;
	}
	return JSON.stringify(value);
}

/** Section heading inside a settings page; a peer of the rows, not a wrapper around them. */
function GroupHeading({ children }: { children: string }) {
	return <div className="pb-2 pt-5 text-[13px] font-medium text-[#1f2937]">{children}</div>;
}

/**
 * Plugin packages, as a settings page: where a pi extension is installed from, and what is
 * installed in each scope.
 *
 * Installing, removing and updating all restart the runtime afterwards, because a package only
 * exists once pi starts with it — the restart is what makes its commands and extensions appear.
 */
export function PluginsSection() {
	const installPackage = usePiStore((state) => state.installPackage);
	const loadPackages = usePiStore((state) => state.loadPackages);
	const packages = usePiStore((state) => state.packages);
	const reconnect = usePiStore((state) => state.reconnect);
	const removePackage = usePiStore((state) => state.removePackage);
	const updatePackages = usePiStore((state) => state.updatePackages);
	const [source, setSource] = useState("");
	const [local, setLocal] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const installed = new Set([...packages.global, ...packages.project].map(sourceText));

	useEffect(() => {
		void loadPackages();
	}, [loadPackages]);

	const run = async (action: () => Promise<string>, status: string) => {
		setBusy(true);
		setMessage(status);
		try {
			// A failed install rejects with its own stderr; success only prints a tree of paths, so
			// what is worth saying is that pi restarted with the package loaded.
			await action();
			await reconnect();
			setMessage("已完成，运行时已重启");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col">
			<GroupHeading>Goal 插件包</GroupHeading>
			<div className="rounded-xl border-[0.5px] border-black/[0.08] px-5">
				<SettingsRow
					description="为 pi 提供目标跟踪和任务完成能力，来自 npm:pi-goal-x。两个 Goal 插件包都注册 /goal，一次只能安装一个。"
					title="目标跟踪（pi-goal-x）"
				>
					<PluginInstallButton
						busy={busy}
						installed={installed.has("npm:pi-goal-x")}
						onClick={() => void run(() => installPackage("npm:pi-goal-x", local), "正在安装 pi-goal-x…")}
					/>
				</SettingsRow>
				<SettingsRow
					description="Narumitw 提供的 Goal 扩展，来自 npm:@narumitw/pi-goal。"
					title="目标跟踪（@narumitw/pi-goal）"
				>
					<PluginInstallButton
						busy={busy}
						installed={installed.has("npm:@narumitw/pi-goal")}
						onClick={() =>
							void run(() => installPackage("npm:@narumitw/pi-goal", local), "正在安装 @narumitw/pi-goal…")
						}
					/>
				</SettingsRow>
			</div>

			<GroupHeading>安装</GroupHeading>
			<div className="flex flex-col gap-2">
				<div className="flex gap-2">
					<input
						className={`${SETTINGS_INPUT_CLASS} min-w-0 flex-1 font-mono`}
						onChange={(event) => setSource(event.target.value)}
						placeholder="npm:@scope/pkg、git:github.com/user/repo、./local/path"
						value={source}
					/>
					<button
						className={buttonClass("primary", "sm")}
						disabled={busy || !source.trim()}
						onClick={() => void run(() => installPackage(source.trim(), local), "正在安装…")}
						type="button"
					>
						安装
					</button>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-[12px] text-[#98a2b3]">作用域</span>
					<SettingsSelect
						align="start"
						minWidth={96}
						onChange={(value) => setLocal(value === "project")}
						options={[
							{ label: "全局", value: "global" },
							{ label: "当前项目", value: "project" },
						]}
						title="选择安装作用域"
						value={local ? "project" : "global"}
					/>
					<span className="text-[11px] text-[#98a2b3]">项目作用域写入该项目的 .pi/settings.json</span>
				</div>
			</div>
			{message ? <div className="pt-2 text-[11px] text-[#667085]">{message}</div> : null}

			<GroupHeading>已安装</GroupHeading>
			<div className="rounded-xl border-[0.5px] border-black/[0.08] px-5">
				{packages.global.map((item, index) => (
					<SettingsRow
						description="对本机所有项目生效"
						key={`global-${sourceText(item)}-${index}`}
						title={<span className="font-mono text-[13px]">{sourceText(item)}</span>}
					>
						<PluginRemoveButton
							busy={busy}
							label={sourceText(item)}
							onClick={() => void run(() => removePackage(sourceText(item), false), "正在移除…")}
						/>
					</SettingsRow>
				))}
				{packages.project.map((item, index) => (
					<SettingsRow
						description="只对当前项目生效"
						key={`project-${sourceText(item)}-${index}`}
						title={<span className="font-mono text-[13px]">{sourceText(item)}</span>}
					>
						<PluginRemoveButton
							busy={busy}
							label={sourceText(item)}
							onClick={() => void run(() => removePackage(sourceText(item), true), "正在移除…")}
						/>
					</SettingsRow>
				))}
				{packages.global.length === 0 && packages.project.length === 0 ? (
					<SettingsRow
						description="从上面的「安装」加一个插件包，或装一个 Goal 插件包"
						title="没有已安装的插件包"
					/>
				) : null}
				<SettingsRow description="按 pi 的版本重新解析每个已安装插件包" title="更新已安装插件包">
					<button
						className={buttonClass("secondary", "sm")}
						disabled={busy}
						onClick={() => void run(() => updatePackages(), "正在更新…")}
						type="button"
					>
						<RotateCw size={12} />
						更新
					</button>
				</SettingsRow>
			</div>
			<div className="flex items-center gap-1 pt-2 text-[11px] text-[#98a2b3]">
				<Puzzle size={12} />
				插件包会在 pi 进程里执行本地代码，安装前请确认来源。
			</div>
		</div>
	);
}

function PluginInstallButton({
	busy,
	installed,
	onClick,
}: {
	busy: boolean;
	installed: boolean;
	onClick: () => void;
}) {
	return (
		<button
			className={buttonClass("secondary", "sm")}
			disabled={busy || installed}
			onClick={onClick}
			type="button"
		>
			{installed ? "已安装" : "安装"}
		</button>
	);
}

function PluginRemoveButton({ busy, label, onClick }: { busy: boolean; label: string; onClick: () => void }) {
	return (
		<button
			className={buttonClass("secondary", "sm")}
			disabled={busy}
			onClick={onClick}
			title={`移除 ${label}`}
			type="button"
		>
			<Trash2 size={12} />
			移除
		</button>
	);
}
