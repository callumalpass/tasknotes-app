import { createLocalVault } from "../storage/vault";

const DIRECTORY = "tasks/__benchmark__";

export interface BenchmarkProgress {
  completed: number;
  total: number;
}

export async function generateBenchmarkVault(
  count: number,
  onProgress?: (progress: BenchmarkProgress) => void,
): Promise<number> {
  const vault = createLocalVault();
  await vault.initialize();
  const startedAt = performance.now();
  // Establish the nested directory before concurrent writes. Capacitor's
  // recursive write can otherwise race while multiple calls create it.
  await vault.writeText(
    `${DIRECTORY}/${benchmarkId(1)}.md`,
    benchmarkDocument(1),
  );
  onProgress?.({ completed: 1, total: count });
  for (let offset = 1; offset < count; offset += 64) {
    const indexes = Array.from(
      { length: Math.min(64, count - offset) },
      (_, index) => offset + index + 1,
    );
    await Promise.all(
      indexes.map((index) =>
        vault.writeText(
          `${DIRECTORY}/${benchmarkId(index)}.md`,
          benchmarkDocument(index),
        ),
      ),
    );
    onProgress?.({ completed: offset + indexes.length, total: count });
  }
  return Math.round(performance.now() - startedAt);
}

export async function removeBenchmarkVault(
  onProgress?: (progress: BenchmarkProgress) => void,
): Promise<number> {
  const vault = createLocalVault();
  await vault.initialize();
  const files = await vault.listMarkdownFiles(DIRECTORY);
  const startedAt = performance.now();
  for (let offset = 0; offset < files.length; offset += 64) {
    const batch = files.slice(offset, offset + 64);
    await Promise.all(batch.map((file) => vault.delete(file.path)));
    onProgress?.({ completed: offset + batch.length, total: files.length });
  }
  return Math.round(performance.now() - startedAt);
}

function benchmarkId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function benchmarkDocument(index: number): string {
  const id = benchmarkId(index);
  const priority = index % 17 === 0 ? "high" : "normal";
  const status = index % 9 === 0 ? "done" : "open";
  const searchMarker = index % 97 === 0 ? " benchmark-needle" : "";
  const day = String((index % 28) + 1).padStart(2, "0");
  const date = `2020-01-${day}`;
  const timestamp = `${date}T10:00:00.000Z`;
  const completed = status === "done" ? `completedDate: ${date}\n` : "";
  return `---
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
}
