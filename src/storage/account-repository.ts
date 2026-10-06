import type {
  ConnectRequestOptions,
  MdbaseConnection,
} from "@mdbase-dev/connect";
import {
  accountBackend,
  type AccountBackendInfo,
} from "@mdbase-dev/connect/control";
import type { TaskRepository } from "../application/ports/task-repository";

/** Dormant pre-data opening seam. Each factory owns the new repository instance;
 * aborting an opening disposes it, rather than installing it into another scope.
 * The caller obtains bare retained consent without application.start/select.
 */
export async function openConsentingAccountRepository(
  connection: MdbaseConnection,
  factories: {
    legacy(
      account: AccountBackendInfo,
    ): TaskRepository | Promise<TaskRepository>;
    next(account: AccountBackendInfo): Promise<TaskRepository>;
  },
  options: ConnectRequestOptions = {},
): Promise<TaskRepository> {
  options.signal?.throwIfAborted();
  const account = await accountBackend(connection, options);
  options.signal?.throwIfAborted();
  const repository = await openAccountRepository(account.backend, {
    legacy: () => factories.legacy(account),
    next: () => factories.next(account),
  });
  if (options.signal?.aborted) {
    repository.dispose?.();
    options.signal.throwIfAborted();
  }
  return repository;
}

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
