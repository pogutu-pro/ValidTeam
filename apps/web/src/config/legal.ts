/**
 * Legal document content (Privacy Policy + Terms of Service).
 *
 * Legal pages are public (no auth) — anyone can link to /legal/privacy and
 * /legal/terms. Google OAuth verification requires a reachable Privacy Policy
 * and Terms of Service, which is why these are mounted in the (public) group.
 *
 * Content lives here (not inline in the page) so non-engineers can keep it
 * current via a single PR, mirroring `src/config/trust-center.ts`.
 *
 * Vendor names come from `src/config/sub-processors.ts`. Keep them in sync when
 * the sub-processor list changes.
 *
 * NOTE: `lastReviewed` must be bumped whenever substantive edits are made.
 */

export const LEGAL_LAST_REVIEWED = '2026-10-04';

export const LEGAL_CONTACT = {
  privacy: 'privacy@rumiamanage.com',
  legal: 'legal@rumiamanage.com',
  security: 'security@rumiamanage.com',
} as const;

export const LEGAL_COMPANY = {
  name: 'StratNovo',
  product: 'ValidTeam',
  domain: 'rumiamanage.com',
  jurisdiction: 'South Africa',
} as const;

/** Shared intro paragraph rendered above the numbered sections. */
export const LEGAL_INTRO = {
  privacy: [
    `This Privacy Policy explains how ${LEGAL_COMPANY.name} ("we", "us") collects, uses, and shares personal information when you use ${LEGAL_COMPANY.product} (the "Service"), our project and issue management platform available at ${LEGAL_COMPANY.domain}.`,
    'We designed the Service for teams, so most content you create is shared with your workspace. This policy covers the Service itself; it does not cover third-party sites we link to.',
  ],
  terms: [
    `These Terms of Service ("Terms") govern your use of ${LEGAL_COMPANY.product} (the "Service"), our project and issue management platform available at ${LEGAL_COMPANY.domain}. By creating an account or using the Service you agree to these Terms.`,
    'If you are using the Service on behalf of an organization, you confirm you have authority to bind that organization, and "you" refers to that organization.',
  ],
} as const;

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
}

export const PRIVACY_SECTIONS: readonly LegalSection[] = [
  {
    heading: 'Information we collect',
    paragraphs: [
      'We collect information you give us directly, information generated as you use the Service, and limited technical information about how you use it.',
    ],
    bullets: [
      'Account information: your name, email address, avatar, job title, and organization membership. If you sign in with Google or GitHub, we receive the profile identifier and email address from that provider.',
      'Content you create: issues, comments, documents, project plans, files you upload, and any other content you put in a workspace.',
      'Collaboration data: real-time document edits are stored so your team can work together, and audio/video sessions while you are in a call.',
      'Usage and device information: IP address, browser and device type, pages viewed, and error logs. We use this to operate, secure, and improve the Service.',
    ],
  },
  {
    heading: 'How we use information',
    paragraphs: ['We use personal information to:'],
    bullets: [
      'Provide and operate the Service, including authentication, storage, and real-time collaboration.',
      'Send transactional email such as verification, password reset, and notifications. We do not send marketing email unless you opt in.',
      'Provide support and respond to your requests.',
      'Detect, prevent, and investigate abuse, fraud, and security incidents.',
      'Improve the Service, including by analyzing aggregate usage patterns.',
    ],
  },
  {
    heading: 'How we share information',
    paragraphs: ['We do not sell personal information. We share it only as described below.'],
    bullets: [
      'With your workspace: other members of your organization can see the content you create in that workspace.',
      'With service providers who process data on our behalf, under contract and only as needed to run the Service. These include Amazon Web Services (hosting and storage), Cloudflare (content delivery and file storage), Google Cloud Platform (database), LiveKit (real-time audio and video), and our email delivery provider. Our current sub-processor list is published in our Trust Center.',
      'With an AI provider, only if your organization enables AI features and you submit content for processing. In that case the relevant provider processes the prompt and content under its own terms. We do not send your content for AI training.',
      'With law enforcement or regulators when we are legally required to do so.',
      'In connection with a merger, acquisition, or sale of assets, with notice to affected users.',
    ],
  },
  {
    heading: 'Data retention',
    paragraphs: [
      'We retain personal information for as long as your account is active and as needed to provide the Service. When you delete content, we remove it from active use and delete it from backups within a reasonable period, normally within 90 days.',
      'When you close your account we delete your personal information, except where we must retain it to comply with law or resolve disputes.',
    ],
  },
  {
    heading: 'Data security',
    paragraphs: [
      'We encrypt data in transit with TLS and at rest with industry-standard encryption. Access to customer data is limited to staff who need it to operate the Service and is governed by confidentiality obligations.',
      'No system is completely secure. If a breach affects your personal information we will notify you and any regulator as required by law.',
    ],
  },
  {
    heading: 'Your rights',
    paragraphs: [
      'Depending on where you live, you may have rights to access, correct, delete, restrict, or export your personal information, and to object to certain processing.',
    ],
    bullets: [
      'Access and export: request a copy of your data, commonly as a machine-readable export.',
      'Correction: ask us to fix inaccurate information.',
      'Deletion: ask us to delete your account and its contents.',
      'Objection and restriction: ask us to stop, or limit, certain processing.',
      'Complaints: you may lodge a complaint with your local data protection authority.',
    ],
  },
  {
    heading: 'International transfers',
    paragraphs: [
      'We run infrastructure in several countries. Your information may therefore be processed outside your country of residence. Where required, we use standard contractual clauses or an equivalent safeguard for these transfers.',
    ],
  },
  {
    heading: 'Cookies and analytics',
    paragraphs: [
      'We use cookies and similar technologies that are necessary to keep you signed in and to remember preferences. We also use privacy-respecting, aggregate analytics to understand which features are used. You can control non-essential cookies through your browser.',
    ],
  },
  {
    heading: 'Children',
    paragraphs: [
      `The Service is not intended for anyone under 16. We do not knowingly collect personal information from children under 16. If you believe a child has provided us information, contact ${LEGAL_CONTACT.privacy} and we will delete it.`,
    ],
  },
  {
    heading: 'Changes to this policy',
    paragraphs: [
      'We may update this policy as the Service changes. If a change is material we will notify you by email or in the Service before it takes effect. We will also update the "last reviewed" date above.',
    ],
  },
  {
    heading: 'Contact us',
    paragraphs: [
      `Questions about this policy or our handling of your information can be sent to ${LEGAL_CONTACT.privacy}. Security reports can be sent to ${LEGAL_CONTACT.security}.`,
    ],
  },
];

export const TERMS_SECTIONS: readonly LegalSection[] = [
  {
    heading: 'Eligibility and accounts',
    paragraphs: [
      'You must be at least 16 years old to use the Service. You are responsible for activity under your account and for keeping your credentials confidential. Tell us promptly if you suspect unauthorized access.',
      'You may not share an account or let someone else use your credentials. Accounts are for individuals; organizations should use workspaces and seats.',
    ],
  },
  {
    heading: 'Your content',
    paragraphs: [
      'You retain ownership of the content you create. You grant us a worldwide, royalty-free, non-exclusive licence to host, copy, transmit, display, and adapt your content only as needed to operate and support the Service for you.',
      'That licence ends when you delete the content, except for copies retained in backups or required by law.',
    ],
  },
  {
    heading: 'Acceptable use',
    paragraphs: ['You agree not to use the Service to:'],
    bullets: [
      'Break the law, or infringe anyone’s rights.',
      'Upload malware, or content that is unlawful, defamatory, or that infringes privacy or intellectual property rights.',
      'Attempt to gain unauthorized access to the Service, another account, or any connected system, including through probing, scanning, or bypassing rate limits.',
      'Interfere with the Service’s operation, including by overloading it, or circumventing usage limits.',
      'Scrape, reverse engineer, or extract the Service to build a competing product, except where that restriction is prohibited by law.',
      'Use the Service to build or train a competing product from our content.',
    ],
  },
  {
    heading: 'Subscriptions and fees',
    paragraphs: [
      'Some plans are paid. Fees are charged in advance per billing period and are non-refundable except where required by law or stated otherwise at purchase.',
      'We may change pricing with reasonable notice. If a price change affects your renewal, we will tell you before it takes effect and you may cancel instead.',
    ],
  },
  {
    heading: 'Our service commitments',
    paragraphs: [
      'We aim for high availability but the Service is provided on an "as is" and "as available" basis. We do not guarantee uninterrupted or error-free operation. Where we publish a service-level agreement, it governs instead of this section.',
    ],
  },
  {
    heading: 'Our intellectual property',
    paragraphs: [
      `The Service, including its software, design, and trademarks, belongs to ${LEGAL_COMPANY.name} and its licensors. We grant you a limited, revocable, non-exclusive right to use the Service per these Terms. These Terms grant no right to our trademarks beyond using them to identify your content.`,
    ],
  },
  {
    heading: 'Third-party services',
    paragraphs: [
      'The Service integrates with third-party services that we do not control. Your use of them is governed by their own terms, and we are not responsible for them.',
    ],
  },
  {
    heading: 'Suspension and termination',
    paragraphs: [
      'You may stop using the Service at any time and close your account from your settings. We may suspend or terminate access for material breach, including the acceptable use rules above, or where required by law.',
      'On termination, your content becomes unavailable and is deleted in line with our retention commitments.',
    ],
  },
  {
    heading: 'Disclaimers',
    paragraphs: [
      'To the fullest extent permitted by law, the Service and all content and materials provided through it are provided "as is" and "as available", without warranties of any kind, whether express or implied, including merchantability, fitness for a particular purpose, and non-infringement.',
      'We do not warrant that the Service will meet your specific requirements or that results from using it will be accurate or error-free. You are responsible for reviewing content before relying on it.',
    ],
  },
  {
    heading: 'Limitation of liability',
    paragraphs: [
      'To the fullest extent permitted by law, neither party is liable for indirect, incidental, special, consequential, or punitive damages, nor for lost profits, revenue, data, or goodwill, arising out of or related to the Service.',
      'Our total aggregate liability for all claims relating to the Service will not exceed the greater of the amounts you paid us in the 12 months before the event giving rise to the claim, or one hundred US dollars (USD 100). Nothing in these Terms limits liability that cannot lawfully be limited, including for death or personal injury caused by negligence, or for fraud.',
    ],
  },
  {
    heading: 'Indemnity',
    paragraphs: [
      'You agree to defend and indemnify us against claims arising from your content, your use of the Service in breach of these Terms, or your violation of law or the rights of a third party, and to pay damages finally awarded or agreed in settlement.',
    ],
  },
  {
    heading: 'Governing law and disputes',
    paragraphs: [
      `These Terms are governed by the laws of ${LEGAL_COMPANY.jurisdiction}, without regard to conflict-of-law rules. The courts of ${LEGAL_COMPANY.jurisdiction} have exclusive jurisdiction, except that residents of the EEA, UK, or Switzerland may bring proceedings in their own courts and consumers retain any protections their local law grants them.`,
      'Before filing a formal claim, please contact us so we can try to resolve the issue informally.',
    ],
  },
  {
    heading: 'Changes to these Terms',
    paragraphs: [
      'We may update these Terms as the Service changes. If a change is material we will notify you by email or in the Service before it takes effect. Continuing to use the Service after that means you accept the updated Terms.',
    ],
  },
  {
    heading: 'Contact us',
    paragraphs: [`Questions about these Terms can be sent to ${LEGAL_CONTACT.legal}.`],
  },
];
