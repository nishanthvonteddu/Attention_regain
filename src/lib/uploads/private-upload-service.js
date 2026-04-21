import { getEnvironmentFlags } from "../env.js";
import { createPublicId } from "../data/schema.js";
import { getDefaultStudyRepository } from "../data/repositories.js";
import { createS3ObjectUri, createUploadObjectKey } from "./object-keys.js";
import { getPrivateS3UploadConfig, createPresignedPutObjectUrl } from "./s3-presign.js";
import { validateUploadDescriptor } from "./validation.js";

const LOCAL_PRIVATE_BUCKET = "local-private-documents";

export async function createPrivateUploadHandshake({
  user,
  file,
  title = "",
  goal = "",
  env = process.env,
  repository = getDefaultStudyRepository(),
}) {
  const validation = validateUploadDescriptor(file);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.message,
      code: validation.code,
    };
  }

  const documentId = createPublicId("doc");
  const descriptor = validation.descriptor;
  const flags = getEnvironmentFlags(env);
  const s3Config = getPrivateS3UploadConfig(env);
  const bucket = s3Config.bucket || LOCAL_PRIVATE_BUCKET;
  const objectKey = createUploadObjectKey({
    userId: user.id,
    documentId,
    fileName: descriptor.fileName,
  });
  const sourceRef = createS3ObjectUri(bucket, objectKey);
  const presigned = flags.awsServices
    ? buildPresignedUpload({ s3Config, objectKey, descriptor })
    : null;

  const upload = await repository.createDocumentUpload({
    user,
    documentId,
    title: title || descriptor.fileName.replace(/\.[^.]+$/, ""),
    goal,
    sourceKind: descriptor.sourceKind,
    sourceRef,
    file: descriptor,
    storage: {
      provider: "s3",
      bucket,
      objectKey,
      objectUri: sourceRef,
      uploadMode: presigned ? "presigned-put" : "metadata-only",
      expiresAt: presigned?.expiresAt || null,
    },
  });

  return {
    ok: true,
    upload: {
      id: upload.id,
      documentId: upload.documentId,
      status: upload.status,
      uploadMode: upload.uploadMode,
      objectKey: upload.objectKey,
      objectUri: upload.objectUri,
      bucket: upload.bucket,
      expiresAt: upload.expiresAt,
      url: presigned?.url || null,
      requiredHeaders: presigned?.requiredHeaders || {},
    },
  };
}

function buildPresignedUpload({ s3Config, objectKey, descriptor }) {
  if (!s3Config.configured) {
    throw new Error(
      "AWS uploads are enabled, but S3 presign credentials or bucket settings are missing.",
    );
  }

  return createPresignedPutObjectUrl({
    bucket: s3Config.bucket,
    key: objectKey,
    region: s3Config.region,
    accessKeyId: s3Config.accessKeyId,
    secretAccessKey: s3Config.secretAccessKey,
    sessionToken: s3Config.sessionToken,
    contentType: descriptor.contentType,
  });
}
