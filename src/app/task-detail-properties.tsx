import { TaskCoreProperties } from "./task-core-properties";
import { CustomField } from "./task-custom-field";
import { isEmptyFieldValue, type Draft } from "./task-editor-draft";

export function TaskDetailProperties(
  props: Parameters<typeof TaskCoreProperties>[0],
) {
  const { draft, configuration, completeField, onChange } = props;
  return (
    <section className="task-detail-properties">
      {configuration.userFields.length ? (
        <div className="field-grid metadata-fields">
          {configuration.userFields.map((field) => (
            <CustomField
              completion={configuration.fieldCompletions[field.key]}
              completeField={completeField}
              field={field}
              key={field.key}
              value={draft.customProperties[field.key]}
              onChange={(value) => {
                const customProperties: Draft["customProperties"] = {
                  ...draft.customProperties,
                };
                if (isEmptyFieldValue(value))
                  delete customProperties[field.key];
                else customProperties[field.key] = value;
                onChange({ customProperties });
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
