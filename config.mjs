// Project configuration. Nothing app-specific or secret is hard-coded in the tool.
// Lookup order: $BACKFLOW_CONFIG (path) -> <workdir>/backflow.config.json (gitignored) -> defaults below.
// The test password is read from $BACKFLOW_TEST_PASSWORD (preferred) or config.password.
// The pre-1.0 names still work: $FIGMA_LIFT_CONFIG, figma-lift.config.json, $FIGMA_LIFT_TEST_PASSWORD.
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

// Where exports, saved sessions and the config live. The tool folder when run from a clone; the folder
// you ran `backflow` in when run through the CLI (bin/backflow.mjs sets BACKFLOW_WORKDIR).
export const workDir = () => path.resolve(process.env.BACKFLOW_WORKDIR || here);

export function configFile() {
  if (process.env.BACKFLOW_CONFIG) return process.env.BACKFLOW_CONFIG;
  if (process.env.FIGMA_LIFT_CONFIG) return process.env.FIGMA_LIFT_CONFIG;
  const w = workDir();
  for (const n of ['backflow.config.json', 'figma-lift.config.json']) if (fs.existsSync(path.join(w, n))) return path.join(w, n);
  return path.join(w, 'backflow.config.json');
}

export function loadConfig() {
  const file = configFile();
  let user = {};
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = { ...DEFAULTS, ...user, login: { ...DEFAULTS.login, ...(user.login || {}) } };
  cfg.password = process.env.BACKFLOW_TEST_PASSWORD || process.env.FIGMA_LIFT_TEST_PASSWORD || user.password || '';
  return cfg;
}
