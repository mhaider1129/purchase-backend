'use strict';

// Development-only audit helper. Babel's parser is supplied by the locked Jest toolchain.
// Read source files only: never import app.js, config/db, runtime ensure* helpers or dotenv.
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

function extractBackendSqlContract(root = path.resolve(__dirname, '..')) {
  const sql = [];
  let stringCount = 0;
  function visit(node, file, source) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression'
      && ['query', 'one', 'many'].includes(node.callee?.property?.name || node.callee?.name)) {
      for (const arg of node.arguments) {
        if (['StringLiteral', 'TemplateLiteral'].includes(arg?.type)) arg.auditQueryCall = true;
      }
    }
    let value;
    if (node.type === 'StringLiteral') value = node.value;
    if (node.type === 'TemplateLiteral') {
      value = node.quasis.map((q, i) => (q.value.cooked ?? q.value.raw)
        + (i < node.expressions.length
          ? '${' + source.slice(node.expressions[i].start, node.expressions[i].end) + '}' : '')).join('');
    }
    if (value !== undefined) {
      stringCount += 1;
      if (/\b(?:SELECT|CREATE TABLE|ALTER TABLE|INSERT INTO|UPDATE|DELETE FROM|CREATE (?:UNIQUE )?INDEX)\b/i.test(value)) {
        sql.push({ source: path.relative(root, file), line: node.loc.start.line,
          value, queryCall: !!node.auditQueryCall });
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'tokens', 'comments'].includes(key)) continue;
      if (Array.isArray(child)) child.forEach(n => visit(n, file, source));
      else if (child && typeof child === 'object') visit(child, file, source);
    }
  }
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'tests', '__tests__', 'integration', 'scripts', 'sql', 'docs', '.git'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (file.endsWith('.js')) {
        const source = fs.readFileSync(file, 'utf8');
        visit(parser.parse(source, { sourceType: 'unambiguous' }), file, source);
      }
    }
  }
  scan(root);
  return { sql, stringCount };
}

module.exports = { extractBackendSqlContract };
if (require.main === module) {
  const result = extractBackendSqlContract();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
