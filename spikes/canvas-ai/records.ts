/**
 * The live check's data (Workspace Phase 4, decision 24): two role-played engagements, each with a design and a
 * record of confirmed findings, the requests made on each, and a small key of the findings relevant to each request.
 * Every company, person and statement is invented.
 *
 * Harbour Bakery's record rests partly on a kick-off whose consent (wording draft-2) told the client the AI may help
 * sketch the screens, and partly on findings the consultant entered without a source. Karoo Freight's also has a
 * session whose consent (draft-1) never said so: its two findings are left out, and the assistant says so.
 */

export interface LiveFinding {
  id: string;
  kind: string;
  statement: string;
  /** The note it quotes, in a session of its engagement, or none (entered by the consultant). */
  note?: { session: string; text: string; quote: string };
}

export interface LiveLayer {
  id: string;
  type: 'frame' | 'rect' | 'text';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  text?: string;
  fontSize?: number;
  radius?: number;
  findings?: string[];
  children?: LiveLayer[];
}

export interface LiveRequest {
  id: string;
  text: string;
  /** The layers selected; the screen itself for a request about the whole screen. */
  select: string[];
  /** The findings a careful designer would draw on for it: the key. */
  relevant: string[];
}

export interface LiveSession {
  id: string;
  title: string;
  /** Wording draft-2 with aiDesign told, or draft-1 without. */
  toldAiDesign: boolean;
  client: string;
}

export interface LiveEngagement {
  company: string;
  industry: string;
  engagement: string;
  goal: string;
  design: { name: string; documentId: string; screen: LiveLayer };
  sessions: LiveSession[];
  findings: LiveFinding[];
  requests: LiveRequest[];
}

const text = (id: string, name: string, x: number, y: number, width: number, height: number, value: string, fontSize = 16) =>
  ({ id, type: 'text', name, x, y, width, height, text: value, fontSize, fill: '#11141a' }) as LiveLayer;
const rect = (id: string, name: string, x: number, y: number, width: number, height: number, fill: string, radius = 8) =>
  ({ id, type: 'rect', name, x, y, width, height, fill, radius }) as LiveLayer;

export const HARBOUR: LiveEngagement = {
  company: 'Harbour Bakery',
  industry: 'Food retail',
  engagement: 'Online ordering',
  goal: 'Take cake orders online for collection.',
  sessions: [{ id: 'se_kickoff', title: 'Kick-off', toldAiDesign: true, client: 'Nomsa Dube' }],
  design: {
    name: 'Order page',
    documentId: 'doc_live_order',
    screen: {
      id: 'l_order',
      type: 'frame',
      name: 'Order page',
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
      fill: '#fffaf2',
      children: [
        text('l_heading', 'Heading', 120, 80, 520, 52, 'Order a cake', 40),
        text('l_sub', 'Subheading', 120, 140, 520, 24, 'Harbour Bakery', 16),
        { ...rect('l_photo', 'Cake photo', 760, 80, 520, 360, '#e9d8c4', 16), findings: ['hf_photos'] },
        text('l_cake', 'Cake name', 760, 460, 520, 28, 'Chocolate celebration cake', 22),
        text('l_price', 'Price', 760, 496, 200, 24, 'R 450 · serves 12', 16),
        text('l_date_label', 'Collection date label', 120, 220, 320, 20, 'Collection date', 14),
        { ...rect('l_date', 'Collection date', 120, 246, 480, 48, '#f1ebe2'), findings: ['hf_notice'] },
        text('l_msg_label', 'Message label', 120, 320, 320, 20, 'Message on the cake', 14),
        { ...rect('l_message', 'Message on the cake', 120, 346, 480, 48, '#f1ebe2'), findings: ['hf_message'] },
        { ...rect('l_pay', 'Pay button', 120, 430, 480, 56, '#2b6b4f', 12), findings: ['hf_pay'] },
        text('l_pay_label', 'Pay label', 300, 446, 140, 24, 'Pay R 450', 18),
      ],
    },
  },
  findings: [
    { id: 'hf_pay', kind: 'functional-requirement', statement: 'Customers pay in full online when they order.' },
    { id: 'hf_methods', kind: 'functional-requirement', statement: 'Card and instant EFT are both accepted.' },
    {
      id: 'hf_notice',
      kind: 'constraint',
      statement: 'Orders need at least two days’ notice.',
      note: {
        session: 'se_kickoff',
        text: 'Two days notice for every cake, no exceptions.',
        quote: 'Two days notice for every cake',
      },
    },
    { id: 'hf_mondays', kind: 'constraint', statement: 'The shop is closed on Mondays, so nothing is collected then.' },
    {
      id: 'hf_collect',
      kind: 'business-requirement',
      statement: 'Every cake is collected from the Harbour Road shop; there is no delivery.',
      note: {
        session: 'se_kickoff',
        text: 'All cakes are collected at Harbour Road. We do not deliver.',
        quote: 'collected at Harbour Road',
      },
    },
    { id: 'hf_hours', kind: 'expectation', statement: 'Customers expect to see the shop’s collection hours, 8:00 to 17:00.' },
    {
      id: 'hf_message',
      kind: 'functional-requirement',
      statement: 'The message on the cake is at most 40 characters.',
      note: { session: 'se_kickoff', text: 'Messages fit 40 letters on the big cakes.', quote: 'fit 40 letters' },
    },
    { id: 'hf_no_msg_cupcakes', kind: 'constraint', statement: 'Cupcakes can’t carry a message.' },
    {
      id: 'hf_photos',
      kind: 'design-preference',
      statement: 'Cake photos are shown large: they sell the cakes.',
      note: {
        session: 'se_kickoff',
        text: 'Nomsa wants the photos big, the photos sell the cakes.',
        quote: 'the photos sell the cakes',
      },
    },
    { id: 'hf_brand', kind: 'design-preference', statement: 'The bakery’s green (#2b6b4f) and cream are its colours.' },
    { id: 'hf_mobile', kind: 'non-functional-requirement', statement: 'Most customers order on their phones.' },
    {
      id: 'hf_access',
      kind: 'non-functional-requirement',
      statement: 'Text is readable by older customers: nothing under 16 px.',
    },
    { id: 'hf_confirm', kind: 'functional-requirement', statement: 'Customers get an order confirmation by SMS.' },
    { id: 'hf_allergens', kind: 'functional-requirement', statement: 'Each cake lists its allergens.' },
    { id: 'hf_sizes', kind: 'functional-requirement', statement: 'Cakes come in three sizes: for 6, 12 and 20 people.' },
    { id: 'hf_staff', kind: 'existing-system', statement: 'Orders are printed in the kitchen each morning.' },
    { id: 'hf_peak', kind: 'scalability', statement: 'Orders peak in December, at about five times the usual volume.' },
    {
      id: 'hf_refund',
      kind: 'business-requirement',
      statement: 'A cancelled order is refunded in full up to a day before collection.',
    },
    { id: 'hf_budget', kind: 'budget', statement: 'The first version costs under R 60,000.' },
    { id: 'hf_popia', kind: 'security', statement: 'Customers’ phone numbers are kept only until the order is collected.' },
  ],
  requests: [
    {
      id: 'harbour-pay',
      text: 'Make the pay button clearer about what the customer pays and how.',
      select: ['l_pay'],
      relevant: ['hf_pay', 'hf_methods'],
    },
    {
      id: 'harbour-date',
      text: 'Add help text under the collection date so customers pick a date that works.',
      select: ['l_date'],
      relevant: ['hf_notice', 'hf_mondays'],
    },
    {
      id: 'harbour-collect',
      text: 'Add a section that tells customers where and when to collect their cake.',
      select: ['l_order'],
      relevant: ['hf_collect', 'hf_hours'],
    },
    {
      id: 'harbour-message',
      text: 'Make the message field match what we agreed about messages.',
      select: ['l_message'],
      relevant: ['hf_message', 'hf_no_msg_cupcakes'],
    },
  ],
};

export const KAROO: LiveEngagement = {
  company: 'Karoo Freight',
  industry: 'Logistics',
  engagement: 'Dispatch app',
  goal: 'Give drivers their collections in an app instead of a WhatsApp group.',
  sessions: [
    { id: 'se_kickoff', title: 'Kick-off', toldAiDesign: true, client: 'Thandi Mokoena' },
    // Its consent never said the AI may help sketch the screens: its findings are left out.
    { id: 'se_depot', title: 'Depot visit', toldAiDesign: false, client: 'Pieter van Wyk' },
  ],
  design: {
    name: 'Collections',
    documentId: 'doc_live_collections',
    screen: {
      id: 'k_screen',
      type: 'frame',
      name: 'Collections',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      fill: '#ffffff',
      children: [
        { ...rect('k_header', 'Header', 0, 0, 390, 96, '#1d3557', 0), findings: ['kf_sun'] },
        { ...text('k_title', 'Title', 20, 48, 300, 32, 'Today’s collections', 24), fill: '#ffffff' },
        text('k_count', 'Count', 20, 112, 300, 20, '12 collections', 14),
        {
          ...rect('k_card', 'Collection card', 16, 144, 358, 132, '#f4f6f8', 12),
          findings: ['kf_card'],
        },
        text('k_card_name', 'Customer', 32, 160, 300, 24, 'Sunrise Packaging', 18),
        text('k_card_addr', 'Address', 32, 190, 300, 20, '14 Industria Rd, Midrand', 14),
        { ...rect('k_done', 'Mark collected', 32, 222, 140, 40, '#2a9d8f', 8), findings: ['kf_gloves'] },
        text('k_done_label', 'Mark collected label', 44, 232, 120, 20, 'Mark collected', 14),
        rect('k_card2', 'Collection card 2', 16, 292, 358, 132, '#f4f6f8', 12),
        text('k_card2_name', 'Customer 2', 32, 308, 300, 24, 'Veld Feeds', 18),
      ],
    },
  },
  findings: [
    {
      id: 'kf_card',
      kind: 'functional-requirement',
      statement: 'Each collection shows the customer, address, contact number, time window and number of parcels.',
      note: {
        session: 'se_kickoff',
        text: 'Drivers need name, address, number, time window and parcel count.',
        quote: 'time window and parcel count',
      },
    },
    {
      id: 'kf_offline',
      kind: 'non-functional-requirement',
      statement: 'The app works offline and sends everything once the driver is back in range.',
      note: { session: 'se_kickoff', text: 'No signal on the N1 for an hour at a time.', quote: 'No signal on the N1' },
    },
    { id: 'kf_sync_state', kind: 'functional-requirement', statement: 'Drivers can see what hasn’t been sent yet.' },
    { id: 'kf_gloves', kind: 'design-preference', statement: 'Buttons are large enough to press in work gloves.' },
    {
      id: 'kf_confirm',
      kind: 'functional-requirement',
      statement: 'Marking a collection done asks for the parcel count to confirm it.',
    },
    {
      id: 'kf_undo',
      kind: 'functional-requirement',
      statement: 'A collection marked done by mistake can be undone for five minutes.',
    },
    {
      id: 'kf_sun',
      kind: 'non-functional-requirement',
      statement: 'Screens are readable in bright sunlight in the cab: high contrast.',
    },
    { id: 'kf_large_text', kind: 'design-preference', statement: 'Text is large: drivers glance at it between tasks.' },
    { id: 'kf_order', kind: 'functional-requirement', statement: 'Collections are listed in route order, not by time booked.' },
    { id: 'kf_trucks', kind: 'existing-system', statement: 'Forty trucks run between Gauteng and the Western Cape.' },
    {
      id: 'kf_whatsapp',
      kind: 'operational-challenge',
      statement: 'Collections are missed because messages get buried in a WhatsApp group.',
    },
    {
      id: 'kf_volume',
      kind: 'scalability',
      statement: 'About 120 collections a day, roughly doubling in November and December.',
    },
    {
      id: 'kf_controller',
      kind: 'business-requirement',
      statement: 'The controller assigns collections; drivers can’t take others’.',
    },
    { id: 'kf_android', kind: 'constraint', statement: 'Drivers use the company’s Android phones.' },
    { id: 'kf_languages', kind: 'expectation', statement: 'Drivers expect the app in English and Afrikaans.' },
    { id: 'kf_privacy', kind: 'security', statement: 'Customers’ contact numbers are hidden once a collection is done.' },
    {
      id: 'kf_depot_hours',
      kind: 'constraint',
      statement: 'The Midrand depot loads trucks only between 5:00 and 7:00.',
      note: {
        session: 'se_depot',
        text: 'Loading at Midrand is 5 to 7 in the morning only.',
        quote: 'Loading at Midrand is 5 to 7',
      },
    },
    {
      id: 'kf_depot_scan',
      kind: 'functional-requirement',
      statement: 'Parcels are scanned at the depot before a truck leaves.',
      note: { session: 'se_depot', text: 'Every parcel gets scanned at the depot gate.', quote: 'scanned at the depot gate' },
    },
  ],
  requests: [
    {
      id: 'karoo-card',
      text: 'Show what the driver most needs to see on each collection card.',
      select: ['k_card'],
      relevant: ['kf_card', 'kf_order'],
    },
    {
      id: 'karoo-done',
      text: 'Make marking a collection done safe and easy for a driver on the road.',
      select: ['k_done'],
      relevant: ['kf_gloves', 'kf_confirm', 'kf_undo'],
    },
    {
      id: 'karoo-offline',
      text: 'Add a way for drivers to see when the app is offline and what will be sent later.',
      select: ['k_screen'],
      relevant: ['kf_offline', 'kf_sync_state'],
    },
    {
      id: 'karoo-sun',
      text: 'Make the header readable in the cab.',
      select: ['k_header'],
      relevant: ['kf_sun', 'kf_large_text'],
    },
  ],
};

export const ENGAGEMENTS = [HARBOUR, KAROO];
