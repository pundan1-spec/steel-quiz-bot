'use strict';

/**
 * Every word the player sees lives here, so the tone stays consistent and
 * copy changes never touch the game engine.
 *
 * WhatsApp formatting: *bold*, _italic_. Header 60 chars, body 1024,
 * footer 60, reply button title 20, list row title 24 and description 72.
 */

const POINTS = { 1: 10, 2: 20 };
const ROUND_LENGTH = 10;
const PROMOTE_AFTER = 2;

const bar = (done, total, width = 5) => {
  const filled = total ? Math.round((done / total) * width) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
};

/* --------------------------------------------------------------- greetings */

const WELCOME =
  '*Steel Quiz*\n\n' +
  'Five houses of steel questions. Pick one and answer ten.\n\n' +
  'Two right in a row moves you up to the hard level. One wrong drops you back.\n' +
  'Easy questions are 10 points, hard ones 20.\n\n' +
  'Type *STATS* any time to see how you are doing, *MENU* to switch house.';

const RULES =
  '*How it works*\n\n' +
  '· Ten questions a round, one house at a time\n' +
  '· Easy 10 points, hard 20 points\n' +
  `· ${PROMOTE_AFTER} correct in a row moves you up a level\n` +
  '· One wrong answer drops you back down\n' +
  '· No question repeats until you have seen them all\n\n' +
  'Your score is yours alone. Nobody else sees it.';

const NUDGE = 'Tap one of the three buttons above to answer, or type *MENU* to start again.';

/* ---------------------------------------------------------------- payloads */

function menu(houses, state) {
  const rows = Object.entries(houses).map(([key, h]) => {
    const p = state.houses[key];
    const desc = p && p.answered
      ? `${p.points} points · level ${p.level} · ${p.correct}/${p.answered} correct`
      : h.blurb;
    return { id: `house:${key}`, title: `${h.glyph} ${h.name}`.slice(0, 24), description: desc.slice(0, 72) };
  });

  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Steel Quiz' },
      body: { text: 'Choose your house. Ten questions, and the difficulty follows your answers.' },
      footer: { text: 'STATS for your progress · RULES to read them' },
      action: { button: 'Choose a house', sections: [{ title: 'Houses', rows }] }
    }
  };
}

function question(q, house, p, asked) {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: `${house.glyph} ${house.name} · ${q.level === 1 ? 'Easy' : 'Hard'}` },
      body: { text: q.question },
      footer: { text: `Question ${asked + 1} of ${ROUND_LENGTH} · ${p.points} points` },
      action: {
        buttons: ['A', 'B', 'C'].map(k => ({
          type: 'reply',
          reply: { id: `ans:${q.id}:${k}`, title: q.options[k] }
        }))
      }
    }
  };
}

function verdict(q, right, p, promoted, asked) {
  const head = right
    ? `✅ *Correct* · +${POINTS[q.level]} points`
    : `✗ *Not this time* · the answer is *${q.correct}, ${q.options[q.correct]}*`;

  const lift = promoted ? '\n\n_Two in a row. Hard questions from here._' : '';
  const drop = !right && q.level === 2 ? '\n\n_Back to the easy level._' : '';

  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: `${head}\n\n${q.explanation}${lift}${drop}`.slice(0, 1024) },
      footer: { text: `${p.points} points · ${p.correct} of ${p.answered} correct` },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'next', title: asked >= ROUND_LENGTH ? 'See my score' : 'Next question' } },
          { type: 'reply', reply: { id: 'menu', title: 'Change house' } },
          { type: 'reply', reply: { id: 'stop', title: 'End round' } }
        ]
      }
    }
  };
}

function summary(house, p, cleared, totalInHouse) {
  const lines = [
    `*${house.glyph} ${house.name}*`,
    '',
    `*${p.points}* points`,
    `${p.correct} of ${p.answered} correct`,
    `Level reached: ${p.level === 2 ? 'hard' : 'easy'}`,
    `Best run: ${p.best} in a row`,
    '',
    `${bar(p.seen.length, totalInHouse)}  ${p.seen.length} of ${totalInHouse} questions seen`
  ];
  if (cleared) lines.push('', 'You have been through every question in this house. Starting again reshuffles them and keeps your points.');

  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: lines.join('\n') },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `house:${house.key}`, title: 'Play again' } },
          { type: 'reply', reply: { id: 'menu', title: 'Change house' } },
          { type: 'reply', reply: { id: 'stats', title: 'All my scores' } }
        ]
      }
    }
  };
}

/**
 * Perfect round. The Cloud API cannot post into a group, so the player gets a
 * ready-made message and a one-tap link that opens their group picker.
 */
function perfect(house, p, shareUrl) {
  const boast = `I just cleared all ${ROUND_LENGTH} questions in the ${house.name} house of the Steel Quiz. ${p.points} points, no mistakes.`;
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: 'Clean sweep' },
      body: {
        text: `*${ROUND_LENGTH} out of ${ROUND_LENGTH}* in ${house.glyph} ${house.name}.\n\n` +
              `${p.points} points, best run ${p.best}. Nobody gets the hard level questions ` +
              `right first time by guessing.\n\n_Tap below to post it in the group._`
      },
      footer: { text: 'Your score stays private unless you send it' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'menu', title: 'Another house' } },
          { type: 'reply', reply: { id: 'stats', title: 'All my scores' } }
        ]
      }
    },
    _share: `${shareUrl}?text=${encodeURIComponent(boast)}`
  };
}

function stats(houses, state, totals) {
  const played = Object.entries(state.houses).filter(([, p]) => p.answered);
  if (!played.length) {
    return { type: 'text', text: { body: 'No answers yet. Type *MENU* to pick a house and start.' } };
  }

  const totalPoints = played.reduce((s, [, p]) => s + p.points, 0);
  const totalCorrect = played.reduce((s, [, p]) => s + p.correct, 0);
  const totalAnswered = played.reduce((s, [, p]) => s + p.answered, 0);

  const lines = ['*Your progress*', ''];
  for (const [key, h] of Object.entries(houses)) {
    const p = state.houses[key];
    if (!p || !p.answered) { lines.push(`${h.glyph} ${h.name} — not started`); continue; }
    lines.push(
      `${h.glyph} *${h.name}* — ${p.points} pts`,
      `   ${bar(p.seen.length, totals[key])} ${p.correct}/${p.answered} correct · ${p.level === 2 ? 'hard' : 'easy'} level`
    );
  }
  lines.push('', `*${totalPoints}* points overall · ${totalCorrect} of ${totalAnswered} correct`);

  return { type: 'text', text: { body: lines.join('\n') } };
}

module.exports = { POINTS, ROUND_LENGTH, PROMOTE_AFTER, WELCOME, RULES, NUDGE, menu, question, verdict, summary, perfect, stats, bar };
