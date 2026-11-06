// Project configuration. Nothing app-specific or secret is hard-coded in the tool.
// Lookup order: $FIGMA_LIFT_CONFIG (path) -> ./figma-lift.config.json (gitignored) -> defaults below.
// The test password is read from $FIGMA_LIFT_TEST_PASSWORD (preferred) or config.password.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS = {
  baseUrl: 'http://localhost:3000',
  apiUrl: 'http://localhost:8000',
  apiPrefix: '/api/v1',
  locale: 'en-US',
  // POST {apiUrl}{apiPrefix}{login.path} with { [identifierField]: batch.phone, [passwordField]: password }.
  // The response must set the session cookies; they are stored in state-<id>.json.
  login: { path: '/auth/login', identifierField: 'identifier', passwordField: 'password' },
  // localStorage entries set before every page load (e.g. to skip an onboarding tutorial).
  localStorage: {},
  // A screen with "tutorial": true removes these keys again.
  tutorialKeys: [],
};

export function loadConfig() {
  const file = process.env.FIGMA_LIFT_CONFIG || path.join(here, 'figma-lift.config.json');
  let user = {};
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = { ...DEFAULTS, ...user, login: { ...DEFAULTS.login, ...(user.login || {}) } };
  cfg.password = process.env.FIGMA_LIFT_TEST_PASSWORD || user.password || '';
  return cfg;
}
