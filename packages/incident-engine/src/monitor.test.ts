import { expect, it } from 'vitest';
import { advanceMonitor, initialMonitorState } from './monitor.js';
it('debounces outages and recovery without interpreting unknown as either', () => {
  let state = initialMonitorState();
  for (const status of ['down', 'unknown', 'down'] as const) {
    const next = advanceMonitor(state, status);
    expect(next.event).toBeNull();
    state = next.state;
  }
  const down = advanceMonitor(state, 'down');
  expect(down.event).toBe('down');
  state = down.state;
  expect(advanceMonitor(state, 'down').event).toBeNull();
  state = advanceMonitor(state, 'healthy').state;
  state = advanceMonitor(state, 'unknown').state;
  expect(state.alertOpen).toBe(true);
  state = advanceMonitor(state, 'healthy').state;
  expect(advanceMonitor(state, 'healthy').event).toBe('recovered');
});
