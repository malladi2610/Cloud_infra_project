import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import fs from "fs";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import session from "express-session";
import multer from "multer";
import { BlobServiceClient } from "@azure/storage-blob";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const TEMPLATE_PROFILE_DIR = path.join(ROOT_DIR, "template", "profiles");
const EXAMPLES_DIR = path.join(ROOT_DIR, "examples");

const PORT = Number(process.env.APP_PORT ?? 8080);
const NODE_ENV = process.env.NODE_ENV ?? "development";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "change_me_session_secret";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN ?? "change_me_internal_token";

const N8N_WEBHOOK_BASE = process.env.N8N_WEBHOOK_BASE ?? "http://n8n:5678/webhook";
const N8N_RUN_WEBHOOK_URL =
  process.env.N8N_RUN_WEBHOOK_URL ?? `${N8N_WEBHOOK_BASE}/summaries/run`;
const N8N_BENCHMARK_WEBHOOK_URL =
  process.env.N8N_BENCHMARK_WEBHOOK_URL ?? `${N8N_WEBHOOK_BASE}/benchmarks/run`;
const N8N_REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.N8N_REQUEST_TIMEOUT_MS ?? 10000));

const DEFAULT_PROFILE_ID = process.env.DEFAULT_PROFILE_ID ?? "pdf_batch_summary";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const OPENAI_INPUT_TOKEN_PRICE_PER_MILLION_USD = Number(
  process.env.OPENAI_INPUT_TOKEN_PRICE_PER_MILLION_USD ?? "0.15",
);
const OPENAI_OUTPUT_TOKEN_PRICE_PER_MILLION_USD = Number(
  process.env.OPENAI_OUTPUT_TOKEN_PRICE_PER_MILLION_USD ?? "0.60",
);
const OPENAI_BATCH_INPUT_TOKEN_PRICE_PER_MILLION_USD = Number(
  process.env.OPENAI_BATCH_INPUT_TOKEN_PRICE_PER_MILLION_USD ??
    String(OPENAI_INPUT_TOKEN_PRICE_PER_MILLION_USD),
);
const OPENAI_BATCH_OUTPUT_TOKEN_PRICE_PER_MILLION_USD = Number(
  process.env.OPENAI_BATCH_OUTPUT_TOKEN_PRICE_PER_MILLION_USD ??
    String(OPENAI_OUTPUT_TOKEN_PRICE_PER_MILLION_USD),
);
const OPENAI_FILE_UPLOAD_MAX_RETRIES = Math.max(
  0,
  Number(process.env.OPENAI_FILE_UPLOAD_MAX_RETRIES ?? 3),
);
const OPENAI_FILE_UPLOAD_RETRY_BASE_MS = Math.max(
  100,
  Number(process.env.OPENAI_FILE_UPLOAD_RETRY_BASE_MS ?? 750),
);
const BENCHMARK_REPETITIONS = Math.max(1, Number(process.env.BENCHMARK_REPETITIONS ?? 3));
const BENCHMARK_JOBS_PER_RUN = Math.max(1, Number(process.env.BENCHMARK_JOBS_PER_RUN ?? 20));
const MAX_BATCH_SIZE = Math.max(1, Number(process.env.MAX_BATCH_SIZE ?? 20));
const MAX_WAIT_SECONDS = Math.max(1, Number(process.env.MAX_WAIT_SECONDS ?? 60));

const PDF_RETENTION_DAYS = Math.max(1, Number(process.env.PDF_RETENTION_DAYS ?? 30));
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 25));

const BLOB_PROVIDER = (process.env.BLOB_PROVIDER ?? "local").toLowerCase();
const LOCAL_BLOB_DIR = process.env.LOCAL_BLOB_DIR ?? path.join(ROOT_DIR, "storage", "documents");
const AZURE_BLOB_CONNECTION_STRING = process.env.AZURE_BLOB_CONNECTION_STRING ?? "";
const AZURE_BLOB_CONTAINER = process.env.AZURE_BLOB_CONTAINER ?? "template2-documents";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const DB_HOST = process.env.DB_HOST ?? "postgres";
const isAzurePostgres = /\.postgres\.database\.azure\.com$/i.test(DB_HOST);
const DB_SSL =
  String(process.env.DB_SSL ?? (isAzurePostgres ? "true" : "false")).toLowerCase() === "true";
const DB_SSL_REJECT_UNAUTHORIZED =
  String(process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "false").toLowerCase() === "true";

const pool = new Pool({
  host: DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "template2",
  user: process.env.DB_USER ?? "template2",
  password: process.env.DB_PASSWORD ?? "template2",
  ssl: DB_SSL ? { rejectUnauthorized: DB_SSL_REJECT_UNAUTHORIZED } : undefined,
});

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    name: "template2.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  }),
);
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

class InputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "InputError";
    this.statusCode = statusCode;
  }
}

const JOB_STATUSES = new Set(["queued", "batched", "processing", "completed", "failed", "expired"]);
const BATCH_STATUSES = new Set(["open", "submitted", "processing", "completed", "failed", "expired"]);
const BATCH_ITEM_STATUSES = new Set(["queued", "processing", "completed", "failed"]);

const toStringOrEmpty = (value) => (value == null ? "" : String(value).trim());
const safeLowerEmail = (value) => toStringOrEmpty(value).toLowerCase();
const now = () => new Date();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    toStringOrEmpty(value),
  );

const parsePositiveInt = (value, fallback, min = 1, max = 1000) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.floor(n);
  if (rounded < min) return fallback;
  return Math.min(max, rounded);
};

const parseNonNegativeInt = (value, fallback, max = 100000) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.floor(n);
  if (rounded < 0) return fallback;
  return Math.min(max, rounded);
};

const asNumberOr = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
};

const sanitizeFilename = (name) => {
  const clean = toStringOrEmpty(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!clean) return "document.pdf";
  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean}.pdf`;
};

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const estimatePdfPages = (buffer) => {
  const latin = buffer.toString("latin1");
  const matches = latin.match(/\/Type\s*\/Page\b/g);
  if (!matches) return null;
  return matches.length > 0 ? matches.length : null;
};

const estimateTokenCount = (text) => {
  const chars = toStringOrEmpty(text).length;
  return Math.max(1, Math.ceil(chars / 4));
};

const estimateCostUsd = (inputTokens = 0, outputTokens = 0) => {
  const inputCost = (Number(inputTokens) / 1_000_000) * OPENAI_INPUT_TOKEN_PRICE_PER_MILLION_USD;
  const outputCost = (Number(outputTokens) / 1_000_000) * OPENAI_OUTPUT_TOKEN_PRICE_PER_MILLION_USD;
  return Number((inputCost + outputCost).toFixed(6));
};

const estimateBatchCostUsd = (inputTokens = 0, outputTokens = 0) => {
  const inputCost = (Number(inputTokens) / 1_000_000) * OPENAI_BATCH_INPUT_TOKEN_PRICE_PER_MILLION_USD;
  const outputCost = (Number(outputTokens) / 1_000_000) * OPENAI_BATCH_OUTPUT_TOKEN_PRICE_PER_MILLION_USD;
  return Number((inputCost + outputCost).toFixed(6));
};

const roundUsd = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(6));
};

const enrichBenchmarkReportWithCostAnalysis = (report) => {
  if (!report || typeof report !== "object") return report;

  const matrix = Array.isArray(report.matrix) ? report.matrix : [];
  const byTierMap = new Map();
  let syncRawUsd = 0;
  let batchRawUsd = 0;

  for (const sample of matrix) {
    const mode = toStringOrEmpty(sample?.mode).toLowerCase();
    if (!["sync", "batch"].includes(mode)) continue;

    const tier = toStringOrEmpty(sample?.datasetTier).toUpperCase() || "UNKNOWN";
    const sampleCost = roundUsd(asNumberOr(sample?.totalCostEstUsd, 0));

    if (!byTierMap.has(tier)) {
      byTierMap.set(tier, {
        datasetTier: tier,
        syncUsd: 0,
        batchUsd: 0,
      });
    }
    const tierRow = byTierMap.get(tier);
    if (mode === "sync") {
      tierRow.syncUsd = roundUsd(tierRow.syncUsd + sampleCost);
      syncRawUsd = roundUsd(syncRawUsd + sampleCost);
    } else {
      tierRow.batchUsd = roundUsd(tierRow.batchUsd + sampleCost);
      batchRawUsd = roundUsd(batchRawUsd + sampleCost);
    }
  }

  const byTier = Array.from(byTierMap.values())
    .map((row) => {
      return {
        ...row,
        totalUsd: roundUsd(row.syncUsd + row.batchUsd),
      };
    })
    .sort((a, b) => a.datasetTier.localeCompare(b.datasetTier));

  const totalsUsd = {
    syncUsd: syncRawUsd,
    batchUsd: batchRawUsd,
    totalUsd: roundUsd(syncRawUsd + batchRawUsd),
  };

  return {
    ...report,
    costAnalysis: {
      totalsUsd,
      byTier,
    },
  };
};

const readStreamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const parseLocalBlobKey = (blobKey) => {
  const key = toStringOrEmpty(blobKey);
  if (!key.startsWith("local://")) {
    throw new Error(`Unsupported local blob key: ${key}`);
  }
  const relativePath = key.replace("local://", "");
  const [ownerUserId, ...rest] = relativePath.split("/");
  if (!ownerUserId || rest.length === 0) {
    throw new Error(`Malformed local blob key: ${key}`);
  }
  return {
    ownerUserId,
    relativePath,
    fileName: rest.join("/"),
  };
};

const parseAzureBlobKey = (blobKey) => {
  const key = toStringOrEmpty(blobKey);
  if (!key.startsWith("azure://")) {
    throw new Error(`Unsupported azure blob key: ${key}`);
  }
  const parts = key.replace("azure://", "").split("/");
  const containerName = parts[0] || "";
  const ownerUserId = parts[1] || "";
  const blobPath = parts.slice(1).join("/");

  if (!containerName || !ownerUserId || parts.length < 3) {
    throw new Error(`Malformed azure blob key: ${key}`);
  }

  return {
    containerName,
    ownerUserId,
    blobPath,
    fileName: parts.slice(2).join("/"),
  };
};

const assertBlobOwnership = (blobKey, expectedUserId) => {
  const expected = toStringOrEmpty(expectedUserId);
  if (!expected) {
    throw new Error("Missing expected user id for blob ownership check");
  }

  if (blobKey.startsWith("local://")) {
    const parsed = parseLocalBlobKey(blobKey);
    if (parsed.ownerUserId !== expected) {
      throw new Error("Blob ownership mismatch for local document");
    }
    return;
  }

  if (blobKey.startsWith("azure://")) {
    const parsed = parseAzureBlobKey(blobKey);
    if (parsed.ownerUserId !== expected) {
      throw new Error("Blob ownership mismatch for azure document");
    }
    return;
  }

  throw new Error(`Unsupported blob key prefix: ${blobKey}`);
};

const uploadDocumentBuffer = async ({ userId, filename, buffer, mimeType }) => {
  const cleanedFilename = sanitizeFilename(filename);
  const uniqueName = `${crypto.randomUUID()}-${cleanedFilename}`;

  if (BLOB_PROVIDER === "azure") {
    if (!AZURE_BLOB_CONNECTION_STRING) {
      throw new InputError("AZURE_BLOB_CONNECTION_STRING is required when BLOB_PROVIDER=azure", 500);
    }

    const service = BlobServiceClient.fromConnectionString(AZURE_BLOB_CONNECTION_STRING);
    const container = service.getContainerClient(AZURE_BLOB_CONTAINER);
    await container.createIfNotExists();

    const blobPath = `${userId}/${uniqueName}`;
    const client = container.getBlockBlobClient(blobPath);
    await client.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: mimeType || "application/pdf",
      },
    });

    return {
      blobKey: `azure://${AZURE_BLOB_CONTAINER}/${blobPath}`,
      sizeBytes: buffer.length,
    };
  }

  const userDir = path.join(LOCAL_BLOB_DIR, userId);
  await ensureDir(userDir);
  const fullPath = path.join(userDir, uniqueName);
  await fs.promises.writeFile(fullPath, buffer);

  return {
    blobKey: `local://${userId}/${uniqueName}`,
    sizeBytes: buffer.length,
  };
};

const readDocumentBuffer = async ({ blobKey, expectedUserId }) => {
  assertBlobOwnership(blobKey, expectedUserId);

  if (blobKey.startsWith("azure://")) {
    if (!AZURE_BLOB_CONNECTION_STRING) {
      throw new Error("Missing AZURE_BLOB_CONNECTION_STRING for azure document read");
    }

    const parsed = parseAzureBlobKey(blobKey);
    const service = BlobServiceClient.fromConnectionString(AZURE_BLOB_CONNECTION_STRING);
    const container = service.getContainerClient(parsed.containerName);
    const client = container.getBlobClient(parsed.blobPath);
    const download = await client.download();
    if (!download.readableStreamBody) {
      throw new Error("Blob download stream is empty");
    }
    return readStreamToBuffer(download.readableStreamBody);
  }

  const parsed = parseLocalBlobKey(blobKey);
  const fullPath = path.join(LOCAL_BLOB_DIR, parsed.relativePath);
  return fs.promises.readFile(fullPath);
};

const uploadOpenAIFileBuffer = async ({
  buffer,
  filename,
  contentType = "application/octet-stream",
  purpose = "user_data",
}) => {
  const normalizedPurpose = toStringOrEmpty(purpose) || "user_data";
  const allowedPurposes = new Set(["user_data", "batch", "assistants", "fine-tune", "vision"]);
  if (!allowedPurposes.has(normalizedPurpose)) {
    throw new InputError(`Unsupported OpenAI file purpose '${normalizedPurpose}'.`);
  }

  if (!toStringOrEmpty(OPENAI_API_KEY)) {
    throw new InputError("OPENAI_API_KEY is required for internal OpenAI file upload.", 500);
  }

  const rawName = toStringOrEmpty(filename || `upload-${crypto.randomUUID()}.bin`);
  const safeName =
    rawName
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^_+/, "")
      .slice(0, 180) || `upload-${crypto.randomUUID()}.bin`;
  const form = new FormData();
  form.append("purpose", normalizedPurpose);
  form.append("file", new Blob([buffer], { type: contentType }), safeName);

  const retryableStatusCodes = new Set([408, 409, 429, 500, 502, 503, 504]);
  const retryableNetworkCodes = new Set([
    "EAI_AGAIN",
    "ENOTFOUND",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);

  const isRetryableNetworkError = (error) => {
    const code = String(error?.cause?.code ?? error?.code ?? "").trim().toUpperCase();
    const message = String(error?.message ?? "").toLowerCase();
    if (retryableNetworkCodes.has(code)) return true;
    return message.includes("fetch failed") || message.includes("network");
  };

  for (let attempt = 0; attempt <= OPENAI_FILE_UPLOAD_MAX_RETRIES; attempt += 1) {
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: form,
      });
    } catch (error) {
      const retryable = isRetryableNetworkError(error);
      if (!retryable || attempt >= OPENAI_FILE_UPLOAD_MAX_RETRIES) {
        throw error;
      }

      const delayMs = OPENAI_FILE_UPLOAD_RETRY_BASE_MS * 2 ** attempt;
      const code = String(error?.cause?.code ?? error?.code ?? "unknown").toUpperCase();
      console.warn(
        `OpenAI file upload network error (${code}); retrying in ${delayMs}ms ` +
          `[attempt ${attempt + 1}/${OPENAI_FILE_UPLOAD_MAX_RETRIES + 1}]`,
      );
      await sleep(delayMs);
      continue;
    }

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (response.ok) {
      return payload;
    }

    const retryableStatus = retryableStatusCodes.has(response.status);
    if (retryableStatus && attempt < OPENAI_FILE_UPLOAD_MAX_RETRIES) {
      const delayMs = OPENAI_FILE_UPLOAD_RETRY_BASE_MS * 2 ** attempt;
      console.warn(
        `OpenAI file upload returned ${response.status}; retrying in ${delayMs}ms ` +
          `[attempt ${attempt + 1}/${OPENAI_FILE_UPLOAD_MAX_RETRIES + 1}]`,
      );
      await sleep(delayMs);
      continue;
    }

    throw new InputError(
      `OpenAI file upload failed (${response.status}): ${JSON.stringify(payload).slice(0, 800)}`,
      502,
    );
  }

  throw new InputError("OpenAI file upload failed after retries.", 502);
};

const listJsonFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));
};

const normalizeFieldDef = (field) => {
  const type = ["text", "number", "select", "textarea", "checkbox"].includes(field?.type)
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
    const options = Array.isArray(field?.options) ? field.options : [];
    normalized.options = options
      .map((option) => {
        if (typeof option === "string") {
          return { label: option, value: option };
        }

        return {
          label: toStringOrEmpty(option?.label ?? option?.value),
          value: toStringOrEmpty(option?.value ?? option?.label),
        };
      })
      .filter((option) => option.value);
  }

  return normalized;
};

const normalizeProfile = (rawProfile, sourceMeta) => {
  const id = toStringOrEmpty(rawProfile?.id) || sourceMeta.fallbackId;

  return {
    id,
    name: toStringOrEmpty(rawProfile?.name) || id,
    description: toStringOrEmpty(rawProfile?.description),
    status: toStringOrEmpty(rawProfile?.status || "planned").toLowerCase(),
    isExample: Boolean(rawProfile?.isExample),
    fields: Array.isArray(rawProfile?.fields)
      ? rawProfile.fields.map(normalizeFieldDef).filter((field) => field.key)
      : [],
    execution: {
      webhookPath: toStringOrEmpty(rawProfile?.execution?.webhookPath),
      webhookUrl: toStringOrEmpty(rawProfile?.execution?.webhookUrl),
      payloadMap:
        rawProfile?.execution?.payloadMap && typeof rawProfile.execution.payloadMap === "object"
          ? rawProfile.execution.payloadMap
          : {},
    },
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
      parsed.push(
        normalizeProfile(raw, {
          type: file.sourceType,
          package: file.packageName,
          file: file.filePath,
          fallbackId: path.basename(file.filePath, ".json"),
        }),
      );
    } catch (error) {
      console.warn(`Skipping profile ${file.filePath}: ${error.message}`);
    }
  }

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

const resolveDefaultProfileId = () => {
  if (profileById.has(DEFAULT_PROFILE_ID)) return DEFAULT_PROFILE_ID;
  const firstNonExampleActive = profiles.find(
    (profile) => !profile.isExample && profile.status === "active",
  );
  if (firstNonExampleActive) return firstNonExampleActive.id;
  const firstActive = profiles.find((profile) => profile.status === "active");
  if (firstActive) return firstActive.id;
  return profiles[0]?.id ?? null;
};

const getByPath = (obj, pathText) => {
  const pathValue = toStringOrEmpty(pathText);
  if (!pathValue) return undefined;
  return pathValue.split(".").reduce((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return acc[key];
  }, obj);
};

const buildWebhookPayload = (profile, canonicalInput) => {
  const payloadMap = profile.execution.payloadMap ?? {};
  const entries = Object.entries(payloadMap);
  if (entries.length === 0) {
    return canonicalInput;
  }

  const payload = {};
  for (const [targetKey, sourcePath] of entries) {
    const value = getByPath(canonicalInput, sourcePath);
    if (value !== undefined) {
      payload[targetKey] = value;
    }
  }

  if (payload.profileId === undefined) {
    payload.profileId = canonicalInput.profileId;
  }

  return payload;
};

const resolveWebhookUrl = (profile) => {
  const explicitUrl = toStringOrEmpty(profile.execution.webhookUrl);
  if (explicitUrl) {
    return explicitUrl;
  }

  const webhookPath = toStringOrEmpty(profile.execution.webhookPath).replace(/^\/+/, "");
  if (webhookPath) {
    return `${N8N_WEBHOOK_BASE.replace(/\/+$/, "")}/${webhookPath}`;
  }

  return N8N_RUN_WEBHOOK_URL;
};

const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = N8N_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
};

const dispatchToN8N = async ({ webhookUrl, payload }) => {
  const res = await fetchJsonWithTimeout(
    webhookUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_API_TOKEN,
      },
      body: JSON.stringify(payload),
    },
    N8N_REQUEST_TIMEOUT_MS,
  );

  if (!res.ok) {
    throw new Error(`n8n webhook failed (${res.status}): ${JSON.stringify(res.data)}`);
  }

  return res.data;
};

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const ensureAuth = (req, _res, next) => {
  if (!req.session?.user) {
    throw new InputError("Authentication required", 401);
  }
  next();
};

const ensureAdmin = (req, _res, next) => {
  if (!req.session?.user) {
    throw new InputError("Authentication required", 401);
  }
  if (req.session.user.role !== "admin") {
    throw new InputError("Admin access required", 403);
  }
  next();
};

const ensureInternal = (req, _res, next) => {
  const token = toStringOrEmpty(req.get("x-internal-token"));
  if (!token || token !== INTERNAL_API_TOKEN) {
    throw new InputError("Invalid internal token", 401);
  }
  next();
};

const assertJobStatus = (status) => {
  const normalized = toStringOrEmpty(status).toLowerCase();
  if (!JOB_STATUSES.has(normalized)) {
    throw new InputError(`Invalid job status '${status}'.`);
  }
  return normalized;
};

const assertBatchStatus = (status) => {
  const normalized = toStringOrEmpty(status).toLowerCase();
  if (!BATCH_STATUSES.has(normalized)) {
    throw new InputError(`Invalid batch status '${status}'.`);
  }
  return normalized;
};

const assertBatchItemStatus = (status) => {
  const normalized = toStringOrEmpty(status).toLowerCase();
  if (!BATCH_ITEM_STATUSES.has(normalized)) {
    throw new InputError(`Invalid batch item status '${status}'.`);
  }
  return normalized;
};

const upsertSummaryResult = async ({
  jobId,
  userId,
  summaryText,
  model,
  provider,
  inputTokens,
  outputTokens,
  totalTokens,
  latencyMs,
  costEstUsd,
  rawResponseJson,
}) => {
  const normalizedSummary = toStringOrEmpty(summaryText);
  const inTokens = Math.max(0, Math.floor(asNumberOr(inputTokens, estimateTokenCount(normalizedSummary))));
  const outTokens = Math.max(0, Math.floor(asNumberOr(outputTokens, estimateTokenCount(normalizedSummary))));
  const allTokens = Math.max(
    inTokens + outTokens,
    Math.floor(asNumberOr(totalTokens, inTokens + outTokens)),
  );
  const normalizedCost = Number.isFinite(Number(costEstUsd))
    ? Number(Number(costEstUsd).toFixed(6))
    : estimateCostUsd(inTokens, outTokens);

  const q = `
    INSERT INTO summary_results (
      job_id,
      user_id,
      summary_text,
      model,
      provider,
      input_tokens,
      output_tokens,
      total_tokens,
      latency_ms,
      cost_est_usd,
      raw_response_json
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11
    )
    ON CONFLICT (job_id)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      summary_text = EXCLUDED.summary_text,
      model = EXCLUDED.model,
      provider = EXCLUDED.provider,
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      total_tokens = EXCLUDED.total_tokens,
      latency_ms = EXCLUDED.latency_ms,
      cost_est_usd = EXCLUDED.cost_est_usd,
      raw_response_json = EXCLUDED.raw_response_json,
      created_at = now();
  `;

  await pool.query(q, [
    jobId,
    userId,
    normalizedSummary,
    toStringOrEmpty(model || OPENAI_MODEL),
    toStringOrEmpty(provider || "openai"),
    inTokens,
    outTokens,
    allTokens,
    Math.max(0, Math.floor(asNumberOr(latencyMs, 0))),
    normalizedCost,
    rawResponseJson ?? null,
  ]);
};

const ensureAdminUser = async () => {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;

  const existing = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [ADMIN_EMAIL]);
  if (existing.rows[0]) {
    await pool.query(`UPDATE users SET role = 'admin', updated_at = now() WHERE id = $1`, [
      existing.rows[0].id,
    ]);
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await pool.query(
    `
      INSERT INTO users (email, password_hash, role)
      VALUES ($1, $2, 'admin')
    `,
    [ADMIN_EMAIL, passwordHash],
  );
};

app.get("/api/profiles", (_req, res) => {
  res.json({
    defaultProfile: resolveDefaultProfileId(),
    items: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      status: profile.status,
      isExample: profile.isExample,
      fields: profile.fields,
      source: profile.source,
      execution: {
        webhookPath: profile.execution.webhookPath,
      },
    })),
  });
});

app.post(
  "/api/auth/register",
  asyncHandler(async (req, res) => {
    const email = safeLowerEmail(req.body?.email);
    const password = toStringOrEmpty(req.body?.password);

    if (!isValidEmail(email)) {
      throw new InputError("Valid email is required.");
    }
    if (password.length < 8) {
      throw new InputError("Password must be at least 8 characters.");
    }

    const existing = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
    if (existing.rows[0]) {
      throw new InputError("User already exists.", 409);
    }

    const hash = await bcrypt.hash(password, 12);
    const insert = await pool.query(
      `
        INSERT INTO users (email, password_hash, role)
        VALUES ($1, $2, 'user')
        RETURNING id, email, role, created_at
      `,
      [email, hash],
    );

    const user = insert.rows[0];
    req.session.user = { id: user.id, email: user.email, role: user.role };

    res.status(201).json({ user });
  }),
);

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const email = safeLowerEmail(req.body?.email);
    const password = toStringOrEmpty(req.body?.password);

    if (!isValidEmail(email) || !password) {
      throw new InputError("Email and password are required.");
    }

    const found = await pool.query(
      `SELECT id, email, password_hash, role, created_at FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    const user = found.rows[0];

    if (!user) {
      throw new InputError("Invalid credentials.", 401);
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      throw new InputError("Invalid credentials.", 401);
    }

    req.session.user = { id: user.id, email: user.email, role: user.role };

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
      },
    });
  }),
);

app.post(
  "/api/auth/logout",
  asyncHandler(async (req, res) => {
    await new Promise((resolve, reject) => {
      req.session.destroy((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    res.clearCookie("template2.sid");
    res.json({ ok: true });
  }),
);

app.get(
  "/api/auth/me",
  asyncHandler(async (req, res) => {
    if (!req.session?.user) {
      return res.status(401).json({ authenticated: false });
    }

    const result = await pool.query(
      `SELECT id, email, role, created_at, updated_at FROM users WHERE id = $1 LIMIT 1`,
      [req.session.user.id],
    );

    const user = result.rows[0];
    if (!user) {
      req.session.destroy(() => undefined);
      return res.status(401).json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      user,
    });
  }),
);

app.post(
  "/api/documents/upload",
  ensureAuth,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new InputError("PDF file is required.");
    }

    const mime = toStringOrEmpty(file.mimetype).toLowerCase();
    if (mime !== "application/pdf") {
      throw new InputError("Only PDF uploads are supported in v1.");
    }

    const userId = req.session.user.id;
    const filename = sanitizeFilename(file.originalname || "document.pdf");
    const digest = sha256(file.buffer);

    const uploaded = await uploadDocumentBuffer({
      userId,
      filename,
      buffer: file.buffer,
      mimeType: mime,
    });

    const pageCount = estimatePdfPages(file.buffer);
    const expiresAt = new Date(Date.now() + PDF_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const insert = await pool.query(
      `
        INSERT INTO documents (
          user_id, blob_key, filename, mime_type, size_bytes, page_count, sha256, expires_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
        RETURNING id, user_id, blob_key, filename, mime_type, size_bytes, page_count, sha256, created_at, expires_at
      `,
      [
        userId,
        uploaded.blobKey,
        filename,
        mime,
        uploaded.sizeBytes,
        pageCount,
        digest,
        expiresAt,
      ],
    );

    res.status(201).json({
      document: insert.rows[0],
    });
  }),
);

app.get(
  "/api/documents",
  ensureAuth,
  asyncHandler(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const offset = parseNonNegativeInt(req.query.offset, 0, 100000);

    const q = `
      SELECT id, user_id, blob_key, filename, mime_type, size_bytes, page_count, sha256, created_at, expires_at
      FROM documents
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(q, [req.session.user.id, limit, offset]);
    res.json({
      items: result.rows,
      limit,
      offset,
    });
  }),
);

app.get(
  "/api/documents/:id",
  ensureAuth,
  asyncHandler(async (req, res) => {
    const id = toStringOrEmpty(req.params.id);
    if (!isUuid(id)) {
      throw new InputError("Invalid document id.");
    }

    const result = await pool.query(
      `
        SELECT id, user_id, blob_key, filename, mime_type, size_bytes, page_count, sha256, created_at, expires_at
        FROM documents
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `,
      [id, req.session.user.id],
    );

    const doc = result.rows[0];
    if (!doc) {
      throw new InputError("Document not found.", 404);
    }

    res.json({ document: doc });
  }),
);

app.post(
  "/api/summaries/run",
  ensureAuth,
  asyncHandler(async (req, res) => {
    const profileId = toStringOrEmpty(req.body?.profileId || resolveDefaultProfileId());
    const documentId = toStringOrEmpty(req.body?.documentId);
    const executionMode = toStringOrEmpty(req.body?.executionMode || "sync").toLowerCase();
    const batchStrategy = toStringOrEmpty(req.body?.batchStrategy || "count_only").toLowerCase();

    if (!profileById.has(profileId)) {
      throw new InputError(`Unknown profile '${profileId}'.`);
    }

    const profile = profileById.get(profileId);
    if (profile.status !== "active") {
      throw new InputError(`Profile '${profileId}' is not active.`, 400);
    }

    if (!["sync", "batch"].includes(executionMode)) {
      throw new InputError("executionMode must be 'sync' or 'batch'.");
    }

    if (!["count_only"].includes(batchStrategy)) {
      throw new InputError("batchStrategy must be only: count_only");
    }

    if (!isUuid(documentId)) {
      throw new InputError("documentId must be a UUID.");
    }

    const userId = req.session.user.id;

    const docResult = await pool.query(
      `SELECT id, user_id FROM documents WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [documentId, userId],
    );
    if (!docResult.rows[0]) {
      throw new InputError("Document not found.", 404);
    }

    const initialStatus = executionMode === "sync" ? "processing" : "queued";
    const insert = await pool.query(
      `
        INSERT INTO summary_jobs (
          user_id,
          document_id,
          execution_mode,
          batch_strategy,
          status,
          started_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          CASE WHEN $3 = 'sync' THEN now() ELSE NULL END
        )
        RETURNING id, user_id, document_id, execution_mode, batch_strategy, status, created_at, started_at
      `,
      [userId, documentId, executionMode, batchStrategy, initialStatus],
    );

    const job = insert.rows[0];
    const canonicalPayload = {
      profileId,
      jobId: job.id,
      userId,
      documentId,
      executionMode,
      batchStrategy,
      template: "template_2",
      requestedAt: now().toISOString(),
    };
    const payload = buildWebhookPayload(profile, canonicalPayload);
    const webhookUrl = resolveWebhookUrl(profile);

    if (executionMode === "sync") {
      try {
        await dispatchToN8N({
          webhookUrl,
          payload,
        });
      } catch (error) {
        await pool.query(
          `
            UPDATE summary_jobs
            SET status = 'failed', error_message = $2, completed_at = now(), updated_at = now()
            WHERE id = $1
          `,
          [job.id, String(error.message ?? "Failed to dispatch sync job to n8n").slice(0, 1000)],
        );
      }

      const fresh = await pool.query(
        `
          SELECT id, user_id, document_id, execution_mode, batch_strategy, status, error_message,
                 openai_request_id, openai_batch_id, batch_id,
                 created_at, started_at, completed_at, updated_at
          FROM summary_jobs
          WHERE id = $1
        `,
        [job.id],
      );

      return res.status(201).json({
        job: fresh.rows[0],
      });
    }

    setImmediate(async () => {
      try {
        await dispatchToN8N({
          webhookUrl,
          payload,
        });
      } catch (error) {
        console.error("Failed to notify n8n for batch enqueue", error.message);
      }
    });

    return res.status(202).json({
      job,
      message: "Batch job queued. n8n batch builder workflow will dispatch windows.",
    });
  }),
);

app.get(
  "/api/summaries/jobs",
  ensureAuth,
  asyncHandler(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const offset = parseNonNegativeInt(req.query.offset, 0, 100000);
    const status = toStringOrEmpty(req.query.status).toLowerCase();

    const params = [req.session.user.id];
    const where = ["j.user_id = $1"];

    if (status) {
      params.push(status);
      where.push(`j.status = $${params.length}`);
    }

    params.push(limit);
    params.push(offset);

    const q = `
      SELECT
        j.id,
        j.document_id,
        d.filename,
        j.execution_mode,
        j.batch_strategy,
        j.status,
        j.error_message,
        j.batch_id,
        j.openai_batch_id,
        j.created_at,
        j.started_at,
        j.completed_at,
        j.updated_at,
        r.summary_text,
        r.provider,
        r.model,
        r.total_tokens,
        r.cost_est_usd
      FROM summary_jobs j
      INNER JOIN documents d ON d.id = j.document_id AND d.user_id = j.user_id
      LEFT JOIN summary_results r ON r.job_id = j.id AND r.user_id = j.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY j.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const result = await pool.query(q, params);
    res.json({
      items: result.rows,
      limit,
      offset,
    });
  }),
);

app.get(
  "/api/summaries/jobs/:id",
  ensureAuth,
  asyncHandler(async (req, res) => {
    const id = toStringOrEmpty(req.params.id);
    if (!isUuid(id)) {
      throw new InputError("Invalid job id.");
    }

    const result = await pool.query(
      `
        SELECT
          j.id,
          j.user_id,
          j.document_id,
          d.filename,
          d.sha256,
          d.created_at AS document_created_at,
          j.execution_mode,
          j.batch_strategy,
          j.status,
          j.error_message,
          j.openai_request_id,
          j.openai_batch_id,
          j.batch_id,
          j.created_at,
          j.started_at,
          j.completed_at,
          j.updated_at,
          r.summary_text,
          r.provider,
          r.model,
          r.input_tokens,
          r.output_tokens,
          r.total_tokens,
          r.latency_ms,
          r.cost_est_usd,
          r.created_at AS result_created_at
        FROM summary_jobs j
        INNER JOIN documents d ON d.id = j.document_id AND d.user_id = j.user_id
        LEFT JOIN summary_results r ON r.job_id = j.id AND r.user_id = j.user_id
        WHERE j.id = $1
          AND (j.user_id = $2 OR $3 = 'admin')
        LIMIT 1
      `,
      [id, req.session.user.id, req.session.user.role],
    );

    const job = result.rows[0];
    if (!job) {
      throw new InputError("Job not found.", 404);
    }

    let batch = null;
    if (job.batch_id) {
      const batchResult = await pool.query(
        `
          SELECT id, strategy, max_batch_size, max_wait_seconds, status,
                 opened_at, closed_at, submitted_at, completed_at,
                 openai_batch_id, input_file_id, output_file_id, error_file_id
          FROM batch_windows
          WHERE id = $1
          LIMIT 1
        `,
        [job.batch_id],
      );
      batch = batchResult.rows[0] ?? null;
    }

    res.json({ job, batch });
  }),
);

app.get(
  "/api/summaries/jobs/:id/result",
  ensureAuth,
  asyncHandler(async (req, res) => {
    const id = toStringOrEmpty(req.params.id);
    if (!isUuid(id)) {
      throw new InputError("Invalid job id.");
    }

    const ownership = await pool.query(
      `
        SELECT id, user_id
        FROM summary_jobs
        WHERE id = $1
          AND (user_id = $2 OR $3 = 'admin')
        LIMIT 1
      `,
      [id, req.session.user.id, req.session.user.role],
    );

    if (!ownership.rows[0]) {
      throw new InputError("Job not found.", 404);
    }

    const result = await pool.query(
      `
        SELECT
          id, job_id, user_id, summary_text, model, provider,
          input_tokens, output_tokens, total_tokens,
          latency_ms, cost_est_usd, raw_response_json, created_at
        FROM summary_results
        WHERE job_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [id, ownership.rows[0].user_id],
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Result not available yet." });
    }

    return res.json({ result: result.rows[0] });
  }),
);

app.get(
  "/api/admin/jobs",
  ensureAdmin,
  asyncHandler(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 30, 1, 200);
    const offset = parseNonNegativeInt(req.query.offset, 0, 100000);
    const status = toStringOrEmpty(req.query.status).toLowerCase();

    const params = [];
    const where = [];
    if (status) {
      params.push(status);
      where.push(`j.status = $${params.length}`);
    }

    params.push(limit);
    params.push(offset);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const q = `
      SELECT
        j.id,
        u.email AS user_email,
        j.user_id,
        j.document_id,
        d.filename,
        j.execution_mode,
        j.batch_strategy,
        j.status,
        j.error_message,
        j.batch_id,
        j.openai_batch_id,
        j.created_at,
        j.started_at,
        j.completed_at,
        r.cost_est_usd,
        r.total_tokens,
        r.provider,
        r.model
      FROM summary_jobs j
      INNER JOIN users u ON u.id = j.user_id
      INNER JOIN documents d ON d.id = j.document_id AND d.user_id = j.user_id
      LEFT JOIN summary_results r ON r.job_id = j.id AND r.user_id = j.user_id
      ${whereSql}
      ORDER BY j.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const rows = await pool.query(q, params);
    res.json({ items: rows.rows, limit, offset });
  }),
);

app.get(
  "/api/admin/batches",
  ensureAdmin,
  asyncHandler(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 30, 1, 200);
    const offset = parseNonNegativeInt(req.query.offset, 0, 100000);

    const q = `
      SELECT
        b.id,
        b.strategy,
        b.max_batch_size,
        b.max_wait_seconds,
        b.status,
        b.opened_at,
        b.closed_at,
        b.submitted_at,
        b.completed_at,
        b.openai_batch_id,
        b.input_file_id,
        b.output_file_id,
        b.error_file_id,
        COUNT(bi.job_id)::int AS jobs_count,
        COUNT(*) FILTER (WHERE bi.status = 'completed')::int AS completed_count,
        COUNT(*) FILTER (WHERE bi.status = 'failed')::int AS failed_count
      FROM batch_windows b
      LEFT JOIN batch_items bi ON bi.batch_id = b.id
      GROUP BY b.id
      ORDER BY b.opened_at DESC
      LIMIT $1 OFFSET $2
    `;

    const rows = await pool.query(q, [limit, offset]);
    res.json({ items: rows.rows, limit, offset });
  }),
);

app.get(
  "/api/admin/metrics",
  ensureAdmin,
  asyncHandler(async (_req, res) => {
    const queueDepth = await pool.query(
      `SELECT COUNT(*)::int AS count FROM summary_jobs WHERE status = 'queued'`,
    );

    const inFlight = await pool.query(
      `SELECT COUNT(*)::int AS count FROM summary_jobs WHERE status IN ('batched', 'processing')`,
    );

    const completedLastHour = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM summary_jobs
        WHERE status = 'completed'
          AND completed_at >= now() - interval '1 hour'
      `,
    );

    const failuresLastDay = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM summary_jobs
        WHERE status = 'failed'
          AND updated_at >= now() - interval '24 hours'
      `,
    );

    const activeBatches = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM batch_windows
        WHERE status IN ('open', 'submitted', 'processing')
      `,
    );

    const totalCostLastDay = await pool.query(
      `
        SELECT COALESCE(SUM(cost_est_usd), 0)::numeric(12,6) AS value
        FROM summary_results
        WHERE created_at >= now() - interval '24 hours'
      `,
    );

    const costByModeLastDay = await pool.query(
      `
        SELECT
          j.execution_mode,
          COALESCE(SUM(r.cost_est_usd), 0)::numeric(12,6) AS value,
          COALESCE(SUM(r.input_tokens), 0)::bigint AS input_tokens,
          COALESCE(SUM(r.output_tokens), 0)::bigint AS output_tokens
        FROM summary_results r
        INNER JOIN summary_jobs j ON j.id = r.job_id
        WHERE r.created_at >= now() - interval '24 hours'
        GROUP BY j.execution_mode
      `,
    );

    let syncObservedUsd = 0;
    let batchObservedUsd = 0;
    let syncInputTokens = 0;
    let syncOutputTokens = 0;
    let batchInputTokens = 0;
    let batchOutputTokens = 0;
    for (const row of costByModeLastDay.rows) {
      const mode = toStringOrEmpty(row.execution_mode).toLowerCase();
      const value = roundUsd(row.value ?? 0);
      const inputTokens = Math.max(0, Math.floor(asNumberOr(row.input_tokens, 0)));
      const outputTokens = Math.max(0, Math.floor(asNumberOr(row.output_tokens, 0)));
      if (mode === "sync") {
        syncObservedUsd = value;
        syncInputTokens = inputTokens;
        syncOutputTokens = outputTokens;
      }
      if (mode === "batch") {
        batchObservedUsd = value;
        batchInputTokens = inputTokens;
        batchOutputTokens = outputTokens;
      }
    }
    const syncConfiguredUsd = estimateCostUsd(syncInputTokens, syncOutputTokens);
    const batchConfiguredUsd = estimateBatchCostUsd(batchInputTokens, batchOutputTokens);
    const totalConfiguredUsd = roundUsd(syncConfiguredUsd + batchConfiguredUsd);

    res.json({
      queueDepth: queueDepth.rows[0].count,
      inFlightJobs: inFlight.rows[0].count,
      completedLastHour: completedLastHour.rows[0].count,
      failuresLast24h: failuresLastDay.rows[0].count,
      activeBatches: activeBatches.rows[0].count,
      totalCostLast24hUsd: Number(totalCostLastDay.rows[0].value ?? 0),
      costAnalysisLast24hUsd: {
        observed: {
          syncUsd: syncObservedUsd,
          batchUsd: batchObservedUsd,
          totalUsd: roundUsd(syncObservedUsd + batchObservedUsd),
        },
        configuredFromTokens: {
          syncUsd: syncConfiguredUsd,
          batchUsd: batchConfiguredUsd,
          totalUsd: totalConfiguredUsd,
        },
        pricing: {
          syncInputPerMillionUsd: OPENAI_INPUT_TOKEN_PRICE_PER_MILLION_USD,
          syncOutputPerMillionUsd: OPENAI_OUTPUT_TOKEN_PRICE_PER_MILLION_USD,
          batchInputPerMillionUsd: OPENAI_BATCH_INPUT_TOKEN_PRICE_PER_MILLION_USD,
          batchOutputPerMillionUsd: OPENAI_BATCH_OUTPUT_TOKEN_PRICE_PER_MILLION_USD,
        },
      },
      scheduler: {
        strategyDefault: "count_only",
        maxBatchSize: MAX_BATCH_SIZE,
        maxWaitSeconds: MAX_WAIT_SECONDS,
      },
    });
  }),
);

app.post(
  "/api/admin/benchmarks/run",
  ensureAdmin,
  asyncHandler(async (req, res) => {
    const datasetTier = toStringOrEmpty(req.body?.datasetTier || "all").toUpperCase();
    if (!["S", "M", "L", "ALL"].includes(datasetTier)) {
      throw new InputError("datasetTier must be one of: S, M, L, all.");
    }

    const normalizedTier = datasetTier === "ALL" ? "all" : datasetTier;

    const insert = await pool.query(
      `
        INSERT INTO benchmark_runs (created_by, dataset_tier, strategy, status, started_at)
        VALUES ($1, $2, 'sync_vs_batch_matrix', 'processing', now())
        RETURNING id, created_by, dataset_tier, strategy, status, started_at
      `,
      [req.session.user.id, normalizedTier],
    );

    const run = insert.rows[0];

    setImmediate(async () => {
      try {
        await dispatchToN8N({
          webhookUrl: N8N_BENCHMARK_WEBHOOK_URL,
          payload: {
            benchmarkRunId: run.id,
            datasetTier: normalizedTier,
            repetitions: BENCHMARK_REPETITIONS,
            jobsPerRun: BENCHMARK_JOBS_PER_RUN,
            maxBatchSize: MAX_BATCH_SIZE,
            maxWaitSeconds: MAX_WAIT_SECONDS,
            openaiModel: OPENAI_MODEL,
            template: "template_2",
          },
        });
      } catch (error) {
        await pool.query(
          `
            UPDATE benchmark_runs
            SET status = 'failed', completed_at = now(), report_json = jsonb_build_object('error', $2)
            WHERE id = $1
          `,
          [run.id, String(error.message ?? "Failed to dispatch benchmark workflow").slice(0, 1000)],
        );
      }
    });

    res.status(202).json({ benchmarkRun: run });
  }),
);

app.get(
  "/api/admin/benchmarks/:id",
  ensureAdmin,
  asyncHandler(async (req, res) => {
    const id = toStringOrEmpty(req.params.id);
    if (!isUuid(id)) {
      throw new InputError("Invalid benchmark id.");
    }

    const runResult = await pool.query(
      `
        SELECT id, created_by, dataset_tier, strategy, status, started_at, completed_at, report_json
        FROM benchmark_runs
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );

    const run = runResult.rows[0];
    if (!run) {
      throw new InputError("Benchmark run not found.", 404);
    }

    const samples = await pool.query(
      `
        SELECT
          id, benchmark_run_id, mode, dataset_tier, strategy,
          jobs_submitted, jobs_completed,
          total_time_ms, avg_latency_ms, p95_latency_ms,
          total_cost_est_usd, created_at
        FROM benchmark_samples
        WHERE benchmark_run_id = $1
        ORDER BY dataset_tier, mode, strategy
      `,
      [id],
    );

    res.json({ benchmarkRun: run, samples: samples.rows });
  }),
);

app.get(
  "/api/admin/benchmarks/:id/report",
  ensureAdmin,
  asyncHandler(async (req, res) => {
    const id = toStringOrEmpty(req.params.id);
    if (!isUuid(id)) {
      throw new InputError("Invalid benchmark id.");
    }

    const runResult = await pool.query(
      `SELECT id, status, report_json FROM benchmark_runs WHERE id = $1 LIMIT 1`,
      [id],
    );

    const run = runResult.rows[0];
    if (!run) {
      throw new InputError("Benchmark run not found.", 404);
    }

    res.json({
      id: run.id,
      status: run.status,
      report: enrichBenchmarkReportWithCostAnalysis(run.report_json),
    });
  }),
);

app.get(
  "/api/internal/jobs/:id/context",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const jobId = toStringOrEmpty(req.params.id);
    if (!isUuid(jobId)) {
      throw new InputError("Invalid job id.");
    }

    const result = await pool.query(
      `
        SELECT
          j.id,
          j.user_id,
          j.document_id,
          j.execution_mode,
          j.batch_strategy,
          j.status,
          j.error_message,
          j.batch_id,
          j.openai_request_id,
          j.openai_batch_id,
          j.created_at,
          j.started_at,
          j.completed_at,
          d.blob_key,
          d.filename,
          d.mime_type,
          d.size_bytes,
          d.page_count,
          d.sha256,
          d.created_at AS document_created_at,
          d.expires_at
        FROM summary_jobs j
        INNER JOIN documents d ON d.id = j.document_id AND d.user_id = j.user_id
        WHERE j.id = $1
        LIMIT 1
      `,
      [jobId],
    );

    const job = result.rows[0];
    if (!job) {
      throw new InputError("Job not found.", 404);
    }

    res.json({
      job,
      document: {
        id: job.document_id,
        userId: job.user_id,
        filename: job.filename,
        mimeType: job.mime_type,
        sizeBytes: job.size_bytes,
        pageCount: job.page_count,
        sha256: job.sha256,
        createdAt: job.document_created_at,
        expiresAt: job.expires_at,
      },
      downloadPath: `/api/internal/jobs/${job.id}/document`,
    });
  }),
);

app.get(
  "/api/internal/jobs/:id/document",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const jobId = toStringOrEmpty(req.params.id);
    if (!isUuid(jobId)) {
      throw new InputError("Invalid job id.");
    }

    const result = await pool.query(
      `
        SELECT
          j.id,
          j.user_id,
          d.blob_key,
          d.filename,
          d.mime_type
        FROM summary_jobs j
        INNER JOIN documents d ON d.id = j.document_id AND d.user_id = j.user_id
        WHERE j.id = $1
        LIMIT 1
      `,
      [jobId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new InputError("Job not found.", 404);
    }

    const buffer = await readDocumentBuffer({
      blobKey: row.blob_key,
      expectedUserId: row.user_id,
    });

    res.setHeader("Content-Type", toStringOrEmpty(row.mime_type) || "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=\"${sanitizeFilename(row.filename || `job-${jobId}.pdf`)}\"`,
    );
    res.send(buffer);
  }),
);

app.post(
  "/api/internal/jobs/:id/openai-file",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const jobId = toStringOrEmpty(req.params.id);
    if (!isUuid(jobId)) {
      throw new InputError("Invalid job id.");
    }

    const purpose = toStringOrEmpty(req.body?.purpose || "user_data") || "user_data";

    const result = await pool.query(
      `
        SELECT
          j.id,
          j.user_id,
          d.blob_key,
          d.filename,
          d.mime_type
        FROM summary_jobs j
        INNER JOIN documents d ON d.id = j.document_id AND d.user_id = j.user_id
        WHERE j.id = $1
        LIMIT 1
      `,
      [jobId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new InputError("Job not found.", 404);
    }

    const buffer = await readDocumentBuffer({
      blobKey: row.blob_key,
      expectedUserId: row.user_id,
    });

    const file = await uploadOpenAIFileBuffer({
      buffer,
      filename: row.filename || `job-${jobId}.pdf`,
      contentType: toStringOrEmpty(row.mime_type) || "application/pdf",
      purpose,
    });

    res.json({
      ok: true,
      jobId,
      purpose,
      file,
    });
  }),
);

app.post(
  "/api/internal/openai/files/upload-text",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const purpose = toStringOrEmpty(req.body?.purpose || "batch") || "batch";
    const filename = toStringOrEmpty(req.body?.filename || `payload-${crypto.randomUUID()}.txt`);
    const contentType = toStringOrEmpty(req.body?.contentType || "text/plain");
    const content = req.body?.content;

    if (content == null) {
      throw new InputError("content is required.");
    }

    const textContent = typeof content === "string" ? content : JSON.stringify(content);
    if (!textContent) {
      throw new InputError("content cannot be empty.");
    }

    const file = await uploadOpenAIFileBuffer({
      buffer: Buffer.from(textContent, "utf8"),
      filename,
      contentType,
      purpose,
    });

    res.json({
      ok: true,
      purpose,
      filename,
      bytes: Buffer.byteLength(textContent, "utf8"),
      file,
    });
  }),
);

app.post(
  "/api/internal/jobs/:id/status",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const jobId = toStringOrEmpty(req.params.id);
    if (!isUuid(jobId)) {
      throw new InputError("Invalid job id.");
    }

    const desiredStatus = assertJobStatus(req.body?.status || "processing");
    const errorMessage = toStringOrEmpty(req.body?.errorMessage);
    const openaiRequestId = toStringOrEmpty(req.body?.openaiRequestId);
    const openaiBatchId = toStringOrEmpty(req.body?.openaiBatchId);

    const jobResult = await pool.query(
      `
        SELECT id, user_id, batch_id
        FROM summary_jobs
        WHERE id = $1
        LIMIT 1
      `,
      [jobId],
    );

    const job = jobResult.rows[0];
    if (!job) {
      throw new InputError("Job not found.", 404);
    }

    if (desiredStatus === "completed") {
      const resultBody = req.body?.result ?? req.body ?? {};
      const summaryText = toStringOrEmpty(resultBody.summaryText || resultBody.summary || "");
      if (!summaryText) {
        throw new InputError("summaryText is required for completed status.");
      }

      await upsertSummaryResult({
        jobId,
        userId: job.user_id,
        summaryText,
        model: resultBody.model,
        provider: resultBody.provider,
        inputTokens: resultBody.inputTokens,
        outputTokens: resultBody.outputTokens,
        totalTokens: resultBody.totalTokens,
        latencyMs: resultBody.latencyMs,
        costEstUsd: resultBody.costEstUsd,
        rawResponseJson: resultBody.rawResponseJson ?? req.body,
      });
    }

    const startedAt = req.body?.startedAt ? new Date(req.body.startedAt) : null;
    const completedAt = req.body?.completedAt ? new Date(req.body.completedAt) : null;

    await pool.query(
      `
        UPDATE summary_jobs
        SET
          status = $2,
          error_message = CASE
            WHEN $2 IN ('completed', 'processing') THEN NULL
            WHEN $3 <> '' THEN $3
            ELSE error_message
          END,
          openai_request_id = COALESCE(NULLIF($4, ''), openai_request_id),
          openai_batch_id = COALESCE(NULLIF($5, ''), openai_batch_id),
          started_at = CASE
            WHEN $2 IN ('processing', 'completed') THEN COALESCE(started_at, $6, now())
            ELSE started_at
          END,
          completed_at = CASE
            WHEN $2 IN ('completed', 'failed', 'expired') THEN COALESCE($7, now())
            ELSE completed_at
          END,
          updated_at = now()
        WHERE id = $1
      `,
      [jobId, desiredStatus, errorMessage, openaiRequestId, openaiBatchId, startedAt, completedAt],
    );

    if (job.batch_id && ["processing", "completed", "failed", "expired"].includes(desiredStatus)) {
      const batchItemStatus =
        desiredStatus === "completed" ? "completed" : desiredStatus === "processing" ? "processing" : "failed";
      await pool.query(
        `
          UPDATE batch_items
          SET status = $3
          WHERE batch_id = $1 AND job_id = $2
        `,
        [job.batch_id, jobId, batchItemStatus],
      );
    }

    const fresh = await pool.query(
      `
        SELECT id, user_id, document_id, execution_mode, batch_strategy, status, error_message,
               openai_request_id, openai_batch_id, batch_id,
               created_at, started_at, completed_at, updated_at
        FROM summary_jobs
        WHERE id = $1
      `,
      [jobId],
    );

    res.json({ ok: true, job: fresh.rows[0] });
  }),
);

app.get(
  "/api/internal/queues/summary",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const strategy = toStringOrEmpty(req.query.strategy || "count_only").toLowerCase();
    const limit = parsePositiveInt(req.query.limit, MAX_BATCH_SIZE, 1, 500);

    if (!["count_only"].includes(strategy)) {
      throw new InputError("strategy must be: count_only");
    }

    const rows = await pool.query(
      `
        SELECT
          j.id,
          j.user_id,
          j.document_id,
          j.batch_strategy,
          j.created_at,
          EXTRACT(EPOCH FROM (now() - j.created_at))::int AS age_seconds
        FROM summary_jobs j
        WHERE j.status = 'queued'
          AND j.execution_mode = 'batch'
          AND j.batch_strategy = $1
        ORDER BY j.created_at ASC
        LIMIT $2
      `,
      [strategy, limit],
    );

    res.json({
      strategy,
      maxBatchSize: MAX_BATCH_SIZE,
      maxWaitSeconds: MAX_WAIT_SECONDS,
      queueDepth: rows.rows.length,
      items: rows.rows,
    });
  }),
);

app.post(
  "/api/internal/batches/open",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const strategy = toStringOrEmpty(req.body?.strategy || "count_only").toLowerCase();
    if (!["count_only"].includes(strategy)) {
      throw new InputError("strategy must be: count_only");
    }

    const providedJobIds = Array.isArray(req.body?.jobIds)
      ? req.body.jobIds.map((id) => toStringOrEmpty(id)).filter((id) => isUuid(id))
      : [];

    if (providedJobIds.length === 0) {
      throw new InputError("jobIds must contain at least one valid job id.");
    }

    const maxBatchSize = parsePositiveInt(req.body?.maxBatchSize, MAX_BATCH_SIZE, 1, 1000);
    const maxWaitSeconds = parsePositiveInt(req.body?.maxWaitSeconds, MAX_WAIT_SECONDS, 1, 86400);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const lockResult = await client.query(
        `
          SELECT id
          FROM summary_jobs
          WHERE id = ANY($1::uuid[])
            AND status = 'queued'
            AND execution_mode = 'batch'
            AND batch_strategy = $2
          ORDER BY created_at ASC
          LIMIT $3
          FOR UPDATE SKIP LOCKED
        `,
        [providedJobIds, strategy, maxBatchSize],
      );

      const lockedJobIds = lockResult.rows.map((row) => row.id);
      if (lockedJobIds.length === 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "No eligible queued jobs found for the requested batch window.",
        });
      }

      // Strict full-batch enforcement: avoid partial claims (e.g. 1-of-2) under concurrent runners.
      if (lockedJobIds.length < maxBatchSize) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `Insufficient unlocked jobs to open full batch window (needed ${maxBatchSize}, claimed ${lockedJobIds.length}).`,
        });
      }

      const limitedJobIds = lockedJobIds.slice(0, maxBatchSize);

      const batchInsert = await client.query(
        `
          INSERT INTO batch_windows (
            strategy,
            max_batch_size,
            max_wait_seconds,
            status,
            opened_at,
            closed_at,
            submitted_at
          ) VALUES (
            $1, $2, $3, 'submitted', now(), now(), now()
          )
          RETURNING id, strategy, max_batch_size, max_wait_seconds, status, opened_at, closed_at, submitted_at
        `,
        [strategy, maxBatchSize, maxWaitSeconds],
      );

      const batch = batchInsert.rows[0];

      for (let idx = 0; idx < limitedJobIds.length; idx += 1) {
        await client.query(
          `
            INSERT INTO batch_items (batch_id, job_id, position, status)
            VALUES ($1, $2, $3, 'queued')
            ON CONFLICT (batch_id, job_id) DO NOTHING
          `,
          [batch.id, limitedJobIds[idx], idx],
        );
      }

      await client.query(
        `
          UPDATE summary_jobs
          SET status = 'batched', batch_id = $1, updated_at = now()
          WHERE id = ANY($2::uuid[])
        `,
        [batch.id, limitedJobIds],
      );

      await client.query("COMMIT");

      return res.status(201).json({
        batch,
        jobIds: limitedJobIds,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.get(
  "/api/internal/batches/pending",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 20, 1, 200);

    const rows = await pool.query(
      `
        SELECT
          id,
          strategy,
          max_batch_size,
          max_wait_seconds,
          status,
          opened_at,
          closed_at,
          submitted_at,
          completed_at,
          openai_batch_id,
          input_file_id,
          output_file_id,
          error_file_id
        FROM batch_windows
        WHERE status IN ('submitted', 'processing')
        ORDER BY submitted_at ASC NULLS LAST, opened_at ASC
        LIMIT $1
      `,
      [limit],
    );

    res.json({ items: rows.rows, limit });
  }),
);

app.get(
  "/api/internal/batches/:id/jobs",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const batchId = toStringOrEmpty(req.params.id);
    if (!isUuid(batchId)) {
      throw new InputError("Invalid batch id.");
    }

    const batchResult = await pool.query(
      `
        SELECT
          id,
          strategy,
          max_batch_size,
          max_wait_seconds,
          status,
          opened_at,
          submitted_at,
          openai_batch_id,
          input_file_id,
          output_file_id,
          error_file_id
        FROM batch_windows
        WHERE id = $1
        LIMIT 1
      `,
      [batchId],
    );

    const batch = batchResult.rows[0];
    if (!batch) {
      throw new InputError("Batch not found.", 404);
    }

    const jobs = await pool.query(
      `
        SELECT
          j.id,
          j.user_id,
          j.document_id,
          j.status,
          j.execution_mode,
          j.batch_strategy,
          bi.position,
          bi.status AS batch_item_status,
          d.filename,
          d.mime_type,
          d.blob_key,
          d.sha256,
          d.size_bytes,
          d.page_count
        FROM batch_items bi
        INNER JOIN summary_jobs j ON j.id = bi.job_id
        INNER JOIN documents d ON d.id = j.document_id AND d.user_id = j.user_id
        WHERE bi.batch_id = $1
        ORDER BY bi.position ASC
      `,
      [batchId],
    );

    const items = jobs.rows.map((row) => ({
      ...row,
      downloadPath: `/api/internal/jobs/${row.id}/document`,
    }));

    res.json({ batch, items });
  }),
);

app.post(
  "/api/internal/batches/:id/status",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const batchId = toStringOrEmpty(req.params.id);
    if (!isUuid(batchId)) {
      throw new InputError("Invalid batch id.");
    }

    const status = assertBatchStatus(req.body?.status || "processing");
    const openaiBatchId = toStringOrEmpty(req.body?.openaiBatchId);
    const inputFileId = toStringOrEmpty(req.body?.inputFileId);
    const outputFileId = toStringOrEmpty(req.body?.outputFileId);
    const errorFileId = toStringOrEmpty(req.body?.errorFileId);
    const errorMessage = toStringOrEmpty(req.body?.errorMessage);

    const existing = await pool.query(`SELECT id FROM batch_windows WHERE id = $1 LIMIT 1`, [batchId]);
    if (!existing.rows[0]) {
      throw new InputError("Batch not found.", 404);
    }

    await pool.query(
      `
        UPDATE batch_windows
        SET
          status = $2,
          openai_batch_id = COALESCE(NULLIF($3, ''), openai_batch_id),
          input_file_id = COALESCE(NULLIF($4, ''), input_file_id),
          output_file_id = COALESCE(NULLIF($5, ''), output_file_id),
          error_file_id = COALESCE(NULLIF($6, ''), error_file_id),
          submitted_at = CASE WHEN $2 IN ('submitted', 'processing') THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
          completed_at = CASE WHEN $2 IN ('completed', 'failed', 'expired') THEN now() ELSE completed_at END
        WHERE id = $1
      `,
      [batchId, status, openaiBatchId, inputFileId, outputFileId, errorFileId],
    );

    if (status === "processing") {
      await pool.query(
        `
          UPDATE summary_jobs
          SET status = 'processing', started_at = COALESCE(started_at, now()), updated_at = now(),
              openai_batch_id = COALESCE(NULLIF($2, ''), openai_batch_id)
          WHERE batch_id = $1
            AND status IN ('batched', 'queued')
        `,
        [batchId, openaiBatchId],
      );
      await pool.query(
        `UPDATE batch_items SET status = 'processing' WHERE batch_id = $1 AND status = 'queued'`,
        [batchId],
      );
    }

    if (status === "failed" || status === "expired") {
      await pool.query(
        `
          UPDATE summary_jobs
          SET status = CASE WHEN $2 = 'expired' THEN 'expired' ELSE 'failed' END,
              error_message = COALESCE(NULLIF($3, ''), error_message, 'Batch workflow failed'),
              completed_at = now(),
              updated_at = now()
          WHERE batch_id = $1
            AND status IN ('queued', 'batched', 'processing')
        `,
        [batchId, status, errorMessage],
      );

      await pool.query(
        `
          UPDATE batch_items
          SET status = 'failed'
          WHERE batch_id = $1
            AND status IN ('queued', 'processing')
        `,
        [batchId],
      );
    }

    const fresh = await pool.query(
      `
        SELECT
          id,
          strategy,
          max_batch_size,
          max_wait_seconds,
          status,
          opened_at,
          closed_at,
          submitted_at,
          completed_at,
          openai_batch_id,
          input_file_id,
          output_file_id,
          error_file_id
        FROM batch_windows
        WHERE id = $1
        LIMIT 1
      `,
      [batchId],
    );

    res.json({ ok: true, batch: fresh.rows[0] });
  }),
);

app.post(
  "/api/internal/batches/:id/ingest",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const batchId = toStringOrEmpty(req.params.id);
    if (!isUuid(batchId)) {
      throw new InputError("Invalid batch id.");
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    const batchExists = await pool.query(`SELECT id FROM batch_windows WHERE id = $1 LIMIT 1`, [batchId]);
    if (!batchExists.rows[0]) {
      throw new InputError("Batch not found.", 404);
    }

    for (const item of items) {
      const jobId = toStringOrEmpty(item?.jobId);
      if (!isUuid(jobId)) continue;

      const itemStatus = assertBatchItemStatus(item?.status || "completed");

      const jobResult = await pool.query(
        `
          SELECT id, user_id
          FROM summary_jobs
          WHERE id = $1 AND batch_id = $2
          LIMIT 1
        `,
        [jobId, batchId],
      );

      const job = jobResult.rows[0];
      if (!job) continue;

      if (itemStatus === "completed") {
        const summaryText = toStringOrEmpty(item.summaryText || item.summary || "");
        if (!summaryText) {
          await pool.query(
            `
              UPDATE summary_jobs
              SET status = 'failed', error_message = 'Batch item completed without summary text', completed_at = now(), updated_at = now()
              WHERE id = $1
            `,
            [jobId],
          );
          await pool.query(
            `UPDATE batch_items SET status = 'failed' WHERE batch_id = $1 AND job_id = $2`,
            [batchId, jobId],
          );
          continue;
        }

        await upsertSummaryResult({
          jobId,
          userId: job.user_id,
          summaryText,
          model: item.model,
          provider: item.provider || "openai",
          inputTokens: item.inputTokens,
          outputTokens: item.outputTokens,
          totalTokens: item.totalTokens,
          latencyMs: item.latencyMs,
          costEstUsd: item.costEstUsd,
          rawResponseJson: item.rawResponseJson ?? item,
        });

        await pool.query(
          `
            UPDATE summary_jobs
            SET status = 'completed',
                error_message = NULL,
                openai_request_id = COALESCE(NULLIF($2, ''), openai_request_id),
                completed_at = now(),
                updated_at = now()
            WHERE id = $1
          `,
          [jobId, toStringOrEmpty(item.openaiRequestId)],
        );

        await pool.query(
          `
            UPDATE batch_items
            SET status = 'completed'
            WHERE batch_id = $1 AND job_id = $2
          `,
          [batchId, jobId],
        );
      } else if (itemStatus === "processing") {
        await pool.query(
          `
            UPDATE summary_jobs
            SET status = 'processing', started_at = COALESCE(started_at, now()), updated_at = now()
            WHERE id = $1
          `,
          [jobId],
        );
        await pool.query(
          `UPDATE batch_items SET status = 'processing' WHERE batch_id = $1 AND job_id = $2`,
          [batchId, jobId],
        );
      } else {
        const message = toStringOrEmpty(item.errorMessage || "Batch item failed");
        await pool.query(
          `
            UPDATE summary_jobs
            SET status = 'failed', error_message = $2, completed_at = now(), updated_at = now()
            WHERE id = $1
          `,
          [jobId, message.slice(0, 1000)],
        );
        await pool.query(
          `UPDATE batch_items SET status = 'failed' WHERE batch_id = $1 AND job_id = $2`,
          [batchId, jobId],
        );
      }
    }

    const pendingCountResult = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM batch_items
        WHERE batch_id = $1
          AND status IN ('queued', 'processing')
      `,
      [batchId],
    );

    const failedCountResult = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM batch_items
        WHERE batch_id = $1
          AND status = 'failed'
      `,
      [batchId],
    );

    const pendingCount = pendingCountResult.rows[0].count;
    const failedCount = failedCountResult.rows[0].count;

    const nextBatchStatus =
      pendingCount > 0 ? "processing" : failedCount > 0 ? "completed" : "completed";

    await pool.query(
      `
        UPDATE batch_windows
        SET status = $2,
            completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END
        WHERE id = $1
      `,
      [batchId, nextBatchStatus],
    );

    res.json({
      ok: true,
      batchId,
      status: nextBatchStatus,
      pendingCount,
      failedCount,
    });
  }),
);

app.post(
  "/api/internal/benchmarks/:id/status",
  ensureInternal,
  asyncHandler(async (req, res) => {
    const benchmarkRunId = toStringOrEmpty(req.params.id);
    if (!isUuid(benchmarkRunId)) {
      throw new InputError("Invalid benchmark id.");
    }

    const status = toStringOrEmpty(req.body?.status).toLowerCase();
    if (!["processing", "completed", "failed"].includes(status)) {
      throw new InputError("status must be one of: processing, completed, failed.");
    }

    const existing = await pool.query(`SELECT id FROM benchmark_runs WHERE id = $1 LIMIT 1`, [
      benchmarkRunId,
    ]);
    if (!existing.rows[0]) {
      throw new InputError("Benchmark run not found.", 404);
    }

    if (status === "processing") {
      await pool.query(
        `
          UPDATE benchmark_runs
          SET status = 'processing',
              started_at = COALESCE(started_at, now()),
              report_json = COALESCE($2::jsonb, report_json)
          WHERE id = $1
        `,
        [benchmarkRunId, req.body?.report ?? null],
      );
      return res.json({ ok: true, status: "processing" });
    }

    if (status === "failed") {
      const report =
        req.body?.report ??
        {
          error: toStringOrEmpty(req.body?.error || "Benchmark workflow failed"),
          failedAt: now().toISOString(),
        };
      await pool.query(
        `
          UPDATE benchmark_runs
          SET status = 'failed', completed_at = now(), report_json = $2::jsonb
          WHERE id = $1
        `,
        [benchmarkRunId, report],
      );
      return res.json({ ok: true, status: "failed" });
    }

    const samples = Array.isArray(req.body?.samples) ? req.body.samples : [];
    const report = req.body?.report ?? null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM benchmark_samples WHERE benchmark_run_id = $1`, [benchmarkRunId]);

      for (const sample of samples) {
        const mode = toStringOrEmpty(sample.mode).toLowerCase();
        const datasetTier = toStringOrEmpty(sample.datasetTier).toUpperCase();
        const strategy = toStringOrEmpty(sample.strategy);

        if (!["sync", "batch"].includes(mode)) continue;
        if (!["S", "M", "L"].includes(datasetTier)) continue;

        await client.query(
          `
            INSERT INTO benchmark_samples (
              benchmark_run_id,
              mode,
              dataset_tier,
              strategy,
              jobs_submitted,
              jobs_completed,
              total_time_ms,
              avg_latency_ms,
              p95_latency_ms,
              total_cost_est_usd
            ) VALUES (
              $1, $2, $3, $4,
              $5, $6,
              $7, $8, $9, $10
            )
          `,
          [
            benchmarkRunId,
            mode,
            datasetTier,
            strategy,
            Math.max(0, Math.floor(asNumberOr(sample.jobsSubmitted, 0))),
            Math.max(0, Math.floor(asNumberOr(sample.jobsCompleted, 0))),
            Math.max(0, Math.floor(asNumberOr(sample.totalTimeMs, 0))),
            Math.max(0, Math.floor(asNumberOr(sample.avgLatencyMs, 0))),
            Math.max(0, Math.floor(asNumberOr(sample.p95LatencyMs, 0))),
            Number(asNumberOr(sample.totalCostEstUsd, 0).toFixed(6)),
          ],
        );
      }

      await client.query(
        `
          UPDATE benchmark_runs
          SET status = 'completed', completed_at = now(), report_json = $2::jsonb
          WHERE id = $1
        `,
        [benchmarkRunId, report],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.json({ ok: true, status: "completed" });
  }),
);

app.get(
  "/health",
  asyncHandler(async (_req, res) => {
    await pool.query("SELECT 1;");
    res.json({
      ok: true,
      service: "template_2",
      executionPolicy: "n8n_only",
      profileCount: profiles.length,
      defaultProfileId: resolveDefaultProfileId(),
      n8n: {
        runWebhook: N8N_RUN_WEBHOOK_URL,
        benchmarkWebhook: N8N_BENCHMARK_WEBHOOK_URL,
      },
    });
  }),
);

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, _req, res, _next) => {
  if (error instanceof InputError) {
    return res.status(error.statusCode).json({ error: error.message });
  }

  console.error("Unhandled error", error);
  return res.status(500).json({ error: "Internal server error", details: error.message });
});

const start = async () => {
  await ensureDir(LOCAL_BLOB_DIR);
  await pool.query("SELECT 1;");
  await ensureAdminUser();

  app.listen(PORT, () => {
    console.log(`Template 2 app listening on http://localhost:${PORT}`);
    console.log("Execution policy: n8n_only");
  });
};

process.on("SIGINT", async () => {
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});

start().catch((error) => {
  console.error("Failed to start Template 2 app", error);
  process.exit(1);
});
