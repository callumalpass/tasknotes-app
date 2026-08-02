import "fake-indexeddb/auto";

import { MarkdownCollection } from "./collection";
import { TaskIndex } from "./index";
import { IndexedMarkdownRepository } from "./repository";
import { MemoryVault } from "../test/memory-vault";
import { taskRepositoryContract } from "../test/task-repository-contract";

taskRepositoryContract("local Markdown", async () => {
  const index = new TaskIndex(`repository-contract-${crypto.randomUUID()}`);
  return {
    repository: new IndexedMarkdownRepository({
      collection: new MarkdownCollection(new MemoryVault()),
      index,
    }),
    cleanup: async () => {
      index.close();
      await index.delete();
    },
  };
});
