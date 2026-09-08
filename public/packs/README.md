# Bundled packs

Anything in this folder ships with the built app and is offered automatically
on first load, without the user having to point at a folder.

## Layout

```
public/packs/
  index.json                 <- lists the packs to load at startup
  compx310-test1/
    pack.json                <- manifest
    topics/
      foundations.json
      knn-and-trees.json
  compx361-test1/
    pack.json
    topics/
      dfsas.json
      pumping-lemma.json
```

`index.json` looks like this:

```json
{
  "packs": [
    { "id": "compx310-test1", "path": "compx310-test1" },
    { "id": "compx361-test1", "path": "compx361-test1" }
  ]
}
```

A missing or empty `index.json` is fine — it just means nothing is bundled,
and the app opens on the library screen instead.

## What ships, and what stays local

`.gitignore` excludes everything here except this file, `index.json`, and the
two committed packs `compx310-test1` and `compx361-test1`, so the deployed app
has something to open on first load instead of an empty library.

Packs you generate stay on your machine by default: they're derived from your
own course material and this repository is public. Load them at runtime with
**Packs → Choose a folder**, which works identically and stores them in your
browser.

To ship another, list it in `index.json` and add a negation line to
`.gitignore` alongside the existing one:

```
!public/packs/your-pack-id/
```

## Generating a pack

Use the `study-pack` skill:

```
/study-pack "path/to/your/course/material"
```

It reads the source documents, proposes a topic breakdown, asks you how deep to
go on each one, and writes the pack. See `docs/pack-format.md` for the schema if
you'd rather write one by hand.
