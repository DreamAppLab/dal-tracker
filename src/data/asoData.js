// src/data/asoData.js — ASO Mission Control data

export const ASO_PHASES = [
  {
    id: 'a1',
    title: '1 · Keyword research',
    steps: [
      { id: 'a1_1', label: 'Brainstorm 20–30 seed keywords from app purpose and user pain points', note: 'Think like a teacher/parent/user searching the store — not like a developer.' },
      { id: 'a1_2', label: 'Check each seed keyword in App Store search on a real iPhone', note: 'Note top 5 apps ranking, their titles, and subtitle patterns.' },
      { id: 'a1_3', label: 'Check each seed keyword in Google Play search', note: 'Play Store ranking signals differ — short-tail keywords often matter more.' },
      { id: 'a1_4', label: 'Identify 5 primary keywords and 10 secondary keywords', note: 'Primary = high intent + achievable. Secondary = long-tail variants.' },
      { id: 'a1_5', label: 'Record target keywords in the Keyword Tracker below', note: 'Track rank weekly. One row per keyword per app.' },
      { id: 'a1_6', label: 'Check competitor app names and subtitles for keyword patterns', note: 'Do not copy — learn what language the category uses.' },
    ]
  },
  {
    id: 'a2',
    title: '2 · iOS listing optimization',
    steps: [
      { id: 'a2_1', label: 'Optimize App Name (30 chars) — lead with primary keyword', note: 'Format: AppName — Primary Keyword. e.g. MyClassLog — Classroom Manager' },
      { id: 'a2_2', label: 'Write Subtitle (30 chars) — secondary keyword + benefit', note: 'No keyword stuffing. Must read naturally to humans.' },
      { id: 'a2_3', label: 'Fill Keywords field (100 chars) — comma-separated, no spaces after commas', note: 'Do NOT repeat words already in title or subtitle. Apple indexes these silently.' },
      { id: 'a2_4', label: 'Write promotional text (170 chars) — updatable without new build', note: 'Use for seasonal promos, new features, or limited offers.' },
      { id: 'a2_5', label: 'Write description — first 3 lines are above the fold', note: 'Lead with value prop. Use short paragraphs. Avoid keyword walls.' },
      { id: 'a2_6', label: 'Add What\'s New text for every version update', note: 'Mention real user-facing changes. Good place for secondary keywords naturally.' },
    ]
  },
  {
    id: 'a3',
    title: '3 · Android listing optimization',
    steps: [
      { id: 'a3_1', label: 'Optimize Short Description (80 chars)', note: 'Most important Android ASO field. Primary keyword + clearest benefit.' },
      { id: 'a3_2', label: 'Write Full Description (4000 chars) — repeat primary keywords 3–5× naturally', note: 'Google indexes full description. Use headers and bullet points.' },
      { id: 'a3_3', label: 'Set app category and tags correctly in Play Console', note: 'Category affects browse discovery. Tags help internal classification.' },
      { id: 'a3_4', label: 'Upload feature graphic (1024×500) with app name + tagline', note: 'First visual impression in search results and store listing.' },
      { id: 'a3_5', label: 'Localize listing for top 3 target countries if applicable', note: 'Even en-GB vs en-US can matter for UK rankings.' },
    ]
  },
  {
    id: 'a4',
    title: '4 · Screenshots & creative',
    steps: [
      { id: 'a4_1', label: 'Design 6–8 screenshots with headline overlays per device size', note: 'Use AppLaunchpad or Canva. Headlines = benefits, not feature names.' },
      { id: 'a4_2', label: 'Screenshot 1 = strongest hook — same message as subtitle', note: '80% of users never scroll past screenshot 1.' },
      { id: 'a4_3', label: 'Include social proof screenshot if you have ratings/reviews', note: 'Even "Trusted by 500+ teachers" helps if true.' },
      { id: 'a4_4', label: 'Upload iPhone 6.7" and 6.5" sets (required) + iPad if universal', note: 'Apple requires specific sizes. Expo/AppLaunchpad handles export.' },
      { id: 'a4_5', label: 'Upload Android phone + 7" tablet screenshots', note: 'Play Console shows different crops in search vs listing.' },
      { id: 'a4_6', label: 'A/B test screenshot order via App Store Connect Product Page Optimization', note: 'Run 2–4 variants for 2+ weeks. Need meaningful traffic to get results.' },
    ]
  },
  {
    id: 'a5',
    title: '5 · Ratings & reviews',
    steps: [
      { id: 'a5_1', label: 'Confirm in-app review prompt fires after meaningful positive action', note: 'See Pub Checklist Phase 3b. Never on first launch.' },
      { id: 'a5_2', label: 'Respond to every 1–3 star review within 48 hours', note: 'Public responses show you care. Offer support email for resolution.' },
      { id: 'a5_3', label: 'Thank 4–5 star reviewers periodically', note: 'Short, genuine replies. Do not ask them to change anything.' },
      { id: 'a5_4', label: 'Track rating trend weekly — flag drops over 0.1 stars', note: 'Sudden drops often correlate with a buggy release.' },
      { id: 'a5_5', label: 'Mine reviews for feature requests and ASO keyword ideas', note: 'Users describe your app in their own words — gold for keyword research.' },
    ]
  },
  {
    id: 'a6',
    title: '6 · Ongoing monitoring',
    steps: [
      { id: 'a6_1', label: 'Weekly: update keyword ranks in tracker below', note: 'Same day each week. Same device/locale for consistency.' },
      { id: 'a6_2', label: 'Monthly: review App Store Connect Analytics — impressions, conversion, retention', note: 'Impressions up + conversion down = listing problem. Both down = keyword problem.' },
      { id: 'a6_3', label: 'Monthly: check competitor listing changes (screenshots, pricing, features)', note: 'Set calendar reminder. Screenshot competitor listings for reference.' },
      { id: 'a6_4', label: 'Quarterly: refresh screenshots if app UI has changed significantly', note: 'Outdated screenshots hurt conversion and look abandoned.' },
      { id: 'a6_5', label: 'Quarterly: re-evaluate keyword strategy based on 90-day rank data', note: 'Drop keywords with no movement. Double down on movers.' },
      { id: 'a6_6', label: 'After every release: update What\'s New + verify listing still accurate', note: 'Pricing changes, new features, and removed features must reflect in listing.' },
    ]
  }
];

export const ASO_TOOLS = [
  { name: 'App Store Connect', url: 'https://appstoreconnect.apple.com', desc: 'Analytics, PPO, metadata' },
  { name: 'Google Play Console', url: 'https://play.google.com/console', desc: 'Listing, stats, experiments' },
  { name: 'App Store (iOS)', url: 'https://apps.apple.com', desc: 'Manual keyword rank checks' },
  { name: 'Google Play Store', url: 'https://play.google.com/store', desc: 'Manual keyword rank checks' },
  { name: 'AppLaunchpad', url: 'https://theapplaunchpad.com', desc: 'Screenshot frames & export' },
  { name: 'Apple Search Ads', url: 'https://searchads.apple.com', desc: 'Keyword discovery & paid' },
];

export const RANK_LABELS = {
  top5: { label: 'Top 5', color: '#22C55E' },
  top10: { label: 'Top 10', color: '#00D4B8' },
  top50: { label: 'Top 50', color: '#F59E0B' },
  top100: { label: 'Top 100', color: '#6366F1' },
  unranked: { label: 'Unranked', color: '#4B5563' },
};

export function getRankTier(rank) {
  if (!rank || rank <= 0) return 'unranked';
  if (rank <= 5) return 'top5';
  if (rank <= 10) return 'top10';
  if (rank <= 50) return 'top50';
  if (rank <= 100) return 'top100';
  return 'unranked';
}

export function loadAsoChecked() {
  try {
    return JSON.parse(localStorage.getItem('dal-aso-checked') || '{}');
  } catch {
    return {};
  }
}

export function saveAsoChecked(checked) {
  localStorage.setItem('dal-aso-checked', JSON.stringify(checked));
}

export function loadAsoKeywords() {
  try {
    return JSON.parse(localStorage.getItem('dal-aso-keywords') || '{}');
  } catch {
    return {};
  }
}

export function saveAsoKeywords(data) {
  localStorage.setItem('dal-aso-keywords', JSON.stringify(data));
}
