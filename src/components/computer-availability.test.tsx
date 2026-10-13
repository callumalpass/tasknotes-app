import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MdbaseError } from "@mdbase-dev/sdk";
import { ConnectionNoticeContext, connectionNotice } from "../app/connection-notice";
import { ViewDiscoveryNotice } from "../app/app-shell";
import { toOperationalError } from "../application/operational-error";
import { CollectionAvailability } from "./collection-availability";
import { OperationErrorNotice } from "./operation-error-notice";

const state = vi.hoisted(() => ({ connection: { state: "unavailable" }, refreshing: false, refresh: vi.fn() }));
vi.mock("../app/repository-context", () => ({ useRepository: () => state }));
afterEach(() => { state.connection.state = "unavailable"; vi.clearAllMocks(); });

it("uses only the selected SDK availability fact, not a storage choice or an unrelated collection", () => {
  const snapshot = { phase: { kind: "ready" }, selectedCollectionId: "selected", collections: [
    { collectionId: "selected", availability: { state: "unavailable", reason: "device_offline" } },
  ] };
  expect(connectionNotice(snapshot as never)).toBe("waiting_for_computer");
  snapshot.collections[0]!.availability.reason = "access_removed";
  expect(connectionNotice(snapshot as never)).not.toBe("waiting_for_computer");
  snapshot.collections[0]!.collectionId = "other";
  snapshot.collections[0]!.availability.reason = "device_offline";
  expect(connectionNotice(snapshot as never)).not.toBe("waiting_for_computer");
});

it("shows waiting instead of a stale retry, keeps loaded tasks and clears on reconnection without reload", () => {
  const { rerender } = render(<ConnectionNoticeContext.Provider value="waiting_for_computer"><CollectionAvailability /></ConnectionNoticeContext.Provider>);
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for your computer");
  expect(screen.getByRole("status")).toHaveTextContent("Previously loaded tasks stay here");
  expect(screen.queryByRole("button", { name: "Retry connection" })).toBeNull();
  expect(state.refresh).not.toHaveBeenCalled();
  state.connection.state = "connected";
  rerender(<ConnectionNoticeContext.Provider value={null}><CollectionAvailability /></ConnectionNoticeContext.Provider>);
  expect(screen.queryByRole("status")).toBeNull();
});

it("does not replace an unavailable read with an empty collection or an error/retry block while waiting", () => {
  const retry = vi.fn();
  const { rerender } = render(<ConnectionNoticeContext.Provider value="waiting_for_computer"><ViewDiscoveryNotice outcome="error" refreshing={false} onRetry={retry} onCreate={vi.fn()} /></ConnectionNoticeContext.Provider>);
  expect(screen.queryByText("Couldn't load your views.")).toBeNull();
  expect(screen.queryByText("No views yet.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(retry).not.toHaveBeenCalled();
  rerender(<ConnectionNoticeContext.Provider value={null}><ViewDiscoveryNotice outcome="error" refreshing={false} onRetry={retry} onCreate={vi.fn()} /></ConnectionNoticeContext.Provider>);
  expect(screen.getByText("Couldn't load your views.")).toBeVisible();
});

it("makes unavailability truthful without automatically retrying a write or hiding denied access", () => {
  const unavailable = toOperationalError(new MdbaseError({ code: "unavailable", recovery: "retry", message: "Unavailable" }), "The task");
  const { rerender } = render(<ConnectionNoticeContext.Provider value="waiting_for_computer"><OperationErrorNotice action="The task" message={unavailable} recovery="Go back and refresh the collection." /></ConnectionNoticeContext.Provider>);
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for your computer");
  expect(screen.queryByText(/Go back and refresh/)).toBeNull();
  const denied = toOperationalError(new MdbaseError({ code: "forbidden", recovery: "reauthorize", message: "Access removed" }), "The task");
  rerender(<ConnectionNoticeContext.Provider value="waiting_for_computer"><OperationErrorNotice action="The task" message={denied} recovery="Review access." /></ConnectionNoticeContext.Provider>);
  expect(screen.getByRole("alert")).toHaveTextContent("needs access");
});
