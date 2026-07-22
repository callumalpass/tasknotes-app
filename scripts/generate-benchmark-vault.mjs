import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = process.argv[2];
const count = Number(process.argv[3] ?? 1000);

if (!output || !Number.isSafeInteger(count) || count < 1 || count > 100_000) {
  console.error(
    "Usage: node scripts/generate-benchmark-vault.mjs <output-directory> [count]",
  );
  process.exitCode = 1;
} else {
  const tasks = resolve(output, "tasks");
  await mkdir(tasks, { recursive: true });
  const started = performance.now();

  for (let index = 1; index <= count; index += 1) {
    const suffix = String(index).padStart(12, "0");
    const id = `00000000-0000-4000-8000-${suffix}`;
    const priority = index % 17 === 0 ? "high" : "normal";
    const status = index % 9 === 0 ? "done" : "open";
    const searchMarker = index % 97 === 0 ? " benchmark-needle" : "";
    const day = String((index % 28) + 1).padStart(2, "0");
    const date = `2020-01-${day}`;
    const timestamp = `${date}T10:00:00.000Z`;
    const completed = status === "done" ? `completedDate: ${date}\n` : "";
    const document = `---
type: task
id: ${id}
title: Benchmark task ${index}${searchMarker}
status: ${status}
priority: ${priority}
dateCreated: ${timestamp}
dateModified: ${timestamp}
${completed}mobileRevision: 1
---

Generated performance fixture ${index}.${searchMarker}
`;
    await writeFile(resolve(tasks, `${id}.md`), document, "utf8");
  }

  console.log(
    `Generated ${count} TaskNotes records in ${tasks} (${Math.round(performance.now() - started)} ms).`,
  );
}
