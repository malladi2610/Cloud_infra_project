import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import fs from "fs";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const TEMPLATE_PROFILE_DIR = path.join(ROOT_DIR, "template", "profiles");
const EXAMPLES_DIR = path.join(ROOT_DIR, "examples");
const EDGE_AI_TAXONOMY_PATH = path.join(
  EXAMPLES_DIR,
  "arxiv_edge_ai",
  "reference-site",
  "edge-ai-taxonomy.json",
);

const PORT = Number(process.env.APP_PORT ?? 8080);
const N8N_WEBHOOK_BASE =
  process.env.N8N_WEBHOOK_BASE ?? "http://n8n:5678/webhook";
const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL ??
  "http://n8n:5678/webhook/classifications/run-e2e-cp5-cp6";
const N8N_REQUEST_TIMEOUT_MS = Number(process.env.N8N_REQUEST_TIMEOUT_MS ?? 30000);

const DB_HOST = process.env.DB_HOST ?? "postgres";
const isAzurePostgres = /\.postgres\.database\.azure\.com$/i.test(DB_HOST);
const DB_SSL =
  String(process.env.DB_SSL ?? (isAzurePostgres ? "true" : "false")).toLowerCase() === "true";
const DB_SSL_REJECT_UNAUTHORIZED =
  String(process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "false").toLowerCase() === "true";
const DEFAULT_PROFILE_ID = process.env.DEFAULT_PROFILE_ID ?? "custom_profile_starter";

const pool = new Pool({
  host: DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "classifier",
  user: process.env.DB_USER ?? "classifier",
  password: process.env.DB_PASSWORD ?? "classifier",
  ssl: DB_SSL ? { rejectUnauthorized: DB_SSL_REJECT_UNAUTHORIZED } : undefined,
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

const parsePositiveInt = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
};

const parseNonNegativeInt = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
};

const toStringOrEmpty = (value) =>
  value == null ? "" : String(value).trim();

const isHttpUrl = (value) => /^https?:\/\/\S+$/i.test(value);

const listJsonFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));
};

const normalizeBaseFields = (baseFields = {}) => {
  const sourceUrl = {
    label: "Source URL",
    required: true,
    default: "",
    placeholder: "https://source.example.com/data",
    ...(baseFields.sourceUrl ?? {}),
  };

  const referenceUrl = {
    label: "Reference URL",
    required: false,
    default: "",
    placeholder: "https://reference.example.com/taxonomy",
    ...(baseFields.referenceUrl ?? {}),
  };

  const runMode = {
    label: "Run Mode",
    required: true,
    default: "on_demand",
    options: ["on_demand", "scheduled"],
    ...(baseFields.runMode ?? {}),
  };

  if (!Array.isArray(runMode.options) || runMode.options.length === 0) {
    runMode.options = ["on_demand", "scheduled"];
  }

  return { sourceUrl, referenceUrl, runMode };
};

const normalizeFieldDef = (field) => {
  const type = ["text", "number", "select", "textarea", "checkbox"].includes(
    field?.type,
  )
    ? field.type
    : "text";

  const normalized = {
    key: toStringOrEmpty(field?.key),
    label: toStringOrEmpty(field?.label) || toStringOrEmpty(field?.key),
    type,
    required: Boolean(field?.required),
  };

  if (field?.default !== undefined) normalized.default = field.default;
  if (field?.placeholder !== undefined) normalized.placeholder = field.placeholder;
  if (field?.helpText !== undefined) normalized.helpText = field.helpText;
  if (field?.min !== undefined) normalized.min = Number(field.min);
  if (field?.max !== undefined) normalized.max = Number(field.max);
  if (field?.step !== undefined) normalized.step = Number(field.step);

  if (type === "select") {
    const opts = Array.isArray(field?.options) ? field.options : [];
    normalized.options = opts
      .map((opt) => {
        if (typeof opt === "string") {
          return { label: opt, value: opt };
        }
        return {
          label: toStringOrEmpty(opt?.label ?? opt?.value),
          value: toStringOrEmpty(opt?.value ?? opt?.label),
        };
      })
      .filter((opt) => opt.value);
  }

  return normalized;
};

const normalizeProfile = (rawProfile, sourceMeta) => {
  const id = toStringOrEmpty(rawProfile?.id) || sourceMeta.fallbackId;
  const fields = Array.isArray(rawProfile?.fields)
    ? rawProfile.fields.map(normalizeFieldDef).filter((field) => field.key)
    : [];

  const execution = {
    webhookPath: toStringOrEmpty(rawProfile?.execution?.webhookPath),
    webhookUrl: toStringOrEmpty(rawProfile?.execution?.webhookUrl),
    payloadMap:
      rawProfile?.execution?.payloadMap &&
      typeof rawProfile.execution.payloadMap === "object"
        ? rawProfile.execution.payloadMap
        : {},
  };

  return {
    id,
    name: toStringOrEmpty(rawProfile?.name) || id,
    description: toStringOrEmpty(rawProfile?.description),
    status: toStringOrEmpty(rawProfile?.status || "planned").toLowerCase(),
    isExample: Boolean(rawProfile?.isExample),
    baseFields: normalizeBaseFields(rawProfile?.baseFields),
    fields,
    execution,
    source: sourceMeta,
  };
};

const loadProfiles = () => {
  const files = [];

  for (const filePath of listJsonFiles(TEMPLATE_PROFILE_DIR)) {
    files.push({ filePath, sourceType: "template", packageName: "core" });
  }

  if (fs.existsSync(EXAMPLES_DIR)) {
    const exampleDirs = fs.readdirSync(EXAMPLES_DIR, { withFileTypes: true });
    for (const entry of exampleDirs) {
      if (!entry.isDirectory()) continue;
      const packageName = entry.name;
      const profileDir = path.join(EXAMPLES_DIR, packageName, "profiles");
      for (const filePath of listJsonFiles(profileDir)) {
        files.push({ filePath, sourceType: "example", packageName });
      }
    }
  }

  const parsed = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file.filePath, "utf8"));
      const fallbackId = path.basename(file.filePath, ".json");
      parsed.push(
        normalizeProfile(raw, {
          type: file.sourceType,
          package: file.packageName,
          file: file.filePath,
          fallbackId,
        }),
      );
    } catch (error) {
      console.warn(`Skipping profile ${file.filePath}: ${error.message}`);
    }
  }

  // Deduplicate by id (first file wins).
  const unique = [];
  const seen = new Set();
  for (const profile of parsed) {
    if (seen.has(profile.id)) continue;
    seen.add(profile.id);
    unique.push(profile);
  }

  return unique;
};

const profiles = loadProfiles();
const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

const buildPublicBaseUrl = (req) => {
  const configured = toStringOrEmpty(process.env.PUBLIC_BASE_URL);
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const forwardedProtoRaw = req.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoRaw)
    ? String(forwardedProtoRaw[0] ?? "").split(",")[0].trim()
    : String(forwardedProtoRaw ?? "").split(",")[0].trim();

  const protocol = forwardedProto || req.protocol || "http";
  const host = req.get("host");
  return host ? `${protocol}://${host}` : "";
};

const withCloudSafeReferenceDefault = (profile, req) => {
  if (profile.id !== "arxiv_edge_ai") return profile;
  const currentDefault = toStringOrEmpty(profile.baseFields?.referenceUrl?.default);
  if (!/https?:\/\/reference_site\//i.test(currentDefault)) return profile;

  const publicBaseUrl = buildPublicBaseUrl(req);
  if (!publicBaseUrl) return profile;

  return {
    ...profile,
    baseFields: {
      ...profile.baseFields,
      referenceUrl: {
        ...profile.baseFields.referenceUrl,
        default: `${publicBaseUrl}/api/reference/edge-ai-taxonomy.json`,
      },
    },
  };
};

const resolveDefaultProfileId = () => {
  if (profileById.has(DEFAULT_PROFILE_ID)) return DEFAULT_PROFILE_ID;
  const firstNonExample = profiles.find((profile) => !profile.isExample);
  if (firstNonExample) return firstNonExample.id;
  return profiles[0]?.id ?? null;
};

const getByPath = (obj, dotPath) => {
  if (!dotPath || typeof dotPath !== "string") return undefined;
  return dotPath.split(".").reduce((acc, part) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return acc[part];
  }, obj);
};

const parseFieldValue = (field, rawValue) => {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    if (field.default !== undefined) rawValue = field.default;
  }

  const missing = rawValue === undefined || rawValue === null || rawValue === "";

  if (missing) {
    if (field.required) {
      throw new InputError(`'${field.label}' is required.`);
    }
    return undefined;
  }

  if (field.type === "number") {
    const n = Number(rawValue);
    if (!Number.isFinite(n)) {
      throw new InputError(`'${field.label}' must be a number.`);
    }
    if (Number.isFinite(field.min) && n < field.min) {
      throw new InputError(`'${field.label}' must be >= ${field.min}.`);
    }
    if (Number.isFinite(field.max) && n > field.max) {
      throw new InputError(`'${field.label}' must be <= ${field.max}.`);
    }
    return n;
  }

  if (field.type === "checkbox") {
    if (typeof rawValue === "boolean") return rawValue;
    const text = toStringOrEmpty(rawValue).toLowerCase();
    return ["1", "true", "yes", "on"].includes(text);
  }

  const text = toStringOrEmpty(rawValue);

  if (field.type === "select") {
    const options = Array.isArray(field.options) ? field.options : [];
    const allowedValues = new Set(options.map((opt) => opt.value));
    if (allowedValues.size > 0 && !allowedValues.has(text)) {
      throw new InputError(`'${field.label}' has an unsupported value.`);
    }
  }

  return text;
};

const validateAndBuildRunInput = (profile, requestBody) => {
  const body = requestBody ?? {};

  const baseFields = profile.baseFields;

  const sourceUrl =
    toStringOrEmpty(body.sourceUrl) || toStringOrEmpty(baseFields.sourceUrl.default);
  const referenceUrl =
    toStringOrEmpty(body.referenceUrl) ||
    toStringOrEmpty(baseFields.referenceUrl.default);

  const runModeOptions = Array.isArray(baseFields.runMode.options)
    ? baseFields.runMode.options
    : ["on_demand", "scheduled"];
  const requestedRunMode =
    toStringOrEmpty(body.runMode) || toStringOrEmpty(baseFields.runMode.default);
  const runMode = runModeOptions.includes(requestedRunMode)
    ? requestedRunMode
    : runModeOptions[0];

  if (baseFields.sourceUrl.required && !sourceUrl) {
    throw new InputError("Source URL is required.");
  }
  if (sourceUrl && !isHttpUrl(sourceUrl)) {
    throw new InputError("Source URL must be a valid http/https URL.");
  }

  if (baseFields.referenceUrl.required && !referenceUrl) {
    throw new InputError("Reference URL is required.");
  }
  if (referenceUrl && !isHttpUrl(referenceUrl)) {
    throw new InputError("Reference URL must be a valid http/https URL.");
  }

  const providedInputs =
    body.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)
      ? body.inputs
      : {};

  const inputs = {};
  for (const field of profile.fields) {
    const candidate =
      providedInputs[field.key] !== undefined
        ? providedInputs[field.key]
        : body[field.key];

    const parsed = parseFieldValue(field, candidate);
    if (parsed !== undefined) {
      inputs[field.key] = parsed;
    }
  }

  return {
    profileId: profile.id,
    sourceUrl,
    referenceUrl,
    runMode,
    inputs,
  };
};

const buildWebhookPayload = (profile, canonicalInput) => {
  const payloadMap = profile.execution.payloadMap ?? {};
  const mapKeys = Object.keys(payloadMap);

  if (mapKeys.length === 0) {
    return canonicalInput;
  }

  const payload = {};
  for (const key of mapKeys) {
    const sourcePath = payloadMap[key];
    const value = getByPath(canonicalInput, String(sourcePath));
    if (value !== undefined) {
      payload[key] = value;
    }
  }

  return payload;
};

const resolveWebhookUrl = (profile) => {
  const webhookUrl = toStringOrEmpty(profile.execution.webhookUrl);
  if (webhookUrl) return webhookUrl;

  const webhookPath = toStringOrEmpty(profile.execution.webhookPath).replace(/^\/+/, "");
  if (webhookPath) {
    return `${N8N_WEBHOOK_BASE.replace(/\/+$/, "")}/${webhookPath}`;
  }

  return N8N_WEBHOOK_URL;
};

let jobsProfileColumns = null;
const detectJobsProfileColumns = async () => {
  if (jobsProfileColumns) return jobsProfileColumns;

  const q = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'classification_jobs'
      AND column_name IN ('profile_id', 'input_payload_json')
  `;
  const result = await pool.query(q);
  const names = new Set(result.rows.map((row) => row.column_name));

  jobsProfileColumns = {
    profileId: names.has("profile_id"),
    inputPayload: names.has("input_payload_json"),
  };

  return jobsProfileColumns;
};

app.get("/api/profiles", (req, res) => {
  const items = profiles.map((profile) => {
    const cloudSafe = withCloudSafeReferenceDefault(profile, req);
    return {
    id: profile.id,
      name: cloudSafe.name,
      description: cloudSafe.description,
      status: cloudSafe.status,
      isExample: cloudSafe.isExample,
      source: cloudSafe.source,
      baseFields: cloudSafe.baseFields,
      fields: cloudSafe.fields,
    };
  });

  return res.json({
    defaultProfile: resolveDefaultProfileId(),
    items,
  });
});

app.get("/api/reference/edge-ai-taxonomy.json", (_req, res) => {
  if (!fs.existsSync(EDGE_AI_TAXONOMY_PATH)) {
    return res.status(404).json({ error: "Taxonomy file not found" });
  }
  return res.sendFile(EDGE_AI_TAXONOMY_PATH);
});

app.post("/api/classifications/run", async (req, res) => {
  try {
    const requestedId =
      toStringOrEmpty(req.body?.profileId) ||
      toStringOrEmpty(req.body?.profile) ||
      resolveDefaultProfileId();

    const profile = profileById.get(requestedId);
    if (!profile) {
      throw new InputError(`Unknown profile '${requestedId}'.`);
    }

    if (profile.status !== "active") {
      return res.status(400).json({
        error: `Profile '${profile.id}' is not active yet.`,
        profileId: profile.id,
        status: profile.status,
      });
    }

    const canonicalInput = validateAndBuildRunInput(profile, req.body);
    const payload = buildWebhookPayload(profile, canonicalInput);
    const webhookUrl = resolveWebhookUrl(profile);

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), N8N_REQUEST_TIMEOUT_MS);

    let upstream;
    try {
      upstream = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    const bodyText = await upstream.text();
    let bodyJson;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = { raw: bodyText };
    }

    if (bodyJson && typeof bodyJson === "object" && !Array.isArray(bodyJson)) {
      bodyJson.profileId = profile.id;
      bodyJson.request = canonicalInput;
    }

    return res.status(upstream.status).json(bodyJson);
  } catch (error) {
    if (error instanceof InputError) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({
      error: "Failed to trigger n8n workflow",
      details: error.message,
    });
  }
});

app.get("/api/classifications", async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status).trim() : null;
    const from = req.query.from ? String(req.query.from).trim() : null;
    const to = req.query.to ? String(req.query.to).trim() : null;
    const limit = Math.min(100, parsePositiveInt(req.query.limit, 20));
    const offset = parseNonNegativeInt(req.query.offset, 0);

    const where = [];
    const params = [];

    if (status) {
      params.push(status);
      where.push(`j.status = $${params.length}`);
    }
    if (from) {
      params.push(from);
      where.push(`j.created_at >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(to);
      where.push(`j.created_at <= $${params.length}::timestamptz`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM classification_jobs j
      ${whereSql};
    `;
    const countResult = await pool.query(countQuery, params);
    const total = countResult.rows[0]?.total ?? 0;

    const jobCols = await detectJobsProfileColumns();
    const profileIdSelect = jobCols.profileId
      ? "j.profile_id,"
      : "NULL::text AS profile_id,";

    params.push(limit);
    params.push(offset);

    const listQuery = `
      SELECT
        j.id,
        ${profileIdSelect}
        j.status,
        j.run_mode,
        j.source_url,
        j.reference_url,
        j.error_message,
        j.created_at,
        j.updated_at,
        r.category AS latest_category,
        r.provider AS latest_provider,
        r.model AS latest_model,
        r.created_at AS latest_result_at,
        CASE WHEN r.raw_response_json ? 'classified_count'
          THEN (r.raw_response_json->>'classified_count')::int ELSE NULL END AS classified_count,
        CASE
          WHEN r.raw_response_json ? 'positive_count'
            THEN (r.raw_response_json->>'positive_count')::int
          WHEN r.raw_response_json ? 'edge_ai_count'
            THEN (r.raw_response_json->>'edge_ai_count')::int
          ELSE NULL
        END AS positive_count,
        CASE
          WHEN r.raw_response_json ? 'negative_count'
            THEN (r.raw_response_json->>'negative_count')::int
          WHEN r.raw_response_json ? 'not_edge_ai_count'
            THEN (r.raw_response_json->>'not_edge_ai_count')::int
          ELSE NULL
        END AS negative_count
      FROM classification_jobs j
      LEFT JOIN LATERAL (
        SELECT *
        FROM classification_results r2
        WHERE r2.job_id = j.id
        ORDER BY r2.created_at DESC
        LIMIT 1
      ) r ON true
      ${whereSql}
      ORDER BY j.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length};
    `;

    const rows = await pool.query(listQuery, params);

    return res.json({
      total,
      limit,
      offset,
      items: rows.rows,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to list classifications",
      details: error.message,
    });
  }
});

app.get("/api/classifications/:id", async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();
    const jobCols = await detectJobsProfileColumns();
    const profileJobCols = jobCols.profileId
      ? "profile_id,"
      : "NULL::text AS profile_id,";
    const inputPayloadCols = jobCols.inputPayload
      ? "input_payload_json,"
      : "NULL::jsonb AS input_payload_json,";

    const jobQuery = `
      SELECT
        id,
        ${profileJobCols}
        source_url,
        reference_url,
        run_mode,
        status,
        error_message,
        ${inputPayloadCols}
        created_at,
        updated_at
      FROM classification_jobs
      WHERE id = $1
      LIMIT 1;
    `;

    const jobResult = await pool.query(jobQuery, [id]);
    const job = jobResult.rows[0];
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const resultsQuery = `
      SELECT
        id, category, confidence, evidence, provider, model, raw_response_json, created_at
      FROM classification_results
      WHERE job_id = $1
      ORDER BY created_at ASC;
    `;
    const results = await pool.query(resultsQuery, [id]);

    return res.json({
      job,
      results: results.rows,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch classification details",
      details: error.message,
    });
  }
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1;");
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, details: error.message });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Classification Template app listening on http://localhost:${PORT}`);
});
