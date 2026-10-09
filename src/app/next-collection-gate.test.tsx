import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { TaskRepository } from "../application/ports/task-repository";
import { NextCollectionGate } from "./next-collection-gate";
const fixture = vi.hoisted(() => ({
  load: vi.fn(),
  opened: vi.fn(),
  mounted: vi.fn(),
  closed: vi.fn(),
  repository: {} as TaskRepository,
  receive: null as null | ((repository: TaskRepository) => Promise<void>),
}));
vi.mock("../cloud/next-native-build", () => ({
  loadNativeBuild: fixture.load,
}));
vi.mock("./next-installation-screen", () => ({
  NextInstallationScreen: ({
    onCollection,
  }: {
    onCollection(repository: TaskRepository): Promise<void>;
  }) => {
    fixture.receive = onCollection;
    useEffect(() => {
      fixture.mounted();
      return () => {
        fixture.closed();
      };
    }, []);
    return (
      <button onClick={() => void onCollection(fixture.repository)}>
        Open held test repository
      </button>
    );
  },
}));
vi.mock("./opened-collection", () => ({
  OpenedCollection: (props: {
    repository: TaskRepository;
    changeCollection(): void;
    discardPendingRecovery(): Promise<void>;
  }) => {
    fixture.opened(props);
    return (
      <button onClick={props.changeCollection}>
        Change held test repository
      </button>
    );
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  fixture.load.mockResolvedValue({ environment: "lab" });
  fixture.repository = {} as TaskRepository;
});
describe("native entry lifetime handoff (component stand-ins)", () => {
  it("fails closed without a bundle and never mounts installation or legacy authority", async () => {
    fixture.load.mockRejectedValueOnce(Error("unconfigured"));
    render(<NextCollectionGate />);
    await screen.findByRole("alert");
    expect(fixture.mounted).not.toHaveBeenCalled();
    expect(fixture.opened).not.toHaveBeenCalled();
  });
  it("refuses a distinct repository from the same owner and late delivery from a replaced owner", async () => {
    render(<NextCollectionGate />);
    await screen.findByRole("button", { name: "Open held test repository" });
    const originalReceive = fixture.receive!,
      original = fixture.repository;
    fireEvent.click(
      screen.getByRole("button", { name: "Open held test repository" }),
    );
    await screen.findByRole("button", { name: "Change held test repository" });
    expect(fixture.receive).toBe(originalReceive);
    await expect(originalReceive({} as TaskRepository)).rejects.toThrow(
      "owner must be replaced",
    );
    expect(fixture.opened.mock.calls.at(-1)![0].repository).toBe(original);
    expect(fixture.closed).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Change held test repository" }),
    );
    await waitFor(() => expect(fixture.closed).toHaveBeenCalledOnce());
    await expect(originalReceive(original)).rejects.toThrow(
      "owner must be replaced",
    );
    expect(
      screen.queryByRole("button", { name: "Change held test repository" }),
    ).not.toBeInTheDocument();
  });
  it("passes the exact original repository while keeping its installation owner mounted", async () => {
    render(<NextCollectionGate />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open held test repository" }),
    );
    await screen.findByRole("button", { name: "Change held test repository" });
    expect(fixture.opened.mock.calls.at(-1)![0].repository).toBe(
      fixture.repository,
    );
    expect(fixture.mounted).toHaveBeenCalledOnce();
    expect(fixture.closed).not.toHaveBeenCalled();
    const original = fixture.opened.mock.calls.at(-1)![0];
    await expect(original.discardPendingRecovery()).rejects.toThrow(
      "cannot be discarded",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Change held test repository" }),
    );
    await waitFor(() => expect(fixture.closed).toHaveBeenCalledOnce());
    expect(fixture.mounted).toHaveBeenCalledTimes(2);
    fixture.repository = {} as TaskRepository;
    fireEvent.click(
      screen.getByRole("button", { name: "Open held test repository" }),
    );
    await screen.findByRole("button", { name: "Change held test repository" });
    const replacement = fixture.opened.mock.calls.at(-1)![0];
    expect(replacement.repository).toBe(fixture.repository);
    expect(replacement.changeCollection).toBe(original.changeCollection);
    expect(replacement.discardPendingRecovery).toBe(
      original.discardPendingRecovery,
    );
  });
});
