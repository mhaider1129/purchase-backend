"use strict";
const identity = require("../domain/rfidObservationIdentity");
const Processor = require("../services/rfidEventProcessor");
test("stable observation identity requires reader and timestamp context beyond EPC", () => {
  const read = {
    reader_id: 1,
    epc: "TEST-EPC",
    read_timestamp: "2026-11-05T00:00:00.000Z",
    source_type: "FIXED",
  };
  expect(identity(read)).toBe(
    identity({ ...read, reader_id: "1", raw_payload: { transportRetry: 4 } }),
  );
  for (const update of [
    { reader_id: 2 },
    { antenna_id: 1 },
    { read_timestamp: "2026-11-05T00:00:01Z" },
    { rssi: -45 },
  ])
    expect(identity({ ...read, ...update })).not.toBe(identity(read));
});
test("manual processing cannot invoke global system authority or omit context", async () => {
  const repo = { transaction: jest.fn() };
  const processor = new Processor(repo);
  await expect(processor.process(10)).rejects.toMatchObject({
    code: "RFID_PROCESSING_FORBIDDEN",
  });
  await expect(processor.process(10, { system: true })).rejects.toMatchObject({
    code: "RFID_PROCESSING_FORBIDDEN",
  });
  expect(repo.transaction).not.toHaveBeenCalled();
});
test("stale claim cannot reach the business aggregation method", async () => {
  const read = {
    processing_status: "PROCESSING",
    processing_lease_token: "new-token",
    processing_worker_id: "new-worker",
  };
  const query = jest.fn().mockResolvedValue({ rows: [read] }),
    processor = new Processor({});
  processor.applyObservation = jest.fn();
  await expect(
    processor.processOne(
      { query },
      1,
      { token: "old-token", workerId: "old-worker" },
      { system: true },
    ),
  ).resolves.toBe(false);
  expect(processor.applyObservation).not.toHaveBeenCalled();
  expect(
    query.mock.calls.some(([sql]) => /^\s*(UPDATE|INSERT)\b/.test(sql)),
  ).toBe(false);
});
test("a cancelled worker does not start another claim", async () => {
  const processor = new Processor({});
  processor.claim = jest.fn();
  const controller = new AbortController();
  controller.abort();
  await expect(
    processor.processSystem(50, { signal: controller.signal }),
  ).resolves.toEqual({ selected: 0, processed: 0, failed: 0, terminal: 0 });
  expect(processor.claim).not.toHaveBeenCalled();
});
