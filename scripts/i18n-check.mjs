#!/usr/bin/env node
/**
 * i18n key-parity checker. Verifies every locale catalog in
 * apps/web/messages/*.json has EXACTLY the same set of leaf keys as the
 * English source (en.json), is valid JSON/ICU, and preserves every runtime
 * interpolation/tag contract. It also reports likely untranslated English
 * copies as a quality signal (brands, code, and other intentional copies can
 * still produce false positives, so that signal is not a hard failure).
 *
 *   node scripts/i18n-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, TYPE } from '@formatjs/icu-messageformat-parser';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const catalogDirFlag = process.argv.indexOf('--catalog-dir');
if (catalogDirFlag !== -1 && !process.argv[catalogDirFlag + 1]) {
  console.error('--catalog-dir requires a directory path');
  process.exit(2);
}
const dir = path.resolve(
  catalogDirFlag === -1
    ? path.join(scriptDir, '../apps/web/messages')
    : process.argv[catalogDirFlag + 1]
);
const flatten = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const np = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, np, out);
    else out[np] = v;
  }
  return out;
};

// These messages are intentionally consumed through next-intl's `t.raw()`:
// JSON examples, Markdown templates with {{handlebars}}, or literal angle
// brackets must not be interpreted as ICU/rich-text syntax.
const isRawMessage = (key) =>
  /^planning\.payload_hint_/.test(key) ||
  /^planning\.starterTemplates\.[^.]+\.body$/.test(key) ||
  key === 'adminPanels.systemCredentials.smtp.fromAddressPlaceholder' ||
  /^settingsClients\.audit\.hint\.(splunk_hec|datadog|s3)$/.test(key);

// These keys formerly carried public claims that exceeded the implemented
// importer/AI/MCP/realtime contracts. Components now reuse bounded source
// descriptions plus the localized `productTruth` block. Keeping the obsolete
// paths out of every catalog prevents an unused translation from being wired
// back into the landing page later.
const obsoleteMarketingClaimKeys = new Set([
  'publicPages.landing.aiMcp.description',
  'publicPages.landing.aiMcp.capabilities.ask.body',
  'publicPages.landing.aiMcp.capabilities.triage.body',
  'publicPages.landing.aiMcp.capabilities.mcp.body',
  'publicPages.landing.faq.items.aiKeys.answer',
  'publicPages.landing.faq.items.aiReality.answer',
  'publicPages.landing.faq.items.mcpServer.answer',
  'publicPages.landing.faq.items.imports.answer',
  'publicPages.landing.faq.items.dataVisibility.answer',
  'publicPages.landing.features.cards.import.body',
  'publicPages.landing.features.cards.structure.title',
  'publicPages.landing.features.cards.structure.body',
  'publicPages.landing.features.cards.ai.title',
  'publicPages.landing.features.cards.ai.body',
  'publicPages.landing.features.cards.agents.body',
  'publicPages.landing.features.cards.realtime.body',
  'publicPages.landing.features.cards.selfHost.body',
  'publicPages.landing.selfHost.cards.postgres.body',
  'publicPages.landing.workflow.steps.build.body',
]);
const isObsoleteMarketingClaimKey = (key) =>
  key.startsWith('publicPages.landing.migrate.') || obsoleteMarketingClaimKeys.has(key);

// Dynamic template keys cannot be checked by TypeScript. Keep this list beside
// the stale-claim guard so every catalog proves the four marketing components
// can resolve their capability-bounded copy at runtime.
const marketingRuntimeKeys = [
  'publicPages.setupImportTitle',
  'pagesSettings.import.subtitle',
  'settingsClients.import.previewBadge',
  ...['jira', 'linear', 'csv', 'github'].flatMap((source) => [
    `settingsClients.import.source.${source}.label`,
    `settingsClients.import.source.${source}.description`,
  ]),
  'publicPages.landing.aiMcp.kicker',
  'publicPages.landing.aiMcp.title',
  ...['ask', 'triage', 'mcp'].map(
    (capability) => `publicPages.landing.aiMcp.capabilities.${capability}.title`
  ),
  ...[
    'aiSummary',
    'ask',
    'ai',
    'mcp',
    'aiKeys',
    'data',
    'structureTitle',
    'structure',
    'realtime',
  ].map((key) => `publicPages.landing.productTruth.${key}`),
];

function messageContract(message) {
  const atoms = new Set();
  const pluralForms = new Map();

  const visit = (elements) => {
    for (const element of elements) {
      switch (element.type) {
        case TYPE.argument:
          atoms.add(`arg:${element.value}:argument`);
          break;
        case TYPE.number:
          atoms.add(`arg:${element.value}:number`);
          break;
        case TYPE.date:
          atoms.add(`arg:${element.value}:date`);
          break;
        case TYPE.time:
          atoms.add(`arg:${element.value}:time`);
          break;
        case TYPE.tag:
          atoms.add(`tag:${element.value}`);
          visit(element.children);
          break;
        case TYPE.select: {
          atoms.add(`arg:${element.value}:select`);
          // Select keys are application values, not natural-language plural
          // categories, so translating/removing them changes runtime behavior.
          const selectors = Object.keys(element.options).sort().join('|');
          atoms.add(`select:${element.value}:selectors=${selectors}`);
          for (const option of Object.values(element.options)) visit(option.value);
          break;
        }
        case TYPE.plural: {
          const kind = element.pluralType === 'ordinal' ? 'selectordinal' : 'plural';
          const exactSelectors = Object.keys(element.options)
            .filter((selector) => selector.startsWith('='))
            .sort()
            .join('|');

          // A locale without grammatical number may safely flatten a basic
          // plural to `{count}`, while another locale may introduce a plural
          // around a source argument. Treat both as the same runtime value
          // type, then compare plural semantics separately below.
          atoms.add(`arg:${element.value}:argument`);
          const form = {
            argument: element.value,
            kind,
            offset: element.offset,
            exactSelectors,
          };
          pluralForms.set(formatPluralForm(form), form);

          // Natural-language plural categories (one/few/many/...) legitimately
          // differ by locale. Exact numeric selectors, offset, kind, and nested
          // runtime contracts do not.
          for (const option of Object.values(element.options)) visit(option.value);
          break;
        }
        default:
          break;
      }
    }
  };

  visit(parse(message));
  return {
    atoms: [...atoms].sort(),
    pluralForms: [...pluralForms.values()].sort((a, b) =>
      formatPluralForm(a).localeCompare(formatPluralForm(b))
    ),
  };
}

function formatPluralForm(form) {
  return `${form.kind}:${form.argument}:offset=${form.offset}:exact=${form.exactSelectors || 'none'}`;
}

function formatMessageContract(contract) {
  return [...contract.atoms, ...contract.pluralForms.map(formatPluralForm)].sort().join(',');
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function messageContractsMatch(source, translation) {
  if (!sameStrings(source.atoms, translation.atoms)) return false;

  const argumentsWithPlurals = new Set([
    ...source.pluralForms.map((form) => form.argument),
    ...translation.pluralForms.map((form) => form.argument),
  ]);

  for (const argument of argumentsWithPlurals) {
    const sourceForms = source.pluralForms
      .filter((form) => form.argument === argument)
      .map(formatPluralForm)
      .sort();
    const translationForms = translation.pluralForms
      .filter((form) => form.argument === argument)
      .map(formatPluralForm)
      .sort();

    if (sourceForms.length > 0 && translationForms.length > 0) {
      if (!sameStrings(sourceForms, translationForms)) return false;
      continue;
    }

    // Basic plural/selectordinal forms may be flattened in languages that do
    // not need grammatical variants. Offset or exact-number branches encode
    // application behavior and therefore may never disappear.
    const remainingForms = sourceForms.length > 0 ? sourceForms : translationForms;
    if (remainingForms.some((form) => !form.includes(':offset=0:exact=none'))) {
      return false;
    }
  }

  return true;
}

function isLikelyEnglishCopy(source, translation) {
  if (source !== translation || typeof source !== 'string') return false;
  const asciiLetters = source.match(/[A-Za-z]/g)?.length ?? 0;
  if (source.length < 15 || asciiLetters < 8) return false;
  // URLs, identifiers, email examples, and compact format labels are normally
  // language-neutral and add noise without identifying translation debt.
  return !/^(https?:|wss?:|\/|[A-Z0-9_.+@/-]+$)/.test(source.trim());
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
if (!files.includes('en.json')) {
  console.error('en.json not found in', dir);
  process.exit(1);
}
const en = flatten(JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8')));
const enKeys = Object.keys(en);
const enSet = new Set(enKeys);
let bad = 0;
let likelyEnglishCopies = 0;

for (const file of files.sort()) {
  const locale = file.replace('.json', '');
  let data;
  try {
    data = flatten(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  } catch (e) {
    console.error(`✗ ${locale}: invalid JSON — ${e.message}`);
    bad++;
    continue;
  }
  const obsoleteClaims = Object.keys(data).filter(isObsoleteMarketingClaimKey);
  if (obsoleteClaims.length) {
    console.error(
      `✗ ${locale}: obsolete marketing claim key(s): ${obsoleteClaims.slice(0, 5).join(', ')}`
    );
    bad++;
    continue;
  }
  if (catalogDirFlag === -1) {
    const missingRuntimeKeys = marketingRuntimeKeys.filter(
      (key) => typeof data[key] !== 'string' || data[key].trim().length === 0
    );
    if (missingRuntimeKeys.length) {
      console.error(
        `✗ ${locale}: missing marketing runtime key(s): ${missingRuntimeKeys.slice(0, 5).join(', ')}`
      );
      bad++;
      continue;
    }
  }
  if (locale === 'en') continue;
  const keys = new Set(Object.keys(data));
  const missing = enKeys.filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !enSet.has(k));
  const contractErrors = [];
  let localeEnglishCopies = 0;

  for (const key of enKeys) {
    if (!keys.has(key)) continue;
    const source = en[key];
    const translation = data[key];

    if (typeof source !== 'string' || typeof translation !== 'string') {
      contractErrors.push(`${key}: messages must be strings`);
      continue;
    }

    if (isLikelyEnglishCopy(source, translation)) localeEnglishCopies++;
    if (key.startsWith('publicPages.landing.productTruth.') && source === translation) {
      contractErrors.push(`${key}: critical public claim must be localized`);
      continue;
    }
    if (isRawMessage(key)) continue;

    try {
      const sourceContract = messageContract(source);
      const translationContract = messageContract(translation);
      if (!messageContractsMatch(sourceContract, translationContract)) {
        const expected = formatMessageContract(sourceContract);
        const received = formatMessageContract(translationContract);
        contractErrors.push(
          `${key}: expected [${expected || 'none'}], got [${received || 'none'}]`
        );
      }
    } catch (error) {
      contractErrors.push(`${key}: invalid ICU — ${error.message}`);
    }
  }

  likelyEnglishCopies += localeEnglishCopies;

  if (missing.length || extra.length || contractErrors.length) {
    bad++;
    console.error(
      `✗ ${locale}: ${missing.length} missing, ${extra.length} extra, ` +
        `${contractErrors.length} ICU contract error(s)` +
        (missing.length ? `\n    missing e.g. ${missing.slice(0, 8).join(', ')}` : '') +
        (extra.length ? `\n    extra e.g. ${extra.slice(0, 8).join(', ')}` : '') +
        (contractErrors.length ? `\n    ${contractErrors.slice(0, 5).join('\n    ')}` : '')
    );
  } else {
    console.log(
      `✓ ${locale} (${keys.size} keys, ${localeEnglishCopies} likely English copy candidates)`
    );
  }
}

if (bad) {
  console.error(
    `\n${bad} locale(s) out of parity with en.json (${enKeys.length} keys). Fix before committing.`
  );
  process.exit(1);
}
console.log(`\nAll ${files.length} locales in parity with valid ICU contracts. ✓`);
console.log(
  `Translation quality signal: ${likelyEnglishCopies} exact-English candidates across ` +
    `${files.length - 1} non-English catalogs (review required; not a hard failure).`
);
