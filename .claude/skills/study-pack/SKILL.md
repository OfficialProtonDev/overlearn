---
name: study-pack
description: Turn a folder of course material (lecture PDFs, slides, notes) into an Overlearn study pack — flashcards, quizzes, computation drills, formulas and definitions. Use when the user points at study material and wants questions generated from it, mentions Overlearn packs, asks to add a subject or a test to their study tool, or wants to regenerate or extend an existing pack.
---

# Building a study pack

You are turning someone's own course material into a pack that Overlearn loads.
The full format is in `docs/pack-format.md` in the Overlearn repo; read it before
writing any JSON. `references/question-craft.md` beside this file covers what
separates a question worth answering from filler.

**The pack is the product.** Its quality is what the tool is worth. A pack of
300 questions that paraphrase slide titles is worse than 90 that make someone
think, because the first one teaches them their coverage map is lying.

---

## The shape of the job

1. Extract and **actually read** the material
2. Propose a topic breakdown and get it confirmed
3. Ask, per topic, how deep to go
4. Generate, validate, install
5. Report honestly what was covered and what wasn't

Steps 2 and 3 are conversations. Do not skip them; the depth judgement is the
user's, and it varies enormously between a topic they are confident on and one
they are dreading.

---

## 1. Extract and read

```bash
python .claude/skills/study-pack/scripts/extract.py <source-dir> <work-dir>
```

This writes `<work-dir>/text/` (plain text per document) and `<work-dir>/sheets/`
(contact sheets, four pages per image).

**Read the contact sheets. This is not optional.**

Lecture slides routinely hold most of their content in images — formulas, worked
examples, plots, code screenshots, tables. Text extraction returns the titles and
nothing else. On one real course, 219 slides yielded 12KB of text: roughly 15% of
what was on them, and none of the formulas.

The extract script prints a per-document character-per-page figure and flags
anything under 400 as image-heavy. Treat that flag as an instruction.

Read every sheet for a deck you intend to generate from. Skimming produces packs
that miss exactly the worked examples that make good computation questions.

As you read, keep a working note of:

- topic and subtopic structure as the lecturer actually organises it
- every formula, with its symbols defined
- every worked example with concrete numbers — these become `computation` questions
- anything the lecturer flags: "this will be tested", "won't be tested",
  "common mistake", emphasis, repetition across lectures
- the citation key for each document (`c2`, `intro`) and the page numbers

Report what you found before moving on — document count, page count, and any
document you could not read.

---

## 2. Propose a breakdown

Present a topic → subtopic tree with, for each topic, a one-line description and
the source pages it draws on. Ask the user to correct it.

Sizing that works:

| Unit | Size | Test |
| --- | --- | --- |
| Topic | 3–8 subtopics | Roughly a lecture, or a coherent chapter |
| Subtopic | 6–20 questions | Something you could sit and work through in one go |

Subtopics are the unit of the coverage map, so they must be things a person
recognises as a thing they either know or don't. "Chapter 4" is not one.
"Precision and recall" is.

Also propose an `emphasis` for each subtopic — `core`, `standard` or
`background` — and say what you based it on. Lecturer emphasis, repetition
across lectures, and the presence of worked examples are all evidence. This is
the pack's claim about what is examinable, and mock tests weight on it, so it
should be defensible rather than decorative.

---

## 3. Ask about depth, topic by topic

This is where the pack is actually specified. Ask per topic, not once globally —
the answers differ.

For each topic, offer a depth and confirm or adjust:

| Depth | Questions per subtopic | What it covers |
| --- | --- | --- |
| **Light** | 4–6 | Definitions and recognition. Enough not to have a blind spot. |
| **Standard** | 8–12 | Definitions, mechanisms, the standard comparisons. |
| **Deep** | 15–25 | Adds worked computation, edge cases, "why this and not that". |
| **Exhaustive** | 25+ | Everything examinable, including detail likely to be skipped. |

Also worth asking where the material makes it relevant:

- **Computation drills** — only where the source has worked numeric examples.
  Ask whether they want them templated (values redrawn each time).
- **Code questions** — where the source teaches an API, ask whether to test
  exact call signatures or just what the call does.
- **Anything to skip** — content the lecturer excluded, or the user already knows.

Batch these into a few rounds rather than one question per topic, but do not
collapse them into a single global setting.

Record the answers into `<pack-dir>/.study-pack.json` so a later run can offer
the same choices as defaults:

```json
{
  "source": "…/COMPX310/Test 1",
  "generatedAt": "2026-09-05",
  "topics": { "knn-and-trees": { "depth": "deep", "computation": true } }
}
```

---

## 4. Generate

Write `pack.json` and one file per topic under `topics/`. Follow
`docs/pack-format.md` exactly.

### Non-negotiables

- **Ids are permanent and unique across the whole pack.** Progress is keyed on
  them. Rewording a question keeps its history; changing its id destroys it.
  Use readable stable ids: `knn-vote`, `gini-from-r`, not `q1`, `q2`.
- **Cite every question and every formula** — `"c2 · slide 15"`. This is what
  makes a suspicious question checkable rather than merely doubted, and it is
  half of what "knowing what's examinable" means.
- **Put formulas in `formulas` and definitions in `keyFacts`**, not only inside
  questions. Those two fields are the *only* thing the cheat sheet can see.
- **Mix tiers within every subtopic.** At least one tier-1 question so a cold
  start has somewhere to begin, and tier-3 so a solid subtopic still has
  somewhere to go.
- **Never invent content.** If the source does not cover it, it does not go in
  the pack. A question whose answer isn't in the material is worse than a gap,
  because it teaches something that will be marked wrong.

### Question mix per subtopic

A reasonable default for a standard-depth subtopic of ten questions:

- 2–3 `mcq` — recognition, tier 1
- 2–3 `short` or `cloze` — supply the term or the formula, tier 2
- 2–3 `recall` — cold production, tier 3
- 1–3 `computation` — wherever the source has worked numbers

Adjust to the material. A conceptual topic may have no computation at all; a
methods topic may be half computation.

### Computation questions

These are the highest-value thing you can build, and the most work. Look for
every worked example in the source and turn it into a template.

```json
{
  "id": "gini-from-r",
  "kind": "computation",
  "prompt": "A node holds {{pct}}% class-1 examples. Give its Gini index.",
  "vars": { "pct": { "type": "int", "min": 10, "max": 90, "step": 5 } },
  "derived": { "r": "pct / 100" },
  "steps": [
    { "text": "Gini is `Q = 2r(1 − r)`, with r the proportion of one class." },
    { "text": "Here `r = {{r}}`, so `1 − r = {{1 - r}}`." },
    { "text": "`Q = 2 × {{r}} × {{1 - r}} = {{2*r*(1-r) | 4}}`" }
  ],
  "answer": { "expr": "2*r*(1-r)", "tolerance": 0.001, "decimals": 4 },
  "source": "c2 · slide 15"
}
```

Rules that matter:

- **Steps are a method, not a recap.** Step one states the rule, later steps
  substitute and evaluate. Someone who got it wrong should be able to see which
  step they diverged at.
- **Keep drawn values sane.** Ranges must produce problems a person can do by
  hand and answers that aren't absurd. Check the extremes of every range.
- **Set `tolerance` to what you would accept.** Too tight and correct working
  with sensible rounding is marked wrong, which destroys trust in the tool.
- Every `{{ … }}` must resolve. An unresolvable one renders as `⟨error⟩`.

---

## 5. Validate, install, report

Always validate. Never hand over a pack you have not run this against:

```bash
python .claude/skills/study-pack/scripts/validate.py <pack-dir>
```

Fix every error. Warnings are judgement calls — read them and decide.

Then install:

- **Runtime load (default):** leave the pack where it is and tell the user to
  open it with Packs → *Choose a folder*.
- **Bundled:** copy into `public/packs/<id>/` and add it to
  `public/packs/index.json`. Note that `public/packs/` is gitignored by
  default — say so, rather than letting them expect it in a deployment.

Finally, report honestly:

- topics, subtopics, questions, formulas, definitions
- per topic: how many questions, and at what depth
- **what you could not cover, and why** — an unreadable document, a topic the
  source treats too thinly to test, a worked example whose numbers you could not
  recover from the slide
- anything the lecturer flagged that you have encoded (`won't be tested`,
  `common mistake`) and how you handled it

Under-reporting coverage is the one thing that makes the coverage map lie. If a
subtopic got four questions because the source was thin, say so.

---

## Extending an existing pack

To add material to a pack that already exists:

1. Read `.study-pack.json` for the previous choices.
2. Generate **only the new or changed topic files.** Do not rewrite the others —
   ids would churn and take progress with them.
3. Add new entries to `pack.json`'s `topics` array.
4. Re-run the validator over the whole pack — id collisions are cross-file.

Keep every existing id byte-identical unless the user has asked for a reset.
