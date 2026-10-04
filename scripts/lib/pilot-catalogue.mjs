import assert from "node:assert/strict";

/** Validate compiled ICU JSON, including interpolation names/types and React tag placeholders. */
export function messageContract(parts) {
  assert.ok(Array.isArray(parts), "Compiled message must be an ICU data array");
  const args = new Set();
  const tags = new Set();
  let text = "";
  for (const part of parts) {
    if (typeof part === "string") {
      text += part;
      continue;
    }
    assert.ok(
      Array.isArray(part) && typeof part[0] === "string",
      "Invalid ICU argument",
    );
    const [name, type, options] = part;
    args.add(`${name}:${type ?? "argument"}`);
    if (type) {
      assert.ok(
        ["plural", "selectordinal", "select"].includes(type),
        "Unsupported pilot ICU operation",
      );
      assert.ok(
        options && typeof options === "object" && options.other,
        "ICU selection requires other",
      );
      for (const branch of Object.values(options)) {
        const child = messageContract(branch);
        child.args.forEach((value) => args.add(value));
        child.tags.forEach((value) => tags.add(value));
      }
    } else assert.equal(part.length, 1, "Invalid ICU argument shape");
  }
  const stack = [];
  for (const match of text.matchAll(/<([^>]+)>/g)) {
    const tag = match[1];
    assert.match(
      tag,
      /^\/?\d+\/?$/,
      "Only numeric React placeholders are allowed, never translator HTML",
    );
    const id = tag.replaceAll("/", "");
    tags.add(id);
    if (tag.startsWith("/"))
      assert.equal(stack.pop(), id, "Unbalanced React placeholder");
    else if (!tag.endsWith("/")) stack.push(id);
  }
  assert.equal(stack.length, 0, "Unclosed React placeholder");
  return { args: [...args].sort(), tags: [...tags].sort() };
}

export function validateCatalogues(english, target) {
  assert.deepEqual(
    Object.keys(target).sort(),
    Object.keys(english).sort(),
    "Compiled catalogue keys differ",
  );
  for (const [id, source] of Object.entries(english)) {
    assert.deepEqual(
      messageContract(target[id]),
      messageContract(source),
      `Interpolation/markup contract changed: ${id}`,
    );
  }
}
