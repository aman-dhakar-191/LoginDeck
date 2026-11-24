# LoginDeck

Manage multiple isolated Salesforce user sessions in separate visible browser windows.

> Early prototype. Use only Salesforce orgs and accounts you are authorized to access.

## Why

Incognito windows in the same Chrome/Edge Incognito session share the Incognito cookie store. LoginDeck instead creates one Playwright `BrowserContext` per session, giving each session independent cookies and browser storage.

## Requirements

- Node.js 20+
- Google Chrome or Microsoft Edge installed (optional), or Playwright's bundled Chromium

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm start
```

Set the browser and URL using environment variables:

**PowerShell**
```powershell
$env:BROWSER="msedge" # chrome, msedge, or chromium
$env:SALESFORCE_URL="https://your-domain.my.salesforce.com"
$env:SESSION_COUNT="2"
npm start
```

**macOS/Linux**
```bash
BROWSER=chrome SALESFORCE_URL=https://your-domain.my.salesforce.com SESSION_COUNT=2 npm start
```

The initial prototype opens separate visible windows. Sign in to each window independently.

## Architecture

- One Playwright browser process.
- One independent non-persistent browser context per user session.
- One visible page/window per context.
- No cookies or storage are copied between contexts.
- Contexts are in-memory only in this prototype; closing LoginDeck clears them.

## Salesforce Login As

Automating the Salesforce Login As handoff is not implemented yet. The next milestone is to test how the org's Login As action establishes its authenticated session, then perform that handoff inside the intended isolated context. Do not copy an authenticated URL or cookies from one user's context into another.

## Security

- Never commit credentials, cookies, access tokens, or session data.
- Prefer a dedicated Salesforce sandbox and test users.
- Treat each browser session as sensitive authentication material.
