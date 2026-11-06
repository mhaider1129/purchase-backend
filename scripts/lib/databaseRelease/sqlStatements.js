"use strict";
// Splits top-level SQL while preserving quoted function bodies and nested comments.
function splitStatements(sql) {
  const result = [];
  let start = 0,
    quote = null,
    escapeQuote = false,
    comment = 0,
    line = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i],
      n = sql[i + 1];
    if (line) {
      if (c === "\n") line = false;
      continue;
    }
    if (comment) {
      if (c === "/" && n === "*") {
        comment++;
        i++;
      } else if (c === "*" && n === "/") {
        comment--;
        i++;
      }
      continue;
    }
    if (quote) {
      if (quote === "'" || quote === '"') {
        if (c === quote) {
          if (n === quote) i++;
          else quote = null;
        } else if (c === "\\" && quote === "'" && escapeQuote) i++;
      } else if (sql.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = null;
      }
      continue;
    }
    if (c === "-" && n === "-") {
      line = true;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      comment++;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      escapeQuote =
        c === "'" &&
        /[Ee]/.test(sql[i - 1] || "") &&
        !/[A-Za-z0-9_]/.test(sql[i - 2] || "");
      continue;
    }
    if (c === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        quote = tag;
        i += tag.length - 1;
        continue;
      }
    }
    if (c === ";") {
      result.push(sql.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (quote || comment)
    throw Object.assign(new Error("Unterminated SQL quote or comment"), {
      code: "INVALID_SQL_BOUNDARY",
    });
  if (sql.slice(start).trim()) result.push(sql.slice(start));
  return result;
}
function migrationBody(sql) {
  const s = splitStatements(sql),
    withoutComments = (v) =>
      v.replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g, "").trim();
  if (
    !/^BEGIN\s*;$/i.test(withoutComments(s[0] || "")) ||
    !/^COMMIT\s*;$/i.test(withoutComments(s.at(-1) || ""))
  )
    throw new Error(
      "Forward migrations require one outer BEGIN/COMMIT boundary",
    );
  for (const v of s.slice(1, -1))
    if (
      /^(BEGIN|COMMIT|ROLLBACK|CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY)\b/i.test(
        withoutComments(v),
      )
    )
      throw new Error(
        "Unsupported nested transaction or nontransactional migration",
      );
  return s.slice(1, -1).join("\n");
}
function leadingKeyword(sql) {
  let i = 0;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      if (end < 0) return "";
      i = end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    break;
  }
  return /^[A-Za-z]+/.exec(sql.slice(i))?.[0]?.toUpperCase() || "";
}
module.exports = { splitStatements, migrationBody, leadingKeyword };
