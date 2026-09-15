import { useEffect } from "react";
import { useScheduledTaskStore, runScheduledTask, taskRunsOnVisibleSession } from "../state/scheduled-tasks";
import { usePiStore } from "../state/store";

export function ScheduledTaskRunner() {
	const status = usePiStore((state) => state.status);
	const tasks = useScheduledTaskStore((state) => state.tasks);

	useEffect(() => {
		let disposed = false;
		const tick = () => {
			if (disposed) return;
			const due = tasks.find(
				(task) =>
					task.status === "pending" &&
					new Date(task.scheduledAt).getTime() <= Date.now() &&
					// A task that runs on the visible session must wait for it to go idle; one with a
					// session of its own fires while the user is mid-chat elsewhere.
					(!taskRunsOnVisibleSession(task) || status === "idle"),
			);
			// The run can take minutes and other due tasks have handles of their own, so the
			// scheduler only starts it — per-task re-entry is guarded inside runScheduledTask.
			if (due) void runScheduledTask(due.id);
		};
		tick();
		const timer = window.setInterval(tick, 15000);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, [status, tasks]);

	return null;
}
