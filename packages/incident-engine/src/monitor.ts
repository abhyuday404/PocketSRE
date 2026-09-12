export type MonitorState = { failures: number; recoveries: number; alertOpen: boolean };
export const initialMonitorState = (): MonitorState => ({
  failures: 0,
  recoveries: 0,
  alertOpen: false,
});
/** Unknown is not proof of outage or recovery. Consecutive observations debounce flapping. */
export function advanceMonitor(
  previous: MonitorState,
  status: 'healthy' | 'down' | 'degraded' | 'unknown',
  threshold = 2,
): { state: MonitorState; event: 'down' | 'recovered' | null } {
  const state = { ...previous };
  state.failures = status === 'down' ? Math.min(threshold, state.failures + 1) : 0;
  state.recoveries = status === 'healthy' ? Math.min(threshold, state.recoveries + 1) : 0;
  if (!state.alertOpen && state.failures >= threshold) {
    state.alertOpen = true;
    return { state, event: 'down' };
  }
  if (state.alertOpen && state.recoveries >= threshold) {
    state.alertOpen = false;
    return { state, event: 'recovered' };
  }
  return { state, event: null };
}
