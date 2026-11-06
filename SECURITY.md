# Security

Figma Lift runs a headless browser against **your own local or staging apps** with **test accounts**, and writes JSON files to disk. It makes no network calls of its own besides the app you point it at, and the Figma plugin has network access disabled.

Things to keep in mind:

- Exports can contain real text and images from your app. Treat `out/` as private data.
- Do not point it at production or at sites you do not own. The extractor only accepts localhost origins.
- Never put passwords in batch files. Use the environment variable described in the README.

To report a vulnerability, use GitHub's **Report a vulnerability** (private security advisory) on this repository rather than a public issue. You will get a reply as soon as possible.
