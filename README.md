# LoginDeck

LoginDeck is a Windows desktop app for managing multiple independent Salesforce browser sessions.

Each saved session gets its own persistent browser profile, so cookies and local storage are isolated from other sessions. Open one session in Microsoft Edge and another in Google Chrome, or use multiple profiles in the same browser family.

## Download

Download the latest Windows installer from the [GitHub Releases](https://github.com/aman-dhakar-191/LoginDeck/releases) page. The GitHub Actions workflow builds a Windows x64 NSIS installer when code is pushed to `main`, and publishes a GitHub Release when a `v*` tag is pushed.

## Requirements

- Windows 10/11 x64
- Microsoft Edge and/or Google Chrome installed

## Use

1. Install and open LoginDeck.
2. Give a session a name, choose Edge or Chrome, and enter your Salesforce login URL or My Domain URL.
3. Save the session.
4. Click **Open window**. LoginDeck opens a dedicated browser profile in its own window.
5. Sign in to Salesforce in that window. Repeat for other users.

LoginDeck never asks for or stores Salesforce passwords. Browser sign-in state is stored in separate local profile folders managed by Playwright.

## Build locally

```bash
npm install
npm start
```

Build the Windows installer (on Windows):

```bash
npm run dist
```

The installer is written to `release/`.

## Current scope

- Desktop app shell and session manager UI.
- Edge and Chrome selection.
- One persistent Playwright browser profile per saved session.
- Separate browser windows and independent cookies/storage.
- Local session configuration and browser profiles.

**Salesforce Admin "Login As" handoff is not automated yet.** This version opens independent Salesforce sessions; sign in to each user account separately. A later milestone can add a supported, secure Login As handoff flow.

## Security notes

- Browser profiles contain sensitive authentication cookies. Keep your Windows account protected.
- Do not share or commit the app's local data directory.
- Use only Salesforce orgs and accounts you are authorized to access.
- LoginDeck does not bypass Salesforce authentication or permissions.
