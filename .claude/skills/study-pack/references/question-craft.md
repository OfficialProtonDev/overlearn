# Writing questions worth answering

The failure mode of generated study material is questions that look like
questions and test nothing. They are easy to produce in volume and they actively
harm the tool, because they inflate the coverage map: someone reads "Solid" on a
subtopic they cannot actually do.

Every question should have a defensible answer to: **what does getting this
wrong tell you that you didn't know?**

---

## The tests a question has to pass

**Would someone who understood the material still get it right if the wording
changed?** If the question is answerable by matching words between prompt and
option, it tests reading, not knowledge.

**Is the answer in the source?** Not "consistent with", *in*. If you inferred it,
cut it. A wrong answer key is the one bug that makes the tool worse than nothing.

**Is it one thing?** A question that asks two things gets a muddled verdict and
teaches nothing about either.

**Would the lecturer recognise this as something they taught?** Packs are built
from a specific course, not from the subject in general. Testing standard
material the course happened not to cover wastes time and misrepresents scope.

---

## By kind

### `mcq` — recognition, tier 1

The distractors are the question. Three obviously-wrong options make a lookup,
not a test.

Good distractors are **things a person actually confuses this with**:

- the neighbouring concept (precision vs recall, bias vs variance)
- the same idea with a term inverted (`TP/(TP+FN)` vs `TP/(TP+FP)`)
- a plausible-sounding statement that is true of a *different* method
- the common misconception the lecturer explicitly warned about

Avoid: joke options, "all of the above", options of conspicuously different
length (the long one reads as the answer), and negation unless the source
frames it that way.

**Vary where the answer sits.** Writing the answer first and then three
distractors is the natural way to think, and it produces packs where
`answerIndex` is 0 every single time — the first version of the bundled pack
had it in 300 of 301 questions. Move the answer around as you write: across a
subtopic, `answerIndex` should be spread over the available positions with no
position obviously favoured.

The app shuffles options on the way to the screen, so a lopsided pack is no
longer fatal. Do not treat that as permission to skip this — the raw
`answerIndex` is what a person sees when they read the JSON, and a pack that is
right on its own terms survives being read, diffed and exported.

```json
{
  "id": "precision-definition",
  "kind": "mcq",
  "prompt": "A classifier flags 8 emails as spam; 6 really are. 4 spam emails were missed. What is its precision?",
  "options": ["6/10", "8/12", "6/8", "6/12"],
  "answerIndex": 2,
  "explanation": "Precision is TP/(TP+FP) = 6/8. 6/10 is recall — TP/(TP+FN) — which is the usual slip.",
  "source": "c4 · slide 12"
}
```

Every distractor there is a real confusion, the explanation names the slip, and
the answer is not sitting in the first slot.

The same applies to `multi`: `answerIndices` of `[0, 1, 2]` every time tells the
reader the answers are the ones at the top.

### `short` — supply the term, tier 2

Ask for something with a short, specific answer. If the natural answer is a
sentence, it should be `recall` instead.

List **every reasonable phrasing** in `answers`. Marking is lenient about case,
punctuation, word order and typos, but it cannot know that "L2 penalty" and
"ridge" are the same thing unless you say so.

```json
{
  "answers": ["ridge regression", "ridge", "L2 regularization", "L2 penalty"]
}
```

Under-listing accepted answers is the single most common way to make a study
tool infuriating.

### `cloze` — the shape of a formula or definition, tier 2

Best where the *structure* is the thing to remember and the gaps are the parts
people drop.

```json
{
  "prompt": "Generalization error = {{1}} + {{2}} + irreducible error.",
  "blanks": [["bias"], ["variance"]]
}
```

Blank the load-bearing words. Blanking "the" tests nothing. Never blank so much
that the sentence stops constraining the answer.

### `recall` — cold production, tier 3

The flashcard. This is where real retention gets built, so most subtopics want
at least two.

The prompt should be answerable in fifteen to sixty seconds, and the answer
should be checkable against what the person said. Structure it so self-grading
is honest:

```json
{
  "kind": "recall",
  "prompt": "Name the three stopping criteria for growing a regression tree.",
  "answer": "**Max depth** reached.\n**Too few examples** left to split.\n**SSE** close to zero.",
  "source": "c2 · slide 12"
}
```

"Name the three…" is much better than "Explain tree stopping" — the person knows
whether they got three.

Avoid prompts so broad that any answer feels partly right. That makes
self-grading meaningless, and self-grading is the whole mechanism here.

### `computation` — method drilling, tier 3

The highest-value kind. Build one for **every worked example in the source**.

```json
{
  "id": "confusion-precision",
  "kind": "computation",
  "prompt": "A confusion matrix reads [[{{tn}}, {{fp}}], [{{fn}}, {{tp}}]]. Give the precision to 3 dp.",
  "vars": {
    "tn": { "type": "int", "min": 20, "max": 90 },
    "fp": { "type": "int", "min": 1, "max": 15 },
    "fn": { "type": "int", "min": 1, "max": 15 },
    "tp": { "type": "int", "min": 10, "max": 60 }
  },
  "steps": [
    { "text": "Rows are actual classes, columns predictions, so `TP = {{tp}}` and `FP = {{fp}}`." },
    { "text": "`precision = TP / (TP + FP) = {{tp}} / {{tp + fp}}`" },
    { "text": "`= {{tp/(tp+fp) | 3}}`" }
  ],
  "answer": { "expr": "tp / (tp + fp)", "tolerance": 0.002, "decimals": 3 },
  "source": "c4 · slide 12"
}
```

Checklist:

- **Check both ends of every range.** Draw the minimum and the maximum of each
  var and confirm the problem is still sensible and hand-doable.
- **Step one is the rule, not the arithmetic.** Someone stuck should get
  unstuck by step one without being handed the answer.
- **Tolerance matches sensible rounding.** For a 3 dp answer, `0.002` accepts
  the rounding a person would actually do. Too tight is worse than too loose.
- **Templated by default** where the method is what matters. Fixed (no `vars`)
  where the specific numbers are the point — a figure from the slides you want
  recognised.

---

## Hints

Any question that has to be typed or produced — `short`, `cloze`, `recall`,
`computation` — may carry an optional `hint`. It is shown only when the person
asks for it, and taking it caps that answer at `partial`, so it never quietly
inflates mastery.

A hint points at the **idea**, never the spelling:

```json
{
  "kind": "short",
  "prompt": "What is the term for constraining a model in order to reduce overfitting?",
  "answers": ["regularization", "regularisation"],
  "hint": "It's the family of techniques that penalise complexity rather than error.",
  "source": "intro · slide 34"
}
```

Good: names the idea's neighbourhood, recalls where it appeared in the course,
or gives the shape of the reasoning. Bad: "starts with an r", "two words",
"rhymes with…" — the app already derives that kind of hint from the answer
itself when no `hint` is written, so spending one on spelling wastes it.

Hints are optional and worth writing for the questions people genuinely get
stuck on: the tier-3 recall prompts and anything whose answer is a term the
course introduced once. Do not write one for every question.

`mcq` and `multi` do not take hints — the options are already the help.

## Formulas and definitions

These are separate from questions and feed the cheat sheet. A formula that only
exists inside a question cannot be printed, so it is invisible when it is most
needed.

```json
{
  "name": "F1 score",
  "expression": "F1 = 2PR / (P + R)",
  "note": "Harmonic mean of precision and recall. Use F_beta when recall matters more.",
  "source": "c4 · slide 14"
}
```

- `expression` is plain text and renders in the mono face. Use `−` `×` `·` `÷`
  freely; write subscripts as `x_i` and powers as `x^2`.
- `note` defines the symbols and says when to reach for it. It is the first
  thing dropped when the sheet is squeezed, so put the essential meaning in
  `name` and `expression`.

Definitions are for terms someone could be asked to define cold. Keep them to
one or two sentences and lead with what it *is*, not with context.

---

## Explanations

An explanation is read at the moment of getting it wrong. It should say what the
right answer is *and why the wrong one was tempting*:

> Precision is TP/(TP+FP) = 6/8. 6/10 is recall — TP/(TP+FN) — which is the
> usual slip.

Not:

> Precision measures the accuracy of positive predictions.

The first repairs a specific confusion. The second restates the question.

---

## Calibration

Roughly, per subtopic at standard depth:

| | Count |
| --- | --- |
| Tier 1 (`mcq`) | 2–3 |
| Tier 2 (`short`, `cloze`, `multi`) | 3–4 |
| Tier 3 (`recall`, `computation`) | 3–5 |

Every subtopic needs at least one tier-1 question — otherwise a cold start opens
on material at full difficulty — and at least one tier-3, or a solid subtopic has
nowhere left to escalate to.

If a subtopic cannot support ten questions honestly, give it four and say so in
the report. Padding is the one thing that makes the coverage map lie.
