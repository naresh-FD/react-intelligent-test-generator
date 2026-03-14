export type FailureKind =
  | 'missing-module'
  | 'type-mismatch'
  | 'provider-required'
  | 'hook-shape'
  | 'matcher'
  | 'unknown';

export interface FailureContext {
  kind: FailureKind;
  moduleName?: string;
  missingProperty?: string;
  hookName?: string;
  providerHint?: 'router' | 'query-client' | 'redux' | 'generic';
  raw: string;
}

export function parseFailureContext(errorOutput: string): FailureContext {
  const raw = errorOutput ?? '';

  const missingModule = raw.match(/Cannot find module ['\"]([^'\"]+)['\"]/i);
  if (missingModule) {
    return { kind: 'missing-module', moduleName: missingModule[1], raw };
  }

  if (/TS2322/i.test(raw)) {
    return { kind: 'type-mismatch', raw };
  }

  if (/useNavigate|useLocation|outside.*Router|context of a <Router>/i.test(raw)) {
    return { kind: 'provider-required', providerHint: 'router', raw };
  }
  if (/No QueryClient set|Missing QueryClient/i.test(raw)) {
    return { kind: 'provider-required', providerHint: 'query-client', raw };
  }
  if (/could not find react-redux context value|could not find store/i.test(raw)) {
    return { kind: 'provider-required', providerHint: 'redux', raw };
  }
  if (/must be used within|must be wrapped|outside.*Provider/i.test(raw)) {
    return { kind: 'provider-required', providerHint: 'generic', raw };
  }

  const hookShape = raw.match(/Cannot destructure property ['\"]?(\w+)['\"]? of .*use([A-Z]\w*)/i)
    ?? raw.match(/Cannot read propert(?:y|ies) of undefined \(reading ['\"](\w+)['\"]\)/i);
  if (hookShape) {
    return {
      kind: 'hook-shape',
      missingProperty: hookShape[1],
      hookName: hookShape[2] ? `use${hookShape[2]}` : undefined,
      raw,
    };
  }

  if (/toBeInTheDocument is not a function|Invalid Chai property: toBeInTheDocument/i.test(raw)) {
    return { kind: 'matcher', raw };
  }

  return { kind: 'unknown', raw };
}

export function buildFailureSignature(context: FailureContext): string {
  switch (context.kind) {
    case 'missing-module':
      return `missing-module:${context.moduleName ?? 'unknown'}`;
    case 'type-mismatch':
      return 'type-mismatch';
    case 'provider-required':
      return `provider-required:${context.providerHint ?? 'generic'}`;
    case 'hook-shape':
      return `hook-shape:${context.hookName ?? 'unknown'}:${context.missingProperty ?? 'unknown'}`;
    case 'matcher':
      return 'matcher:dom';
    case 'unknown':
    default:
      return `unknown:${normalizeUnknownFailure(context.raw)}`;
  }
}

function normalizeUnknownFailure(raw: string): string {
  const line = (raw ?? '')
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0) ?? 'unknown';
  return line
    .replace(/[A-Z]:\\[^ ]+/g, '<path>')
    .replace(/\d+/g, '#')
    .slice(0, 120);
}
