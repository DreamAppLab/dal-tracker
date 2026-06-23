// src/components/AppChecklist.js
import React, { useState, useEffect } from 'react';

const CHECKLIST_PHASES = [
  {
    id: 'p1', title: '1 · Concept & name validation',
    steps: [
      { id: 's1_1', label: 'Define app concept — one sentence: who it\'s for, what problem it solves', note: 'Write this before touching Cursor. It becomes your Cursor build prompt foundation.' },
      { id: 's1_2', label: 'Check app name availability on Apple App Store', note: 'Search appstoreconnect.apple.com or the App Store on your phone. Check exact match + close variations.' },
      { id: 's1_3', label: 'Check app name availability on Google Play Store', note: 'Search play.google.com. If the name is taken, choose a different one before building anything.' },
      { id: 's1_4', label: 'Confirm bundle ID format: com.dreamapplab.appname', note: 'All lowercase, no hyphens. e.g. com.dreamapplab.appname — confirm it is not already registered.' },
      { id: 's1_5', label: 'Decide on pricing — paid, free, or freemium', note: 'Research comparable apps in the category. Consider whether the app justifies a subscription model (requires backend like Firebase + RevenueCat).' },
      { id: 's1_6', label: 'Decide on backend requirements', note: 'No backend = AsyncStorage only, simplest path. Backend needed = plan for Firebase or similar, login flow, data sync, and additional review questions at submission.' },
    ]
  },
  {
    id: 'p2', title: '2 · Cursor build prompt',
    steps: [
      { id: 's2_1', label: 'Write full Cursor build prompt using DAL template', note: 'Include: app name, bundle ID, color palette, all screens, all features, data storage approach, auth requirements if any, Expo SDK 54.' },
      { id: 's2_2', label: 'Specify app icon concept in prompt', note: 'Describe the icon shape, symbol, and primary color before going to Canva.' },
      { id: 's2_3', label: 'Specify all screenshot screens needed in prompt', note: 'List every distinct screen. Minimum 3-4 screens showing real populated data.' },
      { id: 's2_4', label: 'Include in-app review prompt logic in Cursor prompt', note: 'Add expo-store-review triggered after a meaningful positive action. See Phase 3b for full timing rules.' },
      { id: 's2_5', label: 'Include onboarding or empty state screens in prompt', note: 'These make great screenshots and improve first-run UX.' },
      { id: 's2_6', label: 'If app has backend — plan auth, data model, and sync strategy before building', note: 'Decide on Firebase, Supabase, or other. Plan login flow, user data structure, and offline behavior upfront — much harder to add later.' },
    ]
  },
  {
    id: 'p3', title: '3 · Build in Cursor',
    steps: [
      { id: 's3_1', label: 'Create new project folder on desktop', note: 'Name it cleanly with no spaces in the path.' },
      { id: 's3_2', label: 'Run: npx create-expo-app@latest inside folder', note: 'Choose blank template. Confirm SDK 54 is used.' },
      { id: 's3_3', label: 'Paste build prompt into Cursor and build', note: 'Let it scaffold all screens, navigation, and data layer before tweaking.' },
      { id: 's3_4', label: 'Test thoroughly in Expo Go on a real device', note: 'Test every screen, every button, every edge case — empty states, data entry, deletion, error states.' },
      { id: 's3_5', label: 'If app has backend — test auth flows, data sync, and offline behavior', note: 'Test login, logout, password reset, data persistence across sessions, and what happens with no internet.' },
      { id: 's3_6', label: 'Fix all bugs before moving to EAS builds', note: 'Do NOT proceed with known bugs. Much harder to fix post-submission.' },
    ]
  },
  {
    id: 'p3b', title: '3b · In-app review prompt',
    steps: [
      { id: 's3b_1', label: 'Install expo-store-review: npx expo install expo-store-review', note: 'Add during the Cursor build phase, not as an afterthought.' },
      { id: 's3b_2', label: 'Trigger review only after a meaningful positive action', note: 'The user must have experienced real value first — e.g. after saving their 3rd entry, completing a key action, or reaching a milestone in the app.' },
      { id: 's3b_3', label: 'Never trigger on first launch, on a timer, or after an error', note: 'Apple and Google both reject apps that prompt immediately or aggressively. Once per app lifetime is the safe default.' },
      { id: 's3b_4', label: 'Check availability before calling: StoreReview.isAvailableAsync()', note: 'Returns false on simulators and some Android devices. Only call StoreReview.requestReview() if it returns true.' },
      { id: 's3b_5', label: 'Add a storage flag so the prompt only fires once ever', note: 'Use AsyncStorage or your backend to track whether the prompt has already been shown. Set it immediately after triggering.' },
      { id: 's3b_6', label: 'Test review prompt on a real physical device', note: 'Simulators will not show the native review dialog.' },
    ]
  },
  {
    id: 'p4', title: '4 · App icon & assets',
    steps: [
      { id: 's4_1', label: 'Design app icon in Canva — 1024×1024px PNG', note: 'Solid color background only — transparent backgrounds are NOT allowed on iOS. This single file is all you provide; Expo auto-generates all required sizes for both platforms.' },
      { id: 's4_2', label: 'You do NOT need to manually create multiple icon sizes', note: 'Expo SDK 54 auto-generates all iOS sizes and all Android sizes from your single 1024×1024 source. This applies to the ICON only — screenshots must still be exported manually per size.' },
      { id: 's4_3', label: 'Replace assets/icon.png with your 1024×1024 icon', note: 'Confirm the file is named exactly icon.png.' },
      { id: 's4_4', label: '[Android] Create adaptive icon — assets/adaptive-icon.png', note: '1024×1024px. Icon graphic only, centered with safe zone padding around edges. Background color is set separately in app.json — do not bake it into this file.' },
      { id: 's4_5', label: '[Android] Set backgroundColor in app.json under android.adaptiveIcon', note: 'e.g. "backgroundColor": "#F59E0B". Easy to forget — causes a white or black background on Android home screen if missing.' },
      { id: 's4_6', label: 'Verify icon looks correct in Expo Go before building', note: 'Check on both light and dark phone backgrounds. Adaptive icon should look centered and not clipped.' },
      { id: 's4_7', label: '[Android] Create feature graphic in Canva — 1024×500px', note: 'Full color. Must include app icon + app name + short tagline. This is the banner shown at the top of your Play Store listing — make it look professional.' },
    ]
  },
  {
    id: 'p5', title: '5 · app.json & eas.json config',
    steps: [
      { id: 's5_1', label: 'Set name — display name shown under icon on home screen' },
      { id: 's5_2', label: 'Set slug — URL-safe lowercase version of name', note: 'Lowercase, hyphens ok, no spaces.' },
      { id: 's5_3', label: '[iOS] Set ios.bundleIdentifier', note: 'e.g. com.dreamapplab.appname — must match exactly what you register in App Store Connect.' },
      { id: 's5_4', label: '[Android] Set android.package', note: 'e.g. com.dreamapplab.appname — must match exactly what you register in Play Console.' },
      { id: 's5_5', label: 'Set version to "1.0.0" for first release' },
      { id: 's5_6', label: '[Android] Set android.versionCode to 1', note: 'Integer. Must increment by 1 for every new Android build you upload to Play Console. Never reuse a versionCode.' },
      { id: 's5_7', label: 'Confirm eas.json has production profile for both platforms', note: 'iOS profile: "simulator": false. Android profile: "buildType": "aab" for Play Store submission.' },
      { id: 's5_8', label: 'Run npx expo-doctor and fix ALL issues before building', note: 'expo-doctor catches missing peer dependencies, duplicate packages, and version mismatches that work fine in Expo Go but crash in production builds. Fix every red X before running EAS build.' },
      { id: 's5_9', label: 'If app uses backend — add any required environment variables or config keys', note: 'Firebase config, API keys etc. Use EAS Secrets for sensitive values — never hardcode them in the repo.' },
    ]
  },
  {
    id: 'p6', title: '6 · GitHub repo',
    steps: [
      { id: 's6_1', label: 'Create new repo at github.com/DreamAppLab/appname' },
      { id: 's6_2', label: 'Initialize git in project folder: git init' },
      { id: 's6_3', label: 'Connect remote: git remote add origin [repo url]' },
      { id: 's6_4', label: 'Confirm .gitignore excludes node_modules, .env, and any files with secret keys' },
      { id: 's6_5', label: 'Initial commit and push to main' },
    ]
  },
  {
    id: 'p7', title: '7 · EAS builds',
    steps: [
      { id: 's7_1', label: '[Android] Run: eas build --platform android --profile production', note: 'Android builds faster. Catch config issues here before running the iOS build.' },
      { id: 's7_2', label: '[iOS] Run: eas build --platform ios --profile production' },
      { id: 's7_3', label: '[iOS] When asked — reuse existing distribution certificate? → Yes', note: 'Your Apple distribution certificate covers all your apps. Always reuse it unless it has expired.' },
      { id: 's7_4', label: '[iOS] When asked — generate new provisioning profile? → Yes', note: 'Each new app needs its own provisioning profile even though the distribution cert is shared across apps.' },
      { id: 's7_5', label: '[iOS] If you get ECONNRESET error — just run the command again', note: 'This is a network dropout between your machine and Apple\'s servers. Not a real error. Simply rerun the exact same command.' },
      { id: 's7_6', label: 'Monitor both builds at expo.dev dashboard', note: 'Builds run remotely on Expo\'s servers. You can run iOS and Android builds simultaneously.' },
      { id: 's7_7', label: 'Download .ipa (iOS) and .aab (Android) when complete as a local backup' },
    ]
  },
  {
    id: 'p8', title: '8 · Screenshots in AppLaunchpad',
    steps: [
      { id: 's8_1', label: 'Create project in AppLaunchpad for this app' },
      { id: 's8_2', label: 'Take real screenshots from Expo Go or a simulator first', note: 'Real UI with populated data looks far better than placeholder mockups. Show the app actually doing its job.' },
      { id: 's8_3', label: '[iOS] Export 6.5" — 2778×1284px — covers all iPhone sizes', note: 'Apple scales 6.5" screenshots down to fit all smaller phone sizes automatically. If AppLaunchpad offers 6.9" (1290×2796px) export that too as it is Apple\'s newest primary size.' },
      { id: 's8_4', label: '[iOS] Export 5.5" — 2208×1242px', note: 'Covers older iPhones. Always include — easy to export in AppLaunchpad and covers all bases.' },
      { id: 's8_5', label: '[iOS] Export iPad 13" — 2064×2752px — REQUIRED for Universal apps', note: 'Expo apps are Universal (iPhone + iPad) by default. Apple requires iPad screenshots for Universal apps and will block submission without them. Use AppLaunchpad iPad template or resize existing screenshots.' },
      { id: 's8_6', label: '[Android] Export phone screenshots — minimum 2, up to 8', note: 'Min 320px, max 3840px on longest side. 16:9 ratio recommended. JPG or PNG. Max 8MB per file.' },
      { id: 's8_7', label: 'At least one screenshot must show the app with real populated data', note: 'Empty-state-only screenshots hurt conversions significantly. Show the app doing what it promises.' },
      { id: 's8_8', label: '[Android] Feature graphic must be full color with icon + app name + tagline', note: '1024×500px. This is the most visible element on your Play Store listing. Not a black and white logo.' },
    ]
  },
  {
    id: 'p9', title: '9 · App Store Connect (iOS)',
    steps: [
      { id: 's9_1', label: 'Create new app in App Store Connect', note: 'appstoreconnect.apple.com → My Apps → + → New App' },
      { id: 's9_2', label: 'Select bundle ID from dropdown', note: 'It appears automatically because EAS registered it during the build.' },
      { id: 's9_3', label: 'Set SKU — must be unique across your account, never reused', note: 'Common approach: bundle ID without dots e.g. comdreamapplabappname.' },
      { id: 's9_4', label: 'Set price — confirm price matches your pricing decision from Phase 1' },
      { id: 's9_5', label: 'Select primary category — choose the most relevant category for the app', note: 'e.g. Productivity, Health & Fitness, Utilities, Lifestyle. Choose what your target user would search under.' },
      { id: 's9_6', label: 'Set up Content Rights in App Information', note: 'Does your app contain third-party content? Answer honestly. Most apps answer No.' },
      { id: 's9_7', label: 'Complete Age Ratings questionnaire in App Information', note: 'Answer based on your specific app content. Apps with user accounts, messaging, or mature content may need to answer Yes to some questions. Be accurate — Apple can reject for incorrect ratings.' },
      { id: 's9_8', label: 'Enter keywords in App Store tab → Keywords field (100 char max)', note: 'Comma-separated, no spaces after commas. Research what terms your target users would search for. Do not repeat words already in your app name.' },
      { id: 's9_9', label: 'Write app description (up to 4000 chars)', note: 'Lead with the strongest benefit. Plain language. No marketing fluff. Describe what the app does and who it is for.' },
      { id: 's9_10', label: 'Write promotional text (up to 170 chars)', note: 'Shown above description. This is the only metadata field you can update without submitting a new app version.' },
      { id: 's9_11', label: 'Add support URL', note: 'dreamapplab.com is fine as a default. Use a dedicated support page if one exists.' },
      { id: 's9_12', label: 'Add privacy policy URL', note: 'Must be a live, accessible URL. Required for all apps regardless of whether data is collected.' },
      { id: 's9_13', label: 'Complete App Privacy section — answer data collection questions accurately', note: 'If app collects no data: select Data Not Collected. If app collects user data (accounts, analytics, health data etc.) you must disclose each data type, its purpose, and whether it is linked to the user.' },
      { id: 's9_14', label: 'Upload screenshots for all required device sizes', note: 'Required: 6.5" phones, 5.5" phones, iPad 13". Upload 6.9" too if available.' },
      { id: 's9_15', label: 'Submit build via EAS: eas submit --platform ios --latest', note: 'Uploads your most recent EAS build directly to App Store Connect. Easier than Xcode.' },
      { id: 's9_16', label: 'Select the uploaded build under the Build section in App Store Connect' },
      { id: 's9_17', label: 'Answer export compliance questions', note: 'If app uses only standard HTTPS: answer No. If app uses custom encryption beyond HTTPS (e.g. end-to-end encrypted messaging): answer Yes and follow up steps.' },
      { id: 's9_18', label: 'Submit for Apple review', note: 'Typically 24-48 hours. You will receive an email when approved or if action is needed.' },
    ]
  },
  {
    id: 'p10', title: '10 · Google Play Console (Android)',
    steps: [
      { id: 's10_1', label: 'Create new app in Google Play Console', note: 'play.google.com/console → Create app' },
      { id: 's10_2', label: 'Complete store listing — title, short description, full description', note: 'Google has no keyword field — weave your target search terms naturally into the description copy. Google indexes all of it.' },
      { id: 's10_3', label: 'Upload feature graphic (1024×500px full color with icon + name + tagline)' },
      { id: 's10_4', label: 'Upload minimum 2 phone screenshots' },
      { id: 's10_5', label: 'Complete content rating questionnaire', note: 'Answer accurately based on your app\'s actual content. Apps with user accounts, social features, or mature content will have different ratings than simple utility apps.' },
      { id: 's10_6', label: 'Set price — confirm it matches your pricing decision from Phase 1' },
      { id: 's10_7', label: 'Add privacy policy URL', note: 'Must be a live, accessible URL. Required for all apps.' },
      { id: 's10_8', label: 'Complete Data Safety section — answer data collection questions accurately', note: 'If app collects no data: declare no data collected. If app collects user data (accounts, location, health etc.) you must disclose each type and its purpose. Be accurate — Google can suspend apps for false declarations.' },
      { id: 's10_9', label: 'Upload .aab build to Internal Testing first', note: 'Always go Internal → Closed → Production. Never skip steps or Google will block promotion to production.' },
      { id: 's10_10', label: 'Promote to Closed Testing', note: 'Minimum 12 testers required. Use Testers Community or recruit your own testers.' },
      { id: 's10_11', label: 'Post opt-in link to testers', note: 'Get the shareable opt-in URL from Play Console → Closed Testing → Testers tab.' },
      { id: 's10_12', label: 'Wait for 12+ testers to opt in — 14-day clock starts automatically', note: 'Google starts the clock once you have enough active testers. Monitor the countdown in Play Console dashboard.' },
      { id: 's10_13', label: 'After 14 days — promote to Production', note: 'Play Console → Production → Create new release → promote the closed testing build.' },
    ]
  },
  {
    id: 'p11', title: '11 · Privacy policy',
    steps: [
      { id: 's11_1', label: 'Create privacy policy page on dreamapplab.com', note: 'URL format suggestion: dreamapplab.com/appnameprivacy. Must be live before submission.' },
      { id: 's11_2', label: 'Policy must accurately reflect what data the app collects and how it is used', note: 'No backend/local only: state that no data is collected and everything stays on device. Backend apps: detail every data type collected, how it is stored, how it is used, and user rights.' },
      { id: 's11_3', label: '[Android] Add privacy policy URL to Google Play store listing' },
      { id: 's11_4', label: '[iOS] Add privacy policy URL in App Store Connect under App Privacy' },
    ]
  },
  {
    id: 'p12', title: '12 · Pre-submission final checks',
    steps: [
      { id: 's12_1', label: 'npx expo-doctor run and all issues resolved', note: 'Missing peer dependencies and duplicate packages cause white screen crashes in production that do not appear in Expo Go. Fix every red X before building.' },
      { id: 's12_2', label: 'App name is identical on both stores' },
      { id: 's12_2', label: 'Bundle ID matches exactly in app.json and both store consoles' },
      { id: 's12_3', label: 'Version number is correct for this release' },
      { id: 's12_4', label: 'Price is correct and consistent on both stores' },
      { id: 's12_5', label: '[iOS] Primary category selected in App Information' },
      { id: 's12_6', label: '[iOS] Content Rights completed in App Information' },
      { id: 's12_7', label: '[iOS] Age Ratings questionnaire completed in App Information' },
      { id: 's12_8', label: '[iOS] Keywords entered in App Store Connect Keywords field (100 char max)' },
      { id: 's12_9', label: '[iOS] App Privacy / data collection section completed accurately' },
      { id: 's12_10', label: '[Android] Data Safety section completed accurately' },
      { id: 's12_11', label: '[iOS] All screenshot sizes uploaded: 6.5", 5.5", iPad 13"' },
      { id: 's12_12', label: '[Android] Feature graphic uploaded — full color with icon + name + tagline' },
      { id: 's12_13', label: 'Privacy policy URL is live and accessible' },
      { id: 's12_14', label: 'In-app review prompt fires at correct trigger and storage flag prevents repeat' },
      { id: 's12_15', label: 'Final code pushed to GitHub' },
      { id: 's12_16', label: 'Tested on a real physical device one final time before submitting' },
    ]
  },
];

function getStorageKey(projectId) {
  return 'dal_checklist_' + projectId;
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
        <div style={{ height: 6, background: 'var(--bg-card)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pct + '%', background: 'var(--amber)', borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
      </div>

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
                border: '2px solid ' + (allPhaseDone ? 'var(--green)' : 'var(--border)'),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: 'white', fontWeight: 700
              }}>
                {allPhaseDone ? '✓' : ''}
              </div>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{phase.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 6 }}>{phaseDone}/{phaseTotal}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', transition: 'transform 0.2s', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
            </div>

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
                    <div style={{
                      width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 2,
                      border: '2px solid ' + (checked[step.id] ? 'var(--amber)' : 'var(--border)'),
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
