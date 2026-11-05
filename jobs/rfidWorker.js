"use strict";
const Processor = require("../services/rfidEventProcessor");
// Timers schedule attempts only; PostgreSQL owns claims, leases and recovery.
function startRfidWorker({
  processor = new Processor(),
  pollMilliseconds = 5000,
  log = () => {},
} = {}) {
  const abort = new AbortController();
  let timer, current;
  const tick = () => {
    if (abort.signal.aborted) return;
    current = processor
      .processSystem(50, { signal: abort.signal })
      .catch((error) => {
        log("error", "rfid_worker_retry_pending", {
          code: error.code || "RFID_WORKER_DATABASE_UNAVAILABLE",
        });
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          timer = setTimeout(tick, pollMilliseconds);
          timer.unref?.();
        }
      });
  };
  tick();
  return {
    async stop() {
      abort.abort();
      clearTimeout(timer);
      await current;
    },
  };
}
module.exports = { startRfidWorker };
