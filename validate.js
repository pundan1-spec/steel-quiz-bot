'use strict';

/**
 * Validates data/questions.json against the limits WhatsApp enforces.
 * Runs on every boot and on every push (see .github/workflows/validate.yml),
 * so a malformed question is caught in the pull request, not in a live round.
 *
 * Hard limits: reply button title 20 chars, list row title 24, header 60,
 * body 1024, footer 60.
 */

const fs = require('fs');
const path = require('path');

const LIMITS = { button: 20, rowTitle: 24, rowDesc: 72, body: 1024 };

function validate(bank) {
  const errors = [];
  const ids = new Set();

  for (const [key, h] of Object.entries(bank.houses)) {
    if (!h.name) errors.push(`house ${key}: missing name`);
    if (h.name && h.name.length > LIMITS.rowTitle) errors.push(`house ${key}: name is ${h.name.length} chars, limit ${LIMITS.rowTitle}`);
    if (h.blurb && h.blurb.length > LIMITS.rowDesc) errors.push(`house ${key}: blurb is ${h.blurb.length} chars, limit ${LIMITS.rowDesc}`);
  }

  for (const q of bank.questions) {
    const at = q.id || '(question with no id)';
    if (!q.id) errors.push('a question has no id');
    if (ids.has(q.id)) errors.push(`${at}: duplicate id`);
    ids.add(q.id);
    if (!bank.houses[q.house]) errors.push(`${at}: unknown house "${q.house}"`);
    if (![1, 2].includes(q.level)) errors.push(`${at}: level must be 1 or 2`);
    if (!['A', 'B', 'C'].includes(q.correct)) errors.push(`${at}: correct must be A, B or C`);
    if (!q.question) errors.push(`${at}: no question text`);
    if (q.question && q.question.length > 700) errors.push(`${at}: question is ${q.question.length} chars, keep under 700`);
    if (!q.explanation) errors.push(`${at}: no explanation`);
    if (q.explanation && q.explanation.length > 700) errors.push(`${at}: explanation is ${q.explanation.length} chars, keep under 700`);
    for (const k of ['A', 'B', 'C']) {
      const v = q.options && q.options[k];
      if (!v) { errors.push(`${at}: missing option ${k}`); continue; }
      if (v.length > LIMITS.button) errors.push(`${at}: option ${k} is ${v.length} chars, limit ${LIMITS.button} ("${v}")`);
    }
  }

  const counts = {};
  for (const q of bank.questions) {
    const k = `${q.house}/L${q.level}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  return { errors, counts, total: bank.questions.length };
}

function load() {
  const file = path.join(__dirname, '..', 'data', 'questions.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { validate, load };

if (require.main === module) {
  const { errors, counts, total } = validate(load());
  if (errors.length) {
    console.error('Question bank rejected:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`Question bank valid: ${total} questions`);
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(14)} ${v}`);
}
