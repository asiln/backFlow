# Changelog

## v1.0.1 (2026-11-08)

- Backflow is on Figma Community: https://www.figma.com/community/plugin/1701263956497261578
- The plugin manifest carries its registered Figma ID, so local copies (`npx backflow-cli plugin`, the release zip) match the published plugin.
- README, site and CLI help link to the Community plugin; site at https://backflow-site.vercel.app.

## v1.0.0 (2026-11)

First release as **Backflow** (formerly Figma Lift).

- New name, mark and visual identity (blueline / blueprint). Brand assets and tokens in `brand/`.
- `backflow` CLI, published on npm as `backflow-cli`: `init`, `extract`, `run`, `pipeline`, `tokens`, `components`, `diff`, `plugin`. Through the CLI, `out/`, sessions and `backflow.config.json` live in the folder you run it from.
- One Figma plugin, **Backflow**: Fonts → Tokens → Components → Screens checklist, preview before apply, results as numbers. Full Backflow skin, following Figma's light and dark theme.
- Design system: token harvest, component detection with variants, icon sets, instances with tokens bound.
- Landing site in `site/`.

Compatibility: `figma-lift.config.json`, `$FIGMA_LIFT_TEST_PASSWORD`, `$FIGMA_LIFT_CHROME` and `$FIGMA_LIFT_CONFIG` still work. Exports keep the `figmaLift` format key and the `figmalift` plugin-data namespace, so files and Figma documents made before 1.0 import and re-run as before. A `Lift Components` page from an earlier run is reused.
