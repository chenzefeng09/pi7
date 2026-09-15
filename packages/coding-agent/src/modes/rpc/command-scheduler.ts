/** Only state replacement/configuration commands hold a session barrier. */
const ORDERED_COMMANDS = new Set([
	"new_session",
	"switch_session",
	"fork",
	"clone",
	"open_session",
	"close_session",
	"set_model",
	"cycle_model",
	"set_thinking_level",
	"cycle_thinking_level",
	"set_steering_mode",
	"set_follow_up_mode",
	"set_auto_compaction",
	"set_auto_retry",
	"set_session_name",
]);
const CONTROL_COMMANDS = new Set(["abort", "abort_bash", "abort_retry"]);

export class RpcCommandScheduler {
	private readonly barriers = new Map<string, Promise<void>>();

	run<T>(scope: string, type: string, action: () => Promise<T>): Promise<T> {
		if (CONTROL_COMMANDS.has(type)) return action();
		const previous = this.barriers.get(scope);
		const result = previous ? previous.then(action) : action();
		if (ORDERED_COMMANDS.has(type)) {
			const barrier = result.then(
				() => {},
				() => {},
			);
			this.barriers.set(scope, barrier);
			void barrier.then(() => {
				if (this.barriers.get(scope) === barrier) this.barriers.delete(scope);
			});
		}
		return result;
	}
}
