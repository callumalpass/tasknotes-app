import {
  parseTaskCapture,
  taskCapturePreview,
  type TaskCaptureResult,
} from "../domain/task-capture";
import { mergeTaskCreationDefaults } from "../domain/view-creation";
import type { CreateTaskInput, Task } from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";

export interface CaptureFollowUp {
  message?: string;
}
export interface CaptureSnapshot {
  text: string;
  parsedText: string;
  result: TaskCaptureResult | null;
  parsing: boolean;
  status: "editing" | "submitting";
  error: string | null;
  pendingTitle: string;
  version: number;
  accepted: { task: Task; version: number; followUp?: string } | null;
}

/** A collection-scoped, in-memory UI draft, not a task replica.
 * Its lifetime is independent of inline/sheet presentations and background refreshes.
 */
export class CaptureSession {
  private state: CaptureSnapshot = {
    text: "",
    parsedText: "",
    result: null,
    parsing: false,
    status: "editing",
    error: null,
    pendingTitle: "",
    version: 0,
    accepted: null,
  };
  private fields: Partial<CreateTaskInput> = {};
  private parseGeneration = 0;
  private readonly listeners = new Set<() => void>();
  private pending: Promise<Task | null> | null = null;
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  editText(text: string) {
    if (this.state.status === "submitting") return;
    this.parseGeneration++;
    if (!text.trim()) this.fields = {};
    this.publish({
      text,
      error: null,
      version: this.state.version + 1,
      parsing: Boolean(text.trim()),
      ...(text.trim() ? {} : { result: null, parsedText: "" }),
    });
  }

  editFields(
    patch: Partial<CreateTaskInput>,
    configuration: TaskCollectionConfiguration,
  ) {
    if (this.state.status === "submitting") return;
    this.fields = { ...this.fields, ...patch };
    const input = {
      ...(this.state.result?.input ?? { title: this.state.text.trim() }),
      ...patch,
    };
    this.publish({
      result: { input, preview: taskCapturePreview(input, configuration) },
      parsedText: this.state.text.trim(),
      version: this.state.version + 1,
    });
  }

  async parse(
    configuration: TaskCollectionConfiguration,
    defaults: Partial<CreateTaskInput>,
  ) {
    const text = this.state.text.trim();
    if (!text || this.state.status === "submitting") return;
    const generation = ++this.parseGeneration;
    const parsed = await this.parseInput(text, configuration, defaults);
    if (
      generation !== this.parseGeneration ||
      text !== this.state.text.trim() ||
      this.state.status !== "editing"
    )
      return;
    // Edits made while the parser was working win over inferred values.
    const input = { ...parsed.input, ...this.fields };
    this.publish({
      result: { input, preview: taskCapturePreview(input, configuration) },
      parsedText: text,
      parsing: false,
    });
  }

  discard() {
    if (this.state.status === "submitting") return false;
    this.parseGeneration++;
    this.fields = {};
    this.publish({
      text: "",
      parsedText: "",
      result: null,
      parsing: false,
      error: null,
      accepted: null,
      version: this.state.version + 1,
    });
    return true;
  }

  submit(options: {
    configuration: TaskCollectionConfiguration;
    defaults: Partial<CreateTaskInput>;
    create(input: CreateTaskInput): Promise<Task>;
    onAccepted?(task: Task, version: number): void;
    refresh?(task: Task): Promise<CaptureFollowUp | void>;
  }): Promise<Task | null> {
    if (this.pending) return this.pending;
    const text = this.state.text.trim();
    if (!text) return Promise.resolve(null);
    const previous = this.state;
    this.parseGeneration++;
    this.publish({ status: "submitting", error: null, parsing: false });
    const run = async () => {
      let created: Task;
      try {
        const result =
          previous.result && previous.parsedText === text
            ? previous.result
            : await this.parseInput(
                text,
                options.configuration,
                options.defaults,
              );
        if (!result.input.title.trim())
          throw new Error("Add a title as well as task details.");
        this.publish({ pendingTitle: result.input.title.trim() });
        created = await options.create(result.input);
      } catch (reason) {
        const detail =
          reason instanceof Error ? reason.message : String(reason);
        const title = this.state.pendingTitle;
        this.publish({
          status: "editing",
          pendingTitle: "",
          error: title ? `Could not add “${title}”. ${detail}` : detail,
        });
        return null;
      }
      this.fields = {};
      const version = this.state.version + 1;
      this.publish({
        status: "editing",
        text: "",
        result: null,
        parsedText: "",
        pendingTitle: "",
        version,
        accepted: { task: created, version },
      });
      // Authority acceptance is final. Refresh failure must never become a failed create.
      // Notify synchronously, before another draft can be entered; refresh cannot close UI.
      try {
        options.onAccepted?.(created, version);
      } catch {
        /* A presentation cannot turn acceptance into failure. */
      }
      if (options.refresh)
        void Promise.resolve()
          .then(() => options.refresh!(created))
          .then(
            (result) => {
              if (result?.message) this.followUp(version, result.message);
            },
            () =>
              this.followUp(
                version,
                "Task created. This view could not refresh, so it may not appear yet.",
              ),
          );
      return created;
    };
    this.pending = run().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  canCloseAccepted(version: number) {
    return (
      this.state.status === "editing" &&
      this.state.version === version &&
      !this.state.text.trim() &&
      !this.state.accepted?.task.operationWarnings?.length
    );
  }

  private followUp(version: number, message: string) {
    if (this.state.accepted?.version !== version) return;
    this.publish({ accepted: { ...this.state.accepted, followUp: message } });
  }
  private async parseInput(
    text: string,
    configuration: TaskCollectionConfiguration,
    defaults: Partial<CreateTaskInput>,
  ): Promise<TaskCaptureResult> {
    let input: CreateTaskInput;
    try {
      input = (await parseTaskCapture(text, configuration)).input;
    } catch {
      input = { title: text };
    }
    input = { ...mergeTaskCreationDefaults(defaults, input), ...this.fields };
    return { input, preview: taskCapturePreview(input, configuration) };
  }
  private publish(patch: Partial<CaptureSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

// Repository instances identify active collections. Switching authority/provider never
// branches UI behavior, and releasing the repository releases its UI sessions too.
const sessions = new WeakMap<object, Map<string, CaptureSession>>();
export function captureSessionFor(
  collection: object,
  surface = "global",
): CaptureSession {
  let registry = sessions.get(collection);
  if (!registry) {
    registry = new Map();
    sessions.set(collection, registry);
  }
  let session = registry.get(surface);
  if (!session) {
    session = new CaptureSession();
    registry.set(surface, session);
  }
  return session;
}
