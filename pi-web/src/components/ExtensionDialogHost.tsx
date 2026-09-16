import { useEffect, useState } from "react";
import { usePiStore } from "../state/store";
import { buttonClass } from "./buttons";
import { Modal } from "./Modal";
import { isPlanReviewRequest, PlanReviewCard } from "./PlanReviewCard";
import { t } from "../i18n";

export function ExtensionDialogHost() {
	const request = usePiStore((state) => state.extensionUiRequests[0]);
	const respond = usePiStore((state) => state.respondExtensionUi);
	const [value, setValue] = useState("");
	const [lastRequest, setLastRequest] = useState(request);

	useEffect(() => {
		if (request) setLastRequest(request);
	}, [request]);

	// Keeps the dialog rendered while it animates out after the request is answered.
	const shown = request ?? lastRequest;

	useEffect(() => {
		setValue(request?.prefill ?? "");
	}, [request?.id, request?.prefill]);

	useEffect(() => {
		if (!request?.timeout) return;
		const timer = setTimeout(() => {
			void respond({ cancelled: true, id: request.id, type: "extension_ui_response" });
		}, request.timeout);
		return () => clearTimeout(timer);
	}, [request?.id, request?.timeout, respond]);

	if (!shown) return null;
	// A request from a background session still has to be answered, so it names the session it
	// came from: without that the dialog looks like it belongs to whatever is on screen.
	const title = shown.sessionLabel
		? t("会话「{sessionLabel}」{arg}", { "sessionLabel": shown.sessionLabel, "arg": shown.title ?? t("需要确认") })
		: (shown.title ?? t("扩展请求"));

	const cancel = () => void respond({ cancelled: true, id: shown.id, type: "extension_ui_response" });
	const submitValue = () => void respond({ id: shown.id, type: "extension_ui_response", value });

	if (isPlanReviewRequest(shown)) {
		return (
			<Modal
				className="w-full max-w-[760px] overflow-hidden rounded-[20px] border border-line bg-surface shadow-lg"
				onClose={cancel}
				open={Boolean(request)}
			>
				<PlanReviewCard
					onAnswer={(option) => void respond({ id: shown.id, type: "extension_ui_response", value: option })}
					request={shown}
				/>
			</Modal>
		);
	}

	return (
		<Modal
			className="w-full max-w-[520px] rounded-xl border border-line bg-surface p-5 shadow-lg"
			onClose={cancel}
			open={Boolean(request)}
		>
			<>
				<div className="text-base font-semibold">{title}</div>
				{shown.message ? <div className="mt-2 text-sm text-ink-muted">{shown.message}</div> : null}

				{shown.method === "input" ? (
					<input
						autoFocus
						className="mt-4 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-accent"
						onChange={(event) => setValue(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") submitValue();
							if (event.key === "Escape") cancel();
						}}
						placeholder={shown.placeholder ?? ""}
						value={value}
					/>
				) : null}

				{shown.method === "editor" ? (
					<textarea
						autoFocus
						className="mt-4 h-40 w-full resize-none rounded-lg border border-line px-3 py-2 font-mono text-sm outline-none focus:border-accent"
						onChange={(event) => setValue(event.target.value)}
						value={value}
					/>
				) : null}

				{shown.method === "select" ? (
					<div className="mt-4 flex flex-col gap-2">
						{(shown.options ?? []).map((option) => (
							<button
								className={`text-left ${buttonClass()}`}
								key={option}
								onClick={() => void respond({ id: shown.id, type: "extension_ui_response", value: option })}
								type="button"
							>
								{option}
							</button>
						))}
					</div>
				) : null}

				{shown.method === "confirm" ? (
					<div className="mt-5 flex justify-end gap-2">
						<button className={buttonClass()} onClick={cancel} type="button">
							{t("取消")}</button>
						<button
							className={buttonClass("primary")}
							onClick={() => void respond({ confirmed: true, id: shown.id, type: "extension_ui_response" })}
							type="button"
						>
							{t("确认")}</button>
					</div>
				) : null}

				{shown.method === "input" || shown.method === "editor" ? (
					<div className="mt-5 flex justify-end gap-2">
						<button className={buttonClass()} onClick={cancel} type="button">
							{t("取消")}</button>
						<button className={buttonClass("primary")} onClick={submitValue} type="button">
							{t("提交")}</button>
					</div>
				) : null}
			</>
		</Modal>
	);
}
