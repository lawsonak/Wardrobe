# Mannequin base image

The AI virtual try-on feature composites garments onto a single canonical
photoreal mannequin. Both files in this directory are generated, not
hand-edited:

- `base.png` — the mannequin reference image. Sent to Gemini 2.5 Flash
  Image as the first reference whenever a try-on is generated.
- `base.json` — metadata. The `id` field is part of the cache hash; bump
  it (e.g. `mq-v1` → `mq-v2`) whenever you replace `base.png` so every
  cached try-on regenerates against the new mannequin.

## Generating a fresh mannequin

```
GEMINI_API_KEY=... npm run generate:mannequin
```

Run it a few times and pick the best output before committing — the model
is non-deterministic and you want a clean front-facing dress form with no
facial features and a plain background.

To force a new id (and invalidate every existing try-on):

```
GEMINI_API_KEY=... npm run generate:mannequin -- --id mq-v2
```
