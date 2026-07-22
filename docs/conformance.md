# Conformance

TaskNotes has two contract boundaries and tests each at the layer where it is
implemented.

## TaskNotes

The app claims the TaskNotes `core-lite` profile. Its adapter delegates task
mapping, validation, and mutation semantics to `@tasknotes/model`, then runs the
official fixture corpus from `tasknotes-spec`.

The interface also supports recurring-task completion and reminders. Those are
useful product capabilities, but the application manifest does not claim the
broader TaskNotes recurrence or extended profiles until the shared adapter can
pass each profile as a whole.

## mdbase

The local store is an mdbase v0.3 collection with generated `mdbase.yaml` and a
TaskNotes task type. Verification opens those resources with the real mdbase
TypeScript engine and exercises create, effective read, invalid completion,
valid completion, and validation.

Hosted collections advertise the same `tasknotes.task` contract through the
mdbase sync session. The cloud repository resolves its field mapping, status
vocabulary, type name, and record folder from those resources instead of
assuming one physical schema.

## Commands

```sh
pnpm test:conformance:tasknotes
pnpm test:conformance:mdbase
pnpm test:conformance
```

Native filesystem behavior, notifications, process interruption, and OAuth
callback routing remain separate Android gates because JavaScript fixture
runners cannot establish them.
