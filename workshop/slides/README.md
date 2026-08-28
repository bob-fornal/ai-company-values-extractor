# Workshop Slides

`cloudflare-worker-workshop.pptx` — 32 slides covering the full 4-hour
agenda in [../README.md](../README.md): title, agenda, project overview,
then a divider + concept + case-study + hands-on-lab sequence for each of
the 6 phases, two break slides, and a retrospective/closing.

## Regenerating the deck

The deck is generated from `build_deck.js` (`pptxgenjs`), not hand-edited
XML — change the script and rebuild rather than editing the `.pptx`
directly.

```bash
npm install pptxgenjs
node build_deck.js
```

This writes `cloudflare-worker-workshop.pptx` in the same folder.
