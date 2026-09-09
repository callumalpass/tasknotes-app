import { expect, it } from "vitest";
import { searchMatchContext } from "./search-match-context";
const task = {
  title: "Prepare launch",
  body: "Review the research notes.",
  projects: ["[[Projects/Website]]"],
  contexts: ["office"],
  tags: ["release"],
  attachments: ["assets/diagram.png"],
};
it("does not add noise when the title explains every term", () => {
  expect(searchMatchContext(task, "PREPARE launch")).toBeUndefined();
  expect(searchMatchContext(task, "  ")).toBeUndefined();
});
it("explains note matches, including terms spread across title and body", () => {
  expect(searchMatchContext(task, "review")).toBe("Matched in notes");
  expect(searchMatchContext(task, "launch RESEARCH")).toBe("Matched in notes");
});
it("names only fields with observed matches", () => {
  expect(searchMatchContext(task, "website office release diagram")).toBe(
    "Matched in projects, contexts, tags, attachments",
  );
  expect(searchMatchContext(task, "unknown")).toBeUndefined();
});
