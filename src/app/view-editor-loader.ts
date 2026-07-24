export const loadViewEditorForm = () => import("./view-editor-form");

export function preloadViewEditor(): void {
  void loadViewEditorForm();
}
