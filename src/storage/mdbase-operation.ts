import type {
  ConnectOutcome,
  MdbaseDiagnostic,
  MdbaseOperationEnvelope,
} from "@mdbase-dev/connect";
import { requireConnectOutcome } from "../cloud/outcome";

export function validResult<Result>(
  envelope: ConnectOutcome<Result> | MdbaseOperationEnvelope<Result>,
): Result {
  if ("ok" in envelope) return requireConnectOutcome(envelope);
  // Test doubles written for the pre-beta.23 describe() shape return the
  // description directly. Keep that narrow compatibility at this boundary.
  if (!("valid" in envelope)) return envelope as unknown as Result;
  if (!envelope.valid)
    throw new Error(
      envelope.diagnostics.map((item) => item.message).join(" ") ||
        "The collection rejected this change.",
    );
  return envelope.result;
}

export function operationDiagnostics<Result>(
  envelope: ConnectOutcome<Result> | MdbaseOperationEnvelope<Result>,
): MdbaseDiagnostic[] {
  if ("ok" in envelope) return envelope.ok ? envelope.diagnostics : [];
  return envelope.diagnostics;
}
