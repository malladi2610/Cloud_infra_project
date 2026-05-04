const authCard = document.getElementById("auth-card");
const appShell = document.getElementById("app-shell");

const authOutput = document.getElementById("auth-output");
const uploadOutput = document.getElementById("upload-output");
const runOutput = document.getElementById("run-output");
const jobDetail = document.getElementById("job-detail");
const benchmarkOutput = document.getElementById("benchmark-output");

const registerForm = document.getElementById("register-form");
const loginForm = document.getElementById("login-form");
const logoutBtn = document.getElementById("logout-btn");
const sessionInfo = document.getElementById("session-info");

const uploadForm = document.getElementById("upload-form");
const runForm = document.getElementById("run-form");

const profileSelect = document.getElementById("profile");
const documentSelect = document.getElementById("document-id");
const executionModeSelect = document.getElementById("execution-mode");
const batchStrategySelect = document.getElementById("batch-strategy");

const refreshDocumentsBtn = document.getElementById("refresh-documents");
const refreshJobsBtn = document.getElementById("refresh-jobs");
const refreshAdminBtn = document.getElementById("refresh-admin");

const documentsBody = document.getElementById("documents-body");
const jobsBody = document.getElementById("jobs-body");

const adminCard = document.getElementById("admin-card");
const adminMetrics = document.getElementById("admin-metrics");
const adminJobsBody = document.getElementById("admin-jobs-body");
const adminBatchesBody = document.getElementById("admin-batches-body");
const benchmarkForm = document.getElementById("benchmark-form");
const benchmarkTier = document.getElementById("benchmark-tier");

const state = {
  user: null,
  profiles: [],
  documents: [],
  jobs: [],
  adminPollTimer: null,
};

const resetClientState = () => {
  state.profiles = [];
  state.documents = [];
  state.jobs = [];

  profileSelect.innerHTML = "";
  documentSelect.innerHTML = "";
  documentsBody.innerHTML = `<tr><td colspan="6">No documents yet.</td></tr>`;
  jobsBody.innerHTML = `<tr><td colspan="9">No jobs yet.</td></tr>`;
  adminJobsBody.innerHTML = `<tr><td colspan="7">No jobs found.</td></tr>`;
  adminBatchesBody.innerHTML = `<tr><td colspan="7">No batches yet.</td></tr>`;
  adminMetrics.textContent = "";
  jobDetail.textContent = "";
  uploadOutput.textContent = "";
  runOutput.textContent = "";
  benchmarkOutput.textContent = "";
};

const fmtDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const short = (text, max = 24) => {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
};

const formatCurrency = (value) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(6);
};

const setOutput = (node, payload) => {
  node.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data?.error || JSON.stringify(data, null, 2));
  }

  return data;
};

const loadProfiles = async () => {
  const data = await fetchJson("/api/profiles");
  state.profiles = Array.isArray(data.items) ? data.items : [];

  profileSelect.innerHTML = "";
  for (const profile of state.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} [${profile.status}]`;
    profileSelect.appendChild(option);
  }

  if (data.defaultProfile) {
    profileSelect.value = data.defaultProfile;
  }
};

const loadDocuments = async () => {
  const data = await fetchJson("/api/documents?limit=100&offset=0");
  state.documents = Array.isArray(data.items) ? data.items : [];

  documentSelect.innerHTML = "";
  documentsBody.innerHTML = "";

  for (const doc of state.documents) {
    const option = document.createElement("option");
    option.value = doc.id;
    option.textContent = `${short(doc.filename, 40)} (${doc.id.slice(0, 8)}...)`;
    documentSelect.appendChild(option);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${short(doc.id, 12)}</td>
      <td>${doc.filename}</td>
      <td>${doc.size_bytes}</td>
      <td>${doc.page_count ?? "-"}</td>
      <td>${fmtDate(doc.created_at)}</td>
      <td>${fmtDate(doc.expires_at)}</td>
    `;
    documentsBody.appendChild(tr);
  }

  if (state.documents.length === 0) {
    documentsBody.innerHTML = `<tr><td colspan="6">No documents yet.</td></tr>`;
  }
};

const loadJobs = async () => {
  const data = await fetchJson("/api/summaries/jobs?limit=100&offset=0");
  state.jobs = Array.isArray(data.items) ? data.items : [];

  jobsBody.innerHTML = "";
  for (const job of state.jobs) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><button class="link-btn" data-id="${job.id}">${short(job.id, 10)}</button></td>
      <td>${short(job.filename ?? job.document_id, 22)}</td>
      <td>${job.execution_mode}</td>
      <td>${job.batch_strategy}</td>
      <td>${job.status}</td>
      <td>${job.provider ?? "-"} / ${job.model ?? "-"}</td>
      <td>${job.total_tokens ?? "-"}</td>
      <td>${job.cost_est_usd != null ? formatCurrency(job.cost_est_usd) : "-"}</td>
      <td>${fmtDate(job.created_at)}</td>
    `;
    jobsBody.appendChild(tr);
  }

  if (state.jobs.length === 0) {
    jobsBody.innerHTML = `<tr><td colspan="9">No jobs yet.</td></tr>`;
  }

  for (const btn of jobsBody.querySelectorAll(".link-btn")) {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      await loadJobDetail(id);
    });
  }
};

const loadJobDetail = async (jobId) => {
  setOutput(jobDetail, "Loading...");
  try {
    const detail = await fetchJson(`/api/summaries/jobs/${encodeURIComponent(jobId)}`);
    const result = await fetch(`/api/summaries/jobs/${encodeURIComponent(jobId)}/result`, {
      credentials: "same-origin",
    });
    const resultBody = await result.text();
    let parsedResult;
    try {
      parsedResult = JSON.parse(resultBody);
    } catch {
      parsedResult = { raw: resultBody };
    }

    if (!result.ok) {
      detail.result = parsedResult;
    } else {
      detail.result = parsedResult.result;
    }

    setOutput(jobDetail, detail);
  } catch (error) {
    setOutput(jobDetail, `Error: ${error.message}`);
  }
};

const loadAdminState = async () => {
  if (!state.user || state.user.role !== "admin") return;

  try {
    const [metrics, jobs, batches] = await Promise.all([
      fetchJson("/api/admin/metrics"),
      fetchJson("/api/admin/jobs?limit=50&offset=0"),
      fetchJson("/api/admin/batches?limit=50&offset=0"),
    ]);

    setOutput(adminMetrics, metrics);

    adminJobsBody.innerHTML = "";
    for (const job of jobs.items || []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${short(job.id, 10)}</td>
        <td>${job.user_email}</td>
        <td>${job.status}</td>
        <td>${job.execution_mode}</td>
        <td>${job.batch_strategy}</td>
        <td>${job.cost_est_usd != null ? formatCurrency(job.cost_est_usd) : "-"}</td>
        <td>${fmtDate(job.created_at)}</td>
      `;
      adminJobsBody.appendChild(tr);
    }
    if (!jobs.items || jobs.items.length === 0) {
      adminJobsBody.innerHTML = `<tr><td colspan="7">No jobs found.</td></tr>`;
    }

    adminBatchesBody.innerHTML = "";
    for (const batch of batches.items || []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${short(batch.id, 10)}</td>
        <td>${batch.strategy}</td>
        <td>${batch.status}</td>
        <td>${batch.jobs_count}</td>
        <td>${batch.completed_count}</td>
        <td>${batch.failed_count}</td>
        <td>${fmtDate(batch.opened_at)}</td>
      `;
      adminBatchesBody.appendChild(tr);
    }
    if (!batches.items || batches.items.length === 0) {
      adminBatchesBody.innerHTML = `<tr><td colspan="7">No batches yet.</td></tr>`;
    }
  } catch (error) {
    setOutput(adminMetrics, `Failed to load admin state: ${error.message}`);
  }
};

const setAuthenticatedUI = async (isAuthenticated) => {
  authCard.classList.toggle("hidden", isAuthenticated);
  appShell.classList.toggle("hidden", !isAuthenticated);

  if (!isAuthenticated) {
    if (state.adminPollTimer) {
      clearInterval(state.adminPollTimer);
      state.adminPollTimer = null;
    }
    adminCard.classList.add("hidden");
    sessionInfo.textContent = "";
    resetClientState();
    return;
  }

  sessionInfo.textContent = `Logged in as ${state.user.email} (${state.user.role})`;

  await Promise.all([loadProfiles(), loadDocuments(), loadJobs()]);

  if (state.user.role === "admin") {
    adminCard.classList.remove("hidden");
    await loadAdminState();

    if (!state.adminPollTimer) {
      state.adminPollTimer = setInterval(loadAdminState, 5000);
    }
  } else {
    adminCard.classList.add("hidden");
    if (state.adminPollTimer) {
      clearInterval(state.adminPollTimer);
      state.adminPollTimer = null;
    }
  }
};

const loadSession = async () => {
  try {
    const me = await fetchJson("/api/auth/me");
    state.user = me.user;
    await setAuthenticatedUI(true);
  } catch {
    state.user = null;
    await setAuthenticatedUI(false);
  }
};

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;

  try {
    const data = await fetchJson("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    setOutput(authOutput, data);
    state.user = data.user;
    await setAuthenticatedUI(true);
  } catch (error) {
    setOutput(authOutput, `Register failed: ${error.message}`);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  try {
    const data = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    setOutput(authOutput, data);
    state.user = data.user;
    await setAuthenticatedUI(true);
  } catch (error) {
    setOutput(authOutput, `Login failed: ${error.message}`);
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await fetchJson("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {
    // ignore
  }
  state.user = null;
  await setAuthenticatedUI(false);
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fileInput = document.getElementById("pdf-file");
  const file = fileInput.files?.[0];
  if (!file) {
    setOutput(uploadOutput, "Select a PDF file first.");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/api/documents/upload", {
      credentials: "same-origin",
      method: "POST",
      body: formData,
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      throw new Error(payload.error || JSON.stringify(payload, null, 2));
    }

    setOutput(uploadOutput, payload);
    fileInput.value = "";
    await loadDocuments();
  } catch (error) {
    setOutput(uploadOutput, `Upload failed: ${error.message}`);
  }
});

runForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    profileId: profileSelect.value,
    documentId: documentSelect.value,
    executionMode: executionModeSelect.value,
    batchStrategy: batchStrategySelect.value,
  };

  try {
    const data = await fetchJson("/api/summaries/run", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    setOutput(runOutput, data);
    await loadJobs();

    if (data?.job?.id) {
      await loadJobDetail(data.job.id);
    }
  } catch (error) {
    setOutput(runOutput, `Run submission failed: ${error.message}`);
  }
});

refreshDocumentsBtn.addEventListener("click", loadDocuments);
refreshJobsBtn.addEventListener("click", loadJobs);

refreshAdminBtn.addEventListener("click", async () => {
  await loadAdminState();
});

benchmarkForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const run = await fetchJson("/api/admin/benchmarks/run", {
      method: "POST",
      body: JSON.stringify({ datasetTier: benchmarkTier.value }),
    });

    setOutput(benchmarkOutput, {
      submitted: run,
      note: "Benchmark started. Polling for completion...",
    });

    const benchmarkId = run?.benchmarkRun?.id;
    if (!benchmarkId) return;

    let attempts = 0;
    while (attempts < 30) {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const detail = await fetchJson(`/api/admin/benchmarks/${benchmarkId}`);
      if (detail?.benchmarkRun?.status === "completed" || detail?.benchmarkRun?.status === "failed") {
        const report = await fetchJson(`/api/admin/benchmarks/${benchmarkId}/report`);
        setOutput(benchmarkOutput, { detail, report });
        break;
      }
    }
  } catch (error) {
    setOutput(benchmarkOutput, `Benchmark failed: ${error.message}`);
  }
});

loadSession();
