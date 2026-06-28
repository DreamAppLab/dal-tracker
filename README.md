# DAL Mission Control

Dream App Lab internal dashboard for tracking all apps, websites, milestones, edits, tech stacks, and financials.

## Tech Stack
- React 18
- Recharts (analytics)
- localStorage (no backend needed)
- Vercel (free hosting)

## Local Development

```bash
npm install
npm start
```

## Deploy to Vercel (Free)

### Option A — Vercel CLI (fastest)
```bash
npm install -g vercel
npm run build
vercel --prod
```

### Option B — GitHub + Vercel Dashboard
1. Push this folder to a GitHub repo (public or private)
2. Go to vercel.com → "Add New Project"
3. Import your GitHub repo
4. Settings:
   - Framework: **Create React App**
   - Build Command: `npm run build`
   - Output Directory: `build`
5. Click Deploy — you get a free `.vercel.app` URL instantly
6. Optional: Add custom domain (e.g. `tracker.dreamapplab.com`) — also free on Vercel

### Notes
- All data is stored in your browser's `localStorage` — no backend, no database costs
- Works on mobile too (responsive layout)
- The free Vercel Hobby plan is more than enough for this internal tool
- Data persists between sessions on the same browser/device

## Features
- Dashboard with all projects, stats, revenue vs cost
- Per-project detail with 5 tabs: Overview, Milestones, Edits Needed, Tech Stack, Financials
- Add/edit/delete milestones with title, description, budget, due date
- Log edits needed by Page → Location → Item → Notes → Priority
- Full tech stack table per project
- Track MRR, total revenue, operating expenses (monthly/yearly), net P&L
- Progress bars (milestones + edits combined)
- App pipeline / ideation tracker
- Add new projects with custom emoji + color

## Adding a Client Project
Click "+ Add Project" and set Type to "Client App" or "Client Website" — it appears in the separate Websites & Web Apps section.

## Data Backup
Open browser DevTools → Application → Local Storage → copy the value of `dal-projects` and `dal-pipeline` to back up your data.
