import { useEffect, useRef } from "react";
import { AboutDialog } from "./components/AboutDialog";
import { Composer } from "./components/Composer";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { ExtensionDialogHost } from "./components/ExtensionDialogHost";
import { FilePanel } from "./components/FilePanel";
import { ModelChangeBanner } from "./components/ModelChangeBanner";
import { ModelSetupBanner } from "./components/ModelSetupBanner";
import { Notifications } from "./components/Notifications";
import { ScheduledTaskRunner } from "./components/ScheduledTaskRunner";
import { ScheduleView } from "./components/ScheduleView";
import { SessionToolsDialog } from "./components/SessionToolsDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { TopBar } from "./components/TopBar";
import { Transcript } from "./components/Transcript";
import { WidgetStrip } from "./components/WidgetStrip";
import { EventBatcher } from "./state/event-batcher";
import { useCompactionSettings } from "./state/compaction";
import { usePiStore } from "./state/store";
import { useUiStore } from "./state/ui";
import { t } from "./i18n";

export function App() {
	const applyEvent = usePiStore((state) => state.applyEvent);
	const initialize = usePiStore((state) => state.initialize);
	const newSession = usePiStore((state) => state.newSession);
	const setAutoCompaction = usePiStore((state) => state.setAutoCompaction);
	const setStderr = usePiStore((state) => state.setStderr);
	const compact = usePiStore((state) => state.compact);
	const compactionStatus = usePiStore((state) => state.compactionStatus);
	const contextPercent = usePiStore((state) => state.sessionStats?.contextUsage?.percent ?? undefined);
	const messageCount = usePiStore((state) => state.messageCount);
	const status = usePiStore((state) => state.status);
	const autoCompact = useCompactionSettings((state) => state.autoCompact);
	const threshold = useCompactionSettings((state) => state.threshold);
	const aboutOpen = useUiStore((state) => state.aboutOpen);
	const setAboutOpen = useUiStore((state) => state.setAboutOpen);
	const filePanelOpen = useUiStore((state) => state.filePanelOpen);
	const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
	const settingsOpen = useUiStore((state) => state.settingsOpen);
	const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
	const sessionPanel = useUiStore((state) => state.sessionPanel);
	const setSessionPanel = useUiStore((state) => state.setSessionPanel);
	const view = useUiStore((state) => state.view);

	// pi only exposes an on/off compaction switch, so the threshold lives in the UI: watch the
	// context percentage pi reports and trigger compaction ourselves.
	const compactedAt = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (!autoCompact || status !== "idle" || compactionStatus === "running") return;
		if (typeof contextPercent !== "number") return;
		if (contextPercent < threshold * 100) return;
		if (compactedAt.current === messageCount) return;
		compactedAt.current = messageCount;
		void compact();
	}, [autoCompact, compact, compactionStatus, contextPercent, messageCount, status, threshold]);

	// Auto compaction on by default, unless the user turned it off in settings.
	useEffect(() => {
		void setAutoCompaction(autoCompact).catch(() => {});
	}, [autoCompact, setAutoCompaction]);

	useEffect(() => {
		const batcher = new EventBatcher({
			flush: (events) => {
				for (const event of events) applyEvent(event);
			},
		});
		const offEvent = window.pi.onEvent((event) => {
			const record = event as { type?: string } | null;
			const eventSessionId = record && typeof (record as { sessionId?: unknown }).sessionId === "string"
				? (record as { sessionId: string }).sessionId
				: undefined;
			if (record?.type === "message_update") {
				batcher.push(event);
			} else {
				batcher.flushNow();
				applyEvent(event);
			}
			// A session created and used in this run is written to disk asynchronously, so the
			// sidebar list can be missing it until it is re-read once the turn settles.
			if (record?.type === "agent_settled") {
				const current = usePiStore.getState();
				const isVisible = !current.multiSession || !eventSessionId || eventSessionId === current.activeHandleId;
				if (!isVisible) return;
				void current.syncSessionList();
				// Token totals, cache reuse and the context readout only move when a turn ends,
				// and the prompt of that turn only becomes forkable then as well.
				void current.loadSessionStats().catch(() => {});
				void current.loadForkMessages().catch(() => {});
			}
		});
		const offStderr = window.pi.onStderr(setStderr);
		const offMenu = window.pi.onMenuCommand((command) => {
			if (command === "new-session") {
				useUiStore.getState().setView("chat");
				void newSession();
			}
		});
		const offError = window.pi.onError((message) =>
			usePiStore.setState({ error: message, status: "error" }),
		);
		const offExit = window.pi.onExit((info) => {
			// Restarting pi on purpose (session switch, workspace change, reconnect) stops the old
			// process with SIGTERM. That is not a failure: the composer shows a spinner instead of
			// a red disconnect banner, so only a process that died on its own reports an error.
			const record = info as { stopped?: boolean } | null;
			if (record?.stopped) return;
			// Every handle lived in that process, so no event will ever reach these maps again.
			usePiStore.setState({
				activeHandleId: undefined,
				backgroundSessions: {},
				connectionError: t("pi RPC 进程已退出{detail}。请重新连接以继续。", {
					detail: info ? t("（{info}）", { info: JSON.stringify(info) }) : "",
				}),
				extensionUiRequests: [],
				extensionUiStatuses: {},
				extensionUiWidgets: {},
				handles: {},
				status: "error",
			});
		});
		void initialize().catch((error) => {
			usePiStore.setState({
				connectionError: error instanceof Error ? error.message : String(error),
				status: "error",
			});
		});
		return () => {
			batcher.dispose();
			offEvent();
			offStderr();
			offError();
			offExit();
			offMenu();
		};
	}, [applyEvent, initialize, newSession, setStderr]);

	return (
		<div className="flex h-screen w-screen flex-col overflow-hidden bg-[image:var(--pi-app-gradient)] text-ink">
			<TitleBar />
			<div className="flex min-h-0 flex-1 p-2.5 pt-0">
				{sidebarCollapsed ? null : <Sidebar />}
				<main
					className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-black/[0.06] bg-white shadow-[0_2px_12px_rgba(31,41,55,0.05)] ${
						sidebarCollapsed ? "" : "ml-2.5"
					}`}
				>
					<ConnectionBanner />
					{view === "schedule" ? (
						<ScheduleView />
					) : (
						<>
							<TopBar />
							<ModelChangeBanner />
							<ModelSetupBanner />
							<div className="relative flex min-h-0 flex-1 flex-col">
								<Transcript />
								<div className="pointer-events-none absolute bottom-0 left-0 right-2">
									<div className="h-8 bg-gradient-to-t from-white to-transparent" />
									<div className="pointer-events-auto bg-white">
										<WidgetStrip placement="aboveEditor" />
										<Composer />
										<WidgetStrip placement="belowEditor" />
									</div>
								</div>
							</div>
						</>
					)}
				</main>
				{filePanelOpen ? <FilePanel /> : null}
			</div>
			<ExtensionDialogHost />
			<Notifications />
			<ScheduledTaskRunner />
			{/* Owned here, not by the top bar: the sidebar footer opens the same dialog, and the top
			    bar is hidden entirely while the session is still new. */}
			<SessionToolsDialog
				mode={sessionPanel}
				onClose={() => setSessionPanel(null)}
				open={sessionPanel !== null}
			/>
			<SettingsDialog onClose={() => setSettingsOpen(false)} open={settingsOpen} />
			<AboutDialog onClose={() => setAboutOpen(false)} open={aboutOpen} />
		</div>
	);
}
