// Shared data feeds. Several widgets show the same readings (CPU, memory,
// network, battery…); each feed is fetched once on the shared scheduler and
// fanned out to every subscriber, instead of every widget polling its own
// copy over IPC.
import { poll } from "./poll.js";

const api = window.edex;

function feed(fetcher, intervalMs, opts = {}) {
  const subs = new Set();
  let last;
  let has = false;
  let poller = null;
  const run = async () => {
    const value = await fetcher();
    last = value;
    has = true;
    for (const fn of subs) {
      try { fn(value); } catch (e) { console.error("feed subscriber failed", e); }
    }
  };
  const subscribe = (fn) => {
    subs.add(fn);
    if (has) { try { fn(last); } catch (_) {} }
    if (!poller) poller = poll(run, intervalMs, opts);
    return () => {
      subs.delete(fn);
      if (!subs.size && poller) { poller.stop(); poller = null; }
    };
  };
  subscribe.refresh = () => poller?.kick();
  subscribe.latest = () => (has ? last : undefined);
  return subscribe;
}

// CPU, memory, network, disk and GPU in one round trip.
export const onLive = feed(() => api.sys.live(), 1500);
export const onBattery = feed(() => api.sys.battery(), 30000);
export const onProcesses = feed(() => api.sys.processes(), 4000);
export const onDrives = feed(() => api.sys.drives(), 30000);

let staticInfo = null;
export function getStatic() {
  staticInfo ||= api.sys.static().catch(() => ({}));
  return staticInfo;
}
