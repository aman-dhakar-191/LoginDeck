const form = document.getElementById("session-form");
const list = document.getElementById("session-list");
const empty = document.getElementById("empty-state");
const count = document.getElementById("session-count");
const toast = document.getElementById("toast");

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

async function renderSessions() {
  const sessions = await window.loginDeck.listSessions();
  count.textContent = sessions.length;
  empty.classList.toggle("hidden", sessions.length !== 0);
  list.innerHTML = sessions.map(session => `
    <article class="session-card">
      <div class="browser-icon">${session.browser === "edge" ? "e" : "C"}</div>
      <div class="session-info">
        <h4>${escapeHtml(session.name)}</h4>
        <p>${escapeHtml(session.browser === "edge" ? "Microsoft Edge" : "Google Chrome")} · ${escapeHtml(session.url)}</p>
      </div>
      <div class="session-actions">
        <button class="launch-button" data-launch="${escapeHtml(session.id)}">Open window ↗</button>
        <button class="delete-button" data-delete="${escapeHtml(session.id)}" title="Delete session">Delete</button>
      </div>
    </article>
  `).join("");
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await window.loginDeck.saveSession({
      name: document.getElementById("session-name").value,
      browser: document.getElementById("browser").value,
      url: document.getElementById("salesforce-url").value
    });
    form.reset();
    document.getElementById("salesforce-url").value = "https://login.salesforce.com";
    document.getElementById("browser").value = "edge";
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
      notify(result.status === "already-open" ? "That session is already open." : "Browser session launched.");
    } catch (error) {
      notify(error.message || "Could not launch browser. Check that it is installed.");
    } finally {
      button.disabled = false;
    }
  }
  if (deleteId) {
    if (!confirm("Delete this saved session and its local browser profile? This signs that session out.")) return;
    try {
      await window.loginDeck.deleteSession(deleteId);
      await renderSessions();
      notify("Session and local browser profile removed.");
    } catch (error) {
      notify(error.message || "Could not delete session.");
    }
  }
});

document.getElementById("refresh").addEventListener("click", renderSessions);
renderSessions().catch(error => notify(error.message));
