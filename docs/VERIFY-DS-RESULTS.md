# Figma behaviour measured with `plugin/verify-ds` (one run, Figma desktop, Starter plan)

These are the real answers the component and token plugins are written against. The machine-readable block is `docs/verify-ds.cfg.json`.

| Question | Result | Consequence for the build |
|---|---|---|
| E1 promote with `createComponentFromNode` | Only the node type changed (FRAME to COMPONENT); layout, sizing, FILL text, absolute children and constraints are all kept | Build masters with the existing `build()` and promote. `promoteKeepsLayout` is effectively **true** (the run reported false because it counted the type change as a diff) |
| E2 instance sizing | `resize()` and `layoutSizingHorizontal = 'FILL'` work on instances; HUG instances grow with longer text | Instances behave like frames; keep source sizing |
| E3 speed | `createInstance()` is about 4.5x faster than building 8 nodes by hand (about 10 ms vs 46 ms) | Go. Yield to the UI every 24 instances |
| E4 icon stroke on resize | Stroke weight does **not** scale when an instance is resized; nested vector paints bind to variables; stroke weight is overridable | Per-size icon variants or a `strokeWeight` override on nested vectors |
| E5 variants | Component properties added before `combineAsVariants` survive on the set. Selecting a missing combination **throws** | Add properties first; never request a hole combination (fill holes or guard) |
| E6 optional parts | A hidden child leaves the auto-layout flow, including its gap | BOOLEAN properties render like the source |
| E7 nesting | `isExposedInstance` can be set; nested props are set by walking into the instance; INSTANCE_SWAP via `setProperties` works | Exposed nested instances are viable |
| E8 binding cost | About 0.94 ms per paint bind; whole corpus estimated at about 113 s | Bind everything (`bindScope: all`) |
| E9 registry | After `loadAllPagesAsync`, `findAllWithCriteria` per page finds registry nodes on every page; cross-page `getNodeByIdAsync` works | Registry may live on a separate Components page |
| E10 local key import | `importComponentByKeyAsync` fails for unpublished local components | Keep exports and the design system in **one file** |
| E11 text styles | Applying a text style **overwrites** range overrides; a bound fill variable survives | Apply the style first, then re-apply runs |
| E12 effects and gradients | Effect styles keep a bound colour variable. Gradient stops bind via `stops[i].boundVariables.color = createVariableAlias(v)` inside the paint literal. `setBoundVariableForPaint` rejects gradients | Use the literal form for gradients |
| E13 text style precision | Fractional line height is exact in pixels; letter spacing is exact in percent | Write letter spacing as PERCENT |
| E14 variables | Scopes, alias chains and WEB code syntax persist. A **second mode is not available** (plan limit) | One mode per collection; the earlier design system already follows this |
| E15 instance root props | Opacity, blend mode, clip and rotation are inherited and overridable | Rotated or blended nodes can still be instances |
| E16 variant switching | `swapComponent` keeps overrides; assigning `mainComponent` clears them | Use `swapComponent` |
| E17 big sets | 24 members combine in 27 ms, but they stack on top of each other afterwards | A grid layout helper plus `resizeWithoutConstraints` is required after combining |
| E18 sections | Components inside a Section work; description and documentation links persist | Store confidence tags in the description |
| E19 menu commands | Not tested in this run (`manifest-menu.json` still to try) | Use three small plugins if multi-command menus fail |
| E20 Vazirmatn text | Text properties keep auto-resize; hug width and wrapped height grow correctly | Text overrides are safe for Persian |

Cleanup note: 803 nodes, 7 variables, 6 collections, 5 styles and 2 pages were removed and the post-sweep found nothing left. 35 nodes reported "Removing this node is not allowed", which is expected for nodes inside component instances that were deleted with their parent.
