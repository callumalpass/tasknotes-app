// node_modules/obsidian-bases-expression/dist/lexer.js
var punct = /* @__PURE__ */ new Set(["(", ")", "[", "]", "{", "}", ".", ",", ":"]);
var singleOps = /* @__PURE__ */ new Set(["+", "-", "*", "/", "%", "!", ">", "<"]);
var endExpressionValues = /* @__PURE__ */ new Set([")", "]", "}"]);
function tokenize(source) {
  const lexer = new Lexer(source);
  return lexer.scan();
}
var Lexer = class {
  source;
  i = 0;
  tokens = [];
  diagnostics = [];
  lastSignificant;
  constructor(source) {
    this.source = source;
  }
  scan() {
    while (!this.done()) {
      const ch = this.peek();
      if (isWhitespace(ch)) {
        this.i++;
        continue;
      }
      if (isDigit(ch) || ch === "." && isDigit(this.peek(1))) {
        this.scanNumber();
        continue;
      }
      if (ch === "'" || ch === '"') {
        this.scanString(ch);
        continue;
      }
      if (ch === "/" && this.shouldStartRegex()) {
        this.scanRegex();
        continue;
      }
      if (isIdentifierStart(ch)) {
        this.scanIdentifier();
        continue;
      }
      const two = ch + this.peek(1);
      if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) {
        this.push("operator", two, two, this.i, this.i += 2);
        continue;
      }
      if (singleOps.has(ch)) {
        this.push("operator", ch, ch, this.i, ++this.i);
        continue;
      }
      if (punct.has(ch)) {
        this.push("punct", ch, ch, this.i, ++this.i);
        continue;
      }
      this.diagnostics.push({
        code: "unexpected-character",
        message: `Unexpected character ${JSON.stringify(ch)}`,
        severity: "error",
        span: { start: this.i, end: this.i + 1 }
      });
      this.i++;
    }
    this.tokens.push({
      type: "eof",
      value: "",
      raw: "",
      start: this.source.length,
      end: this.source.length
    });
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }
  scanNumber() {
    const start = this.i;
    if (this.peek() !== ".") {
      while (isDigit(this.peek()))
        this.i++;
    }
    if (this.peek() === "." && isDigit(this.peek(1))) {
      this.i++;
      while (isDigit(this.peek()))
        this.i++;
    }
    if (this.peek().toLowerCase() === "e") {
      const expStart = this.i;
      this.i++;
      if (this.peek() === "+" || this.peek() === "-")
        this.i++;
      if (!isDigit(this.peek())) {
        this.i = expStart;
      } else {
        while (isDigit(this.peek()))
          this.i++;
      }
    }
    const raw = this.source.slice(start, this.i);
    this.push("number", raw, raw, start, this.i);
  }
  scanString(quote) {
    const start = this.i;
    this.i++;
    let value = "";
    while (!this.done()) {
      const ch = this.peek();
      if (ch === quote) {
        this.i++;
        this.push("string", value, this.source.slice(start, this.i), start, this.i);
        return;
      }
      if (ch === "\\") {
        this.i++;
        if (this.done())
          break;
        const esc = this.peek();
        value += decodeEscape(esc);
        this.i++;
        continue;
      }
      value += ch;
      this.i++;
    }
    this.diagnostics.push({
      code: "unterminated-string",
      message: "Unterminated string literal",
      severity: "error",
      span: { start, end: this.i }
    });
    this.push("string", value, this.source.slice(start, this.i), start, this.i);
  }
  scanRegex() {
    const start = this.i;
    this.i++;
    let escaped = false;
    let inClass = false;
    let pattern = "";
    while (!this.done()) {
      const ch = this.peek();
      if (escaped) {
        pattern += ch;
        escaped = false;
        this.i++;
        continue;
      }
      if (ch === "\\") {
        pattern += ch;
        escaped = true;
        this.i++;
        continue;
      }
      if (ch === "[")
        inClass = true;
      if (ch === "]")
        inClass = false;
      if (ch === "/" && !inClass) {
        this.i++;
        let flags = "";
        while (/[a-z]/i.test(this.peek())) {
          flags += this.peek();
          this.i++;
        }
        this.push("regex", `${pattern}/${flags}`, this.source.slice(start, this.i), start, this.i);
        return;
      }
      pattern += ch;
      this.i++;
    }
    this.diagnostics.push({
      code: "unterminated-regex",
      message: "Unterminated regular expression literal",
      severity: "error",
      span: { start, end: this.i }
    });
    this.push("regex", pattern, this.source.slice(start, this.i), start, this.i);
  }
  scanIdentifier() {
    const start = this.i;
    this.i++;
    while (isIdentifierPart(this.peek()))
      this.i++;
    const raw = this.source.slice(start, this.i);
    this.push("identifier", raw, raw, start, this.i);
  }
  shouldStartRegex() {
    const previous = this.lastSignificant;
    if (!previous)
      return true;
    if (previous.type === "number" || previous.type === "string" || previous.type === "identifier" || previous.type === "regex") {
      return false;
    }
    return !endExpressionValues.has(previous.value);
  }
  push(type, value, raw, start, end) {
    const token = { type, value, raw, start, end };
    this.tokens.push(token);
    if (type !== "eof")
      this.lastSignificant = token;
  }
  done() {
    return this.i >= this.source.length;
  }
  peek(offset = 0) {
    return this.source[this.i + offset] ?? "";
  }
};
function decodeEscape(ch) {
  switch (ch) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "	";
    case "\\":
      return "\\";
    case "'":
      return "'";
    case '"':
      return '"';
    default:
      return ch;
  }
}
function isWhitespace(ch) {
  return /\s/.test(ch);
}
function isDigit(ch) {
  return /[0-9]/.test(ch);
}
function isIdentifierStart(ch) {
  return /[A-Za-z_$]/.test(ch);
}
function isIdentifierPart(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

// node_modules/obsidian-bases-expression/dist/parser.js
var precedences = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  ">": 3,
  "<": 3,
  ">=": 3,
  "<=": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
  "%": 5
};
function parseExpression(source) {
  const { tokens, diagnostics } = tokenize(source);
  const parser = new Parser(tokens, diagnostics);
  return parser.parse();
}
var Parser = class {
  tokens;
  diagnostics;
  i = 0;
  constructor(tokens, diagnostics) {
    this.tokens = tokens;
    this.diagnostics = diagnostics;
  }
  parse() {
    const ast = this.parseExpression(0);
    if (!this.at("eof")) {
      this.error(this.current(), `Unexpected token ${JSON.stringify(this.current().raw || this.current().value)}`);
    }
    return { ast, diagnostics: this.diagnostics, tokens: this.tokens };
  }
  parseExpression(minPrecedence) {
    let left = this.parsePrefix();
    if (!left)
      return null;
    left = this.parsePostfix(left);
    while (this.current().type === "operator") {
      const op = this.current().value;
      const precedence = precedences[op];
      if (!precedence || precedence < minPrecedence)
        break;
      const token = this.advance();
      const right = this.parseExpression(precedence + 1);
      if (!right) {
        this.error(token, `Missing right-hand side for ${op}`);
        break;
      }
      left = {
        type: "Binary",
        operator: op,
        left,
        right,
        span: { start: left.span.start, end: right.span.end }
      };
    }
    return left;
  }
  parsePrefix() {
    const token = this.current();
    if (token.type === "number") {
      this.advance();
      return {
        type: "Literal",
        value: Number(token.value),
        raw: token.raw,
        span: spanOf(token)
      };
    }
    if (token.type === "string") {
      this.advance();
      return {
        type: "Literal",
        value: token.value,
        raw: token.raw,
        span: spanOf(token)
      };
    }
    if (token.type === "regex") {
      this.advance();
      const raw = token.raw;
      const lastSlash = raw.lastIndexOf("/");
      return {
        type: "Regex",
        pattern: raw.slice(1, lastSlash),
        flags: raw.slice(lastSlash + 1),
        raw,
        span: spanOf(token)
      };
    }
    if (token.type === "identifier") {
      this.advance();
      if (token.value === "true" || token.value === "false" || token.value === "null") {
        return {
          type: "Literal",
          value: token.value === "null" ? null : token.value === "true",
          raw: token.raw,
          span: spanOf(token)
        };
      }
      return {
        type: "Identifier",
        name: token.value,
        span: spanOf(token)
      };
    }
    if (token.type === "operator" && ["!", "-", "+"].includes(token.value)) {
      this.advance();
      const argument = this.parseExpression(6);
      if (!argument) {
        this.error(token, `Missing operand for ${token.value}`);
        return null;
      }
      return {
        type: "Unary",
        operator: token.value,
        argument,
        span: { start: token.start, end: argument.span.end }
      };
    }
    if (this.match("(")) {
      const start = token.start;
      const expr = this.parseExpression(0);
      const close = this.expect(")", "Expected closing parenthesis");
      if (!expr)
        return null;
      expr.span = { start, end: close?.end ?? expr.span.end };
      return expr;
    }
    if (this.match("["))
      return this.parseArray(token);
    if (this.match("{"))
      return this.unsupportedObjectLiteral(token);
    this.error(token, `Expected expression, got ${JSON.stringify(token.raw || token.value)}`);
    if (!this.at("eof"))
      this.advance();
    return null;
  }
  parsePostfix(expr) {
    let current = expr;
    while (true) {
      if (this.match(".")) {
        const property = this.current();
        if (property.type !== "identifier") {
          this.error(property, "Expected property name after dot");
          continue;
        }
        this.advance();
        current = {
          type: "Member",
          object: current,
          property: property.value,
          computed: false,
          span: { start: current.span.start, end: property.end }
        };
        continue;
      }
      if (this.match("[")) {
        const property = this.parseExpression(0);
        const close = this.expect("]", "Expected closing bracket");
        if (!property)
          continue;
        current = {
          type: "Member",
          object: current,
          property,
          computed: true,
          span: { start: current.span.start, end: close?.end ?? property.span.end }
        };
        continue;
      }
      if (this.match("(")) {
        const args = [];
        if (!this.check(")")) {
          while (true) {
            const arg = this.parseExpression(0);
            if (arg)
              args.push(arg);
            if (!this.match(","))
              break;
          }
        }
        const close = this.expect(")", "Expected closing parenthesis");
        current = {
          type: "Call",
          callee: current,
          args,
          span: { start: current.span.start, end: close?.end ?? current.span.end }
        };
        continue;
      }
      return current;
    }
  }
  parseArray(open) {
    const elements = [];
    if (!this.check("]")) {
      while (true) {
        const element = this.parseExpression(0);
        if (element)
          elements.push(element);
        if (!this.match(","))
          break;
      }
    }
    const close = this.expect("]", "Expected closing array bracket");
    return {
      type: "Array",
      elements,
      span: { start: open.start, end: close?.end ?? open.end }
    };
  }
  unsupportedObjectLiteral(open) {
    let depth = 1;
    while (!this.at("eof") && depth > 0) {
      const token = this.advance();
      if (token.type === "punct" && token.value === "{")
        depth++;
      if (token.type === "punct" && token.value === "}")
        depth--;
    }
    const end = this.tokens[Math.max(0, this.i - 1)]?.end ?? open.end;
    this.diagnostics.push({
      code: "unsupported-object-literal",
      message: "Object literals are not supported by the observed Obsidian Bases runtime",
      severity: "error",
      span: { start: open.start, end }
    });
    return null;
  }
  match(value) {
    if (!this.check(value))
      return false;
    this.advance();
    return true;
  }
  expect(value, message) {
    if (this.check(value))
      return this.advance();
    this.error(this.current(), message);
    return null;
  }
  check(value) {
    const token = this.current();
    return token.type === "punct" && token.value === value;
  }
  at(type) {
    return this.current().type === type;
  }
  advance() {
    const token = this.current();
    if (!this.at("eof"))
      this.i++;
    return token;
  }
  current() {
    return this.tokens[this.i] ?? this.tokens[this.tokens.length - 1];
  }
  error(token, message) {
    this.diagnostics.push({
      code: "parse-error",
      message,
      severity: "error",
      span: spanOf(token)
    });
  }
};
function spanOf(token) {
  return { start: token.start, end: token.end };
}

// node_modules/obsidian-bases-expression/dist/inspect.js
function inspectExpression(sourceOrAst) {
  const ast = typeof sourceOrAst === "string" ? parseExpression(sourceOrAst).ast : sourceOrAst;
  const state = {
    identifiers: /* @__PURE__ */ new Set(),
    noteProperties: /* @__PURE__ */ new Set(),
    fileProperties: /* @__PURE__ */ new Set(),
    formulaProperties: /* @__PURE__ */ new Set(),
    functions: /* @__PURE__ */ new Set(),
    hasThisReference: false
  };
  if (ast)
    visit(ast, state);
  return {
    identifiers: [...state.identifiers].sort(),
    noteProperties: [...state.noteProperties].sort(),
    fileProperties: [...state.fileProperties].sort(),
    formulaProperties: [...state.formulaProperties].sort(),
    functions: [...state.functions].sort(),
    hasThisReference: state.hasThisReference
  };
}
function visit(expr, state) {
  switch (expr.type) {
    case "Identifier":
      state.identifiers.add(expr.name);
      if (!["true", "false", "null", "file", "note", "formula", "this", "value", "index", "acc"].includes(expr.name)) {
        state.noteProperties.add(expr.name);
      }
      if (expr.name === "this")
        state.hasThisReference = true;
      break;
    case "Array":
      expr.elements.forEach((element) => visit(element, state));
      break;
    case "Object":
      expr.properties.forEach((property) => visit(property.value, state));
      break;
    case "Unary":
      visit(expr.argument, state);
      break;
    case "Binary":
      visit(expr.left, state);
      visit(expr.right, state);
      break;
    case "Member":
      if (!expr.computed && typeof expr.property === "string" && expr.object.type === "Identifier") {
        if (expr.object.name === "note")
          state.noteProperties.add(expr.property);
        else if (expr.object.name === "file")
          state.fileProperties.add(expr.property);
        else if (expr.object.name === "formula")
          state.formulaProperties.add(expr.property);
        else if (expr.object.name === "this")
          state.hasThisReference = true;
      }
      visit(expr.object, state);
      if (expr.computed && typeof expr.property !== "string")
        visit(expr.property, state);
      break;
    case "Call":
      if (expr.callee.type === "Identifier")
        state.functions.add(expr.callee.name);
      if (expr.callee.type === "Member" && typeof expr.callee.property === "string")
        state.functions.add(expr.callee.property);
      if (expr.callee.type === "Member") {
        visit(expr.callee.object, state);
        if (expr.callee.computed && typeof expr.callee.property !== "string")
          visit(expr.callee.property, state);
      } else if (expr.callee.type !== "Identifier") {
        visit(expr.callee, state);
      }
      expr.args.forEach((arg) => visit(arg, state));
      break;
    case "Literal":
    case "Regex":
      break;
  }
}

// dist/query/tasknotes.js
var TASKNOTES_QUERY_COMPILER_VERSION = 1;
var TASKNOTES_QUERY_PARSER_VERSION = "0.3.0-rc.4";
var MAX_SOURCE_BYTES = 16 * 1024;
var MAX_EXPRESSION_BYTES = 512;
var MAX_NODES = 256;
var MAX_DEPTH = 32;
var MAX_FIELDS = 16;
var encoder = new TextEncoder();
var TaskNotesQueryError = class extends Error {
  code;
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "TaskNotesQueryError";
  }
};
var fail = (code) => {
  throw new TaskNotesQueryError(code);
};
var object = (value) => typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function text(value) {
  if (typeof value !== "string")
    return fail("invalid_input");
  if (value.length > MAX_SOURCE_BYTES || encoder.encode(value).length > MAX_SOURCE_BYTES)
    return fail("query_budget");
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 55296 && c <= 56319) {
      const next = value.charCodeAt(++i);
      if (!(next >= 56320 && next <= 57343))
        return fail("invalid_input");
    } else if (c >= 56320 && c <= 57343)
      return fail("invalid_input");
  }
  return value;
}
function literal(value) {
  if (typeof value === "string")
    return JSON.stringify(text(value));
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
    return JSON.stringify(value);
  return fail("invalid_input");
}
function compileTaskNotesQuery(input, bindings) {
  if (!object(input) || !object(bindings) || !object(bindings.fields) || !Array.isArray(bindings.types) || bindings.types.length === 0 || bindings.types.length > MAX_FIELDS || !["raw", "effective"].includes(bindings.filterQueryBasis) || !Array.isArray(bindings.nativeTimestampFields) || !Array.isArray(bindings.basesTypedFields))
    return fail("invalid_input");
  for (const fields of [bindings.nativeTimestampFields, bindings.basesTypedFields]) {
    if (fields.length > MAX_FIELDS)
      return fail("query_budget");
    for (const name of fields)
      if (!text(name) || name.length > 128)
        return fail("invalid_input");
  }
  const allowed = input.dialect === "obsidian-bases" ? ["dialect", "filter", "globalFilter", "sort", "groupProperty", "computedProperties", "properties"] : input.dialect === "tasknotes-filter" ? ["dialect", "filter", "sortKey", "sortDirection", "groupKey", "subgroupKey"] : ["dialect", "filter"];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    return fail("invalid_input");
  const dense = (array) => {
    for (let i = 0; i < array.length; i++)
      if (!Object.hasOwn(array, i))
        fail("invalid_input");
  };
  dense(bindings.types);
  const types = bindings.types.map((t) => {
    const name = text(t);
    if (!name || name.length > 128)
      return fail("invalid_input");
    return name;
  });
  const dependencies = /* @__PURE__ */ new Map();
  let nodes = 0, sourceBytes = 0, scalarBytes = 0;
  const boundedLiteral = (value) => {
    const result = literal(value);
    scalarBytes += encoder.encode(result).length;
    if (scalarBytes > MAX_SOURCE_BYTES)
      return fail("query_budget");
    return result;
  };
  const active = /* @__PURE__ */ new Set();
  const visit2 = (depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH)
      fail("query_budget");
  };
  const field = (name, basis) => {
    const mapped = Object.hasOwn(bindings.fields, name) ? text(bindings.fields[name]) : fail("unsupported_field");
    if (!mapped || mapped.length > 128 || mapped !== name)
      return fail("unsupported_field");
    if (bindings.nativeTimestampFields.includes(mapped) || bindings.basesTypedFields.includes(mapped))
      return fail("unsupported_expression");
    dependencies.set(`${basis}:${mapped}`, { source: basis, field: mapped });
    if (dependencies.size > MAX_FIELDS)
      return fail("query_budget");
    const root = basis === "raw" ? "raw" : "record";
    const key = JSON.stringify(mapped);
    return `((${key} in ${root}) ? ${root}[${key}] : null)`;
  };
  const predicate = (node) => {
    if (node.type === "Literal")
      return typeof node.value === "boolean";
    if (node.type === "Unary")
      return node.operator === "!" && predicate(node.argument);
    if (node.type !== "Binary")
      return false;
    if (node.operator === "&&" || node.operator === "||")
      return predicate(node.left) && predicate(node.right);
    return node.operator === "==" || node.operator === "!=";
  };
  const ast = (node, depth) => {
    visit2(depth);
    switch (node.type) {
      case "Literal":
        return boundedLiteral(node.value);
      case "Identifier":
        if (["note", "file", "this", "formula"].includes(node.name))
          return fail("unsupported_expression");
        return field(text(node.name), "raw");
      case "Member": {
        if (node.object.type !== "Identifier" || node.object.name !== "note")
          return fail("unsupported_expression");
        const name = typeof node.property === "string" ? node.property : node.property.type === "Literal" && typeof node.property.value === "string" ? node.property.value : fail("unsupported_expression");
        return field(text(name), "raw");
      }
      case "Unary":
        if (node.operator !== "!")
          return fail("unsupported_operator");
        return `!(${ast(node.argument, depth + 1)})`;
      case "Binary": {
        if (!["==", "!=", "&&", "||"].includes(node.operator))
          return fail("unsupported_operator");
        if (node.operator === "==" || node.operator === "!=") {
          const property = (expr) => expr.type === "Identifier" || expr.type === "Member";
          const scalar = (expr) => expr.type === "Literal" && (typeof expr.value === "string" || expr.value === null);
          if (!(property(node.left) && scalar(node.right) || scalar(node.left) && property(node.right)))
            return fail("unsupported_expression");
        }
        return `(${ast(node.left, depth + 1)} ${node.operator} ${ast(node.right, depth + 1)})`;
      }
      default:
        return fail("unsupported_expression");
    }
  };
  const expression = (value, depth) => {
    const source = text(value);
    const bytes = encoder.encode(source).length;
    if (bytes > MAX_EXPRESSION_BYTES)
      return fail("query_budget");
    sourceBytes += bytes;
    if (sourceBytes > MAX_SOURCE_BYTES)
      return fail("query_budget");
    const lexed = tokenize(source);
    if (lexed.tokens.length > MAX_NODES)
      return fail("query_budget");
    let nesting = 0;
    for (const token of lexed.tokens) {
      if (token.type !== "punct")
        continue;
      if (["(", "[", "{"].includes(token.value)) {
        if (++nesting > MAX_DEPTH)
          return fail("query_budget");
      } else if ([")", "]", "}"].includes(token.value))
        nesting--;
    }
    const parsed = parseExpression(source);
    if (!parsed.ast || parsed.diagnostics.some((d) => d.severity === "error"))
      return fail("invalid_input");
    const lowered = ast(parsed.ast, depth);
    const inspected = inspectExpression(parsed.ast);
    if (inspected.hasThisReference || inspected.fileProperties.length || inspected.formulaProperties.length || inspected.functions.length)
      return fail("unsupported_expression");
    if (!predicate(parsed.ast))
      return fail("unsupported_expression");
    return lowered;
  };
  const bases = (value, depth) => {
    visit2(depth);
    if (typeof value === "string")
      return expression(value, depth + 1);
    if (!object(value) || active.has(value))
      return fail("invalid_input");
    const keys = Object.keys(value);
    if (keys.length !== 1 || !["and", "or", "not"].includes(keys[0]))
      return fail("invalid_input");
    const key = keys[0], children = value[key];
    if (!Array.isArray(children) || children.length === 0)
      return fail("invalid_input");
    if (children.length > MAX_NODES)
      return fail("query_budget");
    dense(children);
    active.add(value);
    const combined = children.map((child) => bases(child, depth + 1)).join(key === "or" ? " || " : " && ");
    active.delete(value);
    return key === "not" ? `!(${combined})` : `(${combined})`;
  };
  const absentOrEmptyArray = (value) => value === void 0 || Array.isArray(value) && value.length === 0;
  let where;
  if (input.dialect === "tasknotes-filter") {
    if (!object(input.filter))
      return fail("invalid_input");
    const tree = input.filter;
    if (input.groupKey && input.groupKey !== "none" || input.subgroupKey && input.subgroupKey !== "none" || tree.groupKey && tree.groupKey !== "none" || tree.subgroupKey && tree.subgroupKey !== "none")
      return fail("unsupported_group");
    if (input.sortKey !== void 0 || input.sortDirection !== void 0 || tree.sortKey !== void 0 || tree.sortDirection !== void 0)
      return fail("unsupported_sort");
    return fail("unsupported_dialect");
  } else if (input.dialect === "obsidian-bases") {
    if (input.groupProperty)
      return fail("unsupported_group");
    if (!absentOrEmptyArray(input.sort))
      return fail("unsupported_sort");
    if (!absentOrEmptyArray(input.computedProperties) || !absentOrEmptyArray(input.properties))
      return fail("unsupported_projection");
    const terms = [input.globalFilter, input.filter].filter((value) => value !== void 0).map((value) => bases(value, 0));
    if (terms.length)
      where = `(${terms.join(" && ")})`;
  } else
    return fail("unsupported_dialect");
  if (where && encoder.encode(where).length > MAX_SOURCE_BYTES)
    return fail("query_budget");
  return {
    compilerVersion: TASKNOTES_QUERY_COMPILER_VERSION,
    parserVersion: TASKNOTES_QUERY_PARSER_VERSION,
    query: { types, ...where === void 0 ? {} : { where } },
    dependencies: [...dependencies.values()],
    requiresReplicaValidation: true
  };
}
export {
  TASKNOTES_QUERY_COMPILER_VERSION,
  TASKNOTES_QUERY_PARSER_VERSION,
  TaskNotesQueryError,
  compileTaskNotesQuery
};
