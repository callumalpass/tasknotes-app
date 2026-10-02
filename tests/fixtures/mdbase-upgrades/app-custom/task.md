---
kind: mdbase.type
name: task
version: 4
description: A task managed by TaskNotes.
match:
  where:
    tags:
      contains: task
schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: true
    properties:
      id:
        anyOf:
          - type:
              - string
              - number
              - boolean
            minLength: 1
          - type: "null"
      summary:
        type:
          - string
          - number
          - boolean
        minLength: 1
      state:
        enum: &a1
          - none
          - todo
          - in-progress
          - shipped
          - cancelled
        default: todo
      urgency:
        anyOf:
          - enum: &a3
              - none
              - low
              - normal
              - high
            default: normal
          - type: "null"
      deadline:
        anyOf:
          - anyOf:
              - type: string
                format: date
              - type: string
                pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$
          - type: "null"
      start_on:
        anyOf:
          - anyOf:
              - type: string
                format: date
              - type: string
                pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$
          - type: "null"
      locations:
        anyOf:
          - type: array
            items:
              anyOf:
                - type:
                    - string
                    - number
                    - boolean
                - type: "null"
          - type: "null"
      initiatives:
        anyOf:
          - type: array
            items:
              anyOf:
                - type:
                    - string
                    - number
                    - boolean
                - type: "null"
          - type: "null"
      assignees:
        type: array
        items:
          type: string
          minLength: 1
          pattern: \S
        uniqueItems: true
      attachments:
        anyOf:
          - type: array
            items:
              anyOf:
                - type:
                    - string
                    - number
                    - boolean
                  minLength: 1
                - type: "null"
            uniqueItems: true
          - type: "null"
      estimate_mins:
        anyOf:
          - anyOf:
              - type: integer
              - type: number
                multipleOf: 1
              - type: string
                pattern: ^-?(?:0|[1-9][0-9]*)(?:\.0+)?$
            minimum: 0
          - type: "null"
      finished_on:
        anyOf:
          - type: string
            format: date
          - type: "null"
      created_at:
        type: string
        pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$
      updated_at:
        anyOf:
          - type: string
            pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$
          - type: "null"
      repeat_rule:
        anyOf:
          - type:
              - string
              - number
              - boolean
          - type: "null"
      recurrence_anchor:
        anyOf:
          - enum:
              - scheduled
              - completion
            default: scheduled
          - type: "null"
      occurrence_materialization:
        anyOf:
          - enum:
              - manual
              - on_completion
              - rolling
            default: manual
          - type: "null"
      occurrence_next_trigger:
        anyOf:
          - enum:
              - completion
              - completion_or_skip
            default: completion
          - type: "null"
      occurrence_template:
        anyOf:
          - type:
              - string
              - number
              - boolean
          - type: "null"
      occurrence_past_horizon:
        anyOf:
          - type:
              - string
              - number
              - boolean
          - type: "null"
      occurrence_future_horizon:
        anyOf:
          - type:
              - string
              - number
              - boolean
          - type: "null"
      recurrence_parent:
        anyOf:
          - type:
              - string
              - number
              - boolean
          - type: "null"
      occurrence_date:
        anyOf:
          - type: string
            format: date
          - type: "null"
      tags:
        anyOf:
          - type: array
            items:
              anyOf:
                - type:
                    - string
                    - number
                    - boolean
                - type: "null"
          - type: "null"
      work_log:
        anyOf:
          - type: array
            items:
              anyOf:
                - type: object
                  additionalProperties: true
                  properties:
                    startTime:
                      anyOf:
                        - type: string
                          pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$
                        - type: "null"
                    endTime:
                      anyOf:
                        - type: string
                          pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$
                        - type: "null"
                    description:
                      anyOf:
                        - type:
                            - string
                            - number
                            - boolean
                        - type: "null"
                    duration:
                      anyOf:
                        - anyOf:
                            - type: integer
                            - type: number
                              multipleOf: 1
                            - type: string
                              pattern: ^-?(?:0|[1-9][0-9]*)(?:\.0+)?$
                        - type: "null"
                - type: "null"
          - type: "null"
      alerts:
        anyOf:
          - type: array
            items:
              anyOf:
                - type: object
                  additionalProperties: true
                  properties:
                    id:
                      type:
                        - string
                        - number
                        - boolean
                    type:
                      anyOf:
                        - enum:
                            - absolute
                            - relative
                        - type: "null"
                    description:
                      anyOf:
                        - type:
                            - string
                            - number
                            - boolean
                        - type: "null"
                    relatedTo:
                      anyOf:
                        - enum:
                            - due
                            - scheduled
                        - type: "null"
                    offset:
                      anyOf:
                        - type:
                            - string
                            - number
                            - boolean
                        - type: "null"
                    absoluteTime:
                      anyOf:
                        - type: string
                          pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$
                        - type: "null"
                  required:
                    - id
                - type: "null"
          - type: "null"
      blockedBy:
        anyOf:
          - type: array
            items:
              anyOf:
                - type: object
                  additionalProperties: true
                  properties:
                    uid:
                      type:
                        - string
                        - number
                        - boolean
                    reltype:
                      anyOf:
                        - type:
                            - string
                            - number
                            - boolean
                        - type: "null"
                    gap:
                      anyOf:
                        - type:
                            - string
                            - number
                            - boolean
                        - type: "null"
                  required:
                    - uid
                - type: "null"
          - type: "null"
      complete_instances:
        anyOf:
          - type: array
            items:
              anyOf:
                - type: string
                  format: date
                - type: "null"
          - type: "null"
      skipped_instances:
        anyOf:
          - type: array
            items:
              anyOf:
                - type: string
                  format: date
                - type: "null"
          - type: "null"
      icsEventId:
        anyOf:
          - type: array
            items:
              anyOf:
                - type:
                    - string
                    - number
                    - boolean
                - type: "null"
          - type: "null"
      googleCalendarEventId:
        anyOf:
          - type:
              - string
              - number
              - boolean
          - type: "null"
      googleCalendarExceptionEventId:
        anyOf:
          - type:
              - string
              - number
              - boolean
          - type: "null"
      googleCalendarExceptionOriginalScheduled:
        anyOf:
          - type: string
            format: date
          - type: "null"
      googleCalendarMovedOriginalDates:
        anyOf:
          - type: array
            items:
              anyOf:
                - type: string
                  format: date
                - type: "null"
          - type: "null"
      tasknotes_manual_order:
        anyOf:
          - type:
              - string
              - number
              - boolean
          - type: "null"
      effort:
        anyOf:
          - anyOf:
              - type: number
              - type: string
                pattern: ^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$
          - type: "null"
    allOf:
      - if:
          required:
            - state
          properties:
            state:
              enum: &a2
                - shipped
          not:
            required:
              - repeat_rule
        then:
          required:
            - finished_on
    required:
      - state
      - created_at
collection:
  read_defaults:
    state: todo
    urgency: normal
    recurrence_anchor: scheduled
    occurrence_materialization: manual
    occurrence_next_trigger: completion
  links:
    initiatives[]:
      target_type: any
      validate_exists: false
    assignees[]:
      validate_exists: false
    attachments[]:
      validate_exists: false
    occurrence_template:
      target_type: any
      validate_exists: false
    recurrence_parent:
      target_type: task
      validate_exists: false
    blockedBy[].uid:
      target_type: task
      validate_exists: false
  path:
    runtime: tasknotes
    template: "{{title}}"
    folder: TaskNotes/Tasks
    generated_by: tasknotes.filename.create
  display:
    name_field: summary
  unique:
    - field: id
      scope: type
lifecycle:
  on_create:
    set:
      id:
        uuid: true
      created_at:
        now: true
      updated_at:
        now: true
  on_update:
    set:
      updated_at:
        now: true
implements:
  - contract: tasknotes.task
    version: 0.3.0-rc.5
    fields:
      id: id
      title: summary
      status: state
      priority: urgency
      due: deadline
      scheduled: start_on
      contexts: locations
      projects: initiatives
      assignees: assignees
      attachments: attachments
      timeEstimate: estimate_mins
      completedDate: finished_on
      dateCreated: created_at
      dateModified: updated_at
      recurrence: repeat_rule
      recurrenceAnchor: recurrence_anchor
      occurrenceMaterialization: occurrence_materialization
      occurrenceNextTrigger: occurrence_next_trigger
      occurrenceTemplate: occurrence_template
      occurrencePastHorizon: occurrence_past_horizon
      occurrenceFutureHorizon: occurrence_future_horizon
      recurrenceParent: recurrence_parent
      occurrenceDate: occurrence_date
      tags: tags
      timeEntries: work_log
      reminders: alerts
      blockedBy: blockedBy
      completeInstances: complete_instances
      skippedInstances: skipped_instances
      icsEventId: icsEventId
      googleCalendarEventId: googleCalendarEventId
      googleCalendarExceptionEventId: googleCalendarExceptionEventId
      googleCalendarExceptionOriginalScheduled: googleCalendarExceptionOriginalScheduled
      googleCalendarMovedOriginalDates: googleCalendarMovedOriginalDates
      sortOrder: tasknotes_manual_order
    binding:
      profiles:
        - core-lite
        - recurrence
        - templating
        - materialized-occurrences
        - extended
      capabilities:
        - dependencies
        - reminders
        - attachments
        - links
        - time-tracking
        - materialized-occurrences
        - archive
        - templating
      title:
        storage: filename
        filename_format: title
      status:
        values: *a1
        default: todo
        completed_values: *a2
        skipped_values:
          - cancelled
        default_skipped: cancelled
        definitions:
          - value: none
            label: None
            color: "#cccccc"
            is_completed: false
            is_skipped: false
            exclude_from_cycle: false
            order: 0
            auto_archive: false
            auto_archive_delay_minutes: 5
          - value: todo
            label: To do
            color: "#808080"
            is_completed: false
            is_skipped: false
            exclude_from_cycle: false
            order: 1
            auto_archive: false
            auto_archive_delay_minutes: 5
          - value: in-progress
            label: In progress
            color: "#0066cc"
            is_completed: false
            is_skipped: false
            exclude_from_cycle: false
            order: 2
            auto_archive: false
            auto_archive_delay_minutes: 5
          - value: shipped
            label: Shipped
            color: "#00aa00"
            is_completed: true
            is_skipped: false
            exclude_from_cycle: false
            order: 3
            auto_archive: false
            auto_archive_delay_minutes: 5
          - value: cancelled
            label: Cancelled
            color: "#888888"
            is_completed: false
            is_skipped: true
            exclude_from_cycle: true
            order: 4
            auto_archive: false
            auto_archive_delay_minutes: 5
      priority:
        values: *a3
        default: normal
        definitions:
          - value: none
            label: None
            color: "#cccccc"
            weight: 0
          - value: low
            label: Low
            color: "#00aa00"
            weight: 1
          - value: normal
            label: Normal
            color: "#ffaa00"
            weight: 2
          - value: high
            label: High
            color: "#ff0000"
            weight: 3
      recurrence:
        syntax: tasknotes
        maintain_due_date_offset: false
        reset_body_checkboxes: false
      occurrences:
        identity_roles:
          - recurrenceParent
          - occurrenceDate
        default_materialization: manual
        default_next_trigger: completion
        past_horizon: P0D
        future_horizon: P14D
      links:
        accepted_formats:
          - wikilink
          - markdown
        write_format: wikilink
      archive:
        archived_tag: archived
        move_on_archive: false
        folder: TaskNotes/Archive
      time_tracking:
        auto_stop_on_complete: true
      nlp:
        triggers:
          - property_id: tags
            trigger: "#"
            enabled: true
          - property_id: contexts
            trigger: "@"
            enabled: true
          - property_id: projects
            trigger: +
            enabled: true
          - property_id: status
            trigger: "*"
            enabled: true
          - property_id: priority
            trigger: "!"
            enabled: false
      templating:
        enabled: false
        occurrence_enabled: false
x-tasknotes-generator:
  managed_fields:
    - alerts
    - assignees
    - attachments
    - blockedBy
    - complete_instances
    - created_at
    - deadline
    - effort
    - estimate_mins
    - finished_on
    - googleCalendarEventId
    - googleCalendarExceptionEventId
    - googleCalendarExceptionOriginalScheduled
    - googleCalendarMovedOriginalDates
    - icsEventId
    - id
    - initiatives
    - locations
    - occurrence_date
    - occurrence_future_horizon
    - occurrence_materialization
    - occurrence_next_trigger
    - occurrence_past_horizon
    - occurrence_template
    - recurrence_anchor
    - recurrence_parent
    - repeat_rule
    - skipped_instances
    - start_on
    - state
    - summary
    - tags
    - tasknotes_manual_order
    - updated_at
    - urgency
    - work_log
  legacy_compatibility: true
x-legacy-v0.2:
  coercion_compatible_schema: true
---

# Task

This type definition implements the TaskNotes contract for this mdbase collection.
Its JSON Schema describes persisted task frontmatter; collection and lifecycle
metadata describe generic mdbase behavior; `implements` maps the portable
TaskNotes task view and supplies TaskNotes behavior.

Changes made here are loaded by TaskNotes. Portable changes made in TaskNotes
settings are written back while unknown extensions are preserved.
