const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFile } = require("child_process");

loadLocalConfig();

const PORT = Number(process.env.PORT || 3000);
const AUDIENCE = "https://api2.arduino.cc/iot";
const TOKEN_URL = "https://api2.arduino.cc/iot/v1/clients/token";
const DEVICES_URL = "https://api2.arduino.cc/iot/v2/devices";
const THINGS_URL = "https://api2.arduino.cc/iot/v2/things";
const FLEET_CONFIG_PATH = path.join(__dirname, "config", "fleet.json");
const DEPLOY_SCRIPT_PATH = path.join(__dirname, "scripts", "deploy-class.ps1");
const CLOUDSPACE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cloudspace Devices</title>
  <style>
    :root {
      --bg: #f4efe7;
      --panel: rgba(255, 252, 247, 0.92);
      --ink: #1d2a33;
      --muted: #5d6c74;
      --line: #d9cfc2;
      --accent: #0e7c66;
      --accent-2: #d76c3d;
      --online: #0c8f5e;
      --offline: #8b95a1;
      --shadow: 0 18px 50px rgba(41, 56, 66, 0.12);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(215, 108, 61, 0.18), transparent 28%),
        radial-gradient(circle at top right, rgba(14, 124, 102, 0.16), transparent 24%),
        linear-gradient(180deg, #f8f4ed 0%, var(--bg) 100%);
    }

    main {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }

    .hero {
      margin-bottom: 24px;
      padding: 28px;
      border: 1px solid rgba(29, 42, 51, 0.08);
      border-radius: 24px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }

    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 5vw, 4rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }

    .subhead {
      margin: 0;
      max-width: 60ch;
      color: var(--muted);
      font-size: 1.05rem;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin: 22px 0 0;
    }

    .stat {
      padding: 16px 18px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid rgba(29, 42, 51, 0.08);
    }

    .stat strong {
      display: block;
      font-size: 1.8rem;
      line-height: 1;
      margin-bottom: 6px;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      margin: 18px 0 20px;
    }

    .search {
      flex: 1 1 280px;
      max-width: 420px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.92);
      color: var(--ink);
      font: inherit;
    }

    .toggle-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .notes-editor {
      min-width: 180px;
    }

    .notes-view {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }

    .notes-text {
      color: var(--muted);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .notes-edit-btn,
    .notes-save,
    .notes-cancel {
      padding: 7px 12px;
      border: 0;
      border-radius: 999px;
      font: inherit;
      cursor: pointer;
    }

    .notes-edit-btn {
      min-width: 36px;
      padding: 7px 10px;
      background: rgba(14, 124, 102, 0.12);
      color: var(--accent);
    }

    .notes-form[hidden],
    .notes-view[hidden] {
      display: none;
    }

    .notes-form {
      display: grid;
      gap: 8px;
    }

    .notes-input {
      width: 100%;
      min-height: 68px;
      resize: vertical;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.92);
      color: var(--ink);
      font: inherit;
    }

    .notes-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .notes-save {
      background: var(--accent);
      color: #fff;
    }

    .notes-cancel {
      background: rgba(29, 42, 51, 0.08);
      color: var(--ink);
    }

    .notes-save:disabled,
    .notes-cancel:disabled,
    .notes-edit-btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    .chip {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.82);
      color: var(--ink);
      border-radius: 999px;
      padding: 10px 14px;
      cursor: pointer;
      font: inherit;
    }

    .chip.active {
      background: var(--ink);
      color: #fff;
      border-color: var(--ink);
    }

    .panel {
      border: 1px solid rgba(29, 42, 51, 0.08);
      border-radius: 24px;
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(29, 42, 51, 0.08);
      text-align: left;
      vertical-align: top;
    }

    th {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      background: rgba(29, 42, 51, 0.03);
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--offline);
    }

    .dot.online {
      background: var(--online);
      box-shadow: 0 0 0 6px rgba(12, 143, 94, 0.12);
    }

    .id {
      font-family: Consolas, "Courier New", monospace;
      font-size: 0.88rem;
      color: var(--muted);
      word-break: break-all;
    }

    .empty, .error {
      padding: 28px;
      color: var(--muted);
    }

    .error {
      color: #8f2d2d;
    }

    @media (max-width: 700px) {
      th:nth-child(3), td:nth-child(3) {
        display: none;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>Cloudspace Devices</h1>
      <p class="subhead">A compact cleanup view for the shared Arduino Cloud space. Filter by name, switch between all devices and online only, and use the IDs when removing or auditing entries.</p>
      <div class="stats">
        <div class="stat"><strong id="totalCount">-</strong><span>Total visible devices</span></div>
        <div class="stat"><strong id="onlineCount">-</strong><span>Online right now</span></div>
        <div class="stat"><strong id="filteredCount">-</strong><span>Shown in table</span></div>
      </div>
    </section>

    <div class="toolbar">
      <input id="search" class="search" type="search" placeholder="Filter by name or ID">
      <div class="toggle-row">
        <button class="chip active" data-mode="all" type="button">All visible</button>
        <button class="chip" data-mode="online" type="button">Online only</button>
      </div>
    </div>

    <section class="panel">
      <div id="message" class="empty">Loading devices...</div>
      <table id="deviceTable" hidden>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Device ID</th>
          </tr>
        </thead>
        <tbody id="deviceRows"></tbody>
      </table>
    </section>
  </main>

  <script>
    const state = {
      devices: [],
      mode: "all",
      query: ""
    };

    const totalCount = document.getElementById("totalCount");
    const onlineCount = document.getElementById("onlineCount");
    const filteredCount = document.getElementById("filteredCount");
    const search = document.getElementById("search");
    const message = document.getElementById("message");
    const table = document.getElementById("deviceTable");
    const rows = document.getElementById("deviceRows");
    const chips = Array.from(document.querySelectorAll(".chip"));

    function render() {
      const query = state.query.trim().toLowerCase();
      const visible = state.devices.filter((device) => {
        if (state.mode === "online" && device.status !== "ONLINE") {
          return false;
        }
        if (!query) {
          return true;
        }
        return device.name.toLowerCase().includes(query) || device.id.toLowerCase().includes(query);
      });

      totalCount.textContent = String(state.devices.length);
      onlineCount.textContent = String(state.devices.filter((device) => device.status === "ONLINE").length);
      filteredCount.textContent = String(visible.length);

      rows.innerHTML = "";

      if (!state.devices.length) {
        table.hidden = true;
        message.hidden = false;
        message.className = "empty";
        message.textContent = "No devices returned for this key.";
        return;
      }

      if (!visible.length) {
        table.hidden = true;
        message.hidden = false;
        message.className = "empty";
        message.textContent = "No devices match the current filter.";
        return;
      }

      for (const device of visible) {
        const tr = document.createElement("tr");
        tr.innerHTML = \`
          <td>\${device.name}</td>
          <td>
            <span class="status">
              <span class="dot \${device.status === "ONLINE" ? "online" : ""}"></span>
              \${device.status}
            </span>
          </td>
          <td class="id">\${device.id}</td>
        \`;
        rows.appendChild(tr);
      }

      message.hidden = true;
      table.hidden = false;
    }

    async function load() {
      try {
        const response = await fetch("/cloudspace/names");
        if (!response.ok) {
          throw new Error("Failed to load devices");
        }
        const payload = await response.json();
        state.devices = payload.devices || [];
        render();
      } catch (error) {
        table.hidden = true;
        message.hidden = false;
        message.className = "error";
        message.textContent = error.message;
      }
    }

    search.addEventListener("input", (event) => {
      state.query = event.target.value;
      render();
    });

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        state.mode = chip.dataset.mode;
        chips.forEach((item) => item.classList.toggle("active", item === chip));
        render();
      });
    });

    load();
  </script>
</body>
</html>`;
const ADMIN_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bee Fleet Admin</title>
  <style>
    :root {
      --bg: #f6f1e8;
      --panel: rgba(255, 252, 246, 0.94);
      --ink: #1f2b33;
      --muted: #5e6b71;
      --line: #d9cebe;
      --accent: #b56a1f;
      --accent-2: #0f7a67;
      --warn: #9a3d2f;
      --good: #147f56;
      --shadow: 0 20px 50px rgba(32, 42, 48, 0.12);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: "Segoe UI", Tahoma, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(181, 106, 31, 0.16), transparent 28%),
        radial-gradient(circle at bottom right, rgba(15, 122, 103, 0.14), transparent 26%),
        linear-gradient(180deg, #fbf8f3 0%, var(--bg) 100%);
    }

    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 56px;
    }

    .hero, .panel, .class-card {
      background: var(--panel);
      border: 1px solid rgba(31, 43, 51, 0.08);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }

    .hero {
      padding: 28px;
      margin-bottom: 24px;
    }

    h1 {
      margin: 0 0 10px;
      font-size: clamp(2rem, 5vw, 3.8rem);
      line-height: 0.94;
      letter-spacing: -0.04em;
    }

    .subhead {
      margin: 0;
      max-width: 64ch;
      color: var(--muted);
      font-size: 1rem;
    }

    .stats, .class-grid {
      display: grid;
      gap: 14px;
    }

    .stats {
      margin-top: 22px;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    }

    .stat, .class-card {
      padding: 16px 18px;
    }

    .stat strong, .big {
      display: block;
      font-size: 1.9rem;
      line-height: 1;
      margin-bottom: 6px;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
    }

    .search {
      flex: 1 1 260px;
      max-width: 360px;
      padding: 12px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.92);
      color: var(--ink);
      font: inherit;
    }

    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .chip {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.84);
      color: var(--ink);
      border-radius: 999px;
      padding: 10px 14px;
      cursor: pointer;
      font: inherit;
    }

    .chip.active {
      background: var(--ink);
      color: white;
      border-color: var(--ink);
    }

    .action-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-bottom: 18px;
    }

    .action-btn {
      border: 0;
      border-radius: 999px;
      padding: 11px 16px;
      background: var(--accent);
      color: white;
      font: inherit;
      cursor: pointer;
    }

    .action-btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    .class-grid {
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      margin-bottom: 18px;
    }

    .kicker {
      display: inline-block;
      margin-bottom: 8px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.78rem;
    }

    .meta {
      color: var(--muted);
      font-size: 0.95rem;
    }

    .panel {
      overflow: hidden;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(31, 43, 51, 0.08);
      text-align: left;
      vertical-align: top;
    }

    th {
      background: rgba(31, 43, 51, 0.03);
      color: var(--muted);
      font-size: 0.79rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #98a2aa;
    }

    .dot.online {
      background: var(--good);
      box-shadow: 0 0 0 6px rgba(20, 127, 86, 0.12);
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 0.86rem;
      background: rgba(15, 122, 103, 0.09);
      color: var(--accent-2);
    }

    .pill.warn {
      background: rgba(154, 61, 47, 0.1);
      color: var(--warn);
    }

    .mono {
      font-family: Consolas, "Courier New", monospace;
      font-size: 0.88rem;
      color: var(--muted);
      word-break: break-all;
    }

    .empty, .error {
      padding: 28px;
      color: var(--muted);
    }

    .error {
      color: var(--warn);
    }

    @media (max-width: 860px) {
      th:nth-child(5), td:nth-child(5),
      th:nth-child(7), td:nth-child(7) {
        display: none;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>Bee Fleet Admin</h1>
      <p class="subhead">Track managed device classes, compare desired firmware targets with what devices report from Arduino Cloud, and use the local registry as the source of truth for deployment groups.</p>
      <div class="stats">
        <div class="stat"><strong id="managedCount">-</strong><span>Managed devices</span></div>
        <div class="stat"><strong id="onlineCount">-</strong><span>Online right now</span></div>
        <div class="stat"><strong id="classCount">-</strong><span>Classes configured</span></div>
        <div class="stat"><strong id="outdatedCount">-</strong><span>Need update</span></div>
      </div>
    </section>

    <div id="classGrid" class="class-grid"></div>

    <div class="action-row">
      <div id="deployButtons" class="toggle-row"></div>
      <div id="deployStatus" class="meta">No deployment running.</div>
    </div>

    <div class="toolbar">
      <input id="search" class="search" type="search" placeholder="Filter by name, class, thing or version">
      <div class="chip-row">
        <button type="button" class="chip active" data-mode="all">All</button>
        <button type="button" class="chip" data-mode="online">Online</button>
        <button type="button" class="chip" data-mode="outdated">Needs update</button>
      </div>
    </div>

    <section class="panel">
      <div id="message" class="empty">Loading managed fleet...</div>
      <table id="fleetTable" hidden>
        <thead>
          <tr>
            <th>Device</th>
            <th>Class</th>
            <th>Status</th>
            <th>Desired</th>
            <th>Reported</th>
            <th>Thing</th>
            <th>Sketch</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody id="fleetRows"></tbody>
      </table>
    </section>
  </main>

  <script>
    const state = {
      devices: [],
      classes: [],
      mode: "all",
      query: ""
    };

    const classGrid = document.getElementById("classGrid");
    const managedCount = document.getElementById("managedCount");
    const onlineCount = document.getElementById("onlineCount");
    const classCount = document.getElementById("classCount");
    const outdatedCount = document.getElementById("outdatedCount");
    const search = document.getElementById("search");
    const chips = Array.from(document.querySelectorAll(".chip"));
    const message = document.getElementById("message");
    const table = document.getElementById("fleetTable");
    const rows = document.getElementById("fleetRows");
    const deployButtons = document.getElementById("deployButtons");
    const deployStatus = document.getElementById("deployStatus");

    function formatClock(value) {
      return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(value);
    }

    function formatTimestamp(value) {
      if (!value) {
        return "";
      }

      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return "";
      }

      return formatClock(parsed);
    }

    function renderDeployStatus(lines) {
      deployStatus.innerHTML = lines.join("<br>");
    }

    async function saveNotes(deviceId, notes, statusNode, buttons) {
      buttons.forEach((button) => {
        button.disabled = true;
      });
      statusNode.textContent = "Saving...";

      try {
        const response = await fetch("/admin/device-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, notes })
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Failed to save notes");
        }

        statusNode.textContent = "Saved";
        await load();
      } catch (error) {
        statusNode.textContent = error.message;
      } finally {
        buttons.forEach((button) => {
          button.disabled = false;
        });
      }
    }

    function matchesMode(device) {
      if (state.mode === "online") {
        return device.cloudStatus === "ONLINE";
      }
      if (state.mode === "outdated") {
        return device.updateState === "outdated";
      }
      return true;
    }

    function matchesQuery(device, query) {
      if (!query) {
        return true;
      }

      return [
        device.name,
        device.cloudName,
        device.class,
        device.classLabel,
        device.thingName,
        device.desiredVersion,
        device.reportedVersion,
        device.sketch,
        device.notes
      ].some((value) => String(value || "").toLowerCase().includes(query));
    }

    function renderClasses() {
      classGrid.innerHTML = "";
      for (const item of state.classes) {
        const card = document.createElement("section");
        card.className = "class-card";
        card.innerHTML = \`
          <span class="kicker">\${item.label}</span>
          <strong class="big">\${item.deviceCount}</strong>
          <div class="meta">Sketch: \${item.sketch}</div>
          <div class="meta">Target: \${item.targetVersion}</div>
          <div class="meta">Online: \${item.onlineCount}</div>
          <div class="meta">\${item.notes || "No notes set."}</div>
        \`;
        classGrid.appendChild(card);
      }
    }

    function renderDeployButtons() {
      deployButtons.innerHTML = "";

      for (const item of state.classes.filter((entry) => entry.deviceCount > 0)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "action-btn";
        button.textContent = "Deploy " + item.label;
        button.addEventListener("click", () => {
          deployClass(item.class, item.label);
        });
        deployButtons.appendChild(button);
      }
    }

    function render() {
      const query = state.query.trim().toLowerCase();
      const visible = state.devices.filter((device) => matchesMode(device) && matchesQuery(device, query));

      managedCount.textContent = String(state.devices.length);
      onlineCount.textContent = String(state.devices.filter((device) => device.cloudStatus === "ONLINE").length);
      classCount.textContent = String(state.classes.length);
      outdatedCount.textContent = String(state.devices.filter((device) => device.updateState === "outdated").length);

      renderClasses();
      renderDeployButtons();
      rows.innerHTML = "";

      if (!state.devices.length) {
        table.hidden = true;
        message.hidden = false;
        message.className = "empty";
        message.textContent = "No managed devices are configured yet.";
        return;
      }

      if (!visible.length) {
        table.hidden = true;
        message.hidden = false;
        message.className = "empty";
        message.textContent = "No managed devices match the current filter.";
        return;
      }

      for (const device of visible) {
        const tr = document.createElement("tr");
        const versionClass = device.updateState === "outdated" ? "pill warn" : "pill";
        const alias = device.cloudName && device.cloudName !== device.name
          ? '<br><span class="mono">Cloud: ' + device.cloudName + '</span>'
          : "";
        const noteValue = String(device.notes || "");
        const noteDisplay = noteValue || "No notes";
        tr.innerHTML = \`
          <td>
            <strong>\${device.name}</strong>\${alias}<br>
            <span class="mono">\${device.deviceId}</span>
          </td>
          <td>\${device.classLabel}</td>
          <td>
            <span class="status">
              <span class="dot \${device.cloudStatus === "ONLINE" ? "online" : ""}"></span>
              \${device.cloudStatus}
            </span>
          </td>
          <td><span class="pill">\${device.desiredVersion}</span></td>
          <td><span class="\${versionClass}">\${device.reportedVersion || "Not reported"}</span></td>
          <td>
            <div>\${device.thingName || "Not linked"}</div>
            <div class="mono">\${device.thingId || "-"}</div>
          </td>
          <td>\${device.sketch}</td>
          <td>
            <div class="notes-editor">
              <div class="notes-view">
                <span class="notes-text">\${noteDisplay}</span>
                <button type="button" class="notes-edit-btn" aria-label="Edit note" title="Edit note">✎</button>
              </div>
              <div class="notes-form" hidden>
                <textarea class="notes-input" maxlength="100" placeholder="Add a short note">\${noteValue}</textarea>
                <div class="notes-actions">
                  <button type="button" class="notes-save">Save</button>
                  <button type="button" class="notes-cancel">Cancel</button>
                  <span class="meta notes-status"></span>
                </div>
              </div>
            </div>
          </td>
        \`;

        const view = tr.querySelector(".notes-view");
        const textNode = tr.querySelector(".notes-text");
        const editButton = tr.querySelector(".notes-edit-btn");
        const form = tr.querySelector(".notes-form");
        const input = tr.querySelector(".notes-input");
        const saveButton = tr.querySelector(".notes-save");
        const cancelButton = tr.querySelector(".notes-cancel");
        const statusNode = tr.querySelector(".notes-status");
        let lastSavedValue = noteValue;
        let saving = false;

        function openEditor() {
          view.hidden = true;
          form.hidden = false;
          statusNode.textContent = "";
          input.value = lastSavedValue;
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }

        function closeEditor() {
          if (saving) {
            return;
          }

          form.hidden = true;
          view.hidden = false;
          input.value = lastSavedValue;
          statusNode.textContent = "";
        }

        input.addEventListener("input", () => {
          statusNode.textContent = input.value === lastSavedValue ? "" : "Unsaved";
        });

        editButton.addEventListener("click", () => {
          openEditor();
        });

        cancelButton.addEventListener("click", () => {
          closeEditor();
        });

        saveButton.addEventListener("click", async () => {
          saving = true;
          await saveNotes(device.deviceId, input.value.slice(0, 100), statusNode, [saveButton, cancelButton]);
          lastSavedValue = input.value.slice(0, 100).trim();
          textNode.textContent = lastSavedValue || "No notes";
          saving = false;
          closeEditor();
        });

        rows.appendChild(tr);
      }

      message.hidden = true;
      table.hidden = false;
    }

    async function load(options = {}) {
      try {
        const response = await fetch("/admin/fleet");
        if (!response.ok) {
          throw new Error("Failed to load managed fleet");
        }
        const payload = await response.json();
        state.devices = payload.devices || [];
        state.classes = payload.classes || [];
        render();
      } catch (error) {
        table.hidden = true;
        message.hidden = false;
        message.className = "error";
        message.textContent = error.message;
        if (options.throwOnError) {
          throw error;
        }
      }
    }

    async function deployClass(className, classLabel) {
      const startedAt = new Date();
      const buttons = Array.from(deployButtons.querySelectorAll("button"));
      buttons.forEach((button) => {
        button.disabled = true;
      });
      renderDeployStatus([
        "Deployment running for " + classLabel + "...",
        "Started: " + formatClock(startedAt),
        "Waiting for Arduino Cloud OTA completion."
      ]);

      try {
        const response = await fetch("/admin/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ class: className })
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Deployment failed");
        }

        const finishedAt = new Date();
        const results = payload.result || [];
        const summary = results.length
          ? results.map((item) => {
              const started = formatTimestamp(item.startedAt);
              const finished = formatTimestamp(item.finishedAt);
              const duration = Number.isFinite(item.durationSeconds) ? \`\${item.durationSeconds}s\` : "";
              const timing = [started && "start " + started, finished && "end " + finished, duration].filter(Boolean).join(", ");
              return timing
                ? \`\${item.name}: \${item.status} (\${timing})\`
                : \`\${item.name}: \${item.status}\`;
            }).join("<br>")
          : "Deployment finished.";
        const successLines = [
          "Deployment finished for " + classLabel + ".",
          "Started: " + formatClock(startedAt),
          "Completed: " + formatClock(finishedAt),
          "Devices: " + results.length,
          summary
        ];
        renderDeployStatus(successLines);

        try {
          await load({ throwOnError: true });
        } catch (refreshError) {
          renderDeployStatus([
            ...successLines,
            "Refresh warning: " + refreshError.message
          ]);
        }
      } catch (error) {
        renderDeployStatus([
          "Deployment failed for " + classLabel + ".",
          "Started: " + formatClock(startedAt),
          error.message
        ]);
      } finally {
        buttons.forEach((button) => {
          button.disabled = false;
        });
      }
    }

    search.addEventListener("input", (event) => {
      state.query = event.target.value;
      render();
    });

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        state.mode = chip.dataset.mode;
        chips.forEach((item) => item.classList.toggle("active", item === chip));
        render();
      });
    });

    load();
  </script>
</body>
</html>`;

function loadLocalConfig() {
  const candidates = [
    path.join(__dirname, "secure", "local.env"),
    path.join(__dirname, "secure", ".env"),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function loadFleetConfig() {
  if (!fs.existsSync(FLEET_CONFIG_PATH)) {
    return { classes: {}, devices: [], versionPropertyNames: [] };
  }

  return JSON.parse(fs.readFileSync(FLEET_CONFIG_PATH, "utf8"));
}

function saveFleetConfig(fleet) {
  fs.writeFileSync(FLEET_CONFIG_PATH, `${JSON.stringify(fleet, null, 2)}\n`, "utf8");
}

function updateDeviceNotes(deviceId, notes) {
  const fleet = loadFleetConfig();
  const device = (fleet.devices || []).find((entry) => entry.deviceId === deviceId);

  if (!device) {
    return false;
  }

  device.notes = String(notes || "").trim().slice(0, 100);
  saveFleetConfig(fleet);
  return true;
}

function readSketchTargetVersion(sketchName) {
  if (!sketchName) {
    return null;
  }

  const sketchPath = path.join(__dirname, "sketches", sketchName, `${sketchName}.ino`);
  if (!fs.existsSync(sketchPath)) {
    return null;
  }

  const source = fs.readFileSync(sketchPath, "utf8");
  const patterns = [
    /const\s+char\s+FIRMWARE_VERSION\[\]\s*=\s*"([^"]+)"/,
    /#define\s+FIRMWARE_VERSION\s+"([^"]+)"/,
    /constexpr\s+char\s+FIRMWARE_VERSION\[\]\s*=\s*"([^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function findVersionProperty(properties, propertyNames) {
  for (const propertyName of propertyNames) {
    const wanted = normalizeText(propertyName);
    const match = properties.find((property) => {
      return normalizeText(property.variable_name) === wanted || normalizeText(property.name) === wanted;
    });

    if (match) {
      return match;
    }
  }

  return null;
}

function getConfig(kind) {
  if (kind === "personal") {
    return {
      kind,
      label: "personal",
      clientId: process.env.ARDUINO_CLIENT_ID,
      clientSecret: process.env.ARDUINO_CLIENT_SECRET,
      organizationId: null,
      query: "",
    };
  }

  if (kind === "cloudspace" || kind === "university") {
    return {
      kind,
      label: "cloudspace",
      clientId: process.env.ARDUINO_UNI_CLIENT_ID,
      clientSecret: process.env.ARDUINO_UNI_CLIENT_SECRET,
      organizationId: process.env.ARDUINO_UNI_ORG_ID,
      query: "",
    };
  }

  throw new Error(`Unknown config kind: ${kind}`);
}

async function getAccessToken(clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    throw new Error("Missing client credentials.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    audience: AUDIENCE,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Token request failed: ${response.status} ${response.statusText} ${details}`);
  }

  const data = await response.json();
  return data.access_token;
}

function summarizeDevice(device) {
  return {
    id: device.id,
    name: device.name,
    status: device.device_status,
    lastActivityAt: device.last_activity_at ?? null,
    organizationId: device.organization_id ?? null,
    fqbn: device.fqbn ?? null,
    serial: device.serial ?? null,
    thingName: device.thing?.name ?? null,
  };
}

async function fetchDevicesFor(kind) {
  const config = getConfig(kind);
  const token = await getAccessToken(config.clientId, config.clientSecret);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  if (config.organizationId) {
    headers["X-Organization"] = config.organizationId;
  }

  const response = await fetch(`${DEVICES_URL}${config.query}`, { headers });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Device request failed: ${response.status} ${response.statusText} ${details}`);
  }

  const data = await response.json();
  const allDevices = data.map(summarizeDevice);
  const onlineDevices = allDevices.filter((device) => device.status === "ONLINE");

  return {
    scope: config.label,
    fetchedAt: new Date().toISOString(),
    totalDevices: allDevices.length,
    onlineCount: onlineDevices.length,
    allDevices,
    onlineDevices,
  };
}

async function fetchThingsFor(kind) {
  const config = getConfig(kind);
  const token = await getAccessToken(config.clientId, config.clientSecret);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  if (config.organizationId) {
    headers["X-Organization"] = config.organizationId;
  }

  const response = await fetch(`${THINGS_URL}?show_properties=true`, { headers });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Thing request failed: ${response.status} ${response.statusText} ${details}`);
  }

  return response.json();
}

async function fetchOnlineFor(kind) {
  const payload = await fetchDevicesFor(kind);
  return {
    scope: payload.scope,
    fetchedAt: payload.fetchedAt,
    onlineCount: payload.onlineCount,
    onlineDevices: payload.onlineDevices,
  };
}

async function fetchNamesFor(kind) {
  const payload = await fetchDevicesFor(kind);
  return {
    scope: payload.scope,
    fetchedAt: payload.fetchedAt,
    totalDevices: payload.totalDevices,
    devices: payload.allDevices.map((device) => ({
      id: device.id,
      name: device.name,
      status: device.status,
    })),
  };
}

async function fetchManagedFleet() {
  const fleet = loadFleetConfig();
  const resolvedClassVersions = Object.fromEntries(
    Object.entries(fleet.classes || {}).map(([className, classConfig]) => [
      className,
      readSketchTargetVersion(classConfig.sketch) || classConfig.targetVersion || null,
    ])
  );
  const [personalDevices, cloudspaceDevices, personalThings, cloudspaceThings] = await Promise.all([
    fetchDevicesFor("personal").catch(() => ({ allDevices: [] })),
    fetchDevicesFor("cloudspace").catch(() => ({ allDevices: [] })),
    fetchThingsFor("personal").catch(() => []),
    fetchThingsFor("cloudspace").catch(() => []),
  ]);

  const devicesById = new Map();
  const thingsById = new Map();

  for (const device of [...personalDevices.allDevices, ...cloudspaceDevices.allDevices]) {
    devicesById.set(device.id, device);
  }

  for (const thing of [...personalThings, ...cloudspaceThings]) {
    thingsById.set(thing.id, thing);
  }

  const managedDevices = fleet.devices.map((entry) => {
    const classConfig = fleet.classes[entry.class] || {};
    const cloudDevice = devicesById.get(entry.deviceId) || null;
    const cloudThing = thingsById.get(entry.thingId) || null;
    const versionProperty = findVersionProperty(cloudThing?.properties || [], fleet.versionPropertyNames || []);
    const reportedVersion = versionProperty ? String(versionProperty.last_value ?? "").trim() || null : null;
    const desiredVersion = entry.targetVersion || resolvedClassVersions[entry.class] || null;
    const updateState = !reportedVersion ? "unknown" : reportedVersion === desiredVersion ? "current" : "outdated";

    return {
      name: entry.name,
      cloudName: cloudDevice?.name || cloudThing?.device_name || null,
      class: entry.class,
      classLabel: classConfig.label || entry.class,
      enabled: entry.enabled !== false,
      scope: entry.scope || "cloudspace",
      sketch: classConfig.sketch || "",
      desiredVersion,
      reportedVersion,
      updateState,
      versionPropertyName: versionProperty?.variable_name || versionProperty?.name || null,
      cloudStatus: cloudDevice?.status || "UNKNOWN",
      deviceId: entry.deviceId,
      thingId: entry.thingId || cloudThing?.id || null,
      thingName: cloudThing?.name || cloudDevice?.thingName || null,
      notes: entry.notes || classConfig.notes || "",
      sourceTemplate: cloudThing?.source_template || null,
      propertyCount: cloudThing?.properties_count ?? (cloudThing?.properties || []).length ?? 0,
    };
  });

  const classSummaries = Object.entries(fleet.classes).map(([className, classConfig]) => {
    const classDevices = managedDevices.filter((device) => device.class === className && device.enabled);
    return {
      class: className,
      label: classConfig.label || className,
      sketch: classConfig.sketch || "",
      targetVersion: resolvedClassVersions[className] || "",
      notes: classConfig.notes || "",
      deviceCount: classDevices.length,
      onlineCount: classDevices.filter((device) => device.cloudStatus === "ONLINE").length,
    };
  });

  return {
    fetchedAt: new Date().toISOString(),
    devices: managedDevices,
    classes: classSummaries,
  };
}

function runDeployment(className, deviceNames = []) {
  return new Promise((resolve, reject) => {
    const args = [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      DEPLOY_SCRIPT_PATH,
      "-Class",
      className,
    ];

    if (Array.isArray(deviceNames) && deviceNames.length > 0) {
      args.push("-DeviceNames", deviceNames.join(","));
    }

    execFile("powershell", args, { cwd: __dirname, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message).trim() || "Deployment failed."));
        return;
      }

      try {
        resolve({
          result: stdout ? JSON.parse(stdout) : [],
          stderr: stderr.trim(),
        });
      } catch (parseError) {
        reject(new Error(`Deployment returned invalid JSON. ${stdout}`.trim()));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/admin/device-notes") {
      const body = await readJsonBody(req);
      if (!body.deviceId) {
        sendJson(res, 400, { error: "Missing deviceId." });
        return;
      }

      const updated = updateDeviceNotes(body.deviceId, body.notes || "");
      if (!updated) {
        sendJson(res, 404, { error: "Managed device not found." });
        return;
      }

      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/admin/deploy") {
      const body = await readJsonBody(req);
      if (!body.class) {
        sendJson(res, 400, { error: "Missing class." });
        return;
      }

      const deployment = await runDeployment(body.class, body.deviceNames || []);
      sendJson(res, 200, deployment);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed. Use GET." });
      return;
    }

    if (req.url === "/") {
      redirect(res, "/cloudspace");
      return;
    }

    if (req.url === "/devices" || req.url === "/personal/devices") {
      sendJson(res, 200, await fetchDevicesFor("personal"));
      return;
    }

    if (req.url === "/personal/online") {
      sendJson(res, 200, await fetchOnlineFor("personal"));
      return;
    }

    if (req.url === "/personal/names") {
      sendJson(res, 200, await fetchNamesFor("personal"));
      return;
    }

    if (req.url === "/cloudspace/devices" || req.url === "/university/devices") {
      sendJson(res, 200, await fetchDevicesFor("cloudspace"));
      return;
    }

    if (req.url === "/cloudspace/online" || req.url === "/university/online") {
      sendJson(res, 200, await fetchOnlineFor("cloudspace"));
      return;
    }

    if (req.url === "/cloudspace/names" || req.url === "/university/names") {
      sendJson(res, 200, await fetchNamesFor("cloudspace"));
      return;
    }

    if (req.url === "/university") {
      redirect(res, "/cloudspace");
      return;
    }

    if (req.url === "/cloudspace") {
      sendHtml(res, CLOUDSPACE_PAGE_HTML);
      return;
    }

    if (req.url === "/admin") {
      sendHtml(res, ADMIN_PAGE_HTML);
      return;
    }

    if (req.url === "/admin/fleet") {
      sendJson(res, 200, await fetchManagedFleet());
      return;
    }

    if (req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(res, 500, {
      error: "Failed to fetch Arduino Cloud devices.",
      details: error.message,
    });
  }
});

module.exports = { server, fetchDevicesFor, fetchOnlineFor, fetchNamesFor, fetchThingsFor, fetchManagedFleet };

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Arduino device server listening on http://localhost:${PORT}`);
  });
}

