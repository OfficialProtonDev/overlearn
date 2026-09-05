# The pack format

A **pack** is a folder of JSON that Overlearn loads. One pack is usually one
assessment — a test, or a whole paper's exam — for one subject.

The app has no knowledge of any subject. Everything it shows comes from a pack.

```
compx310-test1/
  pack.json              manifest: identity + the list of topic files
  topics/
    foundations.json     one topic
    knn-and-trees.json   another
```

Topics live in separate files so a single topic can be regenerated without
rewriting the pack, and so diffs stay readable.

The authoritative definition is [`src/types/pack.ts`](../src/types/pack.ts).
Runtime checks with human-readable errors live in
[`src/lib/validate.ts`](../src/lib/validate.ts) — a pack that fails them is
reported field by field on the Packs screen rather than silently half-loading.

---

## `pack.json`

```json
{
  "schemaVersion": 1,
  "id": "compx310-test1",
  "title": "COMPX310 · Test 1",
  "subtitle": "Machine Learning",
  "description": "Lectures 1–7, up to and including deep neural networks.",
  "generatedAt": "2026-09-05",
  "source": {
    "label": "7 lecture PDFs, 219 slides",
    "detail": "Based on Lindholm et al. and Géron.",
    "documents": [
      { "key": "c2", "title": "c2_2026.pdf — Supervised Learning", "pages": 19 }
    ]
  },
  "topics": [
    { "id": "foundations", "title": "What ML Is", "file": "topics/foundations.json" }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `schemaVersion` | yes | Currently `1`. A higher number is refused rather than guessed at. |
| `id` | yes | Lowercase letters, digits and hyphens. **Progress is keyed on it — changing it resets history.** |
| `title` | yes | Shown everywhere the pack is named. |
| `subtitle` | no | Second line on the coverage page and cheat sheet. |
| `description` | no | A sentence or two on the coverage page. Supports the light markup below. |
| `generatedAt` | no | ISO date. |
| `source` | no | Where the content came from. `documents[].key` is what `source` fields on questions cite. |
| `topics` | yes | Ordered. `file` is relative to `pack.json` and may not escape the folder. |

---

## A topic file

```json
{
  "id": "knn-and-trees",
  "title": "kNN and Decision Trees",
  "summary": "Two non-parametric methods that both carve the feature space into regions.",
  "formulas": [
    {
      "name": "Gini index",
      "expression": "Q = 2r(1 − r)",
      "note": "r is the proportion of one class in the node. Maximum at r = 0.5.",
      "source": "c2 · slide 15"
    }
  ],
  "keyFacts": [
    {
      "term": "Unstable classifier",
      "definition": "A small change in the training data produces a very different tree.",
      "source": "c2 · slide 14"
    }
  ],
  "subtopics": [ /* … */ ]
}
```

`formulas` and `keyFacts` feed the **cheat sheet** and the reference panel.
They can sit on a topic or on a subtopic; subtopic-level is preferred, because
the cheat sheet's "only what I'm shaky on" filter works at subtopic granularity.

### A subtopic

```json
{
  "id": "knn-algorithm",
  "title": "The kNN algorithm",
  "emphasis": "core",
  "summary": "Compute distances to every training point, take the k nearest, vote or average.",
  "formulas": [],
  "keyFacts": [],
  "questions": [ /* … */ ]
}
```

`emphasis` is `"core"`, `"standard"` (default) or `"background"`. It drives the
`core` badge on the coverage map and weighting in mock tests: core material is
sampled twice as often, background half as often.

**Subtopics are the unit of the coverage map.** Aim for something a person
could sit down and work through — roughly 6–20 questions. One subtopic per
lecture is too coarse; one per slide is too fine.

---

## Questions

Every question needs `id`, `kind` and `prompt`. Ids must be unique **across the
whole pack**, not just the subtopic, because progress is keyed on them.

Optional on all kinds:

| Field | Notes |
| --- | --- |
| `tier` | `1` recognise · `2` supply · `3` produce. Defaults from `kind`. |
| `source` | `"c2 · slide 15"`. Shown on the card so anything suspect can be checked. |
| `explanation` | Shown after answering. |
| `tags` | Free-form labels. |

Tier drives the escalating quiz: an untouched subtopic is served tier 1, and
higher tiers unlock as it gets solid. A subtopic with nothing at or below its
current tier still gets asked at its lowest available tier, so a subtopic
written entirely as tier 3 is never unreachable.

### `mcq` — pick one

```json
{
  "id": "knn-vote",
  "kind": "mcq",
  "prompt": "In kNN classification, how is the prediction formed from the k neighbours?",
  "options": ["Majority vote", "Mean of their labels", "The nearest one wins", "Weighted sum of distances"],
  "answerIndex": 0,
  "explanation": "Regression takes the mean; classification takes a majority vote.",
  "source": "c2 · slide 5"
}
```

### `multi` — pick all that apply

`answerIndices` instead of `answerIndex`. Partial answers are reported as
partial and neither build nor break a streak.

### `short` — type it, checked leniently

```json
{
  "id": "impurity-gini",
  "kind": "short",
  "prompt": "Which impurity measure equals 2r(1 − r)?",
  "answers": ["Gini index", "Gini"]
}
```

Marking ignores case, punctuation, accents, filler words, word order and small
typos, and accepts an answer that contains the expected one. Getting most of
the key words is marked **partial** and handed back to you to judge. List every
reasonable phrasing in `answers`; the first is shown as the model answer.

### `recall` — the flashcard

```json
{
  "id": "tree-stopping",
  "kind": "recall",
  "prompt": "Name the three stopping criteria for growing a regression tree.",
  "answer": "**Max depth** reached.\n**Too few examples** left to split.\n**SSE** very close to zero.",
  "source": "c2 · slide 12"
}
```

Shown, answered from memory, then graded by you as missed / partly / got it.
`answer` supports the light markup below.

### `cloze` — fill the blanks

```json
{
  "id": "bias-variance-decomp",
  "kind": "cloze",
  "prompt": "Generalization error = {{1}} + {{2}} + irreducible error.",
  "blanks": [["bias"], ["variance"]]
}
```

The number of `{{n}}` markers must equal the number of `blanks` entries. Each
entry lists the accepted answers for that blank, marked with the same lenient
matching as `short`.

### `computation` — a worked numeric problem

```json
{
  "id": "gini-from-r",
  "kind": "computation",
  "prompt": "A node holds {{pct}}% class-1 examples. Give its Gini index.",
  "vars": {
    "pct": { "type": "int", "min": 10, "max": 90, "step": 5 }
  },
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

`steps` are revealed one at a time — this is what makes a wrong answer
diagnosable, since you can see which step your method diverged at. At least one
step is required.

**`vars` makes the question a template.** Values are drawn fresh every time it
is served and on the "New numbers" button, so the method gets drilled instead
of one answer memorised. Omit `vars` for a fixed problem.

| Var type | Shape |
| --- | --- |
| `int` | `{ "type": "int", "min": 1, "max": 20, "step": 1 }` |
| `float` | `{ "type": "float", "min": 0, "max": 1, "decimals": 2 }` |
| `choice` | `{ "type": "choice", "values": [2, 4, 8, 16] }` |

`derived` computes further values from the drawn ones, in declaration order.

### Expressions

Any string in a computation's `prompt`, `steps` or `explanation` may contain
`{{ … }}`, evaluated against the drawn variables. `{{ expr | 3 }}` rounds the
displayed value to three decimals.

Expressions are parsed by a small recursive-descent evaluator
([`src/lib/expr.ts`](../src/lib/expr.ts)) — never `eval`. Available:

- `+ - * / % ^`, parentheses, and the typographic variants `− × · ÷`
- `abs ceil exp floor ln log log2 log10 max min round sign sqrt`
- `round(x)` or `round(x, decimals)`
- constants `pi`, `e`

An expression that references an unknown name, or fails to evaluate, is a
**validation error** — it would otherwise render as `⟨error⟩` on the card.

---

## Light markup

`summary`, `description`, `definition`, `note`, `explanation` and a `recall`
answer accept a deliberately small subset — parsed into elements, never
injected as HTML:

```
**bold**    *italic*    `code`
- bullet
- bullet

Blank lines separate paragraphs.
```

Anything else is shown literally.

---

## Loading a pack

**At runtime** — Packs → *Choose a folder* (or drop the folder on the page).
It is stored in the browser and stays there between visits.

**Bundled with the app** — put it in `public/packs/<id>/` and list it in
`public/packs/index.json`:

```json
{ "packs": [{ "id": "compx310-test1", "path": "compx310-test1" }] }
```

Note that `public/packs/` is gitignored by default; see
[`public/packs/README.md`](../public/packs/README.md).

---

## Rules worth repeating

1. **Ids are permanent.** Progress is keyed on pack, subtopic and question ids.
   Rewording a question keeps its history; renaming its id throws it away.
2. **Ids are unique across the pack**, not per subtopic.
3. **Cite everything.** `source` is what makes a suspicious question checkable
   instead of merely doubted.
4. **Put formulas and definitions in `formulas`/`keyFacts`, not only in
   questions.** That is the only thing the cheat sheet can see.
5. **Set `emphasis` honestly.** It is the pack's claim about what is examinable,
   and mock tests weight on it.
