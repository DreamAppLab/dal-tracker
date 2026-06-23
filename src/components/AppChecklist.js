// src/components/AppChecklist.js
import React, { useState, useEffect } from 'react';

const CHECKLIST_PHASES = [
  {
    id: 'p1', title: '1 · Concept & name validation',
    steps: [
      { id: 's1_1', label: 'Define app concept — one sentence: who it\'s for, what problem it solves', note: 'Write this before touching Cursor. It becomes your Cursor build prompt foundation.' },
      { id: 's1_2', label: 'Check app name availability on Apple App Store', note: 'Search appstoreconnect.apple.com or the App Store on your phone. Check exact match + close variations.' },
      { id: 's1_3', label: 'Check app name availability on Google Play Store', note: 'Search play.google.com. If taken, choose a different name before building anything.' },
      { id: 's1_4', label: 'Confirm bundle ID format: com.dreamapplab.appname', note: 'All lowercase, no hyphens. e.g. com.dreamapplab.logabode' },
      { id: 's1_5', label: 'Set pricing — $3.99 is your standard rate', note: 'Only deviate if you have a strong reason. Keep consistent across both stores.' },
    ]
  },
  {
    id: 'p2', title: '2 · Cursor build prompt',
    steps: [
      { id: 's2_1', label: 'Write full Cursor build prompt using DAL template', note: 'Include: app name, bundle ID, color palette, all screens, all features, AsyncStorage structure, no backend/no login, Expo SDK 54.' },
      { id: 's2_2', label: 'Specify app icon concept in prompt', note: 'Describe the icon — shield, house, leaf etc. — and primary color so you know the direction before going to Canva.' },
      { id: 's2_3', label: 'Specify all screenshot screens needed in prompt', note: 'List every screen that should exist. Minimum 3–4 distinct screens with real populated data.' },
      { id: 's2_4', label: 'Include in-app review prompt logic in Cursor prompt', note: 'Tell Cursor to add expo-store-review and trigger after a meaningful positive action (e.g. 3rd entry saved). See Phase 3b for timing rules.' },
      { id: 's2_5', label: 'Include onboarding or empty state screens in prompt', note: 'These make great screenshots and improve first-run UX.' },
    ]
  },
  {
    id: 'p3', title: '3 · Build in Cursor',
    steps: [
      { id: 's3_1', label: 'Create new project folder on desktop', note: 'Name it cleanly: LogAbode, Flarepad etc. No spaces in path.' },
      { id: 's3_2', label: 'Run: npx create-expo-app@latest inside folder', note: 'Choose blank template. Confirm SDK 54 is used.' },
      { id: 's3_3', label: 'Paste build prompt into Cursor and build', note: 'Let it scaffold all screens, navigation, and AsyncStorage before you start tweaking.' },
      { id: 's3_4', label: 'Test thoroughly in Expo Go on your phone', note: 'Test every screen, every button, every edge case — empty states, data entry, deletion.' },
      { id: 's3_5', label: 'Fix all bugs before moving to EAS builds', note: 'Do NOT proceed with known bugs. Much harder to fix post-submission.' },
    ]
  },
  {
    id: 'p3b', title: '3b · In-app review prompt',
    steps: [
      { id: 's3b_1', label: 'Install expo-store-review: npx expo install expo-store-review', note: 'Add during the Cursor build phase, not as an afterthought.' },
      { id: 's3b_2', label: 'Trigger review only after a meaningful positive action', note: 'e.g. user saves their 3rd entry. The user must have experienced real value first.' },
      { id: 's3b_3', label: 'Never trigger on first launch, on a timer, or after an error', note: 'Apple and Google both reject apps that prompt immediately or aggressively. One prompt per app lifetime.' },
      { id: 's3b_4', label: 'Check availability before calling: StoreReview.isAvailableAsync()', note: 'Returns false on simulators. Only call StoreReview.requestReview() if it returns true.' },
      { id: 's3b_5', label: 'Add AsyncStorage flag so prompt only fires once ever', note: 'e.g. hasPromptedReview: true — set immediately after triggering.' },
      { id: 's3b_6', label: 'Test review prompt on a real physical device', note: 'Simulators will not show the native review dialog.' },
    ]
  },
  {
    id: 'p4', title: '4 · App icon & assets',
    steps: [
      { id: 's4_1', label: 'Design app icon in Canva — 1024×1024px PNG', note: 'Solid color background only — transparent backgrounds NOT allowed on iOS. This single file is all you provide; Expo auto-generates all sizes for both platforms.' },
      { id: 's4_2', label: 'You do NOT need to manually create multiple icon sizes', note: 'Expo SDK 54 auto-generates all iOS and Android sizes from your single 1024×1024 source file. Icons only — screenshots are different, those you export manually per size.' },
      { id: 's4_3', label: 'Replace assets/icon.png with your 1024×1024 icon', note: 'Confirm the file is named exactly icon.png.' },
      { id: 's4_4', label: '[Android] Create adaptive icon — assets/adaptive-icon.png', note: '1024×1024px. Icon graphic only, centered with safe zone padding. Background color set separately in app.json.' },
      { id: 's4_5', label: '[Android] Set backgroundColor in app.json under android.adaptiveIcon', note: 'e.g. "backgroundColor": "#F59E0B". Easy to forget — causes white/black background on Android if missing.' },
      { id: 's4_6', label: 'Verify icon looks correct in Expo Go before building', note: 'Check on both light and dark phone backgrounds.' },
      { id: 's4_7', label: '[Android] Create feature graphic in Canva — 1024×500px', note: 'Full color. Must include: app icon + app name + short tagline. NOT black and white. Banner shown at top of Play Store listing.' },
    ]
  },
  {
    id: 'p5', title: '5 · app.json & eas.json config',
    steps: [
      { id: 's5_1', label: 'Set name — display name shown under icon on home screen' },
      { id: 's5_2', label: 'Set slug — URL-safe lowercase version of name', note: 'e.g. "slug": "logabode" — lowercase, hyphens ok, no spaces.' },
      { id: 's5_3', label: '[iOS] Set ios.bundleIdentifier', note: 'e.g. "bundleIdentifier": "com.dreamapplab.logabode"' },
      { id: 's5_4', label: '[Android] Set android.package', note: 'e.g. "package": "com.dreamapplab.logabode"' },
      { id: 's5_5', label: 'Set version to "1.0.0" for first release' },
      { id: 's5_6', label: '[Android] Set android.versionCode to 1', note: 'Integer. Must increment by 1 for every new Android build you upload. Never reuse a versionCode.' },
      { id: 's5_7', label: 'Confirm eas.json has production profile for both platforms', note: 'iOS: "simulator": false. Android: "buildType": "aab" for Play Store.' },
    ]
  },
  {
    id: 'p6', title: '6 · GitHub repo',
    steps: [
      { id: 's6_1', label: 'Create new repo at github.com/DreamAppLab/appname' },
      { id: 's6_2', label: 'Initialize git in project folder: git init' },
      { id: 's6_3', label: 'Connect remote: git remote add origin [repo url]' },
      { id: 's6_4', label: 'Confirm .gitignore excludes node_modules and .env' },
      { id: 's6_5', label: 'Initial commit and push to main' },
    ]
  },
  {
    id: 'p7', title: '7 · EAS builds',
    steps: [
      { id: 's7_1', label: '[Android] Run: eas build --platform android --profile production', note: 'Android builds faster. Catch config issues here before iOS.' },
      { id: 's7_2', label: '[iOS] Run: eas build --platform ios --profile production' },
      { id: 's7_3', label: '[iOS] When asked — reuse existing distribution certificate? → Yes', note: 'Your cert (Z573X9NRV7) covers all your apps. Expires Jun 18, 2027. Always reuse it.' },
      { id: 's7_4', label: '[iOS] When asked — generate new provisioning profile? → Yes', note: 'Each new app needs its own provisioning profile even though the distribution cert is shared.' },
      { id: 's7_5', label: '[iOS] If you get ECONNRESET error — just run the command again', note: 'Network dropout between your machine and Apple\'s servers. Not a real error. Rerun the exact same command.' },
      { id: 's7_6', label: 'Monitor both builds at expo.dev dashboard', note: 'Builds run remotely. You can run iOS and Android simultaneously.' },
      { id: 's7_7', label: 'Download .ipa (iOS) and .aab (Android) when complete as local backup' },
    ]
  },
  {
    id: 'p8', title: '8 · Screenshots in AppLaunchpad',
    steps: [
      { id: 's8_1', label: 'Create project in AppLaunchpad for this app' },
      { id: 's8_2', label: 'Take real screenshots from Expo Go or a simulator first', note: 'Real UI with populated data looks far better than placeholders.' },
      { id: 's8_3', label: '[iOS] Export 6.9" — 1290×2796px — Apple\'s primary required size', note: 'Required as of Sept 2024 (iPhone 16 Pro Max). If AppLaunchpad does not have this size, use 6.5" as fallback — Apple accepts it and scales it. This is what worked for Flarepad.' },
      { id: 's8_4', label: '[iOS] Export 6.5" — 2778×1284px', note: 'Still accepted by Apple. Use as fallback if AppLaunchpad has no 6.9" template, or export both.' },
      { id: 's8_5', label: '[iOS] Export 5.5" — 2208×1242px', note: 'Covers older iPhones (iPhone 8 Plus etc.). Always include — easy in AppLaunchpad.' },
      { id: 's8_6', label: '[iOS] Export iPad 13" — 2064×2752px — REQUIRED', note: 'Expo apps are Universal (iPhone + iPad) by default. Apple requires iPad screenshots for Universal apps or it will block submission.' },
      { id: 's8_7', label: '[Android] Export phone screenshots — min 2, up to 8', note: 'Min 320px, max 3840px on longest side. 16:9 ratio recommended. JPG or PNG. Max 8MB.' },
      { id: 's8_8', label: 'Confirm at least one screenshot shows app with real populated data', note: 'Empty-state-only screenshots hurt conversions.' },
      { id: 's8_9', label: '[Android] Confirm feature graphic is full color with icon + name + tagline', note: '1024×500px. Most visible element on Play Store listing. Not black and white.' },
    ]
  },
  {
    id: 'p9', title: '9 · App Store Connect (iOS)',
    steps: [
      { id: 's9_1', label: 'Create new app in App Store Connect', note: 'appstoreconnect.apple.com → My Apps → + → New App' },
      { id: 's9_2', label: 'Select bundle ID from dropdown — registered automatically by EAS during build' },
      { id: 's9_3', label: 'Set SKU — use bundle ID without dots', note: 'e.g. comdreamapplablogabode — unique across your account, never reused.' },
      { id: 's9_4', label: 'Set price to $3.99 under Pricing & Availability' },
      { id: 's9_5', label: 'Enter keywords in App Store tab → Keywords field (100 char max)', note: 'Comma-separated, no spaces after commas. Logabode: home repair,warranty tracker,maintenance log,home improvement,appliance tracker,repair history,home inventory · Flarepad: symptom tracker,health journal,flare log,chronic illness,pain diary,wellness log,daily symptoms' },
      { id: 's9_6', label: 'Write app description (up to 4000 chars)', note: 'Lead with the strongest benefit. Plain language. No marketing fluff.' },
      { id: 's9_7', label: 'Write promotional text (up to 170 chars)', note: 'Shown above description. Only field you can update without a new submission.' },
      { id: 's9_8', label: 'Upload screenshots for all required device sizes', note: 'Required: 6.9" (or 6.5" fallback), 6.5", 5.5", iPad 13". All four is best practice.' },
      { id: 's9_9', label: 'Submit build via EAS: eas submit --platform ios --latest', note: 'Uploads your most recent EAS build directly to App Store Connect. Easier than Xcode.' },
      { id: 's9_10', label: 'Select the uploaded build under the Build section in App Store Connect' },
      { id: 's9_11', label: 'Answer export compliance — No for most apps', note: 'Unless you use encryption beyond standard HTTPS, answer No to all questions.' },
      { id: 's9_12', label: 'Add privacy policy URL under App Privacy', note: 'dreamapplab.com/appnameprivacy' },
      { id: 's9_13', label: 'Submit for Apple review', note: 'Typically 24–48 hours. You\'ll receive an email when approved or if action is needed.' },
    ]
  },
  {
    id: 'p10', title: '10 · Google Play Console (Android)',
    steps: [
      { id: 's10_1', label: 'Create new app in Google Play Console', note: 'play.google.com/console → Create app' },
      { id: 's10_2', label: 'Complete store listing — title, short description, full description', note: 'No keyword field on Android — weave target keywords naturally into descriptions. Google indexes all of it.' },
      { id: 's10_3', label: 'Upload feature graphic (1024×500px full color)' },
      { id: 's10_4', label: 'Upload minimum 2 phone screenshots' },
      { id: 's10_5', label: 'Complete content rating questionnaire' },
      { id: 's10_6', label: 'Set price to $3.99 under Monetization' },
      { id: 's10_7', label: 'Add privacy policy URL', note: 'dreamapplab.com/appnameprivacy' },
      { id: 's10_8', label: 'Upload .aab build to Internal Testing first', note: 'Always go Internal → Closed → Production. Never skip steps.' },
      { id: 's10_9', label: 'Promote to Closed Testing', note: 'Minimum 12 testers required. Use Testers Community to recruit opt-ins.' },
      { id: 's10_10', label: 'Post opt-in link to Testers Community', note: 'Get shareable URL from Play Console → Closed Testing → Testers tab.' },
      { id: 's10_11', label: 'Wait for 12+ testers to opt in — 14-day clock starts automatically', note: 'Google starts the clock once you have enough testers. Monitor countdown in Play Console.' },
      { id: 's10_12', label: 'After 14 days — promote to Production', note: 'Play Console → Production → Create new release → promote the closed testing build.' },
    ]
  },
  {
    id: 'p11', title: '11 · Privacy policy',
    steps: [
      { id: 's11_1', label: 'Create privacy policy page on dreamapplab.com', note: 'URL format: dreamapplab.com/appnameprivacy' },
      { id: 's11_2', label: 'Policy must state: no data collected, no backend, local storage only', note: 'Both stores require a privacy policy even for apps that collect zero data.' },
      { id: 's11_3', label: '[Android] Add privacy policy URL to Google Play store listing' },
      { id: 's11_4', label: '[iOS] Add privacy policy URL in App Store Connect under App Privacy' },
    ]
  },
  {
    id: 'p12', title: '12 · Pre-submission final checks',
    steps: [
      { id: 's12_1', label: 'App name is identical on both stores' },
      { id: 's12_2', label: 'Bundle ID matches exactly in app.json and both store consoles' },
      { id: 's12_3', label: 'Version is 1.0.0 for first submission' },
      { id: 's12_4', label: 'Price is $3.99 on both stores' },
      { id: 's12_5', label: '[iOS] Keywords entered in App Store Connect (100 char max)', note: 'Easy to forget during the rush to submit.' },
      { id: 's12_6', label: '[Android] Feature graphic is full color with icon + name + tagline' },
      { id: 's12_7', label: '[iOS] All four screenshot sizes exported and uploaded (6.9"/6.5", 5.5", iPad 13")' },
      { id: 's12_8', label: 'Privacy policy URL is live and accessible' },
      { id: 's12_9', label: 'In-app review fires at correct trigger and AsyncStorage flag prevents repeat', note: 'Test on a real device before submitting.' },
      { id: 's12_10', label: 'Final code pushed to GitHub' },
      { id: 's12_11', label: 'Tested on a real physical device one final time' },
    ]
  },
];

function getStorageKey(projectId) {
  return `dal_checklist_${projectId}`;
}

function loadChecked(projectId) {
  try {
    return JSON.parse(localStorage.getItem(getStorageKey(projectId)) || '{}');
  } catch (e) {
    return {};
  }
}

function saveChecked(projectId, checked) {
  try {
    localStorage.setItem(getStorageKey(projectId), JSON.stringify(checked));
  } catch (e) {}
}

export default function AppChecklist({ project }) {
  const [checked, setChecked] = useState(() => loadChecked(project.id));
  const [openPhases, setOpenPhases] = useState({ p1: true });

  useEffect(() => {
    setChecked(loadChecked(project.id));
  }, [project.id]);

  const toggle = (stepId) => {
    const next = { ...checked, [stepId]: !checked[stepId] };
    setChecked(next);
    saveChecked(project.id, next);
  };

  const togglePhase = (phaseId) => {
    setOpenPhases(p => ({ ...p, [phaseId]: !p[phaseId] }));
  };

  const expandAll = () => {
    const all = {};
    CHECKLIST_PHASES.forEach(p => { all[p.id] = true; });
    setOpenPhases(all);
  };

  const collapseAll = () => setOpenPhases({});

  const resetChecklist = () => {
    if (!window.confirm('Reset all checklist progress for this app? This cannot be undone.')) return;
    setChecked({});
    saveChecked(project.id, {});
  };

  const allSteps = CHECKLIST_PHASES.flatMap(p => p.steps);
  const totalSteps = allSteps.length;
  const doneSteps = allSteps.filter(s => checked[s.id]).length;
  const pct = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;

  return (
    <div className="data-section">
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
              App Publishing Pipeline
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {doneSteps} of {totalSteps} steps complete · {pct}%
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={expandAll}>Expand all</button>
            <button className="btn btn-ghost btn-sm" onClick={collapseAll}>Collapse all</button>
            <button className="btn btn-sm" style={{ color: 'var(--coral)', borderColor: 'rgba(255,91,91,0.3)', background: 'transparent' }} onClick={resetChecklist}>Reset</button>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ height: 6, background: 'var(--bg-card)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--amber)', borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Phases */}
      {CHECKLIST_PHASES.map(phase => {
        const phaseDone = phase.steps.filter(s => checked[s.id]).length;
        const phaseTotal = phase.steps.length;
        const isOpen = !!openPhases[phase.id];
        const allPhaseDone = phaseDone === phaseTotal;

        return (
          <div key={phase.id} style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            marginBottom: 8,
            overflow: 'hidden',
            background: allPhaseDone ? 'rgba(34,197,94,0.04)' : 'var(--bg-card)'
          }}>
            {/* Phase header */}
            <div
              onClick={() => togglePhase(phase.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px', cursor: 'pointer',
                borderBottom: isOpen ? '1px solid var(--border)' : 'none'
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                background: allPhaseDone ? 'var(--green)' : 'var(--bg-elevated)',
                border: `2px solid ${allPhaseDone ? 'var(--green)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: 'white', fontWeight: 700
              }}>
                {allPhaseDone ? '✓' : ''}
              </div>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{phase.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 6 }}>{phaseDone}/{phaseTotal}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', transition: 'transform 0.2s', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
            </div>

            {/* Steps */}
            {isOpen && (
              <div>
                {phase.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    onClick={() => toggle(step.id)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '10px 14px',
                      borderBottom: idx < phase.steps.length - 1 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
                      background: checked[step.id] ? 'rgba(34,197,94,0.04)' : 'transparent'
                    }}
                  >
                    {/* Checkbox */}
                    <div style={{
                      width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 2,
                      border: `2px solid ${checked[step.id] ? 'var(--amber)' : 'var(--border)'}`,
                      background: checked[step.id] ? 'var(--amber)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: 'white', fontWeight: 700, transition: 'all 0.15s'
                    }}>
                      {checked[step.id] ? '✓' : ''}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: 13,
                        color: checked[step.id] ? 'var(--text-muted)' : 'var(--text-primary)',
                        textDecoration: checked[step.id] ? 'line-through' : 'none',
                        lineHeight: 1.4
                      }}>
                        {step.label}
                      </div>
                      {step.note && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                          {step.note}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
