# Changelog

## v1.0.0 (2026-11)

First release as **Backflow** (formerly Figma Lift).

- New name, mark and visual identity (blueline / blueprint). Brand assets and tokens in `brand/`.
- `backflow` CLI, run straight from GitHub with `npx github:asiln/backflow` (an npm package, `backflow-cli`, will follow): `init`, `extract`, `run`, `pipeline`, `tokens`, `components`, `diff`, `plugin`. Through the CLI, `out/`, sessions and `backflow.config.json` live in the folder you run it from.
- One Figma plugin, **Backflow**: Fonts → Tokens → Components → Screens checklist, preview before apply, results as numbers. Full Backflow skin, following Figma's light and dark theme.
- Design system: token harvest, component detection with variants, icon sets, instances with tokens bound.
- Landing site in `site/`.

Compatibility: `figma-lift.config.json`, `$FIGMA_LIFT_TEST_PASSWORD`, `$FIGMA_LIFT_CHROME` and `$FIGMA_LIFT_CONFIG` still work. Exports keep the `figmaLift` format key and the `figmalift` plugin-data namespace, so files and Figma documents made before 1.0 import and re-run as before. A `Lift Components` page from an earlier run is reused.
