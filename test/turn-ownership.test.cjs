'use strict';
// Who owns a memory turn, and who is allowed to close it.
//
// Measured 20.09.2026 on the reference profile: two Claudian connections are registered on one
// machine -- 'claude-code' from .claude.json and 'claude-desktop' from the Claude application's
// own config -- and a Claude Code session running inside the Claude application uses the first
// one's prompt hook while its tool calls are served by the second. begin() stamped the hook's
// label, every receipt carried the server's, and memory_review refused the turn it had just
// done the work for. The writes were durable; only the maintenance receipt was lost.
//
// The invariant these cases hold: a write receipt and its review belong to the same logical
// turn AND the same connection identity -- established by evidence, never by assumption.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const store = require('../memory-store.cjs');
const runtime = require('../memory-runtime.cjs');
const hook = require('../memory-hook.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-owner-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const vault = path.join(root, 'vault');
  await fs.mkdir(vault);
  return {vault, data: path.join(root, 'data'), profile: {vault, access: 'write', language: 'en'}};
}
const prompt = (data, profile, session, host) =>
  hook.run({session_id: session, hook_event_name: 'UserPromptSubmit'}, data, profile, host);
const write = (vault, note, actor) =>
  store.mutate(vault, {operation: 'create', note, body: 'Durable line', reason: 'test'}, actor);
const review = (data, session, turn, outcome, receipts, actor, vault) =>
  runtime.review(data, {session_id: session, turn, outcome, receipts}, actor, vault);

test('the ordinary turn: one connection opens, writes and reviews', async t => {
  const {vault, data, profile} = await fixture(t);
  await prompt(data, profile, 's1', 'claude-code');
  const receipt = await write(vault, 'A', 'claude-code');
  const result = await review(data, 's1', 1, 'UPDATED', [receipt.id], 'claude-code', vault);
  assert.equal(result.recorded, true);
  assert.equal(result.connection, undefined, 'nothing was rebound, so nothing is reported');
  assert.ok(runtime.isReviewed(await runtime.load(data, 's1')));
});

test('a hook-opened turn is reviewable by the connection that actually did the writing', async t => {
  const {vault, data, profile} = await fixture(t);
  // The hook lives in Claude Code's settings file and stamps its own label.
  const started = await prompt(data, profile, 's1', 'claude-code');
  assert.match(started.hookSpecificOutput.additionalContext, /turn 1/);
  assert.equal((await runtime.load(data, 's1')).host, 'claude-code');

  // The tool calls are served by the application's own connection.
  const receipt = await write(vault, 'A', 'claude-desktop');
  const result = await review(data, 's1', 1, 'UPDATED', [receipt.id], 'claude-desktop', vault);
  assert.equal(result.recorded, true);
  assert.deepEqual(result.connection, {owner: 'claude-desktop', openedBy: 'claude-code'},
    'the rebind is reported, not silent');

  const state = await runtime.load(data, 's1');
  assert.equal(state.host, 'claude-desktop');
  assert.equal(state.reboundFrom, 'claude-code');
  assert.ok(state.reboundAt);
  assert.ok(runtime.isReviewed(state));
  // And it is visible outside the session file too.
  const listed = (await runtime.status(data)).find(s => s.turn === 1);
  assert.equal(listed.openedBy, 'claude-code');
});

test('once ownership is proved, later turns do not have to rebind again', async t => {
  const {vault, data, profile} = await fixture(t);
  await prompt(data, profile, 's1', 'claude-code');
  const first = await write(vault, 'A', 'claude-desktop');
  await review(data, 's1', 1, 'UPDATED', [first.id], 'claude-desktop', vault);

  // The next user prompt runs the same hook, with the same label, and must not re-break it.
  await prompt(data, profile, 's1', 'claude-code');
  assert.equal((await runtime.load(data, 's1')).host, 'claude-desktop', 'the proved owner survives the hook');
  const second = await write(vault, 'B', 'claude-desktop');
  const result = await review(data, 's1', 2, 'UPDATED', [second.id], 'claude-desktop', vault);
  assert.equal(result.recorded, true);
});

test('a connection cannot review another connection\'s receipts', async t => {
  const {vault, data, profile} = await fixture(t);
  await prompt(data, profile, 's1', 'claude-code');
  const mine = await write(vault, 'A', 'codex');
  await assert.rejects(review(data, 's1', 1, 'UPDATED', [mine.id], 'claude-desktop', vault),
    /requires committed receipts from this actor and turn/);
  assert.equal((await runtime.load(data, 's1')).host, 'claude-code', 'a refused review rebinds nothing');
});

test('two connections writing in one turn is ambiguous, and ambiguity is refused', async t => {
  const {vault, data, profile} = await fixture(t);
  await prompt(data, profile, 's1', 'claude-code');
  await write(vault, 'A', 'codex');
  const mine = await write(vault, 'B', 'claude-desktop');
  await assert.rejects(review(data, 's1', 1, 'UPDATED', [mine.id], 'claude-desktop', vault),
    /already carries writes from codex/, 'the message names both sides');
  const state = await runtime.load(data, 's1');
  assert.equal(state.host, 'claude-code');
  assert.equal(state.reboundFrom, undefined);
  assert.equal(runtime.isReviewed(state), false, 'the turn stays UNREVIEWED rather than silently passing');
});

test('a reconnect between the prompt and the write does not lose the turn', async t => {
  const {vault, data, profile} = await fixture(t);
  await prompt(data, profile, 's1', 'claude-code');
  // The server restarts and comes back under its own identity before anything is written.
  const receipt = await write(vault, 'A', 'claude-desktop');
  assert.equal((await review(data, 's1', 1, 'UPDATED', [receipt.id], 'claude-desktop', vault)).recorded, true);
});

test('a reconnect between the write and the review keeps the receipt with its turn', async t => {
  const {vault, data, profile} = await fixture(t);
  await prompt(data, profile, 's1', 'claude-desktop');
  const receipt = await write(vault, 'A', 'claude-desktop');
  // Same physical connection, restarted; the label it reports is unchanged, so nothing rebinds.
  const result = await review(data, 's1', 1, 'UPDATED', [receipt.id], 'claude-desktop', vault);
  assert.equal(result.recorded, true);
  assert.equal(result.connection, undefined);
});

test('a stale turn number is refused whoever asks', async t => {
  const {vault, data, profile} = await fixture(t);
  await prompt(data, profile, 's1', 'claude-code');
  await prompt(data, profile, 's1', 'claude-code');
  const receipt = await write(vault, 'A', 'claude-desktop');
  await assert.rejects(review(data, 's1', 1, 'UPDATED', [receipt.id], 'claude-desktop', vault), /Stale turn/);
  assert.equal((await review(data, 's1', 2, 'UPDATED', [receipt.id], 'claude-desktop', vault)).recorded, true);
});

test('a turn nobody wrote in cannot be claimed by a label alone', async t => {
  const {vault, data, profile} = await fixture(t);
  await prompt(data, profile, 's1', 'claude-code');
  // No receipts exist, so there is no evidence of who is serving this session. Refusing is the
  // safe direction: otherwise any connection could close any other's turn on its own say-so.
  await assert.rejects(review(data, 's1', 1, 'NO_OP', [], 'claude-desktop', vault),
    /belongs to a different connection/);
  await assert.rejects(review(data, 's1', 1, 'NO_OP', [], 'claude-desktop', vault),
    /Call begin_memory_turn/, 'the message names the way out');
  assert.equal(runtime.isReviewed(await runtime.load(data, 's1')), false);

  // begin_memory_turn is that way out: it is the connection saying "this turn is mine".
  await runtime.begin(data, 's1', 'claude-desktop');
  assert.equal((await review(data, 's1', 2, 'NO_OP', [], 'claude-desktop', vault)).recorded, true);

  // And a NO_OP still cannot close a turn another connection was writing in.
  await prompt(data, profile, 's2', 'claude-code');
  await write(vault, 'C', 'codex');
  await assert.rejects(review(data, 's2', 1, 'NO_OP', [], 'claude-desktop', vault), /already carries writes from codex/);
});

test('a retried review does not duplicate the write it reports', async t => {
  const {vault, data, profile} = await fixture(t);
  await prompt(data, profile, 's1', 'claude-code');
  const receipt = await write(vault, 'A', 'claude-desktop');
  // The first attempt fails on a genuinely stale turn number; the retry succeeds. Neither
  // attempt touches the note: review records metadata and nothing else.
  await assert.rejects(review(data, 's1', 9, 'UPDATED', [receipt.id], 'claude-desktop', vault), /Stale turn/);
  await review(data, 's1', 1, 'UPDATED', [receipt.id], 'claude-desktop', vault);
  await review(data, 's1', 1, 'UPDATED', [receipt.id], 'claude-desktop', vault);
  assert.equal((await store.list(vault)).length, 1, 'one note');
  assert.equal((await store.history(vault, 100)).filter(r => r.status === 'committed').length, 1, 'one receipt');
  assert.deepEqual((await runtime.load(data, 's1')).receipts, [receipt.id]);
  // And the write itself is still refused a second time by the store's own guard.
  await assert.rejects(write(vault, 'A', 'claude-desktop'), /already exists/);
});
