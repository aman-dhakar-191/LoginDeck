# LoginDeck

LoginDeck is a Windows desktop session manager plus a companion Salesforce browser extension.

## Desktop app

LoginDeck supports two browser profile modes:

- **Personal Edge profile** opens Salesforce through the Windows Microsoft Edge protocol handler. Edge uses its normal profile selection and handles existing sign-ins, cookies and saved passwords. LoginDeck does not read, export, copy or store browser credentials. The Edge profile that opens is controlled by Edge/Windows (typically the default or last-used Edge profile).
- **LoginDeck isolated profile** launches Chrome or Edge with a dedicated user-data directory for that saved session. Cookies and site storage are separate for each LoginDeck session; sign in once in each isolated profile.

Personal Edge mode is currently Windows-only and supports Microsoft Edge. It opens a tab/window in Edge but does not give LoginDeck control over that personal browser window. Deleting a Personal Edge session removes only its LoginDeck shortcut/configuration; it does not touch Edge data. Existing sessions without a `profileMode` setting continue to launch as isolated profiles.

Download the Windows installer from the GitHub Releases page.

## Companion extension

The unpacked Manifest V3 extension is in the `extension/` folder. The release ZIP contains the same folder ready for unpacked installation.

1. Install LoginDeck desktop and keep it running.
2. Open `edge://extensions` or `chrome://extensions`.
3. Enable Developer mode and choose **Load unpacked**.
4. Select the extracted `extension/` folder (or the repository's `extension/` folder).
5. Open a signed-in Salesforce Lightning org tab and open the LoginDeck extension side panel.
6. Copy the six-digit pairing code from LoginDeck's **Browser Connection** panel into the extension and select **Connect**.

The extension reports the Salesforce org and authenticated admin identity to the desktop app over a loopback-only local HTTP bridge on `127.0.0.1:17321`. The bridge uses a desktop pairing code and a per-connection random token. Multiple Edge and Chrome org tabs can be connected simultaneously. The extension sends periodic heartbeats and services LoginDeck user-search and open-Setup commands.

The extension uses the signed-in Salesforce tab's REST API to identify the current user and search users. It does not collect or export session cookies, passwords or Salesforce access tokens. User search requires Salesforce API access and appropriate user visibility/permissions.

## Browser bridge behaviour and limits

- Connections are held in the desktop app's memory and are cleared when LoginDeck exits. After restarting LoginDeck, reconnect each org using the new pairing code. Reconnect after a browser restart if the original tab ID changes.
- Each connection is tied to the browser tab and Salesforce org that were paired. Keep that original org tab open; closing it makes the connection go offline.
- The extension's background service worker sends a heartbeat every 30 seconds. The side panel polls more frequently while open.
- The bridge listens only on loopback (127.0.0.1); it is not exposed to the local network.
- Login As opens the standard Salesforce Setup user page in the same browser profile. The administrator still completes Salesforce's standard Login action; the extension does not bypass Salesforce permissions or login-access settings.

## CI and releases

- **Build LoginDeck** runs on pull requests targeting `main` to validate the Windows installer, and again after changes are merged to `main`. Only the post-merge run uploads the 14-day installer artifact.
- **Release LoginDeck** is separate. Run it from Actions → Release LoginDeck → Run workflow, choose Major, Minor or Patch, and optionally add release notes. It increments the version, commits the version bump to `main`, creates a version tag, builds the installer and updater metadata, and publishes the GitHub Release.
- You can also create and push a matching `vX.Y.Z` tag yourself. The Release workflow will build and publish it, provided its version matches `package.json`.
- Merging a pull request never publishes a GitHub Release automatically.

## In-app updates

Installed Windows builds check the GitHub Releases feed shortly after startup. When a newer release is published, LoginDeck downloads it in the background and shows a **Restart & install** action when ready. You can also use **Check now**. Updates are delivered through electron-updater and GitHub Releases. Release builds increment package.json before building and upload the installer plus updater metadata; development builds do not self-update.
