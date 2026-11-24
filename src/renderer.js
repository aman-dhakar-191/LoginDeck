const form = document.getElementById("session-form");
const list = document.getElementById("session-list");
const empty = document.getElementById("empty-state");
const count = document.getElementById("session-count");
const toast = document.getElementById("toast");
const browserSelect = document.getElementById("browser");
const profileModeSelect = document.getElementById("profile-mode");
const profileHelp = document.getElementById("profile-help");
const adminSessionSelect = document.getElementById("admin-session");
const userSearchInput = document.getElementById("user-search");
const userSearchButton = document.getElementById("user-search-button");
const userSearchStatus = document.getElementById("user-search-status");
const userResults = document.getElementById("user-results");

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function syncProfileMode() {
  const personal = profileModeSelect.value === "personal";
  if (personal) browserSelect.value = "edge";
  browserSelect.disabled = personal;
  profileHelp.textContent = personal
    ? "Opens Salesforce in your normal Microsoft Edge profile. Edge handles your existing cookies, signed-in accounts and saved passwords. LoginDeck does not access or copy them."
    : "Creates a private browser profile for this session. Sign in once; LoginDeck keeps that session separate from your other profiles.";
}

async function renderSessions() {
  const sessions = await window.loginDeck.listSessions();
  count.textContent = sessions.length;
  empty.classList.toggle("hidden", sessions.length !== 0);
  const previousAdmin = adminSessionSelect.value;
  const adminSessions = sessions.filter(session => session.profileMode !== "personal");
  adminSessionSelect.innerHTML = '<option value="">Select an isolated admin session</option>' + adminSessions.map(session =>
    '<option value="' + escapeHtml(session.id) + '">' + escapeHtml(session.name) + ' · ' + escapeHtml(session.browser) + '</option>'
  ).join("");
  if (adminSessions.some(session => session.id === previousAdmin)) adminSessionSelect.value = previousAdmin;
  list.innerHTML = sessions.map(session => {
    const personal = session.profileMode === "personal";
    return `
      <article class="session-card">
        <div class="browser-icon">${session.browser === "edge" ? "e" : "C"}</div>
        <div class="session-info">
          <h4>${escapeHtml(session.name)}</h4>
          <p>${personal ? "Personal Edge profile · Existing browser data" : `${escapeHtml(session.browser === "edge" ? "Microsoft Edge" : "Google Chrome")} · Isolated profile`} · ${escapeHtml(session.url)}</p>
        </div>
        <div class="session-actions">
          <button class="launch-button" data-launch="${escapeHtml(session.id)}">${personal ? "Open in Edge ↗" : "Open isolated ↗"}</button>
          <button class="delete-button" data-delete="${escapeHtml(session.id)}" title="Delete session">Delete</button>
        </div>
      </article>
    `;
  }).join("");
}

profileModeSelect.addEventListener("change", syncProfileMode);

form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await window.loginDeck.saveSession({
      name: document.getElementById("session-name").value,
      browser: profileModeSelect.value === "personal" ? "edge" : browserSelect.value,
      profileMode: profileModeSelect.value,
      url: document.getElementById("salesforce-url").value
    });
    form.reset();
    document.getElementById("salesforce-url").value = "https://login.salesforce.com";
    browserSelect.value = "edge";
    profileModeSelect.value = "isolated";
    syncProfileMode();
    await renderSessions();
    notify("Session saved. Open it whenever you're ready.");
  } catch (error) {
    notify(error.message || "Could not save session.");
  } finally {
    button.disabled = false;
  }
});

list.addEventListener("click", async event => {
  const launchId = event.target.closest("[data-launch]")?.dataset.launch;
  const deleteId = event.target.closest("[data-delete]")?.dataset.delete;
  if (launchId) {
    const button = event.target.closest("[data-launch]");
    button.disabled = true;
    try {
      const result = await window.loginDeck.launchSession(launchId);
      const messages = {
        "already-open": "That isolated session is already open.",
        "opened-personal": "Opened in your existing Microsoft Edge profile.",
        "launched": "Isolated browser session launched."
      };
      notify(messages[result.status] || "Browser session launched.");
    } catch (error) {
      notify(error.message || "Could not launch browser. Check that it is installed.");
    } finally {
      button.disabled = false;
    }
  }
  if (deleteId) {
    if (!confirm("Delete this saved session and its local browser profile? This signs that isolated session out. Personal Edge data is not deleted.")) return;
    try {
      await window.loginDeck.deleteSession(deleteId);
      await renderSessions();
      notify("Saved session removed. Personal Edge data was left untouched.");
    } catch (error) {
      notify(error.message || "Could not delete session.");
    }
  }
});


function setUserSearchStatus(message, error = false) {
  userSearchStatus.textContent = message;
  userSearchStatus.classList.toggle("error", error);
}

function renderUserResults(users) {
  userResults.replaceChildren();
  if (!users.length) {
    setUserSearchStatus("No matching users found.");
    return;
  }
  setUserSearchStatus(users.length + " matching user(s). Select Login As to open the standard Salesforce user page.");
  for (const user of users) {
    const card = document.createElement("article");
    card.className = "user-result";
    const details = document.createElement("div");
    details.className = "user-result-details";
    const name = document.createElement("strong");
    name.textContent = user.Name || "(No name)";
    const username = document.createElement("span");
    username.textContent = user.Username || "";
    const email = document.createElement("span");
    email.textContent = user.Email || "";
    details.append(name, username, email);
    const status = document.createElement("span");
    status.className = "user-status" + (user.IsActive ? "" : " inactive");
    status.textContent = user.IsActive ? "Active" : "Inactive";
    const action = document.createElement("button");
    action.className = "launch-button";
    action.type = "button";
    action.textContent = "Login As ↗";
    action.disabled = !user.IsActive;
    action.addEventListener("click", async () => {
      action.disabled = true;
      try {
        await window.loginDeck.openLoginAs(adminSessionSelect.value, user.Id);
        notify("Opened the Salesforce user page. Use its standard Login action.");
      } catch (error) {
        notify(error.message || "Could not open Login As.");
      } finally {
        action.disabled = !user.IsActive;
      }
    });
    card.append(details, status, action);
    userResults.append(card);
  }
}

async function runUserSearch() {
  const sessionId = adminSessionSelect.value;
  const term = userSearchInput.value.trim();
  if (!sessionId) {
    setUserSearchStatus("Select an admin session first.", true);
    return;
  }
  if (term.length < 2) {
    setUserSearchStatus("Enter at least 2 characters.", true);
    return;
  }
  userSearchButton.disabled = true;
  userResults.replaceChildren();
  setUserSearchStatus("Searching Salesforce users…");
  try {
    const users = await window.loginDeck.searchSalesforceUsers(sessionId, term);
    renderUserResults(users);
  } catch (error) {
    setUserSearchStatus(error.message || "User search failed.", true);
  } finally {
    userSearchButton.disabled = false;
  }
}

userSearchButton.addEventListener("click", runUserSearch);
userSearchInput.addEventListener("keydown", event => {
  if (event.key === "Enter") runUserSearch();
});

document.getElementById("refresh").addEventListener("click", renderSessions);
syncProfileMode();
renderSessions().catch(error => notify(error.message));
