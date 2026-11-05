/** Missing definitions must not select a default schema or render task views. */
export class TaskNotesModelRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskNotesModelRequiredError";
  }
}
