// Auto-generated DAL pipeline checklist data — 106 tasks, 9 phases
export const PWA_PIPELINE = {
  "title": "DAL PWA Pipeline",
  "total": 106,
  "phases": [
    {
      "id": "p1",
      "title": "Phase 1 — Discovery, Scope & Kickoff",
      "note": "A PWA is an installable product, not a brochure with a manifest.",
      "tasks": [
        {
          "id": "t1",
          "num": 1,
          "text": "Confirm why a PWA vs native vs marketing site",
          "note": "",
          "badges": []
        },
        {
          "id": "t2",
          "num": 2,
          "text": "List offline / install requirements for v1",
          "note": "",
          "badges": []
        },
        {
          "id": "t3",
          "num": 3,
          "text": "List pages/screens and the core loop",
          "note": "",
          "badges": []
        },
        {
          "id": "t4",
          "num": 4,
          "text": "Confirm iOS Safari limitations the client must accept",
          "note": "",
          "badges": []
        },
        {
          "id": "t5",
          "num": 5,
          "text": "Confirm push-notification needs (and iOS constraints)",
          "note": "",
          "badges": []
        },
        {
          "id": "t6",
          "num": 6,
          "text": "Create Mission Control project with type PWA",
          "note": "",
          "badges": []
        },
        {
          "id": "t7",
          "num": 7,
          "text": "Save SOW, deposit, and kickoff notes",
          "note": "",
          "badges": [
            "blackbox"
          ]
        },
        {
          "id": "t8",
          "num": 8,
          "text": "Define success: installs, repeat visits, or task completion",
          "note": "",
          "badges": []
        },
        {
          "id": "t9",
          "num": 9,
          "text": "Confirm hosting (HTTPS is required for a real PWA)",
          "note": "",
          "badges": [
            "critical"
          ]
        },
        {
          "id": "t10",
          "num": 10,
          "text": "Share this pipeline with the builder",
          "note": "",
          "badges": []
        },
        {
          "id": "t11",
          "num": 11,
          "text": "Identify auth vs anonymous-first",
          "note": "",
          "badges": []
        },
        {
          "id": "t12",
          "num": 12,
          "text": "Park native-only features so they do not block v1",
          "note": "",
          "badges": []
        }
      ]
    },
    {
      "id": "p2",
      "title": "Phase 2 — Legal, Domain & Accounts",
      "note": "PWAs still need contracts, DNS, and a real origin.",
      "tasks": [
        {
          "id": "t13",
          "num": 13,
          "text": "Signed agreement and scope for PWA + optional wrap later",
          "note": "",
          "badges": []
        },
        {
          "id": "t14",
          "num": 14,
          "text": "Domain + HTTPS hosting project created",
          "note": "",
          "badges": []
        },
        {
          "id": "t15",
          "num": 15,
          "text": "GitHub repo with protected main",
          "note": "",
          "badges": [
            "lesson"
          ]
        },
        {
          "id": "t16",
          "num": 16,
          "text": "Save DNS, hosting, and GitHub in Black Box",
          "note": "",
          "badges": [
            "blackbox"
          ]
        },
        {
          "id": "t17",
          "num": 17,
          "text": "2FA on registrar and hosting",
          "note": "",
          "badges": [
            "security"
          ]
        },
        {
          "id": "t18",
          "num": 18,
          "text": "Decide apex vs www origin (manifest start_url must match)",
          "note": "",
          "badges": []
        },
        {
          "id": "t19",
          "num": 19,
          "text": "Privacy policy URL planned (required if you collect accounts)",
          "note": "",
          "badges": []
        },
        {
          "id": "t20",
          "num": 20,
          "text": "Client vs DAL account ownership written down",
          "note": "",
          "badges": []
        },
        {
          "id": "t21",
          "num": 21,
          "text": "Drive folder for brand and legal PDFs",
          "note": "",
          "badges": []
        },
        {
          "id": "t22",
          "num": 22,
          "text": "Staging hostname chosen (preview.vercel.app or similar)",
          "note": "",
          "badges": []
        },
        {
          "id": "t23",
          "num": 23,
          "text": "Confirm cookies / storage plan (local vs Firestore)",
          "note": "",
          "badges": []
        },
        {
          "id": "t24",
          "num": 24,
          "text": "Budget alert if using billed backend APIs",
          "note": "",
          "badges": [
            "security"
          ]
        }
      ]
    },
    {
      "id": "p3",
      "title": "Phase 3 — Brand, UX & Install Surface",
      "note": "Install prompts fail if the icon and name look unfinished.",
      "tasks": [
        {
          "id": "t25",
          "num": 25,
          "text": "App name (12 chars-friendly) and short_name",
          "note": "",
          "badges": []
        },
        {
          "id": "t26",
          "num": 26,
          "text": "Maskable icon 512 and apple-touch-icon 180",
          "note": "",
          "badges": []
        },
        {
          "id": "t27",
          "num": 27,
          "text": "Theme color and background color matching the shell",
          "note": "",
          "badges": []
        },
        {
          "id": "t28",
          "num": 28,
          "text": "Splash/start experience on iOS (apple-mobile-web-app meta)",
          "note": "",
          "badges": []
        },
        {
          "id": "t29",
          "num": 29,
          "text": "Design the install hint (iOS share sheet instructions)",
          "note": "",
          "badges": []
        },
        {
          "id": "t30",
          "num": 30,
          "text": "Mobile-first layout; desktop is secondary unless scoped",
          "note": "",
          "badges": []
        },
        {
          "id": "t31",
          "num": 31,
          "text": "Empty states for the core object",
          "note": "",
          "badges": []
        },
        {
          "id": "t32",
          "num": 32,
          "text": "Write onboarding that explains install + permissions",
          "note": "",
          "badges": []
        },
        {
          "id": "t33",
          "num": 33,
          "text": "Favicon set that is not a default framework icon",
          "note": "",
          "badges": []
        },
        {
          "id": "t34",
          "num": 34,
          "text": "Contrast and type scale for outdoor/mobile use",
          "note": "",
          "badges": []
        },
        {
          "id": "t35",
          "num": 35,
          "text": "Client approval of name + icon before engineering freeze",
          "note": "",
          "badges": []
        },
        {
          "id": "t36",
          "num": 36,
          "text": "Save icon source files in Drive",
          "note": "",
          "badges": []
        }
      ]
    },
    {
      "id": "p4",
      "title": "Phase 4 — App Shell, Manifest & Service Worker",
      "note": "Without a valid manifest + SW, it is not a PWA.",
      "tasks": [
        {
          "id": "t37",
          "num": 37,
          "text": "Add a web app manifest (name, icons, display, start_url, scope)",
          "note": "",
          "badges": [
            "critical"
          ]
        },
        {
          "id": "t38",
          "num": 38,
          "text": "display standalone (or agreed display mode)",
          "note": "",
          "badges": []
        },
        {
          "id": "t39",
          "num": 39,
          "text": "Register a service worker on the production origin",
          "note": "",
          "badges": []
        },
        {
          "id": "t40",
          "num": 40,
          "text": "Precache the app shell; network-first for API/Firestore",
          "note": "",
          "badges": []
        },
        {
          "id": "t41",
          "num": 41,
          "text": "Handle SW updates (skipWaiting strategy documented)",
          "note": "",
          "badges": []
        },
        {
          "id": "t42",
          "num": 42,
          "text": "Add an offline fallback page",
          "note": "",
          "badges": []
        },
        {
          "id": "t43",
          "num": 43,
          "text": "Verify installability in Chrome (Application panel)",
          "note": "",
          "badges": []
        },
        {
          "id": "t44",
          "num": 44,
          "text": "Verify Add to Home Screen on iOS Safari",
          "note": "",
          "badges": []
        },
        {
          "id": "t45",
          "num": 45,
          "text": "Ensure start_url is in scope and HTTPS",
          "note": "",
          "badges": [
            "critical"
          ]
        },
        {
          "id": "t46",
          "num": 46,
          "text": "Do not cache authenticated API responses loosely",
          "note": "",
          "badges": [
            "security"
          ]
        },
        {
          "id": "t47",
          "num": 47,
          "text": "Version the cache name so deploys bust stale shells",
          "note": "",
          "badges": []
        },
        {
          "id": "t48",
          "num": 48,
          "text": "Document how to unregister SW during support",
          "note": "",
          "badges": []
        }
      ]
    },
    {
      "id": "p5",
      "title": "Phase 5 — Backend, Auth & Data",
      "note": "Same security bar as a native app.",
      "tasks": [
        {
          "id": "t49",
          "num": 49,
          "text": "Firebase (or agreed backend) project created under the right account",
          "note": "",
          "badges": []
        },
        {
          "id": "t50",
          "num": 50,
          "text": "Auth methods enabled and tested on mobile Safari",
          "note": "",
          "badges": []
        },
        {
          "id": "t51",
          "num": 51,
          "text": "Firestore rules deny by default",
          "note": "",
          "badges": [
            "security"
          ]
        },
        {
          "id": "t52",
          "num": 52,
          "text": "Storage rules if uploads exist",
          "note": "",
          "badges": [
            "security"
          ]
        },
        {
          "id": "t53",
          "num": 53,
          "text": "Account deletion if you have accounts",
          "note": "",
          "badges": [
            "critical"
          ]
        },
        {
          "id": "t54",
          "num": 54,
          "text": "No secrets in the client bundle",
          "note": "",
          "badges": [
            "security"
          ]
        },
        {
          "id": "t55",
          "num": 55,
          "text": "App Check if public",
          "note": "",
          "badges": [
            "security"
          ]
        },
        {
          "id": "t56",
          "num": 56,
          "text": "PITR / backups if Firestore is source of truth",
          "note": "",
          "badges": [
            "security"
          ]
        },
        {
          "id": "t57",
          "num": 57,
          "text": "Save Firebase IDs in Black Box",
          "note": "",
          "badges": [
            "blackbox"
          ]
        },
        {
          "id": "t58",
          "num": 58,
          "text": "Test permission-denied UX",
          "note": "",
          "badges": []
        },
        {
          "id": "t59",
          "num": 59,
          "text": "Index composite queries",
          "note": "",
          "badges": []
        },
        {
          "id": "t60",
          "num": 60,
          "text": "Document emulator vs production",
          "note": "",
          "badges": []
        }
      ]
    },
    {
      "id": "p6",
      "title": "Phase 6 — Core Product Build",
      "note": "The PWA has to complete the job that made the client pay.",
      "tasks": [
        {
          "id": "t61",
          "num": 61,
          "text": "Implement the core loop on the app shell",
          "note": "",
          "badges": []
        },
        {
          "id": "t62",
          "num": 62,
          "text": "CRUD for the primary object",
          "note": "",
          "badges": []
        },
        {
          "id": "t63",
          "num": 63,
          "text": "Settings: legal links, sign out, delete, install help",
          "note": "",
          "badges": []
        },
        {
          "id": "t64",
          "num": 64,
          "text": "Add to Home Screen instructions for iOS",
          "note": "",
          "badges": []
        },
        {
          "id": "t65",
          "num": 65,
          "text": "Share / invite if it is part of the loop",
          "note": "",
          "badges": []
        },
        {
          "id": "t66",
          "num": 66,
          "text": "Loading and offline banners",
          "note": "",
          "badges": []
        },
        {
          "id": "t67",
          "num": 67,
          "text": "Push (Web Push) only if scoped and actually implemented",
          "note": "",
          "badges": []
        },
        {
          "id": "t68",
          "num": 68,
          "text": "File inputs / camera where scoped; test iOS file picker",
          "note": "",
          "badges": []
        },
        {
          "id": "t69",
          "num": 69,
          "text": "Keep main shippable via feature branches",
          "note": "",
          "badges": [
            "lesson"
          ]
        },
        {
          "id": "t70",
          "num": 70,
          "text": "PR review of Files Changed",
          "note": "",
          "badges": [
            "lesson"
          ]
        },
        {
          "id": "t71",
          "num": 71,
          "text": "No debug panels in production",
          "note": "",
          "badges": []
        },
        {
          "id": "t72",
          "num": 72,
          "text": "Capture polish as Edits Needed",
          "note": "",
          "badges": []
        }
      ]
    },
    {
      "id": "p7",
      "title": "Phase 7 — Performance, SEO & Measurement",
      "note": "Installable and fast. Slow PWAs get deleted.",
      "tasks": [
        {
          "id": "t73",
          "num": 73,
          "text": "Lighthouse PWA section: fix installability failures",
          "note": "",
          "badges": [
            "critical"
          ]
        },
        {
          "id": "t74",
          "num": 74,
          "text": "Lighthouse Performance on mobile",
          "note": "",
          "badges": []
        },
        {
          "id": "t75",
          "num": 75,
          "text": "Code-split large routes",
          "note": "",
          "badges": []
        },
        {
          "id": "t76",
          "num": 76,
          "text": "Compress images; avoid huge JS for a landing hero",
          "note": "",
          "badges": []
        },
        {
          "id": "t77",
          "num": 77,
          "text": "Analytics without PII in properties",
          "note": "",
          "badges": [
            "security"
          ]
        },
        {
          "id": "t78",
          "num": 78,
          "text": "Sentry (or agreed) on the production origin",
          "note": "",
          "badges": []
        },
        {
          "id": "t79",
          "num": 79,
          "text": "robots/sitemap if any routes should be indexed",
          "note": "",
          "badges": []
        },
        {
          "id": "t80",
          "num": 80,
          "text": "If app-like, noindex private app routes",
          "note": "",
          "badges": []
        },
        {
          "id": "t81",
          "num": 81,
          "text": "Save analytics/Sentry in Black Box",
          "note": "",
          "badges": [
            "blackbox"
          ]
        },
        {
          "id": "t82",
          "num": 82,
          "text": "Test on a mid-range Android over LTE",
          "note": "",
          "badges": []
        },
        {
          "id": "t83",
          "num": 83,
          "text": "Measure Time to Interactive on first visit vs repeat (SW)",
          "note": "",
          "badges": []
        },
        {
          "id": "t84",
          "num": 84,
          "text": "Confirm SW does not serve a stale broken shell after a bad deploy",
          "note": "",
          "badges": []
        }
      ]
    },
    {
      "id": "p8",
      "title": "Phase 8 — Security, QA & Store-Adjacent Checks",
      "note": "Treat it like a product users keep on their home screen.",
      "tasks": [
        {
          "id": "t85",
          "num": 85,
          "text": "HTTPS only; HSTS if you control the domain",
          "note": "",
          "badges": [
            "security"
          ]
        },
        {
          "id": "t86",
          "num": 86,
          "text": "CSP as tight as the SW and APIs allow",
          "note": "",
          "badges": [
            "security"
          ]
        },
        {
          "id": "t87",
          "num": 87,
          "text": "Diff-review Firestore rules before deploy",
          "note": "",
          "badges": [
            "security",
            "lesson"
          ]
        },
        {
          "id": "t88",
          "num": 88,
          "text": "QA iPhone Safari add-to-home and relaunch",
          "note": "",
          "badges": []
        },
        {
          "id": "t89",
          "num": 89,
          "text": "QA Android Chrome install and relaunch",
          "note": "",
          "badges": []
        },
        {
          "id": "t90",
          "num": 90,
          "text": "QA offline: open core screens without network",
          "note": "",
          "badges": []
        },
        {
          "id": "t91",
          "num": 91,
          "text": "QA update: ship a change and confirm clients get the new SW",
          "note": "",
          "badges": []
        },
        {
          "id": "t92",
          "num": 92,
          "text": "Keyboard and screen-reader pass on primary flow",
          "note": "",
          "badges": []
        },
        {
          "id": "t93",
          "num": 93,
          "text": "Privacy policy + terms live and linked",
          "note": "",
          "badges": [
            "critical"
          ]
        },
        {
          "id": "t94",
          "num": 94,
          "text": "Test account for the client/reviewer in Black Box",
          "note": "",
          "badges": [
            "blackbox"
          ]
        },
        {
          "id": "t95",
          "num": 95,
          "text": "Fix P0 bugs before launch",
          "note": "",
          "badges": [
            "critical"
          ]
        },
        {
          "id": "t96",
          "num": 96,
          "text": "Never git add . blindly",
          "note": "",
          "badges": [
            "lesson"
          ]
        }
      ]
    },
    {
      "id": "p9",
      "title": "Phase 9 — Launch, Handoff & Care",
      "note": "Clients need install instructions more than a URL.",
      "tasks": [
        {
          "id": "t97",
          "num": 97,
          "text": "Production deploy on the final origin",
          "note": "",
          "badges": []
        },
        {
          "id": "t98",
          "num": 98,
          "text": "Verify manifest + SW on the live origin (not only staging)",
          "note": "",
          "badges": []
        },
        {
          "id": "t99",
          "num": 99,
          "text": "Send install instructions (iOS and Android) to the client",
          "note": "",
          "badges": []
        },
        {
          "id": "t100",
          "num": 100,
          "text": "Walk through Print / Export handoff",
          "note": "",
          "badges": []
        },
        {
          "id": "t101",
          "num": 101,
          "text": "Confirm DNS, SSL, and auto-renew",
          "note": "",
          "badges": []
        },
        {
          "id": "t102",
          "num": 102,
          "text": "Monitor errors for 72 hours",
          "note": "",
          "badges": []
        },
        {
          "id": "t103",
          "num": 103,
          "text": "Document how to ship a hotfix (cache bust)",
          "note": "",
          "badges": []
        },
        {
          "id": "t104",
          "num": 104,
          "text": "Optional: wrap in a thin native shell later — do not pretend it is in the stores unless it is",
          "note": "",
          "badges": []
        },
        {
          "id": "t105",
          "num": 105,
          "text": "Mark project Live / In Progress and schedule a post-launch check",
          "note": "",
          "badges": []
        },
        {
          "id": "t106",
          "num": 106,
          "text": "Write one Lesson Learned if SW or iOS install surprised you",
          "note": "",
          "badges": [
            "lesson"
          ]
        }
      ]
    }
  ]
};
