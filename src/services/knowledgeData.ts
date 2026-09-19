import { KnowledgeDocument } from '../types';

export const INITIAL_KNOWLEDGE_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: 'kb-platform-overview',
    title: 'Umrah360 Platform Architecture & Core Capabilities Overview',
    category: 'PRODUCT',
    tags: ['overview', 'erp', 'crm', 'hajj', 'umrah', 'tour-operator', 'etos-global', 'umrah360.in'],
    status: 'PUBLISHED',
    version: 2,
    author: 'Umrah360 Product Team',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-17T08:00:00Z',
    content: `Umrah360 (www.umrah360.in) is the premier all-in-one cloud ERP, CRM, and dynamic booking technology platform purpose-built for Hajj and Umrah tour operators, pilgrimage travel agencies, consolidators, and DMCs worldwide (powered by ETOS Global travel technology).

Core Mission & Architecture:
- Purpose-engineered for Islamic pilgrimage workflows: unifies lead management, FIT (Free Independent Traveler) and group series package creation, dynamic costing, multi-currency invoicing, Saudi visa tracking, hotel & transport allotments, and sub-agent B2B networks into a single cohesive system.
- Eliminates manual spreadsheets and operational silos across offices in India, Saudi Arabia, UAE, UK, and worldwide.
- Provides agencies with both Back-Office / Mid-Office ERP systems and Consumer-Facing (B2C) online booking websites with dynamic package engines.
- Official Website: https://www.umrah360.in
- Support: 24/7 dedicated human support, onboarding assistance, and comprehensive video training.`,
  },
  {
    id: 'kb-customer-vs-agency-booking',
    title: 'Pilgrim Booking Experience: Direct Customer Inquiries vs Travel Agency Role',
    category: 'FAQS',
    tags: ['customer-booking', 'b2c', 'retail-pilgrim', 'direct-booking', 'travel-agency', 'faq', 'family-package'],
    status: 'PUBLISHED',
    version: 2,
    author: 'Umrah360 Solutions Lead',
    createdAt: '2026-09-02T10:00:00Z',
    updatedAt: '2026-09-17T08:00:00Z',
    content: `Crucial Clarification on How Booking Works for Individual Pilgrims and Families:

Q: Can an individual pilgrim or family directly use the Umrah360 platform to create and book a customized package (flights, Makkah/Madinah hotels, transfers, meals, visa) with real-time pricing and online payment? Do they need to go through a travel agency?

A:
1. The Role of Umrah360:
   - Umrah360 (www.umrah360.in) is an enterprise travel technology and booking software provider. We empower licensed Hajj & Umrah tour operators, travel agencies, and consolidators with the software to run their business.
   - We do NOT sell travel packages directly to consumers as an airline or retail travel agency ourselves.

2. How the Booking Experience Works for Pilgrims:
   - Travel agencies using Umrah360 are equipped with modern, white-labeled B2C consumer booking websites and dynamic packaging engines.
   - On these agency websites powered by Umrah360, pilgrims and families CAN directly:
     • Customize their pilgrimage itinerary day-by-day.
     • Select real-time Makkah and Madinah hotel options (5-star, 4-star, 3-star, Clock Tower, Markaziyah) with preferred room sharing (Quad, Triple, Double) and meal plans (BB, Half Board, Full Board).
     • Add live flights, Haramain High-Speed Train tickets, private VIP transfers (GMC/Yukon), or luxury buses.
     • Add Ziyarat tours in Makkah and Madinah with certified guides.
     • Submit passport details for Saudi tourist eVisa or Umrah visa processing.
     • View instant, transparent, real-time pricing and availability.
     • Complete the entire booking and payment process securely online.

3. How to Book:
   - To make a booking, pilgrims book through one of the verified, licensed travel agencies that run on the Umrah360 platform.
   - Umrah360's team is delighted to connect any inquiring pilgrim or family with our top authorized partner travel agencies in their city (Mumbai, Delhi, Bangalore, Hyderabad, etc.) who will provide them instant access to customized packages with transparent pricing.
   - If the person inquiring is a travel agency or tour operator, Umrah360 provides the software so they can launch their own automated booking engine and manage pilgrims seamlessly!`,
  },
  {
    id: 'kb-b2b-portal',
    title: 'B2B Sub-Agent Reseller Portal & Agent Distribution Engine',
    category: 'B2B',
    tags: ['b2b', 'sub-agents', 'wholesalers', 'credit-limit', 'white-label', 'vouchers', 'allotments'],
    status: 'PUBLISHED',
    version: 2,
    author: 'Umrah360 Product Team',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-17T08:00:00Z',
    content: `Umrah360 provides a dedicated, white-label B2B Sub-Agent Portal designed specifically for wholesale tour operators who distribute packages through external travel agents, resellers, and franchise branches.

Key B2B Capabilities:
- Multi-tier agent hierarchy: Set custom markup percentages, commission structures, and inventory visibility per agent class (Gold, Silver, Bronze, Standard).
- Credit Limits & Virtual Wallet Engine: Real-time agent credit management, balance alerts, deposit receipts, and ledger reconciliation to ensure zero bad debt.
- Instant White-Label PDF Vouchers: Sub-agents can search contracted inventory, customize pilgrim packages, and immediately generate and download vouchers branded with their OWN agency name, logo, and contact details.
- Offline Contract Upload: Consolidators can upload custom negotiated offline hotel room blocks and transport allotments with specific blackout dates, release periods, and minimum stays alongside online inventory.
- Real-Time Allotment Locking: Prevents overbooking across high-demand dates like Ramadan, Mawlid, and peak winter school breaks.`,
  },
  {
    id: 'kb-dynamic-packages',
    title: 'Dynamic Package Builder & Day-by-Day Itinerary Generator',
    category: 'MODULES',
    tags: ['packages', 'itinerary', 'fit', 'groups', 'hotels', 'ziyarat', 'transport', 'real-time'],
    status: 'PUBLISHED',
    version: 2,
    author: 'Umrah360 Product Team',
    createdAt: '2026-09-02T10:00:00Z',
    updatedAt: '2026-09-17T08:00:00Z',
    content: `The Dynamic Umrah Package Builder empowers operators to create both bespoke FIT (Free Independent Traveler) custom itineraries and fixed departure group packages in under 3 minutes.

Features & Integrations:
- Makkah & Madinah Hotel Inventories: Live contracted rates and extranet connectivity for properties across Makkah (Clock Tower / Abraj Al Bait, Swissotel, Pullman Zamzam, Jabal Omar Hyatt, Aziziyah) and Madinah (Dar Al Taqwa, Oberoi, Anwar Al Madinah, Pullman Zamzam Madinah, Markaziyah).
- Room Configurations & Meal Plans: Support for Quad, Triple, Double, and Quint sharing, with meal plans ranging from Room Only, Bed & Breakfast (BB), Half Board (HB), Full Board (FB), to Ramadan Sahoor and Iftar.
- Ground Transport Options: Integration with bus fleet operators, private VIP vehicles (GMC Yukon, Toyota HiAce, Camry), and Haramain High-Speed Railway links (Jeddah Airport -> Makkah -> Madinah).
- Ziyarat Tour Planner: Pre-configured holy site visits (Cave Hira, Jabal Thawr, Mount Arafat, Mina, Muzdalifah, Masjid Quba, Mount Uhud, Seven Mosques) with multilingual guide assignments.
- Dynamic Day-by-Day Itinerary PDF: Generates elegant pilgrim itineraries in English, Arabic, and Urdu with flight PNRs, hotel confirmations, prayer timings, and local Saudi ground emergency contacts.`,
  },
  {
    id: 'kb-hotel-extranet-allotments',
    title: 'Hotel Contracting, Extranets & Room Allotment Management',
    category: 'OPERATIONS',
    tags: ['hotels', 'makkah', 'madinah', 'allotments', 'contracts', 'extranet', 'inventory'],
    status: 'PUBLISHED',
    version: 2,
    author: 'Umrah360 Product Team',
    createdAt: '2026-09-03T10:00:00Z',
    updatedAt: '2026-09-17T08:00:00Z',
    content: `Managing accommodation in Makkah and Madinah is the most critical operational component for Umrah operators. Umrah360 provides a complete hotel management extranet.

Capabilities:
- Contract Setup: Enter seasonal rates, room categories (Deluxe, Executive, Haram View, Kaaba View, City View), and occupancy policies.
- Allotment & Room Blocking: Track confirmed blocked rooms, release dates, and cutoff policies to minimize cancellation penalties.
- Dynamic Pricing & Real-Time Availability: Reflect real-time supplier prices and inventory adjustments.
- Offline + Online Hybrid: Seamlessly combine directly negotiated hotel blocks with connected bed-banks and B2B aggregators.`,
  },
  {
    id: 'kb-visa-management',
    title: 'Saudi Visa, Nusuk & Pilgrimage Document Operations',
    category: 'MODULES',
    tags: ['visa', 'saudi-evisa', 'nusuk', 'mofa', 'passport-tracking', 'biometrics'],
    status: 'PUBLISHED',
    version: 2,
    author: 'Umrah360 Product Team',
    createdAt: '2026-09-04T10:00:00Z',
    updatedAt: '2026-09-17T08:00:00Z',
    content: `Streamlined operations for Saudi Tourist eVisas, Umrah visas, and pilgrimage document management in compliance with the Saudi Ministry of Hajj and Umrah.

Capabilities:
- OCR Passport Extraction: Automatically extracts pilgrim full names, passport numbers, nationalities, dates of birth, and expiry dates with 99.4% accuracy.
- Status Workflow: Live status tracking [Document Collected -> MOFA / Nusuk Submission -> Visa Issued -> Stamped & Vouchered].
- Nusuk Coordination: Guidelines and tracking for pilgrim Nusuk permits (Umrah permit slots and Rawdah prayer appointments).
- Automated Pilgrim Alerts: Real-time WhatsApp and email status notifications sent to pilgrims as their visas are approved.
- Ground Manifest Export: 1-click export of passenger manifests formatted for Saudi Ground Handling Agents (Muassasa / Maktab).`,
  },
  {
    id: 'kb-costing-invoicing',
    title: 'Dynamic Costing, Margin Control & Multi-Currency Invoicing',
    category: 'OPERATIONS',
    tags: ['costing', 'pricing', 'invoicing', 'vat', 'gst', 'forex', 'currency', 'zatca'],
    status: 'PUBLISHED',
    version: 2,
    author: 'Umrah360 Product Team',
    createdAt: '2026-09-05T10:00:00Z',
    updatedAt: '2026-09-17T08:00:00Z',
    content: `Umrah360 handles complex multi-currency hospitality costing and strict tax compliance across Saudi Arabia (15% VAT) and origin countries (GST in India, VAT in UK/UAE).

Capabilities:
- Live Forex Engine: Auto-converts supplier costs in Saudi Riyals (SAR) to your billing currencies (INR, USD, GBP, EUR, AED, IDR) with configurable hedge safety buffers.
- Profit Margin Calculator: Apply percentage markups, flat passenger fees, or tiered margins per item (flight, hotel, visa, transport).
- Compliant Tax Invoices: 1-click generation of proforma, interim, and final tax invoices compliant with ZATCA (Saudi e-Invoicing) and local domestic tax regulations.
- Payment Gateways: Supports Stripe, Razorpay, net banking, UPI, direct wire transfers, and installment payment tracking.`,
  },
  {
    id: 'kb-pricing-plans',
    title: 'Umrah360 Official Subscription Plans & Approved Pricing Structure',
    category: 'PRICING',
    tags: ['pricing', 'plans', 'lite', 'pro', 'enterprise', 'cost', 'subscription'],
    status: 'PUBLISHED',
    version: 2,
    author: 'Umrah360 Sales Leadership',
    createdAt: '2026-09-05T10:00:00Z',
    updatedAt: '2026-09-17T08:00:00Z',
    content: `Umrah360 offers transparent and cost-effective subscription plans tailored to pilgrimage businesses:

1. Umrah360 Lite Plan:
   - Price: Starting at $15 per user per month (billed annually).
   - Target: Emerging travel agencies, boutique pilgrimage consultants, and growing tour operators.
   - Includes:
     • Dynamic package creation and management.
     • Multiple departure date package management.
     • Unlimited pilgrim bookings.
     • Booking manager & reservation system.
     • Lead Manager & Pilgrimage CRM.
     • Invoicing & Billing module.

2. Umrah360 Pro / Growth Plan:
   - Price: Contact for customized agency tier ($499/mo for up to 10 users).
   - Target: Established tour operators with sub-agent reseller networks.
   - Includes:
     • All Lite features.
     • Complete B2B Sub-Agent Reseller Portal with custom markups and credit wallets.
     • Hotel Extranet & Allotment management with blackout dates.
     • Automated WhatsApp and SMS pilgrim status alerts.
     • Multi-branch and role-based staff management.

3. Umrah360 Enterprise Plan (20+ Users / Large Consolidators):
   - Price: STRICTLY CUSTOM QUOTE REQUIRED.
   - AI RULE: If an agency inquires about 20+ users, high transaction volumes, or custom enterprise architecture, inform them that Enterprise tiers require a tailored volume assessment covering dedicated cloud infrastructure, custom GDS/Nusuk API integrations, and SLA guarantees, and immediately connect them with our Senior Solutions Specialist.`,
  },
  {
    id: 'kb-onboarding-support',
    title: 'Onboarding, Data Migration & 24/7 Human Support',
    category: 'FAQS',
    tags: ['faq', 'migration', 'support', 'onboarding', 'security', 'data-hosting'],
    status: 'PUBLISHED',
    version: 2,
    author: 'Umrah360 Support Lead',
    createdAt: '2026-09-06T10:00:00Z',
    updatedAt: '2026-09-17T08:00:00Z',
    content: `Frequently Asked Technical & Operational Questions:

Q: How long does onboarding and setup take?
A: Standard setup takes 48 to 72 hours. Our onboarding team assists in importing your existing hotel contracts, agent lists, and past customer records via standard CSV/Excel templates.

Q: Can we keep our existing offline hotel contracts?
A: Yes! Umrah360 allows you to load custom offline hotel room blocks with negotiated rates, blackout dates, and cutoff policies alongside online inventory.

Q: Does Umrah360 offer 24/7 support?
A: Yes, Umrah360 provides 24/7 dedicated human support and access to extensive video documentation.

Q: Where is our client and pilgrim data hosted?
A: All data is encrypted in transit (TLS 1.3) and at rest (AES-256) on Google Cloud infrastructure with role-based access control, GDPR compliance, and automated daily backups.`,
  },
];

