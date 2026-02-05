import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '../..');
export const SRC_DIR = path.join(ROOT_DIR, 'src');
export const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');

export const GENERATED_HEADER = '/** @generated AUTO-GENERATED FILE - safe to overwrite */';

export const RENDER_WITH_PROVIDERS_PATH = '@/test-utils/renderWithProviders';

export const IGNORE_DIRS = [
  '__tests__',
  '__test__',
  '.test',
  '.spec',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
];

export const IGNORE_PATTERNS = [/\.test\./, /\.spec\./, /__tests__/, /__test__/];
