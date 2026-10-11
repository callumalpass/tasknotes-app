import { act, renderHook, waitFor } from "@testing-library/react";
import type {
  CollectionInfo,
  TaskRepository,
} from "../application/ports/task-repository";
import type { TaskView } from "../domain/view";
import { usePlannerViewLink } from "./use-planner-view-link";

const collectionId = "11111111-1111-4111-8111-111111111111";
const info = (id: string, portable = collectionId): CollectionInfo => ({
  kind: "connect",
  id,
  collectionId: portable,
  name: "Tasks",
  location: "Tasks",
  runtime: "browser",
});
function repository(load: () => Promise<CollectionInfo>): TaskRepository {
  return { collectionInfo: load } as TaskRepository;
}
function view(): TaskView {
  return {
    key: "same-view",
    documentId: "document",
    documentName: "Views",
    id: "planner",
    name: "Planner",
    properties: [],
    source: {
      path: "views.base",
      format: "bases",
      revision: "1",
      writable: true,
    },
    presentation: { type: "tasknotes.planner", mappings: {}, options: {} },
  };
}

it("uses the actual portable collection id, not the preference namespace, in a Planner link", async () => {
  const repo = repository(async () => info(`next:account:${collectionId}`));
  const { result } = renderHook(() => usePlannerViewLink(repo, view()));
  await waitFor(() => expect(result.current).toBeDefined());
  expect(new URL(result.current!).searchParams.get("collection")).toBe(
    collectionId,
  );
});

it("never renders the old collection id while metadata for the same view in another repository is pending", async () => {
  const first = repository(async () => info("scope-a"));
  let resolve!: (value: CollectionInfo) => void;
  const second = repository(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const selected = view();
  const { result, rerender } = renderHook(
    ({ repo }) => usePlannerViewLink(repo, selected),
    { initialProps: { repo: first } },
  );
  await waitFor(() => expect(result.current).toContain(collectionId));
  rerender({ repo: second });
  expect(result.current).toBeUndefined();
  await act(async () =>
    resolve(info("scope-b", "22222222-2222-4222-8222-222222222222")),
  );
  expect(new URL(result.current!).searchParams.get("collection")).toBe(
    "22222222-2222-4222-8222-222222222222",
  );
});

it("retains legacy declared collection ids without parsing a namespace", async () => {
  const legacy = info(collectionId);
  delete legacy.collectionId;
  const repo = repository(async () => legacy);
  const { result } = renderHook(() => usePlannerViewLink(repo, view()));
  await waitFor(() => expect(result.current).toBeDefined());
  expect(new URL(result.current!).searchParams.get("collection")).toBe(
    collectionId,
  );
});
