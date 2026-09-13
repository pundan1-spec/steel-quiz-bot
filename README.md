# Steel Quiz — WhatsApp bot

An adaptive steel quiz that runs entirely inside a WhatsApp chat. Questions and
answers stay on the server. A player receives one question and three buttons at
a time, and can see their own progress at any point. Nobody sees anyone else's.

## Repository

```
server.js                    webhook, routing, game engine
lib/messages.js              every word the player sees, plus payload builders
lib/store.js                 per-player state: memory, or Upstash Redis
data/questions.json          the question bank
scripts/validate.js          limit checks, run at boot and in CI
.github/workflows/           runs the validator on every push
render.yaml                  one-click deploy definition
```

## Two ways to play, one deployment

The same service runs both:

- **Browser quiz** at `https://<your-service>/` — opens inside WhatsApp's
  in-app browser, needs no Meta account, no recipient cap. Progress is stored
  on each player's phone.
- **WhatsApp bot** at `/webhook` — the pure in-chat experience, once the Meta
  side is approved. Both read the same `data/questions.json`.

Answers are never sent to the browser with the question. `/api/next` returns
the text and options only; `/api/answer` returns the correct letter and the
explanation after a choice is submitted. Viewing the page source shows nothing.
A determined person could still probe `/api/answer` one question at a time,
which is a fair trade for a group quiz.

## Deploy from GitHub

1. Push this repository to GitHub, private is fine.
2. On [render.com](https://render.com), New → Blueprint, point it at the repo.
   `render.yaml` sets everything except the secrets.
3. The browser quiz works immediately at the service root, with no environment
   variables at all. Fill in `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and
   `VERIFY_TOKEN` only when you are ready to switch the bot on.
4. In the Meta app console, set the webhook callback to
   `https://<your-service>.onrender.com/webhook`, paste the same verify token,
   and subscribe to the `messages` field.
5. Message the number. It should reply with the house list.

Railway, Fly and Cloud Run work the same way; only step 2 changes. GitHub Pages
cannot host this, since a webhook needs a running server.

The free Render tier sleeps after inactivity, so the first message of the day
may take a few seconds. Anything paid, or a cron ping to `/health`, removes it.

## Saving progress

Without Redis, progress lives in process memory and disappears on restart or
redeploy. For anything real, create a free Upstash Redis database and set
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. The store switches
automatically and falls back to memory if Redis is unreachable, so a Redis
outage degrades the experience instead of breaking it.

State is keyed by phone number, expires after 120 days of inactivity, and holds
only points, level, counts and question ids seen.

## Reporting a clean sweep

The Cloud API cannot post into a WhatsApp group. Official senders reach
individuals only, and libraries that drive a personal account into groups
breach WhatsApp's terms and get numbers banned. So a perfect round is handled
in two legitimate ways:

- the player receives a card and a `wa.me` link that opens their own group
  picker, one tap to post;
- your number receives an automatic alert. Set `ADMIN_WHATSAPP` to your number
  in international format, digits only, e.g. `919876543210`.

The alert is subject to the same 24-hour rule as any other message: it lands
only if you have messaged the bot in the last 24 hours. Either send it a `.`
each morning, or register a message template for out-of-window alerts.

## Game rules as coded

- Ten questions a round, one house at a time
- Easy 10 points, hard 20
- Two correct in a row promotes to the hard level
- One wrong answer drops back to easy and resets the streak
- No repeats until every question in that house has been seen, then it reshuffles
  and keeps the points

- Ten out of ten triggers the clean-sweep card and your alert

Typed commands: `MENU`, `STATS`, `RULES`, `STOP`, `RESET`.

## The bank

100 questions, 20 per house, 10 at each level. Correct answers are spread
across A, B and C within every house and level, so guessing one letter gains
nothing.

Append further questions to `data/questions.json` using the `HSE-Ln-NNN` id
convention, keeping the per-level counts even so the adaptive step always has
somewhere to go.

The validator runs on every push and every boot, and refuses the bank on:

- an option longer than 20 characters (WhatsApp truncates the button)
- a duplicate id, unknown house, level other than 1 or 2, or a correct answer
  outside A, B, C
- a missing question or explanation, or either one over 700 characters

A bad question therefore fails in the pull request rather than in a live round.
Run it locally before pushing:

```bash
npm install
npm run validate
```

Every question, answer and explanation must be checked against the approved
technical source before it is added. Nothing goes in from memory.

`npm run validate` also reports the spread of correct answers; rebalance if one
letter starts to dominate.
