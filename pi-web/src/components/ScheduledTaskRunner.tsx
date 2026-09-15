import { useEffect, useRef } from "react";
import { useScheduledTaskStore, runScheduledTask } from "../state/scheduled-tasks";
import { usePiStore } from "../state/store";

export function ScheduledTaskRunner() {
	const checking = useRef(false);
	const status = usePiStore((state) => state.status);
	const tasks = useScheduledTaskStore((state) => state.tasks);

	useEffect(() => {
		let disposed = false;
		const tick = async () => {
			if (checking.current || disposed || status !== "idle") return;
			const due = tasks.find(
				(task) => task.status === "pending" && new Date(task.scheduledAt).getTime() <= Date.now(),
			);
			if (!due) return;
			checking.current = true;
			try {
				await runScheduledTask(due.id);
			} finally {
				checking.current = false;
			}
		};
		void tick();
		const timer = window.setInterval(() => void tick(), 15000);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, [status, tasks]);

	return null;
}
