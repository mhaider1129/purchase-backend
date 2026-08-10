'use strict';

const fs = require('fs');
const path = require('path');

const input = process.argv[2] || path.join(__dirname, '../sql/manual/004_inventory_transaction_engine.sql');
const lines = fs.readFileSync(input, 'utf8').split(/\r?\n/);
const patchMetadata = /^(?:@@|diff --git|index [0-9a-f]+|--- |\+\+\+ )/;
const invalid = lines.map((line, index) => ({ line, number: index + 1 }))
  .filter(({ line }) => patchMetadata.test(line));
if (invalid.length) {
  for (const entry of invalid) process.stderr.write(`${path.basename(input)}:${entry.number}: Git patch metadata is not valid SQL\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('raw SQL validation passed\n');
}