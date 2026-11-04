import {
  encode,
  type Connector,
  type FramePort,
  type MdbaseClient,
} from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { attachTaskNotes, taskQueryWhere } from "../src/test/next-task-fixture";

// The SDK's MemoryReplica is the authority stand-in: real client, frames and
// CBOR encoding, but not native Core, its query engine, Noise or a network.
export const STAND_IN =
  "SDK MemoryReplica over the in-process frame port; real SDK client and CBOR frames, no native Core query engine, Noise, relay or network latency";

export interface Work {
  /** Frames and Bases reads the replica answered. */
  requests: number;
  /** Records the SDK client handed the app. */
  records: number;
  /** Encoded bytes received from the replica. */
  responseBytes: number;
  /** Body text bytes the SDK client handed the app. */
  bodyBytes: number;
}

export function emptyWork(): Work {
  return { requests: 0, records: 0, responseBytes: 0, bodyBytes: 0 };
}

export function benchmarkReplica() {
  // Selecting rows here is not a benchmark of a real query engine.
  return new MemoryReplica({ where: taskQueryWhere, confirmDelayMs: 0 });
}

/** Attach TaskNotes to `replica` with every replica response metered. */
export async function meteredTaskNotes(
  replica: MemoryReplica,
  work: () => Work,
) {
  const fixture = await attachTaskNotes(replica, undefined, {
    wrapConnector: (connector) => meteredConnector(connector, work),
  });
  meterRecords(fixture.client, work);
  return fixture;
}

function meteredConnector(inner: Connector, work: () => Work): Connector {
  const received = (bytes: number) => {
    work().requests++;
    work().responseBytes += bytes;
  };
  return {
    description: `metered:${inner.description}`,
    async open(hello, signal) {
      const opened = await inner.open(hello, signal);
      const port = opened.port;
      const early: Parameters<FramePort["send"]>[0][] = [];
      let onframe: FramePort["onframe"] = null;
      const metered: FramePort = {
        send: (frame) => port.send(frame),
        close: () => port.close(),
        onclose: null,
        get onframe() {
          return onframe;
        },
        set onframe(listener) {
          onframe = listener;
          if (listener) early.splice(0).forEach(listener);
        },
      };
      port.onframe = (frame) => {
        received(encode(frame).byteLength);
        if (onframe) onframe(frame);
        else early.push(frame);
      };
      port.onclose = (error) => metered.onclose?.(error);
      if (port.readAppBases)
        metered.readAppBases = async (request, signal) => {
          const response = await port.readAppBases!(request, signal);
          received(response.byteLength);
          return response;
        };
      if (port.readAppBasesDiscovery)
        metered.readAppBasesDiscovery = async (operation, request, signal) => {
          const response = await port.readAppBasesDiscovery!(
            operation,
            request,
            signal,
          );
          received(response.byteLength);
          return response;
        };
      return { ...opened, port: metered };
    },
  };
}

/** Count records and body text at the SDK client's API boundary. */
function meterRecords(client: MdbaseClient, work: () => Work) {
  const seen = (record: { body?: string } | null | undefined) => {
    if (!record) return;
    work().records++;
    work().bodyBytes += Buffer.byteLength(record.body ?? "");
  };
  const pages = client.pages.bind(client);
  client.pages = async function* (...args) {
    for await (const page of pages(...args)) {
      page.records.forEach(seen);
      yield page;
    }
  };
  const get = client.get.bind(client);
  client.get = async (...args) => {
    const record = await get(...args);
    seen(record);
    return record;
  };
  const find = client.find.bind(client);
  client.find = async (...args) => {
    const record = await find(...args);
    seen(record);
    return record;
  };
}
