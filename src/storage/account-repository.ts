import type { TaskRepository } from "../application/ports/task-repository";

/** Only the authenticated account discriminator selects a backend.
 * Unknown/missing values and a failed selected backend never open the other one.
 */
export async function openAccountRepository(
  backend: unknown,
  factories: {
    legacy(): TaskRepository | Promise<TaskRepository>;
    next(): Promise<TaskRepository>;
  },
): Promise<TaskRepository> {
  switch (backend) {
    case "legacy":
      return factories.legacy();
    case "next":
      return factories.next();
    default:
      throw new Error(
        "Mdbase returned an unsupported account backend. Update TaskNotes before opening this account.",
      );
  }
}
