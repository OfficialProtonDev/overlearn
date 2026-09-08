# Overlearn

A study tool that works from your own course material.

Point it at a folder of lecture PDFs, run them through the `study-pack` skill,
and you get flashcards, per-subtopic quizzes, timed mock tests, computation
drills with fresh numbers each time, and a cheat sheet that squeezes itself onto
however many pages you're allowed.

The app knows nothing about any subject. Everything it shows comes from a
**pack** — a folder of JSON generated from your material. Adding a new paper
means generating a new pack, not changing the code.

*Overlearning* is the term for practising past the point of first mastery, which
is what a long session before a test actually is.

---

## Running it

```bash
npm install
npm run dev
```

Then **Packs → Choose a folder** and point it at a pack.

```bash
npm run build      # typecheck + production build into dist/
npm run preview    # serve the built output
npm run lint
```

---

## What's in it

**Coverage map** — every subtopic as a tile, coloured by how well you know it.
Untouched material is drawn as an outline rather than a filled tile, because a
blind spot costs more in a test than a wobble on something you've seen.

**Escalating quiz** — a subtopic you haven't touched opens on recognition
questions. Once those land, the same material comes back as supply, then as cold
recall. You're never dropped into the hardest form of something you haven't
warmed up on, and never left grinding multiple choice on something you know.

**Flashcards** — cold recall, graded by you.

**Rapid fire** — recognition only, for warming up or finding gaps fast.

**Mock test** — timed, mixed across topics, no feedback until the end, then a
full breakdown by subtopic and a list of what you missed.

**Mistake review** — a queue built from everything you've got wrong or flagged,
across every past session.

**Cheat sheet** — every formula and definition in the pack, laid out at true page
dimensions. Set the paper size, margins, columns and page budget, and it
binary-searches the type size for the largest that still fits. The preview shows
the real page breaks, so printing gives you what you were looking at.

**Computation drills** — worked numeric problems with the solution revealed one
step at a time, so a wrong answer tells you *which* step your method diverged
at. Questions with `vars` redraw their numbers every time, which drills the
method instead of the answer.

Within a session, anything you get wrong comes back later — far enough away that
you're recalling it rather than echoing it, and it keeps coming back until it
sticks. There's no spaced repetition across days: this is built for long single
sittings, not daily review.

---

## Making a pack

```
/study-pack path/to/your/course/material
```

The skill reads the source — including rendering pages as images, because slide
decks keep most of their real content in pictures that extract as nothing —
proposes a topic breakdown, asks you per topic how deep to go, generates the
pack, and validates it.

**Generation runs on your own agent.** Overlearn ships no model, no API key and
no backend. `/study-pack` is a skill for the coding agent you already have — it's
written for Claude Code — so the reading and the question writing happen on your
machine, under your own subscription. The app only ever reads the JSON that comes
out the other end.

Format reference: [`docs/pack-format.md`](docs/pack-format.md).
Skill: [`.claude/skills/study-pack/`](.claude/skills/study-pack/) (also installed
to `~/.claude/skills/` so it works from any folder).

You can validate a pack by hand at any time:

```bash
python .claude/skills/study-pack/scripts/validate.py path/to/pack
```

It reports problems field by field, and its rules mirror the app's exactly.

---

## Your data

Packs and progress live in your browser — IndexedDB for packs, localStorage for
progress. Nothing is uploaded, nothing is shared with anyone you send the app
to, and clearing browser data removes it. Settings has export and import if you
want a copy or want to move to another machine.

---

## Deploying

`npm run build` produces a fully static `dist/`. Asset paths are relative and
routing is hash-based, so the same build runs from a GitHub Pages project
subpath, a custom domain, any static host, or a folder opened off disk — with no
configuration.

Pushing to `main` deploys via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) once Pages is
enabled with **Source: GitHub Actions**.

**Two packs ship; the rest are gitignored.** `compx310-test1` and
`compx361-test1` are committed, so the deployed app opens on real material.
Everything else in `public/packs/` is excluded, so questions derived from your
own course material stay on your machine while the app itself is public — anyone you share the link
with loads their own packs with the folder picker. To ship another, see
[`public/packs/README.md`](public/packs/README.md).

---

## How it's built

Vite + React 19 + TypeScript, no UI framework. Icons are `lucide-react`; that
and React are the only runtime dependencies.

```
src/
  types/pack.ts        the pack format — the contract with the skill
  lib/
    expr.ts            safe arithmetic evaluator (no eval) for templated questions
    instance.ts        drawing values and resolving {{ … }} into a concrete question
    grading.ts         marking, including lenient short-answer matching
    progress.ts        what you know; derives everything the coverage map shows
    scheduler.ts       session queues, escalation, requeueing
    sheet.ts           cheat sheet page geometry, packing and fitting
    packLoader.ts      bundled / folder / file loading
    validate.ts        pack validation with human-readable errors
    router.ts          hash router
  state/store.tsx      app state and persistence
  views/               one file per screen
  styles/tokens.css    the entire look — light "Ledger", dark "Nocturne"
```

Swapping the whole visual identity is one file: `src/styles/tokens.css`. No
component hard-codes a colour.
