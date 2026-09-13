'use strict';

/**
 * Player state, keyed by phone number.
 *
 * Two backends, chosen by environment:
 *   - memory  (default) fine for testing, wiped on every restart
 *   - Upstash Redis REST, set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 *
 * Upstash is used over plain HTTP fetch, so there is no client library and
 * nothing to keep alive between requests. Free tier covers a group easily.
 */

const URL_BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS = Boolean(URL_BASE && TOKEN);
const TTL_DAYS = 120;

const memory = new Map();

function blank() {
  return { houses: {}, current: null, started: Date.now() };
}

function blankHouse() {
  return { points: 0, answered: 0, correct: 0, level: 1, best: 0, streak: 0, seen: [] };
}

async function redis(command) {
  const res = await fetch(`${URL_BASE}/${command.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!res.ok) throw new Error(`redis ${res.status}: ${await res.text()}`);
  return (await res.json()).result;
}

async function load(wa) {
  if (!REDIS) return memory.get(wa) || blank();
  try {
    const raw = await redis(['get', `quiz:${wa}`]);
    return raw ? JSON.parse(raw) : blank();
  } catch (err) {
    console.error('store.load fell back to memory:', err.message);
    return memory.get(wa) || blank();
  }
}

async function save(wa, state) {
  memory.set(wa, state);
  if (!REDIS) return;
  try {
    await fetch(`${URL_BASE}/set/${encodeURIComponent(`quiz:${wa}`)}?EX=${TTL_DAYS * 86400}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(state)
    });
  } catch (err) {
    console.error('store.save failed:', err.message);
  }
}

async function reset(wa) {
  memory.delete(wa);
  if (REDIS) { try { await redis(['del', `quiz:${wa}`]); } catch (e) { /* best effort */ } }
}

function house(state, key) {
  if (!state.houses[key]) state.houses[key] = blankHouse();
  return state.houses[key];
}

module.exports = { load, save, reset, house, backend: REDIS ? 'upstash' : 'memory' };
