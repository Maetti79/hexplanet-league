// Prueft einen eingereichten Core aus einem GitHub-Issue und legt ihn als cores/<login>.hex ab.
// Ein Konto hat genau einen Core; eine neue Einreichung ersetzt ihn als neue Version.
import fs from 'node:fs';
import { assemble, coreHash } from '../engine/arena.mjs';
const body = process.env.ISSUE_BODY || '', login = (process.env.ISSUE_USER || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
const out = (ok, text) => { fs.writeFileSync('reply.md', text); fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', 'ok=' + ok + '\n'); console.log(text); process.exit(0); };
if (!login) out(false, 'Could not tell who submitted this.');
const m = body.match(/```[a-zA-Z]*\r?\n([\s\S]*?)```/);
if (!m) out(false, 'No core found. Put your core in a code block (three backticks before and after it).');
const src = m[1].replace(/\r/g, '').trim() + '\n';
if (src.length > 20000) out(false, 'Your core is too large (20,000 characters at most).');
const asm = assemble(src);
if (asm.errors.length) out(false, 'Your core has errors and was not accepted:\n\n' + asm.errors.map(e => '- line ' + e.line + ': ' + e.msg).join('\n') + '\n\nFix them and edit this issue or open a new one.');
const subs = JSON.parse(fs.readFileSync('data/submissions.json', 'utf8'));
const prev = subs[login], hash = coreHash(src);
if (prev && prev.hash === hash) out(true, 'This core is already registered as version ' + prev.v + '. Nothing changed.');
const v = prev ? prev.v + 1 : 1;
subs[login] = { v, hash, at: new Date().toISOString(), name: asm.meta.name, played: false };
fs.writeFileSync('cores/' + login + '.hex', src);
fs.writeFileSync('data/submissions.json', JSON.stringify(subs, null, 1));
out(true, 'Accepted: **' + asm.meta.name + '** as version ' + v + ' for @' + login + ' (' + asm.code.length + ' instructions, checksum `' + hash + '`).\n\nIt plays in the next round. Its source is published with that round\'s results.');
