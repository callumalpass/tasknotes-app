import { z } from "zod";

export const dueSchema = z.object({
  date: z.string(),
  timezone: z.string().nullable().optional(),
  string: z.string().optional(),
  lang: z.string().optional(),
  is_recurring: z.boolean().optional(),
});
export const taskSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  description: z.string().default(""),
  project_id: z.string(),
  section_id: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  labels: z.array(z.string()).default([]),
  priority: z.number().int().min(1).max(4),
  due: dueSchema.nullable().optional(),
  deadline: z.object({ date: z.string() }).nullable().optional(),
  duration: z
    .object({
      amount: z.number().nonnegative(),
      unit: z.enum(["minute", "day"]),
    })
    .nullable()
    .optional(),
  added_at: z.string().optional(),
  completed_at: z.string().nullable().optional(),
  checked: z.boolean().optional(),
  is_completed: z.boolean().optional(),
});
const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  parent_id: z.string().nullable().optional(),
});
const sectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  project_id: z.string(),
});
export type TodoistTask = z.infer<typeof taskSchema>;
export type TodoistProject = z.infer<typeof projectSchema>;
export interface SourceData {
  userId: string;
  tasks: TodoistTask[];
  projects: TodoistProject[];
  sections: z.infer<typeof sectionSchema>[];
}

export class TodoistApi {
  constructor(
    private token: string,
    private request: typeof fetch = (...args) => fetch(...args),
  ) {}
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.request(
      `https://api.todoist.com/api/v1/${path}`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
        signal,
        credentials: "omit",
        cache: "no-store",
      },
    );
    if (response.status === 401)
      throw new Error("Your Todoist session expired. Connect Todoist again.");
    if (response.status === 429)
      throw new Error(
        `Todoist is rate limiting requests. Try again after ${response.headers.get("Retry-After") || "a short wait"} seconds.`,
      );
    if (!response.ok)
      throw new Error(
        `Todoist request failed (${response.status}). No destination tasks have been changed.`,
      );
    return response.json();
  }
  private async pages<T>(
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const result: T[] = [],
      seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ limit: "200" });
      if (cursor) params.set("cursor", cursor);
      const page = z
        .object({
          results: z.array(schema),
          next_cursor: z.string().nullable().optional(),
        })
        .parse(await this.get(`${path}?${params}`, signal));
      result.push(...page.results);
      cursor = page.next_cursor ?? null;
      if (cursor && seen.has(cursor))
        throw new Error(
          "Todoist returned a repeated pagination cursor. Import stopped.",
        );
      if (cursor) seen.add(cursor);
    } while (cursor);
    return result;
  }
  async load(signal?: AbortSignal): Promise<SourceData> {
    const user = z
      .object({ id: z.string().min(1) })
      .parse(await this.get("user", signal));
    const [tasks, projects, sections] = await Promise.all([
      this.pages("tasks", taskSchema, signal),
      this.pages("projects", projectSchema, signal),
      this.pages("sections", sectionSchema, signal),
    ]);
    if (new Set(tasks.map((t) => t.id)).size !== tasks.length)
      throw new Error(
        "Todoist returned duplicate task IDs. Please reload before importing.",
      );
    return { userId: user.id, tasks, projects, sections };
  }
}
