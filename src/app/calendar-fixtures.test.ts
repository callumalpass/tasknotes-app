import { describe, expect, it } from "vitest";
import { calendarDateToInstant } from "@tasknotes/model/calendar";
import { calendarFixtures } from "@tasknotes/model/calendar/fixtures";
import { DEFAULT_FIELD_MAPPING } from "@tasknotes/model/defaults";
import { mapTaskToFrontmatter } from "@tasknotes/model/mapping";
import { applyFrontmatterPatch } from "@tasknotes/model/operations";
import { AppCalendarEntryIndex } from "../domain/calendar-events";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import { mdbaseFixture, taskRecord } from "../test/mdbase-fixture";
import { calendarItems } from "./calendar-items";
import type { Task } from "../domain/task";
import type { TaskViewExecution } from "../domain/view";
import type { FieldMapping } from "@tasknotes/model/types";

function execution(tasks: Task[]): TaskViewExecution {
  return {
    view: {
      key: "calendar",
      documentId: "calendar",
      documentName: "Calendar",
      id: "calendar",
      name: "Calendar",
      properties: [],
      source: {
        path: "calendar.base",
        format: "obsidian.base",
        revision: "1",
        writable: true,
      },
    },
    rows: tasks.map((task) => ({ task, values: {} })),
    groups: [],
    totalCount: tasks.length,
    hasMore: false,
  };
}

function mappedField(field: string, mapping: FieldMapping): string {
  const role = Object.entries(DEFAULT_FIELD_MAPPING).find(
    ([, value]) => value === field,
  )?.[0] as keyof FieldMapping | undefined;
  return role ? mapping[role] : field;
}

describe("shared calendar contract through app mapping and exact repository persistence", () => {
  for (const fixture of calendarFixtures) {
    it(fixture.name, async () => {
      // The repository's real type mapping differs from the fixture's plugin mapping.
      const empty = new MdbaseTaskRepository(mdbaseFixture([]).connect);
      await empty.initialize();
      const configuration = await empty.taskConfiguration();
      for (const info of fixture.input.tasks) {
        if (
          !configuration.statuses.some((status) => status.value === info.status)
        )
          configuration.statuses.push({
            ...configuration.statuses[0],
            id: info.status,
            value: info.status,
            label: info.status,
            isCompleted:
              fixture.input.settings?.completedStatuses?.includes(
                info.status,
              ) ?? false,
          });
      }
      const model = new TaskNotesTaskModel(configuration);
      const records = fixture.input.tasks.map((info) => {
        const record = taskRecord(info.id || info.path, info.title, "r1");
        record.path = info.path;
        record.frontmatter = {
          ...mapTaskToFrontmatter(
            configuration.fieldMapping,
            info,
            configuration.defaults.taskTag,
            false,
            [],
          ),
          id: info.id || info.path,
          [configuration.fieldMapping.dateCreated]: fixture.input.now,
          [configuration.fieldMapping.dateModified]: fixture.input.now,
          ...(configuration.statuses.some(
            (status) => status.value === info.status && status.isCompleted,
          ) && !info.recurrence
            ? {
                [configuration.fieldMapping.completedDate]:
                  fixture.input.now.slice(0, 10),
              }
            : {}),
        };
        return record;
      });
      const tasks = records.map((record) => model.read(record));
      const view = execution(tasks);
      const index = new AppCalendarEntryIndex(configuration, fixture.input);
      const grouped = index.entries(
        view,
        fixture.input.range,
        tasks,
        fixture.input,
      );
      const { items } = calendarItems(grouped, view, "title", configuration);
      // Ordering/grouping is host presentation, not entry identity.
      expect(
        items
          .map((item) => item.data!.metadata.entry.modelEntry)
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(
        [...fixture.expectedEntries].sort((a, b) => a.id.localeCompare(b.id)),
      );
      for (const expected of fixture.expectedEntries) {
        expect(items.find((item) => item.id === expected.id)).toMatchObject({
          title: expected.title,
          start: expected.start,
          end: expected.end ?? null,
          allDay: expected.allDay,
          kind: expected.type,
          editable: expected.startEditable,
          startEditable: expected.startEditable,
          durationEditable: expected.durationEditable,
          completed: expected.isCompleted,
          ...(expected.type === "timeEntry" ? { lane: "actual" } : {}),
        });
      }
      for (const edit of fixture.edits) {
        // Independent gestures against the same original snapshot.
        const fresh = new MdbaseTaskRepository(
          mdbaseFixture(structuredClone(records)).connect,
        );
        await fresh.initialize();
        const item = items.find((candidate) => candidate.id === edit.entryId)!;
        const neutral = item.data!.metadata.entry.modelEntry;
        const before = (await fresh.get(neutral.taskId))!;
        const after = await fresh.editCalendar(neutral.taskId, {
          entry: neutral,
          change: edit.change,
          timezone: fixture.input.timezone,
          now: fixture.input.now,
        });
        const patch = edit.expectedFrontmatterPatch.map((operation) => ({
          ...operation,
          field: mappedField(operation.field, configuration.fieldMapping),
        }));
        // The contract states times on the fixture's wall clock; the app
        // stores the same moments as instants.
        const moment = (value: unknown) =>
          typeof value === "string" && value.includes("T")
            ? calendarDateToInstant(value, fixture.input.timezone)
            : value;
        const dateFields = [
          configuration.fieldMapping.scheduled,
          configuration.fieldMapping.due,
        ];
        const expected = applyFrontmatterPatch(before.frontmatter, patch);
        for (const operation of patch)
          if (dateFields.includes(operation.field))
            expect(
              moment(after.frontmatter[operation.field]),
              operation.field,
            ).toEqual(moment(expected[operation.field]));
          else
            expect(after.frontmatter[operation.field], operation.field).toEqual(
              expected[operation.field],
            );
        const planned = { ...model.taskInfo(before), ...edit.expectedUpdates };
        const actual = model.taskInfo(after);
        expect({
          ...actual,
          scheduled: moment(actual.scheduled),
          due: moment(actual.due),
          complete_instances: actual.complete_instances ?? [],
          skipped_instances: actual.skipped_instances ?? [],
        }).toMatchObject({
          ...planned,
          scheduled: moment(planned.scheduled),
          due: moment(planned.due),
          complete_instances: planned.complete_instances ?? [],
          skipped_instances: planned.skipped_instances ?? [],
        });
        expect(after.revision).toBe(before.revision + 1);
        expect(after.body).toBe(before.body);
        expect((await fresh.list({ status: "all" })).length).toBe(tasks.length);
      }
    });
  }
});
