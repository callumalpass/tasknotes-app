import { t } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import { Link2 } from "lucide-react";
import { useId } from "react";

import { linkTarget } from "../domain/completion";
import { DurationField } from "./duration-field";
import { MultiValueField } from "./multi-value-field";
import { TaskNotesSelectField } from "./tasknotes-controls";

import type {
  FieldCompletionRequest,
  FieldCompletion,
} from "../domain/completion";
import type { TaskDependency, TaskDependencyRelType } from "../domain/task";
import type { TaskRelationships } from "../domain/task-relationships";

const RELATIONSHIP_TYPES: Array<{
  value: TaskDependencyRelType;
  label: string;
}> = [
  {
    value: "FINISHTOSTART",
    get label() {
      return t({ message: "Finish to start" });
    },
  },
  {
    value: "STARTTOSTART",
    get label() {
      return t({ message: "Start to start" });
    },
  },
  {
    value: "FINISHTOFINISH",
    get label() {
      return t({ message: "Finish to finish" });
    },
  },
  {
    value: "STARTTOFINISH",
    get label() {
      return t({ message: "Start to finish" });
    },
  },
];

export function DependencyEditor({
  field,
  dependencies,
  labels,
  completeField,
  onChange,
}: {
  field: string;
  dependencies: TaskDependency[];
  labels?: ReadonlyMap<string, string>;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  onChange(dependencies: TaskDependency[]): void;
}) {
  const { t } = useLingui();
  const headingId = useId();
  const byUid = new Map(
    dependencies.map((dependency) => [dependency.uid, dependency]),
  );

  function changeUids(uids: string[]) {
    onChange(
      uids.map(
        (uid) =>
          byUid.get(uid) ?? {
            uid,
            reltype: "FINISHTOSTART",
          },
      ),
    );
  }

  function change(index: number, patch: Partial<TaskDependency>) {
    onChange(
      dependencies.map((dependency, candidate) =>
        candidate === index ? { ...dependency, ...patch } : dependency,
      ),
    );
  }

  return (
    <section className="dependency-editor" aria-labelledby={headingId}>
      <div className="dependency-editor-heading">
        <div>
          <h2 id={headingId}>
            <Trans>Dependencies</Trans>
          </h2>
          <p>
            <Trans>Add work that must happen before this task.</Trans>
          </p>
        </div>
      </div>
      <MultiValueField
        completion={{ kind: "records", targetTypes: ["task"] }}
        field={field}
        label={t({ message: "Blocked by" })}
        placeholder={t({ message: "Find a task" })}
        values={dependencies.map((dependency) => dependency.uid)}
        valueLabel={(uid) => dependencyLabel(uid, labels)}
        completeField={completeField}
        onChange={changeUids}
      />
      {dependencies.length ? (
        <div className="dependency-rules">
          {dependencies.map((dependency, index) => (
            <div className="dependency-rule" key={dependency.uid}>
              <div className="dependency-rule-title">
                <Link2 aria-hidden="true" size={15} />
                <strong>{dependencyLabel(dependency.uid, labels)}</strong>
              </div>
              <div className="field-grid metadata-fields">
                <TaskNotesSelectField
                  label={t({ message: "Relationship" })}
                  options={RELATIONSHIP_TYPES}
                  value={dependency.reltype}
                  onChange={(reltype) =>
                    change(index, {
                      reltype: reltype as TaskDependencyRelType,
                    })
                  }
                />
                <DurationField
                  label={t({ message: "Gap" })}
                  optional
                  value={dependency.gap ?? ""}
                  onChange={(gap) => change(index, { gap: gap || undefined })}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function RelatedWork({
  relationships,
}: {
  relationships: TaskRelationships;
}) {
  const { t } = useLingui();
  const groups = [
    {
      label: t({ message: "Blocking" }),
      tasks: relationships.blocking,
    },
    {
      label: t({ message: "Subtasks" }),
      tasks: relationships.subtasks,
    },
  ];

  if (!groups.some((group) => group.tasks.length)) return null;
  return (
    <section className="related-work" aria-labelledby="related-work-title">
      <h2 id="related-work-title">
        <Trans>Related work</Trans>
      </h2>
      <div className="related-work-groups">
        {groups.map((group) =>
          group.tasks.length ? (
            <div className="related-work-group" key={group.label}>
              <span>{group.label}</span>
              <ul>
                {group.tasks.map((task) => (
                  <li key={task.id}>
                    <span>{task.title}</span>
                    <small>
                      {task.completed
                        ? t({
                            message: "Complete",
                            context: "related task completion state",
                          })
                        : task.status}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </section>
  );
}

function dependencyLabel(
  uid: string,
  labels?: ReadonlyMap<string, string>,
): string {
  const label = labels?.get(uid);
  if (label) return label;
  const target = linkTarget(uid);
  return target.split("/").at(-1) || uid;
}
