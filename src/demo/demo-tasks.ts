import { todayString, type Task } from "../domain/task";
import type { TaskNotesTaskModel } from "../domain/tasknotes-model";

export function demoTasks(model: TaskNotesTaskModel, count: number): Task[] {
  const configuration = model.configuration();
  const activeStatuses = configuration.statuses.filter(
    (status) => !status.isCompleted && !status.isSkipped,
  );
  const completeStatus =
    configuration.statuses.find((status) => status.isCompleted)?.value ??
    "done";
  const priorities = configuration.priorities.map((priority) => priority.value);
  const today = new Date();
  const titles = [
    "Prepare quarterly planning session",
    "Review the mobile navigation notes",
    "Book the project room",
    "Send the research summary to Rowan",
    "Test reminder delivery on Android",
    "Refine the onboarding copy",
    "Collect examples for the design review",
    "Reconcile the travel receipts",
    "Write the release checklist",
    "Confirm next week’s interviews",
    "Update the field guide",
    "Triage follow-up questions",
  ];
  return Array.from({ length: count }, (_, index) => {
    const completed = index % 11 === 8;
    const status =
      activeStatuses[index % Math.max(1, activeStatuses.length)]?.value ??
      configuration.defaults.status;
    const scheduled =
      index % 5 === 4
        ? undefined
        : dateOffset(
            today,
            (index % 13) - 3,
            index % 4 === 0 ? 9 + (index % 7) : undefined,
          );
    const due =
      index % 3 === 0 ? dateOffset(today, (index % 9) - 2) : undefined;
    let task = model.create(
      {
        title: titles[index] ?? `Review demo task ${index + 1}`,
        status,
        priority:
          priorities[index % Math.max(priorities.length, 1)] ??
          configuration.defaults.priority,
        scheduled,
        due,
        body:
          index === 0
            ? "Bring the open questions, last quarter’s decisions, and a short list of outcomes.\n\n## Notes\n\nKeep the session practical and leave ten minutes for owners and dates."
            : index % 6 === 0
              ? "A deliberately concise note that shows how supporting content sits beneath the task fields."
              : "",
        tags:
          index % 4 === 0
            ? ["work", "review"]
            : index % 4 === 1
              ? ["personal"]
              : ["work"],
        contexts:
          index % 3 === 0
            ? ["office"]
            : index % 3 === 1
              ? ["computer"]
              : ["errands"],
        projects:
          index % 5 === 0
            ? ["[[Projects/Product refresh]]"]
            : index % 5 === 1
              ? ["[[Projects/Field research]]"]
              : index % 5 === 2
                ? ["[[Projects/Operations]]"]
                : [],
        recurrence: index === 4 ? "FREQ=WEEKLY;BYDAY=MO,WE,FR" : undefined,
        reminders:
          index === 0
            ? [
                {
                  id: "demo-reminder",
                  type: "relative",
                  relatedTo: "due",
                  offset: "-PT30M",
                },
              ]
            : [],
        timeEstimate: index % 4 === 0 ? 45 + (index % 3) * 15 : undefined,
        sortOrder: String(count - index).padStart(6, "0"),
      },
      {
        id: index === 0 ? "demo-planning-session" : `demo-task-${index + 1}`,
        now: new Date(today.getTime() - index * 3_600_000).toISOString(),
      },
    );
    if (completed) task = model.update(task, { status: completeStatus });
    if (index % 13 === 12) task = model.update(task, { archived: true });
    if (index === 1) {
      task = model.replaceTimeEntries(task, [
        {
          startTime: new Date(today.getTime() - 4_200_000).toISOString(),
          endTime: new Date(today.getTime() - 2_400_000).toISOString(),
          description: "Navigation review",
        },
      ]);
    }
    return task;
  });
}

function dateOffset(date: Date, days: number, hour?: number): string {
  const value = new Date(date);
  value.setHours(hour ?? 12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  const day = todayString(value);
  return hour === undefined
    ? day
    : `${day}T${String(hour).padStart(2, "0")}:00`;
}
