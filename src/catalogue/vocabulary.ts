/**
 * The catalogue's fixed vocabularies (Workspace Phase 5, decisions 6, 7 and 27). The validator, the engine and the
 * Technologies page share them. Adding a value is a code change, reviewed with the rule that uses it, not a data
 * change. Places are ISO 3166-1 alpha-2 codes, checked against `catalogue/countries.json`, so none is listed here.
 */

/** The parts of a system (decision 6, with decision 28's eleven). The page groups payments to email as "Integrations". */
export const PARTS = [
  'web-front-end',
  'mobile-app',
  'back-end',
  'database',
  'hosting',
  'authentication',
  'payments',
  'accounting',
  'messaging',
  'email',
  'data-reporting',
] as const;
export type Part = (typeof PARTS)[number];

/** The parts shown together under "Integrations" (decision 6). */
export const INTEGRATION_PARTS: readonly Part[] = ['payments', 'accounting', 'messaging', 'email'];

/** The kinds of fact (decision 7, with decision 27's place and compliance facts in place of a single country's). */
export const FACT_KINDS = [
  'licence',
  'offering',
  'languages',
  'runtimes',
  'platforms',
  'offline',
  'self-hostable',
  'managed-service',
  'regions',
  'available-in',
  'compliance',
  'host-runtimes',
  'host-databases',
  'sdks',
  'requires',
  'support',
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** Kinds whose value is a list, which must be the source's whole list or be left out (decision 27). */
export const LIST_KINDS: readonly FactKind[] = [
  'languages',
  'runtimes',
  'platforms',
  'regions',
  'available-in',
  'compliance',
  'host-runtimes',
  'host-databases',
  'sdks',
];

export const LANGUAGES = [
  'javascript',
  'typescript',
  'csharp',
  'python',
  'php',
  'java',
  'kotlin',
  'swift',
  'dart',
  'go',
  'ruby',
] as const;
export type Language = (typeof LANGUAGES)[number];

export const RUNTIMES = [
  'node',
  'dotnet',
  'python',
  'php',
  'jvm',
  'go',
  'ruby',
  'browser',
  'android',
  'ios',
  'container',
] as const;
export type Runtime = (typeof RUNTIMES)[number];

export const PLATFORMS = ['web', 'android', 'ios', 'linux', 'windows', 'macos', 'serverless'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const OFFERINGS = ['open-source', 'paid-service'] as const;
export type Offering = (typeof OFFERINGS)[number];

export const OFFLINE = ['yes', 'partly', 'no'] as const;
export type Offline = (typeof OFFLINE)[number];

/** Compliance a hosted service may claim (decision 7). */
export const COMPLIANCE = ['iso-27001', 'soc2-type2', 'pci-dss-l1-service-provider', 'hipaa-baa'] as const;
export type Compliance = (typeof COMPLIANCE)[number];

/**
 * Licences, by SPDX id, or "proprietary". A fixed list so decision 12's licence constraint can name them; a licence
 * not here is added with the technology that needs it. `strongCopyleft` is for the "no strong copyleft" constraint.
 */
export const LICENCES = {
  MIT: { strongCopyleft: false },
  'Apache-2.0': { strongCopyleft: false },
  'BSD-2-Clause': { strongCopyleft: false },
  'BSD-3-Clause': { strongCopyleft: false },
  PostgreSQL: { strongCopyleft: false },
  'MPL-2.0': { strongCopyleft: false },
  'LGPL-2.1-only': { strongCopyleft: false },
  'LGPL-3.0-only': { strongCopyleft: false },
  'GPL-2.0-only': { strongCopyleft: true },
  'GPL-3.0-only': { strongCopyleft: true },
  'AGPL-3.0-only': { strongCopyleft: true },
  'SSPL-1.0': { strongCopyleft: true },
  proprietary: { strongCopyleft: false },
} as const;
export type Licence = keyof typeof LICENCES;
