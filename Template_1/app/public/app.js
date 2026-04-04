const runForm = document.getElementById("run-form");
const runOutput = document.getElementById("run-output");
const refreshBtn = document.getElementById("refresh-btn");
const jobsBody = document.getElementById("jobs-body");
const detailsOutput = document.getElementById("details-output");
const runButton = runForm.querySelector('button[type="submit"]');

const profileSelect = document.getElementById("profile");
const profileHelp = document.getElementById("profile-help");

const sourceUrlLabel = document.getElementById("sourceUrlLabel");
const sourceUrlInput = document.getElementById("sourceUrl");
const referenceUrlLabel = document.getElementById("referenceUrlLabel");
const referenceUrlInput = document.getElementById("referenceUrl");
const runModeLabel = document.getElementById("runModeLabel");
const runModeSelect = document.getElementById("runMode");

const dynamicFieldsContainer = document.getElementById("dynamic-fields");

const profileState = {
  profilesById: new Map(),
  defaultProfileId: null,
  activeProfile: null,
};

const dynamicFieldDomByKey = new Map();

const fmtDate = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
};

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(JSON.stringify(data, null, 2));
  }
  return data;
};

const setRunModes = (runModeField = {}) => {
  runModeSelect.innerHTML = "";
  const options = Array.isArray(runModeField.options) && runModeField.options.length > 0
    ? runModeField.options
    : ["on_demand", "scheduled"];

  for (const mode of options) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode;
    runModeSelect.appendChild(option);
  }
  runModeSelect.value = runModeField.default ?? options[0];
};

const createDynamicInput = (field) => {
  const wrapper = document.createElement("div");
  wrapper.className = "row";

  const label = document.createElement("label");
  label.setAttribute("for", `dynamic-${field.key}`);
  label.textContent = field.label ?? field.key;
  wrapper.appendChild(label);

  let input;
  if (field.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 3;
  } else if (field.type === "select") {
    input = document.createElement("select");
    const options = Array.isArray(field.options) ? field.options : [];
    for (const opt of options) {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label ?? opt.value;
      input.appendChild(option);
    }
  } else {
    input = document.createElement("input");
    if (field.type === "number") {
      input.type = "number";
      if (field.min != null) input.min = String(field.min);
      if (field.max != null) input.max = String(field.max);
      if (field.step != null) input.step = String(field.step);
    } else if (field.type === "checkbox") {
      input.type = "checkbox";
    } else {
      input.type = "text";
    }
  }

  input.id = `dynamic-${field.key}`;
  input.name = field.key;
  if (field.placeholder != null && "placeholder" in input) {
    input.placeholder = field.placeholder;
  }
  if (field.required) {
    input.required = true;
  }

  if (field.type === "checkbox") {
    input.checked = Boolean(field.default);
  } else if (field.default != null) {
    input.value = field.default;
  }

  wrapper.appendChild(input);
  if (field.helpText) {
    const help = document.createElement("p");
    help.className = "muted inline-help";
    help.textContent = field.helpText;
    wrapper.appendChild(help);
  }

  return { wrapper, input };
};

const renderDynamicFields = (fields = []) => {
  dynamicFieldDomByKey.clear();
  dynamicFieldsContainer.innerHTML = "";

  for (const field of fields) {
    const { wrapper, input } = createDynamicInput(field);
    dynamicFieldDomByKey.set(field.key, { field, input });
    dynamicFieldsContainer.appendChild(wrapper);
  }
};

const applyProfile = (profile) => {
  profileState.activeProfile = profile;

  const base = profile.baseFields ?? {};

  sourceUrlLabel.textContent = base.sourceUrl?.label ?? "Source URL";
  sourceUrlInput.placeholder = base.sourceUrl?.placeholder ?? "";
  sourceUrlInput.value = base.sourceUrl?.default ?? "";
  sourceUrlInput.required = Boolean(base.sourceUrl?.required);

  referenceUrlLabel.textContent = base.referenceUrl?.label ?? "Reference URL";
  referenceUrlInput.placeholder = base.referenceUrl?.placeholder ?? "";
  referenceUrlInput.value = base.referenceUrl?.default ?? "";
  referenceUrlInput.required = Boolean(base.referenceUrl?.required);

  runModeLabel.textContent = base.runMode?.label ?? "Run Mode";
  setRunModes(base.runMode ?? {});

  renderDynamicFields(Array.isArray(profile.fields) ? profile.fields : []);

  const status = String(profile.status ?? "planned").toLowerCase();
  const active = status === "active";
  runButton.disabled = !active;

  const sourceText = profile.isExample
    ? "Example Profile"
    : "Template Profile";
  if (active) {
    profileHelp.textContent = `${sourceText}: ${profile.description ?? ""}`;
  } else {
    profileHelp.textContent = `${sourceText}: ${profile.description ?? ""} (Status: ${status})`;
  }
};

const loadProfiles = async () => {
  const data = await fetchJson("/api/profiles");
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) {
    throw new Error("No profile definitions found.");
  }

  profileState.defaultProfileId = data.defaultProfile ?? items[0].id;
  profileState.profilesById = new Map(items.map((item) => [item.id, item]));

  profileSelect.innerHTML = "";
  for (const profile of items) {
    const option = document.createElement("option");
    option.value = profile.id;
    const tag = profile.isExample ? "example" : "template";
    option.textContent = `${profile.name} [${tag}:${profile.status}]`;
    profileSelect.appendChild(option);
  }

  const initialId = profileState.defaultProfileId ?? items[0].id;
  profileSelect.value = initialId;
  applyProfile(profileState.profilesById.get(initialId));
};

const readDynamicInputs = () => {
  const inputs = {};
  for (const [key, dom] of dynamicFieldDomByKey.entries()) {
    const { field, input } = dom;

    let value;
    if (field.type === "checkbox") {
      value = Boolean(input.checked);
    } else if (field.type === "number") {
      value = Number(input.value);
      if (!Number.isFinite(value)) {
        value = undefined;
      }
    } else {
      value = String(input.value ?? "").trim();
    }

    if (value !== undefined && value !== "") {
      inputs[key] = value;
    }
  }
  return inputs;
};

const loadDetails = async (jobId) => {
  detailsOutput.textContent = "Loading details...";
  try {
    const data = await fetchJson(`/api/classifications/${encodeURIComponent(jobId)}`);
    detailsOutput.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    detailsOutput.textContent = `Error: ${error.message}`;
  }
};

const renderJobs = (items) => {
  jobsBody.innerHTML = "";
  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><button class="link-btn" data-id="${item.id}">${item.id.slice(0, 8)}...</button></td>
      <td>${item.profile_id ?? "-"}</td>
      <td>${item.status ?? "-"}</td>
      <td>${item.latest_category ?? "-"}</td>
      <td>${item.latest_provider ?? "-"} / ${item.latest_model ?? "-"}</td>
      <td>${item.classified_count ?? "-"} (${item.positive_count ?? "-"} / ${item.negative_count ?? "-"})</td>
      <td>${fmtDate(item.created_at)}</td>
    `;
    jobsBody.appendChild(tr);
  }

  for (const btn of jobsBody.querySelectorAll(".link-btn")) {
    btn.addEventListener("click", () => loadDetails(btn.dataset.id));
  }
};

const loadJobs = async () => {
  try {
    const data = await fetchJson("/api/classifications?limit=20&offset=0");
    renderJobs(data.items ?? []);
  } catch (error) {
    jobsBody.innerHTML = `<tr><td colspan="7">Error loading jobs: ${error.message}</td></tr>`;
  }
};

profileSelect.addEventListener("change", () => {
  const selected = profileState.profilesById.get(profileSelect.value);
  if (selected) {
    applyProfile(selected);
    runOutput.textContent = "";
  }
});

runForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  runOutput.textContent = "Submitting...";

  const activeProfile = profileState.activeProfile;
  if (!activeProfile) {
    runOutput.textContent = "No profile selected.";
    return;
  }

  if (String(activeProfile.status ?? "").toLowerCase() !== "active") {
    runOutput.textContent = `Profile '${activeProfile.id}' is not active yet.`;
    return;
  }

  const payload = {
    profileId: profileSelect.value,
    sourceUrl: String(sourceUrlInput.value ?? "").trim(),
    referenceUrl: String(referenceUrlInput.value ?? "").trim(),
    runMode: String(runModeSelect.value ?? "on_demand").trim(),
    inputs: readDynamicInputs(),
  };

  try {
    const result = await fetchJson("/api/classifications/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    runOutput.textContent = JSON.stringify(result, null, 2);
    await loadJobs();
    if (result.jobId) {
      await loadDetails(result.jobId);
    }
  } catch (error) {
    runOutput.textContent = `Error: ${error.message}`;
  }
});

refreshBtn.addEventListener("click", loadJobs);

const bootstrap = async () => {
  try {
    await loadProfiles();
    await loadJobs();
  } catch (error) {
    runOutput.textContent = `Error: ${error.message}`;
  }
};

bootstrap();
