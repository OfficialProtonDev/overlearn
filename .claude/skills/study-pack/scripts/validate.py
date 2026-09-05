#!/usr/bin/env python3
"""
Validate a pack folder before handing it over.

Mirrors src/lib/validate.ts, so anything this accepts the app will load, and
anything it rejects the app would have rejected with the same message. Run it
after generating and fix everything it reports — a pack that fails validation
does not half-load, it refuses.

Usage:
    python validate.py <pack-dir>            # exits non-zero on any error
    python validate.py <pack-dir> --quiet    # only print problems
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

SCHEMA_VERSION = 1
KINDS = {"mcq", "multi", "short", "recall", "cloze", "computation"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
EXPR_RE = re.compile(r"\{\{([^}]*)\}\}")
CLOZE_MARKER_RE = re.compile(r"\{\{\s*\d+\s*\}\}")

FUNCTIONS = {
    "abs", "ceil", "exp", "floor", "ln", "log", "log2", "log10",
    "max", "min", "round", "sign", "sqrt",
}
CONSTANTS = {"pi", "e"}


def _safe_namespace(scope: dict[str, float]) -> dict[str, object]:
    ns: dict[str, object] = dict(scope)
    ns.update({"pi": math.pi, "e": math.e})
    ns.update(
        {
            "abs": abs, "ceil": math.ceil, "exp": math.exp, "floor": math.floor,
            "ln": math.log, "log": math.log, "log2": math.log2, "log10": math.log10,
            "max": max, "min": min, "sign": lambda x: (x > 0) - (x < 0),
            "sqrt": math.sqrt,
            "round": lambda x, d=0: round(x, int(d)),
        }
    )
    return ns


def _evaluate(source: str, scope: dict[str, float]) -> float:
    """Evaluate a checked expression. Returns 1.0 if it cannot be evaluated."""
    cleaned = (
        source.replace("−", "-").replace("×", "*").replace("·", "*").replace("÷", "/")
    )
    try:
        value = eval(cleaned.replace("^", "**"), {"__builtins__": {}}, _safe_namespace(scope))  # noqa: S307
        return float(value)
    except Exception:  # noqa: BLE001
        return 1.0


class Report:
    def __init__(self) -> None:
        self.errors: list[tuple[str, str]] = []
        self.warnings: list[tuple[str, str]] = []

    def error(self, path: str, message: str) -> None:
        self.errors.append((path, message))

    def warn(self, path: str, message: str) -> None:
        self.warnings.append((path, message))


# --------------------------------------------------------------------------
# Expression checking — same grammar as src/lib/expr.ts
# --------------------------------------------------------------------------


def check_expression(source: str, scope: dict[str, float]) -> str | None:
    """
    Return an error message, or None when the expression is usable.

    `scope` maps each declared variable to a *representative* value drawn from
    its declared range. Probing with a constant instead would reject perfectly
    good expressions: `ln(1 - r)` is fine for r in [0.1, 0.9] but not for an
    arbitrary probe value above 1.
    """
    names = set(scope)
    cleaned = (
        source.replace("−", "-").replace("×", "*").replace("·", "*").replace("÷", "/")
    )

    if not cleaned.strip():
        return "empty expression"

    for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", cleaned):
        followed_by_paren = re.search(rf"\b{re.escape(token)}\s*\(", cleaned)
        if followed_by_paren:
            if token not in FUNCTIONS:
                return f'unknown function "{token}()"'
        elif token not in names and token not in CONSTANTS:
            return f'unknown variable "{token}"'

    if cleaned.count("(") != cleaned.count(")"):
        return "unbalanced parentheses"

    # Evaluate in a namespace holding only the whitelisted functions.
    scope = dict(scope)
    scope.update({"pi": math.pi, "e": math.e})
    scope.update(
        {
            "abs": abs, "ceil": math.ceil, "exp": math.exp, "floor": math.floor,
            "ln": math.log, "log": math.log, "log2": math.log2, "log10": math.log10,
            "max": max, "min": min, "sign": lambda x: (x > 0) - (x < 0),
            "sqrt": math.sqrt,
            "round": lambda x, d=0: round(x, int(d)),
        }
    )

    python_expr = cleaned.replace("^", "**")
    try:
        value = eval(python_expr, {"__builtins__": {}}, scope)  # noqa: S307
    except ZeroDivisionError:
        return None  # depends on the drawn values; not a structural fault
    except Exception as exc:  # noqa: BLE001
        return f"could not be evaluated ({exc})"

    if isinstance(value, complex) or (isinstance(value, float) and not math.isfinite(value)):
        return "does not evaluate to a finite number"
    return None


# --------------------------------------------------------------------------
# Questions
# --------------------------------------------------------------------------


def check_question(q: object, path: str, r: Report) -> None:
    if not isinstance(q, dict):
        r.error(path, "each question must be an object")
        return

    for field in ("id", "prompt"):
        if not isinstance(q.get(field), str) or not q[field].strip():
            r.error(path, f"{field} is required and must be a non-empty string")

    kind = q.get("kind")
    if kind not in KINDS:
        r.error(path, f"kind must be one of {', '.join(sorted(KINDS))} — got {kind!r}")
        return

    if "tier" in q and q["tier"] not in (1, 2, 3):
        r.error(path, "tier must be 1, 2 or 3")

    if kind in {"mcq", "multi"}:
        options = q.get("options")
        if not isinstance(options, list) or len(options) < 2:
            r.error(path, "options must be an array of at least two strings")
            return
        if not all(isinstance(o, str) and o.strip() for o in options):
            r.error(path, "every option must be a non-empty string")
            return
        if len({o.strip().lower() for o in options}) != len(options):
            r.warn(path, "two or more options are identical, making the question unanswerable")

        if kind == "mcq":
            idx = q.get("answerIndex")
            if not isinstance(idx, int):
                r.error(path, "answerIndex is required for an mcq question")
            elif not 0 <= idx < len(options):
                r.error(path, f"answerIndex {idx} is outside options (0..{len(options) - 1})")
        else:
            indices = q.get("answerIndices")
            if not isinstance(indices, list) or not indices:
                r.error(path, "answerIndices must be a non-empty array")
            else:
                for i in indices:
                    if not isinstance(i, int) or not 0 <= i < len(options):
                        r.error(path, f"answerIndices contains {i!r}, which is outside options")

    elif kind == "short":
        answers = q.get("answers")
        if not isinstance(answers, list) or not answers:
            r.error(path, "answers must be a non-empty array of accepted strings")
        elif not all(isinstance(a, str) and a.strip() for a in answers):
            r.error(path, "every entry in answers must be a non-empty string")

    elif kind == "recall":
        if not isinstance(q.get("answer"), str) or not q["answer"].strip():
            r.error(path, "answer is required and must be a non-empty string")

    elif kind == "cloze":
        blanks = q.get("blanks")
        if not isinstance(blanks, list) or not blanks:
            r.error(path, "blanks must be a non-empty array")
        else:
            for i, b in enumerate(blanks):
                if not isinstance(b, list) or not b or not all(
                    isinstance(x, str) and x.strip() for x in b
                ):
                    r.error(path, f"blanks[{i}] must be a non-empty array of strings")

            prompt = q.get("prompt")
            if isinstance(prompt, str):
                markers = CLOZE_MARKER_RE.findall(prompt)
                if len(markers) != len(blanks):
                    r.error(
                        path,
                        f"prompt has {len(markers)} blank marker(s) but blanks has "
                        f"{len(blanks)} entry/entries — they must match",
                    )

    elif kind == "computation":
        check_computation(q, path, r)


def check_computation(q: dict, path: str, r: Report) -> None:
    steps = q.get("steps")
    if not isinstance(steps, list) or not steps:
        r.error(path, "steps must be a non-empty array — stepped reveal is the point of this kind")

    answer = q.get("answer")
    if not isinstance(answer, dict) or not isinstance(answer.get("expr"), str):
        r.error(path, "answer.expr is required and must be an expression string")
        return

    scope: dict[str, float] = {}

    vars_ = q.get("vars")
    if vars_ is not None:
        if not isinstance(vars_, dict):
            r.error(path, "vars must be an object mapping names to specs")
        else:
            for name, spec in vars_.items():
                if not isinstance(spec, dict):
                    r.error(path, f"vars.{name} must be an object")
                    continue
                kind = spec.get("type")
                if kind in {"int", "float"}:
                    lo, hi = spec.get("min"), spec.get("max")
                    if not isinstance(lo, (int, float)) or not isinstance(hi, (int, float)):
                        r.error(path, f"vars.{name} needs numeric min and max")
                        continue
                    if lo > hi:
                        r.error(path, f"vars.{name} has min greater than max")
                    scope[name] = (lo + hi) / 2
                elif kind == "choice":
                    values = spec.get("values")
                    if not isinstance(values, list) or not values:
                        r.error(path, f"vars.{name} needs a non-empty values array")
                        continue
                    try:
                        scope[name] = float(values[0])
                    except (TypeError, ValueError):
                        scope[name] = 1.0
                else:
                    r.error(path, f'vars.{name}.type must be "int", "float" or "choice"')
                    continue

    derived = q.get("derived")
    if derived is not None:
        if not isinstance(derived, dict):
            r.error(path, "derived must be an object mapping names to expressions")
        else:
            for name, expr in derived.items():
                if not isinstance(expr, str):
                    r.error(path, f"derived.{name} must be an expression string")
                    continue
                problem = check_expression(expr, scope)
                if problem:
                    r.error(path, f'derived.{name} = "{expr}" {problem}')
                    scope[name] = 1.0
                    continue
                # Bind the real derived value, so expressions built on it are
                # checked against something realistic rather than a placeholder.
                scope[name] = _evaluate(expr, scope)

    problem = check_expression(answer["expr"], scope)
    if problem:
        r.error(path, f'answer.expr = "{answer["expr"]}" {problem}')

    texts = [q.get("prompt"), q.get("explanation")]
    if isinstance(steps, list):
        texts += [s.get("text") for s in steps if isinstance(s, dict)]

    for text in texts:
        if not isinstance(text, str):
            continue
        for match in EXPR_RE.findall(text):
            expr = match.split("|")[0].strip()
            if not expr:
                continue
            problem = check_expression(expr, scope)
            if problem:
                r.error(path, f"the expression {{{{{expr}}}}} {problem}")


# --------------------------------------------------------------------------
# Topics and manifest
# --------------------------------------------------------------------------


def check_topic(data: object, file_label: str, r: Report) -> dict | None:
    if not isinstance(data, dict):
        r.error(file_label, "the file must contain a JSON object")
        return None

    for field in ("id", "title"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            r.error(file_label, f"{field} is required and must be a non-empty string")

    subtopics = data.get("subtopics")
    if not isinstance(subtopics, list) or not subtopics:
        r.error(file_label, "subtopics must be a non-empty array")
        return None

    for i, sub in enumerate(subtopics):
        path = f"{file_label} subtopics[{i}]"
        if not isinstance(sub, dict):
            r.error(path, "each subtopic must be an object")
            continue

        for field in ("id", "title"):
            if not isinstance(sub.get(field), str) or not sub[field].strip():
                r.error(path, f"{field} is required and must be a non-empty string")

        if "emphasis" in sub and sub["emphasis"] not in {"core", "standard", "background"}:
            r.error(path, 'emphasis must be "core", "standard" or "background"')

        questions = sub.get("questions")
        if not isinstance(questions, list):
            r.error(path, "questions must be an array")
            continue
        if not questions:
            r.warn(path, "no questions, so this subtopic will always read as untouched")
            continue

        for j, q in enumerate(questions):
            check_question(q, f"{path} questions[{j}]", r)

    return data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", type=Path)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    r = Report()
    pack_dir = args.pack
    manifest_path = pack_dir / "pack.json"

    if not manifest_path.is_file():
        print(f"error: {manifest_path} not found", file=sys.stderr)
        return 1

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"error: pack.json is not valid JSON — {exc}", file=sys.stderr)
        return 1

    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        r.error("pack.json", f"schemaVersion must be {SCHEMA_VERSION}")

    for field in ("id", "title"):
        if not isinstance(manifest.get(field), str) or not manifest[field].strip():
            r.error("pack.json", f"{field} is required and must be a non-empty string")

    if isinstance(manifest.get("id"), str) and not ID_RE.match(manifest["id"]):
        r.error("pack.json", f'id "{manifest["id"]}" must be lowercase letters, digits and hyphens')

    topics = manifest.get("topics")
    if not isinstance(topics, list) or not topics:
        r.error("pack.json", "topics must be a non-empty array")
        topics = []

    subtopic_ids: dict[str, str] = {}
    question_ids: dict[str, str] = {}
    counts = {"topics": 0, "subtopics": 0, "questions": 0, "formulas": 0, "facts": 0}

    for i, ref in enumerate(topics):
        label = f"pack.json topics[{i}]"
        if not isinstance(ref, dict):
            r.error(label, "each topic entry must be an object")
            continue

        for field in ("id", "title", "file"):
            if not isinstance(ref.get(field), str) or not ref[field].strip():
                r.error(label, f"{field} is required")

        file_rel = ref.get("file")
        if not isinstance(file_rel, str):
            continue
        if file_rel.startswith("/") or ".." in file_rel:
            r.error(label, f'file "{file_rel}" must be a relative path inside the pack folder')
            continue

        topic_path = pack_dir / file_rel
        if not topic_path.is_file():
            r.error(label, f'file "{file_rel}" was not found')
            continue

        try:
            data = json.loads(topic_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            r.error(file_rel, f"not valid JSON — {exc}")
            continue

        topic = check_topic(data, file_rel, r)
        if topic is None:
            continue

        if topic.get("id") != ref.get("id"):
            r.error(file_rel, f'topic id "{topic.get("id")}" does not match the manifest\'s "{ref.get("id")}"')

        counts["topics"] += 1
        counts["formulas"] += len(topic.get("formulas") or [])
        counts["facts"] += len(topic.get("keyFacts") or [])

        for sub in topic.get("subtopics", []):
            if not isinstance(sub, dict):
                continue
            counts["subtopics"] += 1
            counts["formulas"] += len(sub.get("formulas") or [])
            counts["facts"] += len(sub.get("keyFacts") or [])

            sid = sub.get("id")
            if isinstance(sid, str):
                if sid in subtopic_ids:
                    r.error(file_rel, f'subtopic id "{sid}" already used in "{subtopic_ids[sid]}"')
                subtopic_ids[sid] = file_rel

            for q in sub.get("questions", []):
                if not isinstance(q, dict):
                    continue
                counts["questions"] += 1
                qid = q.get("id")
                if isinstance(qid, str):
                    if qid in question_ids:
                        r.error(
                            file_rel,
                            f'question id "{qid}" already used in "{question_ids[qid]}" — '
                            "progress is keyed on it, so ids must be unique across the pack",
                        )
                    question_ids[qid] = f"{file_rel}/{sid}"

    for path, message in r.errors:
        print(f"ERROR  {path}\n       {message}")
    for path, message in r.warnings:
        print(f"WARN   {path}\n       {message}")

    if not args.quiet or r.errors:
        print()
        print(
            f"{counts['topics']} topics · {counts['subtopics']} subtopics · "
            f"{counts['questions']} questions · {counts['formulas']} formulas · "
            f"{counts['facts']} definitions"
        )
        print(f"{len(r.errors)} error(s), {len(r.warnings)} warning(s)")

    return 1 if r.errors else 0


if __name__ == "__main__":
    sys.exit(main())
