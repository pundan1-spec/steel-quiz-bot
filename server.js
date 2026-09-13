'use strict';

/**
 * Steel Quiz — WhatsApp Cloud API bot.
 *
 * The whole game runs in the chat. Questions and answers stay on the server;
 * the player only ever receives one question and three buttons at a time.
 */

const express = require('express');
const store = require('./lib/store');
const M = require('./lib/messages');
const { validate, load } = require('./scripts/validate');

const BANK = load();
const HOUSES = BANK.houses;

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'steelquiz';
const ADMIN = process.env.ADMIN_WHATSAPP;          // your number, for clean-sweep alerts
const GRAPH = 'https://graph.facebook.com/v21.0';

const TOTALS = Object.fromEntries(
  Object.keys(HOUSES).map(k => [k, BANK.questions.filter(q => q.house === k).length])
);

/* ------------------------------------------------------------------ sending */

async function send(to, payload) {
  const res = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload })
  });
  if (!res.ok) console.error('send failed', res.status, await res.text());
}

const text = (to, body) => send(to, { type: 'text', text: { body } });

async function markRead(id) {
  try {
    await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: id })
    });
  } catch (e) { /* cosmetic only */ }
}

/* ----------------------------------------------------------------- gameplay */

function pick(houseKey, p) {
  const unseen = BANK.questions.filter(q => q.house === houseKey && !p.seen.includes(q.id));
  if (!unseen.length) return null;
  const atLevel = unseen.filter(q => q.level === p.level);
  const pool = atLevel.length ? atLevel : unseen;   // level exhausted, keep playing
  return pool[Math.floor(Math.random() * pool.length)];
}

async function serve(to, state) {
  const key = state.current.house;
  const p = store.house(state, key);

  if (state.current.asked >= M.ROUND_LENGTH) return finish(to, state, false);

  const q = pick(key, p);
  if (!q) return finish(to, state, true);

  state.current.qid = q.id;
  await store.save(to, state);
  await send(to, M.question(q, { ...HOUSES[key], key }, p, state.current.asked));
}

async function answer(to, state, qid, choice) {
  const q = BANK.questions.find(x => x.id === qid);
  if (!q || !state.current || state.current.qid !== qid) {
    await text(to, 'That question has already been answered. Here is the next one.');
    return state.current ? serve(to, state) : send(to, M.menu(HOUSES, state));
  }

  const p = store.house(state, q.house);
  const right = choice === q.correct;
  let promoted = false;

  p.seen.push(q.id);
  p.answered += 1;
  state.current.asked += 1;
  state.current.qid = null;

  if (right) {
    state.current.right += 1;
    p.points += M.POINTS[q.level];
    p.correct += 1;
    p.streak += 1;
    if (p.streak > p.best) p.best = p.streak;
    if (p.level === 1 && p.streak >= M.PROMOTE_AFTER) { p.level = 2; p.streak = 0; promoted = true; }
  } else {
    p.streak = 0;
    p.level = 1;
  }

  await store.save(to, state);
  await send(to, M.verdict(q, right, p, promoted, state.current.asked));
}

async function finish(to, state, cleared) {
  const key = state.current.house;
  const p = store.house(state, key);
  const house = { ...HOUSES[key], key };
  const clean = state.current.asked >= M.ROUND_LENGTH && state.current.right === state.current.asked;

  if (cleared) p.seen = [];                        // reshuffle, points survive
  state.current = null;
  await store.save(to, state);

  await send(to, M.summary(house, p, cleared, TOTALS[key]));

  if (clean) {
    const card = M.perfect(house, p, 'https://wa.me/');
    const share = card._share;
    delete card._share;
    await send(to, card);
    await text(to, `Post it here: ${share}`);       // tapping opens the group picker
    await notifyAdmin(`Clean sweep: ${to} scored ${M.ROUND_LENGTH}/${M.ROUND_LENGTH} in ${house.name} (${p.points} points).`);
  }
}

/**
 * Alerts the operator's own number. Cloud API rules apply: this only lands if
 * the operator has messaged the bot within the last 24 hours, otherwise it
 * needs an approved template. Failure is logged, never shown to the player.
 */
async function notifyAdmin(body) {
  if (!ADMIN) return;
  try { await text(ADMIN, body); }
  catch (err) { console.error('admin notify failed', err.message); }
}

async function startHouse(to, state, key) {
  const p = store.house(state, key);
  if (p.seen.length >= TOTALS[key]) p.seen = [];
  state.current = { house: key, asked: 0, right: 0, qid: null };
  await store.save(to, state);
  await serve(to, state);
}

/* ------------------------------------------------------------------ routing */

async function route(to, input) {
  const state = await store.load(to);
  const word = (input.text || '').trim().toLowerCase();

  if (input.id) {
    if (input.id.startsWith('house:')) return startHouse(to, state, input.id.split(':')[1]);
    if (input.id.startsWith('ans:')) {
      const [, qid, choice] = input.id.split(':');
      return answer(to, state, qid, choice);
    }
    if (input.id === 'next') return state.current ? serve(to, state) : send(to, M.menu(HOUSES, state));
    if (input.id === 'menu') return send(to, M.menu(HOUSES, state));
    if (input.id === 'stats') return send(to, M.stats(HOUSES, state, TOTALS));
    if (input.id === 'stop') return state.current ? finish(to, state, false) : send(to, M.menu(HOUSES, state));
  }

  if (['stats', 'score', 'progress'].includes(word)) return send(to, M.stats(HOUSES, state, TOTALS));
  if (['rules', 'help'].includes(word)) return text(to, M.RULES);
  if (['stop', 'end', 'quit'].includes(word)) {
    if (state.current) return finish(to, state, false);
    return send(to, M.menu(HOUSES, state));
  }
  if (word === 'reset') {
    await store.reset(to);
    return text(to, 'Progress cleared. Type *MENU* to start fresh.');
  }
  if (['menu', 'start', 'quiz'].includes(word)) return send(to, M.menu(HOUSES, state));

  if (!Object.keys(state.houses).length && !state.current) {
    await text(to, M.WELCOME);
    return send(to, M.menu(HOUSES, state));
  }
  if (state.current && state.current.qid) return text(to, M.NUDGE);
  if (state.current) return serve(to, state);
  return send(to, M.menu(HOUSES, state));
}

/* -------------------------------------------------------------------- http */

const app = express();
app.use(express.json());

app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);                              // acknowledge fast, then work
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;                               // delivery statuses land here too
    markRead(msg.id);

    let input;
    if (msg.type === 'text') input = { text: msg.text.body };
    else if (msg.type === 'interactive') {
      const i = msg.interactive;
      input = { id: i.button_reply?.id || i.list_reply?.id };
    } else {
      return text(msg.from, 'Type *MENU* to start the quiz.');
    }
    await route(msg.from, input);
  } catch (err) {
    console.error('handler error', err);
  }
});

app.get('/health', (_req, res) =>
  res.json({ ok: true, questions: BANK.questions.length, store: store.backend }));

/* --------------------------------------------------------------------- boot */

const { errors, total, counts } = validate(BANK);
if (errors.length) {
  console.error('Question bank rejected:\n' + errors.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`Bank: ${total} questions`, counts, `| store: ${store.backend}`);
if (!TOKEN || !PHONE_ID) console.warn('WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID missing, sends will fail.');
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
