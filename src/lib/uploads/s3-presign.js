import { createHmac, createHash } from "node:crypto";

const DEFAULT_EXPIRES_SECONDS = 10 * 60;
const SERVICE = "s3";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export function getPrivateS3UploadConfig(env = process.env) {
  const bucket = clean(env.AWS_S3_BUCKET_DOCUMENTS);
  const region = clean(env.AWS_REGION);
  const accessKeyId = clean(env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = clean(env.AWS_SECRET_ACCESS_KEY);
  const sessionToken = clean(env.AWS_SESSION_TOKEN);

  return {
    configured: Boolean(bucket && region && accessKeyId && secretAccessKey),
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
  };
}

export function createPresignedPutObjectUrl({
  bucket,
  key,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken = "",
  contentType,
  expiresSeconds = DEFAULT_EXPIRES_SECONDS,
  now = new Date(),
}) {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const encodedKey = encodeS3Key(key);
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const signedHeaders = "content-type;host;x-amz-server-side-encryption";
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  });

  if (sessionToken) {
    query.set("X-Amz-Security-Token", sessionToken);
  }

  const headers = {
    "content-type": contentType,
    host,
    "x-amz-server-side-encryption": "AES256",
  };
  const canonicalRequest = [
    "PUT",
    `/${encodedKey}`,
    sortQueryString(query),
    canonicalHeaders(headers),
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, SERVICE);
  const signature = hmacHex(signingKey, stringToSign);
  query.set("X-Amz-Signature", signature);

  return {
    url: `https://${host}/${encodedKey}?${sortQueryString(query)}`,
    expiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
    requiredHeaders: {
      "Content-Type": contentType,
      "x-amz-server-side-encryption": "AES256",
    },
  };
}

function clean(value) {
  return String(value || "").trim();
}

function encodeS3Key(key) {
  return String(key || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalHeaders(headers) {
  return Object.entries(headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name.toLowerCase()}:${String(value).trim()}\n`)
    .join("");
}

function sortQueryString(query) {
  return Array.from(query.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = leftKey.localeCompare(rightKey);
      return keyComparison || leftValue.localeCompare(rightValue);
    })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function hmac(key, input) {
  return createHmac("sha256", key).update(input, "utf8").digest();
}

function hmacHex(key, input) {
  return createHmac("sha256", key).update(input, "utf8").digest("hex");
}

function getSignatureKey(secretAccessKey, dateStamp, region, service) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}
