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
```

`index.json` looks like this:

```json
{
  "packs": [
    { "id": "compx310-test1", "path": "compx310-test1" }
  ]
}
```

A missing or empty `index.json` is fine — it just means nothing is bundled,
and the app opens on the library screen instead.

## These are gitignored

`.gitignore` excludes everything here except this file. Packs are generated
from course material, and this repository is public, so the derived questions
stay on your machine by default. Load them at runtime with **Packs → Choose a
folder**, which works identically and stores them in your browser.

If you do want to ship a pack — for a course where that's appropriate, or in a
private fork — remove these two lines from `.gitignore`:

```
public/packs/*
!public/packs/README.md
```

## Generating a pack

Use the `study-pack` skill:

```
/study-pack "path/to/your/course/material"
```

It reads the source documents, proposes a topic breakdown, asks you how deep to
go on each one, and writes the pack. See `docs/pack-format.md` for the schema if
you'd rather write one by hand.
