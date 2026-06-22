// src/data/initialData.js
export const INITIAL_PROJECTS = [
  {
    id: "myclasslog",
    name: "MyClassLog",
    type: "own-app",
    platform: "mobile",
    status: "live",
    tagline: "K-12 Classroom Management",
    color: "#6366F1",
    logo: "MCL",
    bundleId: "com.dreamapplab.myclasslog",
    launchDate: "2024-01-15",
    revenue: { monthly: 420, total: 3780, currency: "USD", model: "freemium" },
    expenses: [
      { id: "e1", name: "Apple Dev Account", amount: 99, period: "yearly", category: "platform" },
      { id: "e2", name: "Google Play Account", amount: 25, period: "yearly", category: "platform" },
      { id: "e3", name: "EAS Build", amount: 29, period: "monthly", category: "devops" }
    ],
    techStack: [
      { layer: "Framework", tech: "React Native / Expo SDK 54" },
      { layer: "Build", tech: "EAS Build + EAS Submit" },
      { layer: "Storage", tech: "AsyncStorage" },
      { layer: "Distribution", tech: "Apple App Store + Google Play" },
      { layer: "Analytics", tech: "None (planned)" }
    ],
    milestones: [
      { id: "m1", title: "App Store Launch", description: "Initial launch on Apple App Store", amount: 0, dueDate: "2024-01-15", completed: true },
      { id: "m2", title: "Play Store Launch", description: "Launch on Google Play", amount: 0, dueDate: "2024-02-01", completed: true },
      { id: "m3", title: "Tutorial Videos", description: "ElevenLabs + Camtasia video series", amount: 500, dueDate: "2024-06-01", completed: true },
      { id: "m4", title: "Push Notifications", description: "Add reminder system for assignments", amount: 0, dueDate: "2025-02-01", completed: false },
      { id: "m5", title: "Parent Portal", description: "View-only portal for parents", amount: 1200, dueDate: "2025-04-01", completed: false }
    ],
    edits: [
      { id: "ed1", page: "Dashboard", location: "Top Nav", item: "Filter by class", notes: "Add dropdown to filter view by period", priority: "medium", completed: false },
      { id: "ed2", page: "Gradebook", location: "Grade Entry", item: "Bulk import", notes: "CSV import for grade entry", priority: "high", completed: false },
      { id: "ed3", page: "Settings", location: "Profile", item: "School logo upload", notes: "Let teachers add school branding", priority: "low", completed: true }
    ]
  },
  {
    id: "tenmilesahead",
    name: "Ten Miles Ahead",
    type: "own-app",
    platform: "mobile",
    status: "live",
    tagline: "Travel Journaling",
    color: "#00D4B8",
    logo: "TMA",
    bundleId: "com.dreamapplab.tenmilesahead",
    launchDate: "2024-03-10",
    revenue: { monthly: 185, total: 1295, currency: "USD", model: "paid" },
    expenses: [
      { id: "e1", name: "Mapbox API", amount: 15, period: "monthly", category: "api" },
      { id: "e2", name: "EAS Build", amount: 29, period: "monthly", category: "devops" }
    ],
    techStack: [
      { layer: "Framework", tech: "React Native / Expo SDK 54" },
      { layer: "Maps", tech: "Mapbox SDK" },
      { layer: "Storage", tech: "AsyncStorage + expo-file-system" },
      { layer: "PDF Export", tech: "expo-print + expo-sharing" },
      { layer: "Distribution", tech: "Apple App Store + Google Play" }
    ],
    milestones: [
      { id: "m1", title: "v1.0 Launch", description: "MVP launch with core journaling", amount: 0, dueDate: "2024-03-10", completed: true },
      { id: "m2", title: "Offline Maps", description: "Downloadable map tiles for offline use", amount: 0, dueDate: "2025-01-01", completed: false },
      { id: "m3", title: "Photo Import", description: "Import from camera roll with geo-tagging", amount: 0, dueDate: "2024-12-01", completed: true }
    ],
    edits: [
      { id: "ed1", page: "Journal Entry", location: "Media", item: "Video clips", notes: "Allow short video attachments", priority: "low", completed: false },
      { id: "ed2", page: "Map View", location: "Route Layer", item: "Custom route colors", notes: "Color by trip segment", priority: "medium", completed: false }
    ]
  },
  {
    id: "rvvault",
    name: "RV Vault",
    type: "own-app",
    platform: "mobile",
    status: "in-development",
    tagline: "RV Maintenance & Management",
    color: "#F59E0B",
    logo: "RVV",
    bundleId: "com.dreamapplab.rvvault",
    launchDate: null,
    revenue: { monthly: 0, total: 0, currency: "USD", model: "freemium" },
    expenses: [
      { id: "e1", name: "EAS Build", amount: 29, period: "monthly", category: "devops" }
    ],
    techStack: [
      { layer: "Framework", tech: "React Native / Expo SDK 54" },
      { layer: "Storage", tech: "AsyncStorage" },
      { layer: "OEM Data", tech: "Custom JSON dataset (2000-2026)" },
      { layer: "PDF Export", tech: "expo-print + expo-sharing" },
      { layer: "Distribution", tech: "Apple App Store + Google Play (planned)" }
    ],
    milestones: [
      { id: "m1", title: "OEM Data Complete", description: "Full maintenance dataset for all RV makes/models", amount: 0, dueDate: "2025-01-01", completed: true },
      { id: "m2", title: "Work Order System", description: "7-point spec work order feature", amount: 0, dueDate: "2025-03-01", completed: true },
      { id: "m3", title: "Beta Testing", description: "Closed beta via TestFlight", amount: 0, dueDate: "2025-07-01", completed: false },
      { id: "m4", title: "App Store Submit", description: "Submit to Apple App Store", amount: 0, dueDate: "2025-09-01", completed: false }
    ],
    edits: [
      { id: "ed1", page: "Work Orders", location: "Location Tracking", item: "GPS auto-fill", notes: "Pull current location for work order address", priority: "high", completed: false },
      { id: "ed2", page: "Maintenance Log", location: "Filters", item: "Filter by system", notes: "Engine, generator, axle, etc.", priority: "medium", completed: false },
      { id: "ed3", page: "Dashboard", location: "Stats", item: "Mileage tracker", notes: "Odometer entry with service reminders", priority: "high", completed: false }
    ]
  },
  {
    id: "flarepad",
    name: "Flarepad",
    type: "own-app",
    platform: "mobile",
    status: "submitted",
    tagline: "Personal Health Symptom Journal",
    color: "#FF5B5B",
    logo: "FLP",
    bundleId: "com.dreamapplab.flarepad",
    launchDate: null,
    price: 2.99,
    revenue: { monthly: 0, total: 0, currency: "USD", model: "paid" },
    expenses: [
      { id: "e1", name: "EAS Build", amount: 29, period: "monthly", category: "devops" }
    ],
    techStack: [
      { layer: "Framework", tech: "React Native / Expo SDK 54 (pinned)" },
      { layer: "Storage", tech: "AsyncStorage (no backend)" },
      { layer: "PDF Export", tech: "expo-print printToFileAsync + expo-sharing" },
      { layer: "Auth", tech: "None (local only)" },
      { layer: "Distribution", tech: "App Store + Play Store (submitted)" }
    ],
    milestones: [
      { id: "m1", title: "Build Complete", description: "Full 31-step, 8-phase build", amount: 0, dueDate: "2025-04-01", completed: true },
      { id: "m2", title: "Publishing Guide", description: "Flarepad_Publishing_Guide_v3.docx created", amount: 0, dueDate: "2025-04-15", completed: true },
      { id: "m3", title: "App Store Submit", description: "Submitted to Apple App Store", amount: 0, dueDate: "2025-05-01", completed: true },
      { id: "m4", title: "Play Store Submit", description: "Submitted via Google closed testing (testerscommunity.com)", amount: 0, dueDate: "2025-05-01", completed: true },
      { id: "m5", title: "App Store Approved", description: "Go live on App Store", amount: 0, dueDate: "2025-06-01", completed: false },
      { id: "m6", title: "Play Store Approved", description: "Go live on Play Store", amount: 0, dueDate: "2025-06-15", completed: false }
    ],
    edits: []
  },
  {
    id: "logabode",
    name: "Logabode",
    type: "own-app",
    platform: "mobile",
    status: "in-development",
    tagline: "Home Repair & Warranty Tracker",
    color: "#F59E0B",
    logo: "LGA",
    bundleId: "com.dreamapplab.logabode",
    launchDate: null,
    price: 2.99,
    revenue: { monthly: 0, total: 0, currency: "USD", model: "paid" },
    expenses: [
      { id: "e1", name: "EAS Build", amount: 29, period: "monthly", category: "devops" }
    ],
    techStack: [
      { layer: "Framework", tech: "React Native / Expo SDK 54 (pinned)" },
      { layer: "Storage", tech: "AsyncStorage (no backend)" },
      { layer: "PDF Export", tech: "expo-print + expo-sharing" },
      { layer: "Auth", tech: "None (local only)" },
      { layer: "Palette", tech: "Warm Slate + Amber" },
      { layer: "Nav", tech: "4-tab bottom navigation" }
    ],
    milestones: [
      { id: "m1", title: "Logo Design", description: "Bold amber shield + white house silhouette in Canva", amount: 0, dueDate: "2025-05-15", completed: false },
      { id: "m2", title: "Cursor Build", description: "Full app build in Cursor", amount: 0, dueDate: "2025-07-01", completed: false },
      { id: "m3", title: "App Store Submit", description: "Submit to Apple App Store", amount: 0, dueDate: "2025-08-01", completed: false },
      { id: "m4", title: "Play Store Submit", description: "Submit to Google Play", amount: 0, dueDate: "2025-08-15", completed: false }
    ],
    edits: []
  },
  {
    id: "dal-website",
    name: "Dream App Lab Website",
    type: "own-website",
    platform: "web",
    status: "in-development",
    tagline: "dreamapplab.com — Studio Site",
    color: "#58c6f4",
    logo: "WEB",
    bundleId: null,
    launchDate: null,
    revenue: { monthly: 0, total: 0, currency: "USD", model: "lead-gen" },
    expenses: [
      { id: "e1", name: "Netlify Hosting", amount: 0, period: "monthly", category: "hosting" },
      { id: "e2", name: "Domain (dreamapplab.com)", amount: 15, period: "yearly", category: "domain" }
    ],
    techStack: [
      { layer: "Builder", tech: "Cursor (HTML/CSS/JS)" },
      { layer: "Hosting", tech: "Netlify" },
      { layer: "Font", tech: "Inter" },
      { layer: "Palette", tech: "Black + Electric Blue #58c6f4" },
      { layer: "Forms", tech: "Jotform (ID: 261383968266168)" },
      { layer: "Email", tech: "Brevo" },
      { layer: "Payments", tech: "Stripe" }
    ],
    milestones: [
      { id: "m1", title: "Cursor Prompt Drafted", description: "Full Cursor prompt with brand specs", amount: 0, dueDate: "2025-03-01", completed: true },
      { id: "m2", title: "Homepage Build", description: "Hero, services, portfolio sections", amount: 0, dueDate: "2025-06-01", completed: false },
      { id: "m3", title: "Quote Pipeline Live", description: "Jotform → GAS → Brevo → Stripe", amount: 0, dueDate: "2025-05-01", completed: true },
      { id: "m4", title: "Go Live", description: "Deploy to Netlify, DNS pointed", amount: 0, dueDate: "2025-07-01", completed: false }
    ],
    edits: [
      { id: "ed1", page: "Homepage", location: "Hero", item: "Headline copy", notes: "Remove teaching background references", priority: "high", completed: true },
      { id: "ed2", page: "Services", location: "Quote Form", item: "Scope clarification", notes: "Instant Quote form is for website projects only", priority: "high", completed: true },
      { id: "ed3", page: "Portfolio", location: "App Grid", item: "App cards", notes: "Add MyClassLog, Ten Miles Ahead, RV Vault", priority: "medium", completed: false }
    ]
  }
];

export const PIPELINE_APPS = [
  { id: "plantcare", name: "Plant Care Journal", logo: "PLT", color: "#22C55E", status: "ideation" },
  { id: "petsymptom", name: "Pet Symptom Journal", logo: "PET", color: "#8B5CF6", status: "ideation" },
  { id: "yarnstash", name: "Yarn & Fabric Stash Tracker", logo: "YRN", color: "#EC4899", status: "ideation" },
  { id: "medsideeffect", name: "Medication Side Effect Journal", logo: "MED", color: "#06B6D4", status: "ideation" },
  { id: "migrainelogger", name: "Migraine Pattern Logger", logo: "MIG", color: "#7C3AED", status: "ideation" },
  { id: "parentcare", name: "Aging Parent Care Journal", logo: "FAM", color: "#F43F5E", status: "ideation" }
];

export const STATUS_CONFIG = {
  live: { label: "Live", color: "#00D4B8", bg: "rgba(0,212,184,0.15)" },
  submitted: { label: "Submitted", color: "#6366F1", bg: "rgba(99,102,241,0.15)" },
  "in-development": { label: "In Development", color: "#F59E0B", bg: "rgba(245,158,11,0.15)" },
  ideation: { label: "Ideation", color: "#94A3B8", bg: "rgba(148,163,184,0.15)" },
  paused: { label: "Paused", color: "#FF5B5B", bg: "rgba(255,91,91,0.15)" }
};

export const PRIORITY_CONFIG = {
  high: { label: "High", color: "#FF5B5B" },
  medium: { label: "Medium", color: "#F59E0B" },
  low: { label: "Low", color: "#6366F1" }
};
