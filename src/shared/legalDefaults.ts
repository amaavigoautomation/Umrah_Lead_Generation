/**
 * Seed text for the public legal pages, taken from ADSL "Global SaaS Legal Documentation" v1 (26 Oct 2026).
 * Only used until a platform admin saves/publishes their own version from Platform Console -> Legal.
 * Proposed text: subject to counsel approval before publication.
 */
export type LegalSlug = 'privacy' | 'terms' | 'dpa' | 'aup';
export interface LegalSection { id: string; heading: string; body: string }
export interface LegalContent { title: string; effectiveDate: string; sections: LegalSection[] }

export const LEGAL_SLUGS: LegalSlug[] = ['privacy', 'terms', 'dpa', 'aup'];

export const DEFAULT_LEGAL_DOCS: Record<LegalSlug, LegalContent> = {
  "privacy": {
    "title": "Privacy Policy",
    "effectiveDate": "",
    "sections": [
      {
        "id": "s1",
        "heading": "",
        "body": "This Privacy Policy applies to the website, AI Lead & Engagement Platform and associated services (collectively, “Services”) owned and operated by Amaavigo Digital Solutions LLP (“ADSL”, “we”, “our”). The Platform may operate under a separately designated product brand without changing ADSL’s identity as operator. Effective date: [To be inserted on publication]."
      },
      {
        "id": "s2",
        "heading": "1. Scope and privacy roles",
        "body": "The Platform provides separate workspaces for business subscribers (“Customers”). ADSL processes business account, billing, security and support information for its own purposes and may process end-customer leads and communications on Customer instructions. The relevant legal roles (controller/processor, business/service provider, data fiduciary/processor or equivalent) depend on applicable law and actual processing activities. Customers must provide their own legally required notices to individuals whose information they collect."
      },
      {
        "id": "s3",
        "heading": "2. Information processed",
        "body": "ADSL may process the following categories of information in connection with the Services (including Customer Data where processed on a Customer’s behalf):\n\nAccount and workspace information: business identity, names, roles, business contact details, authentication identifiers and configuration.\n\nCustomer Data: leads, contact lists, notes, pipeline stages, website enquiries, communications, message metadata and attachments from WhatsApp, Facebook Messenger, Instagram and email.\n\nArtificial intelligence (AI) inputs and outputs: knowledge bases, prompts, conversation context, classifications and replies. Calendar information: connected account identifiers, availability and events necessary for scheduling. Subscription information: plan, usage, invoices, transaction identifiers and billing contacts. Technical data: IP addresses, devices, logs, error and security events. Payment-card handling depends on the configured Stripe checkout/payment architecture and must be verified."
      },
      {
        "id": "s4",
        "heading": "3. Purposes and legal grounds",
        "body": "ADSL processes information to provide Services, operate isolated workspaces, route messages, manage CRM records, generate Customer-authorised AI outputs, conduct Customer-configured outreach and follow-ups, schedule demos, bill subscriptions, prevent misuse, provide support and comply with the applicable law. Applicable lawful bases and notices depend on jurisdiction and processing purpose. ADSL does not sell Customer personal information or use Customer Data for unrelated advertising."
      },
      {
        "id": "s5",
        "heading": "4. Multi-tenancy and access",
        "body": "Each Customer receives a segregated workspace. The access to the workspace is governed by workspace roles and permissions. Further, segregation of workspaces does not promise physically dedicated servers or databases. ADSL personnel access Customer Data only where authorised and reasonably necessary for operations, support, security or legal obligations, with controls appropriate to the implementation."
      },
      {
        "id": "s6",
        "heading": "5. Meta and communications integrations",
        "body": "Customers may connect their own authorised WhatsApp Business numbers, Facebook page(s), Instagram accounts and email services. The Platform processes messages and permitted metadata only for disclosed, enabled functions. Each Customer must comply with applicable Meta and other platform / provider terms, permissions, messaging windows, templates, consent and opt-out requirements. ADSL cannot override independent provider suspensions, API changes or restrictions. ADSL remains responsible for its own platform policy and legal obligations."
      },
      {
        "id": "s7",
        "heading": "6. Google and Microsoft calendar data",
        "body": "If authorised by the Customer, the Platform may read availability and relevant event information and create, update or manage meetings, limited to granted scopes and user-facing scheduling features. ADSL’s use and transfer of information received through Google APIs will comply with the Google API Services User Data Policy, including its Limited Use requirements. Google user data will not be sold, used for targeted advertising or used to train general-purpose AI models. Human access and onward sharing are restricted to permitted purposes. Users can revoke access in the provider account or disconnect within the Platform where supported. Exact scopes and any AI use of calendar information require technical confirmation."
      },
      {
        "id": "s8",
        "heading": "7. AI processing",
        "body": "Customer-selected automatic, human-review and simulation modes may process conversations and Customer knowledge bases through authorised AI subprocessors. AI results can be inaccurate. Customers control their business instructions and approved workflows; ADSL must implement and operate the safeguards it promises and comply with its own legal duties. AI providers, model retention, training restrictions and regional processing must be disclosed accurately after verification."
      },
      {
        "id": "s9",
        "heading": "8. Service providers and disclosures",
        "body": "Information may be disclosed as necessary to (i) hosting, authentication, database, AI, messaging, email, calendar, analytics, error-monitoring and payment providers, (ii) authorised Customer workspace users, (iii) lawful successors under appropriate protections, and (iv) authorities, where legally required. A current subprocessor list and relevant transfer safeguards should be maintained."
      },
      {
        "id": "s10",
        "heading": "9. Security and incidents",
        "body": "ADSL applies appropriate technical and organisational safeguards, including access controls and encrypted integration credentials as represented by the deployed system. No system is perfectly secure. ADSL will\n\ninvestigate and provide incident notifications as required by applicable law and the contract. Incident response procedures, notification contacts and timelines must be confirmed."
      },
      {
        "id": "s11",
        "heading": "10. Retention, deletion and export",
        "body": "Customer Data is retained for the active subscription, subject to Customer instructions, legal obligations and the applicable retention schedule. ADSL proposes a 30-day post-termination export period, primary-system deletion within 30 days after that period or an eligible verified request, and backup expiry within 90 days thereafter, unless law or a documented exception requires otherwise. These timeframes apply only when confirmed as technically supportable and incorporated into the operative schedule. Billing and security records may be retained separately for applicable legal or security purposes. Disconnecting a third-party integration does not delete data independently held by that provider."
      },
      {
        "id": "s12",
        "heading": "11. Individual rights",
        "body": "Depending on applicable law, individuals may have rights to request access, correction, deletion, withdrawal of consent or other statutory remedies. For Customer-controlled lead and communications data, requests may be directed to the relevant Customer, with ADSL providing legally required assistance. Privacy requests to ADSL may be directed to privacy@amaavigo.com."
      },
      {
        "id": "s13",
        "heading": "12. International access and transfers",
        "body": "The Platform may be used by Customers worldwide and data may be accessed, stored or processed across jurisdictions based on infrastructure and integrations. ADSL will apply transfer mechanisms and safeguards legally required for transfers for which it is responsible, which may include adequacy arrangements, approved contractual clauses, UK addenda or other recognised measures where applicable. Customers must ensure their own instructions and transfers are lawful. Regional hosting or residency is not promised unless expressly agreed. ADSL may restrict functionality or countries where legal compliance cannot reasonably be maintained."
      },
      {
        "id": "s14",
        "heading": "13. Children, changes and contact",
        "body": "The Platform is designed for business users and is not directed to children. Customers must not unlawfully process children’s information. ADSL may update this Policy, providing notices or obtaining consent when legally required. Amaavigo Digital Solutions LLP, 616, Neelkanth Corporate IT Park, Nathani Road, Kirol Village, Vidyavihar West, Vidyavihar, Mumbai, Maharashtra 400086, India; privacy@amaavigo.com; www.amaavigo.com. [Confirm statutory grievance officer/representative contact if required.]"
      }
    ]
  },
  "terms": {
    "title": "SaaS Terms of Service",
    "effectiveDate": "",
    "sections": [
      {
        "id": "s1",
        "heading": "",
        "body": "These Terms form an agreement between Amaavigo Digital Solutions LLP (“ADSL”) and the subscribing business or other person accepting these Terms in a business capacity (“Customer”). A person accepting on behalf of an organisation represents that they have authority to bind it.\n\nADSL remains the contracting operator and may designate a separate product brand.\n\nThese Terms apply to business use, subject to mandatory laws."
      },
      {
        "id": "s2",
        "heading": "1. Platform and licence",
        "body": "ADSL provides multi-tenant software as a service (SaaS) for (i) unified WhatsApp, Facebook Messenger, Instagram and email inboxes; (ii) AI replies in automatic, human-review and simulation modes; (iii) lead capture and CRM; (iv) outbound email campaigns; (v) AI follow-ups; (vi) Google/Microsoft calendar scheduling; and (vii) subscription and usage administration.\n\nSubject to payment and compliance with these Terms, ADSL grants a limited, non-exclusive, non-transferable, non-sublicensable right to access the Platform during the subscription. No source code or ownership rights in the Platform are transferred."
      },
      {
        "id": "s3",
        "heading": "2. Ownership and Customer Data",
        "body": "ADSL and its licensors retain all right, title and interest in and to the Platform, including its software, architecture, proprietary workflows, interfaces, documentation and branding. Customer retains all right, title and interest in and to Customer Data and its other independent assets unless provided otherwise. Customer grants ADSL a limited, non-exclusive licence to host, process, transmit and otherwise use Customer Data solely to: (a) perform the Services; (b) act on Customer's authorized instructions; (c) secure and maintain the Platform; and (d) comply with applicable law. Customer represents and warrants that it has, and will maintain, all rights, consents and legal grounds necessary to provide Customer Data and connect any thirdparty accounts to the Platform."
      },
      {
        "id": "s4",
        "heading": "3. Accounts and isolation",
        "body": "Customer is responsible for controlling user access, role assignments, credentials and authorized integrations to the Platform, and must promptly notify ADSL of any suspected or actual compromise. Customer must not access, or attempt to access, any workspace or tenant other than its own. ADSL provides logical isolation between Customer workspaces; physically dedicated servers or databases are not provided unless expressly agreed in writing."
      },
      {
        "id": "s5",
        "heading": "4. Third-party services and provider policies",
        "body": "The Services interoperate with independent third-party providers, including Meta, WhatsApp, Facebook, Instagram, Google, Microsoft, email service providers and Stripe (collectively, “Third-Party Services”). Customer must comply with applicable Third-Party Service rules, including messaging templates, consent, permitted content, usage quotas and access permissions. Third-Party Services may change APIs, suspend accounts or revoke access tokens independently. ADSL cannot reverse independent enforcement. To the maximum extent permitted by law, ADSL is not liable for losses caused solely by Third-Party Service acts or Customer policy violations, except to the extent caused by ADSL’s own legal or contractual breach."
      },
      {
        "id": "s6",
        "heading": "5. Outreach, consent and international compliance",
        "body": "Customer is solely responsible for the recipients, source and accuracy of its lead lists; for obtaining and maintaining consent or another lawful basis for contacting those recipients; and for the content, timing, unsubscribe and suppression mechanisms, marketing notices, telemarketing restrictions and recordkeeping applicable in each relevant jurisdiction. ADSL does not pre-clear or vet individual campaigns. Customer must not transmit unlawful spam, deceptive messages or prohibited content through the Platform. ADSL may suspend any affected campaign where reasonably necessary to address abuse, legal risk or a Third-Party Service's requirements."
      },
      {
        "id": "s7",
        "heading": "6. AI controls and disclaimers",
        "body": "Customer selects the available automation mode and is responsible for providing accurate instructions and knowledge bases to the Platform. In Automatic Mode, messages may be sent without prior human approval; in Human Review Mode, messages require approval before sending; Simulation Mode is for testing only and does not send live outbound messages. Customer acknowledges that outputs generated by artificial intelligence may be inaccurate or inappropriate. Customer is solely responsible for its authorised campaigns and the decisions made using the Platform; ADSL remains responsible for the design, security and operation of the Platform and for its own contractual and legal obligations. ADSL does not guarantee any particular rate of conversion, sales, appointment attendance or other financial or commercial result."
      },
      {
        "id": "s8",
        "heading": "7. Scheduling and integrations",
        "body": "Customer must grant calendar permissions necessary for scheduling functionality and maintain accurate availability information. Calendar booking depends on relevant external provider availability, APIs, permissions and Customer settings. ADSL does not guarantee attendance or uninterrupted third-party calendar performance."
      },
      {
        "id": "s9",
        "heading": "8. Subscriptions and payments",
        "body": "Subscription currency, billing period, renewal, cancellation, trial terms, usage quotas, overage rates, taxes and refunds will be displayed at checkout or in the accepted order form. Unless the order expressly states otherwise, subscriptions are billed in advance and cancellation stops renewal at the end of the current paid period. No undisclosed automatic renewal, overage or non-refundable charge is imposed. Statutory refund and consumer protections apply where mandatory. Pricing and Stripe settings must be aligned before orders are accepted."
      },
      {
        "id": "s10",
        "heading": "9. Acceptable use and suspension",
        "body": "Customer must not use the Platform to engage in unlawful outreach, impersonation, fraud, harassment, infringement of third-party rights, distribution of malicious code, unauthorised scraping, circumvention of security controls, or evasion of this Agreement or any applicable policy. ADSL may suspend or restrict Customer's use of the Platform, proportionately to the circumstances, for material breach, security risk, legal compliance requirements, a Third-Party Service's requirements, or non-payment, and will provide notice and a reasonable opportunity to cure where reasonably practicable."
      },
      {
        "id": "s11",
        "heading": "10. Availability and change",
        "body": "ADSL will use commercially reasonable efforts to operate and secure the Services. Maintenance, updates, provider outages and API restrictions may affect availability. Any uptime service level or service credit applies only if separately agreed. ADSL will notify Customer of material changes to this Agreement where required by applicable law."
      },
      {
        "id": "s12",
        "heading": "11. Confidentiality and security",
        "body": "Each party shall protect the other party's confidential information with reasonable care and shall use it only for the purposes permitted under this Agreement. These obligations do not apply to information that is or becomes publicly available other than through breach of this Agreement, is independently developed without reference to the disclosing party's confidential information, is lawfully received from a third party without restriction, or is required to be disclosed by law, provided the disclosing party is given notice and the benefit of applicable safeguards to the extent legally permitted. The security and handling of personal data are further governed by the Privacy Policy and any applicable data processing agreement."
      },
      {
        "id": "s13",
        "heading": "12. Disclaimers and business results",
        "body": "Except as expressly warranted in this Agreement and subject to applicable mandatory law, the Platform is provided on an “as available” basis. ADSL does not warrant uninterrupted access to the Platform, the accuracy of AI-generated content, message deliverability, approval by any Third-Party Service, lead conversion, or any particular commercial outcome. Nothing in this Agreement excludes or limits any right or obligation that cannot lawfully be excluded or limited."
      },
      {
        "id": "s14",
        "heading": "13. Liability cap",
        "body": "To the maximum extent permitted by applicable law, neither party is liable for indirect, incidental, special, consequential or punitive damages or lost profits, except as expressly agreed or where exclusion is unlawful. Subject to applicable law and agreed exceptions, ADSL’s aggregate contractual liability is capped at subscription fees paid or payable by the affected Customer in the twelve months before the event giving rise to the claim. The cap does not limit liabilities that cannot lawfully be limited, including applicable fraud or wilful misconduct liabilities. Allocation of liability for confidentiality, data protection, security, intellectual property, gross negligence and statutory penalties requires final counsel approval before publication."
      },
      {
        "id": "s15",
        "heading": "14. Indemnity",
        "body": "To the extent permitted by applicable law, Customer shall defend and indemnify ADSL against third-party claims and reasonable losses arising from Customer Data, unauthorised accounts, unlawful campaigns, thirdparty rights infringement, Customer policy violations or material breach, except to the extent caused by ADSL’s\n\nown breach or misconduct. ADSL shall provide reasonably prompt notice, reasonable cooperation at Customer’s expense, and permit Customer to control the defence with competent counsel, provided no settlement may impose non-monetary obligations, admissions or unreimbursed liability on ADSL without its written consent. Counsel should approve this procedure."
      },
      {
        "id": "s16",
        "heading": "15. Termination and exit",
        "body": "Customer may cancel this Agreement in accordance with the applicable order terms. On termination, ADSL may cease providing access to the Platform; export, deletion and retention of Customer Data will be handled in accordance with the applicable data processing agreement and published retention schedules. Each party remains liable for obligations accrued prior to termination, and those provisions of this Agreement intended to survive termination shall continue in full force and effect."
      },
      {
        "id": "s17",
        "heading": "16. Global restrictions and sanctions",
        "body": "ADSL may decline or restrict provision of Services in countries, territories, sectors or to persons where doing so would violate applicable trade, sanctions, export-control or other mandatory laws. Customer represents and warrants that it will not use the Platform in violation of such restrictions and will not knowingly circumvent provider geographic controls."
      },
      {
        "id": "s18",
        "heading": "17. Governing law and disputes",
        "body": "These Terms are governed by the laws of India, subject to mandatory applicable protections. Subject to mandatory jurisdiction rules, competent courts in Mumbai, Maharashtra, India shall have exclusive jurisdiction. Customers located outside India accept this forum to the extent enforceable under applicable law. Any agreement to arbitrate must be recorded separately in writing."
      },
      {
        "id": "s19",
        "heading": "18. Contact and notices",
        "body": "Legal notices: Amaavigo Digital Solutions LLP, 616, Neelkanth Corporate IT Park, Nathani Road, Kirol Village, Vidyavihar West, Vidyavihar, Mumbai, Maharashtra 400086, India. Privacy requests: privacy@amaavigo.com. Website: www.amaavigo.com. Contractual notices may be delivered to the address above until ADSL designates and publishes a monitored contractual email."
      }
    ]
  },
  "dpa": {
    "title": "Data Processing Agreement",
    "effectiveDate": "",
    "sections": [
      {
        "id": "s1",
        "heading": "",
        "body": "This DPA supplements the SaaS Terms where ADSL processes personal data on behalf of Customer and applies to the extent required by applicable law. In case of conflict concerning personal-data processing, the DPA prevails to that extent, subject to mandatory law."
      },
      {
        "id": "s2",
        "heading": "1. Roles and instructions",
        "body": "Customer determines purposes and means of its lead, message and campaign processing, except for activities ADSL independently controls. ADSL processes Customer personal data on documented instructions, including use of the Services and support requests, unless otherwise required by law. Roles must be mapped by jurisdiction and actual feature."
      },
      {
        "id": "s3",
        "heading": "2. Processing details",
        "body": "Subject matter: omnichannel inbox, CRM, AI replies, campaigns, follow-ups and calendar scheduling. Duration: subscription plus agreed exit/retention periods. Categories: contacts, leads, workspace users, senders, meeting participants. Data: identifiers, contact details, communications, notes, event metadata and any information Customer elects to submit. Processing: collection, access, organisation, storage, analysis, transmission, deletion."
      },
      {
        "id": "s4",
        "heading": "3. Confidentiality and security",
        "body": "ADSL shall ensure authorised personnel are bound by confidentiality duties and shall maintain appropriate technical and organisational security measures, including tenant access control and protection of integration credentials. Specific security controls and audit evidence are described in the verified security schedule once adopted; no unverified control is represented as deployed."
      },
      {
        "id": "s5",
        "heading": "4. Subprocessors",
        "body": "Customer authorises the subprocessors listed in an agreed schedule and any general-authorisation mechanism specified there. ADSL will impose appropriate contractual data-protection obligations and provide notice of material changes where required. Customer objections and remedies require agreed procedures."
      },
      {
        "id": "s6",
        "heading": "5. Rights, incidents and assessments",
        "body": "ADSL will reasonably assist with data-subject requests, incident investigation and legally required assessments, considering the processing and available information. ADSL shall notify the Customer without undue delay after confirming a personal-data breach affecting Customer Data, subject to applicable law and agreed procedures. An operational escalation target of 24 hours is proposed internally, not a contractual notification guarantee until validated."
      },
      {
        "id": "s7",
        "heading": "6. Cross-border transfers",
        "body": "Where required, parties will execute appropriate transfer instruments, including EU Standard Contractual Clauses, UK addenda or other valid mechanisms as applicable. The DPA alone does not substitute for mandatory transfer clauses. Customer remains responsible for the lawfulness of its instructions."
      },
      {
        "id": "s8",
        "heading": "7. Return, deletion and audit",
        "body": "Upon termination, ADSL shall enable reasonable export and deletion consistent with the agreed retention schedule, except legally required retention and backup rotation. Customer audits shall be subject to proportionate confidentiality, security, frequency and scope limits. Proposed timings appear in internal Schedule E1 and must be confirmed before incorporation into customer commitments."
      },
      {
        "id": "s9",
        "heading": "8. Governing framework",
        "body": "This DPA is intended for global B2B use but must be supplemented by mandatory jurisdiction-specific terms, including relevant EU/UK, Indian, US state and other requirements where applicable. Counsel must assess whether additional representations or regional agreements are necessary."
      }
    ]
  },
  "aup": {
    "title": "Acceptable Use & AI Automation Policy",
    "effectiveDate": "",
    "sections": [
      {
        "id": "s1",
        "heading": "1. Authorised channels",
        "body": "Connect only accounts owned or lawfully administered by Customer. Do not share access tokens, circumvent platform permissions, impersonate other businesses or evade provider restrictions."
      },
      {
        "id": "s2",
        "heading": "2. Messaging compliance",
        "body": "Do not send unlawful bulk messages, spam, harassment, misleading offers or prohibited content. Maintain required consent, marketing records, unsubscribe lists, suppression and message-template compliance for each destination country and provider."
      },
      {
        "id": "s3",
        "heading": "3. AI operation",
        "body": "Customer must verify knowledge bases, configure guardrails, test workflows and select automatic, review or simulation mode responsibly. High-risk, sensitive or consequential matters should be escalated to human review where required. Customer must be able to pause outbound automation."
      },
      {
        "id": "s4",
        "heading": "4. Follow-ups and stopping rules",
        "body": "Follow-ups must be configured to stop or change appropriately after reply, booking, unsubscribe, withdrawal of consent or other applicable suppression event. Customer remains responsible for lawful configuration; ADSL must implement the features it represents as available."
      },
      {
        "id": "s5",
        "heading": "5. Monitoring and enforcement",
        "body": "ADSL may investigate reported abuse, throttle messages, restrict integrations or suspend workspaces where reasonably necessary to protect the Platform, third parties or comply with law. Repeated or material violations may result in termination, subject to applicable notice and contract terms."
      }
    ]
  }
};
