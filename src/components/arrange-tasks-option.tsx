import { Check, GripVertical } from "lucide-react";

/** Touch layouts reveal manual-order handles only while arranging. */
export function ArrangeTasksOption({
  available,
  arrangingViewKey,
  viewKey,
  onChange,
}: {
  available: boolean;
  arrangingViewKey?: string;
  viewKey: string;
  onChange(viewKey: string | undefined): void;
}) {
  if (!available) return null;
  const arranging = arrangingViewKey === viewKey;
  return (
    <button
      className="view-option-arrange"
      type="button"
      aria-pressed={arranging}
      onClick={() => onChange(arranging ? undefined : viewKey)}
    >
      {arranging ? (
        <Check aria-hidden="true" size={18} />
      ) : (
        <GripVertical aria-hidden="true" size={18} />
      )}{" "}
      Arrange tasks
    </button>
  );
}
