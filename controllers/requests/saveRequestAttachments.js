const {
  insertAttachment,
  attachmentsHasItemIdColumn,
} = require("../../utils/attachmentSchema");
const { storeAttachmentFile } = require("../../utils/attachmentStorage");

const ITEM_FIELD_PREFIX = "item_";

function groupUploadedFiles(files = []) {
  const requestFiles = [];
  const itemFiles = {};

  for (const file of files) {
    if (!file?.fieldname) continue;

    if (file.fieldname === "attachments") {
      requestFiles.push(file);
      continue;
    }

    if (!file.fieldname.startsWith(ITEM_FIELD_PREFIX)) continue;

    const idx = parseInt(file.fieldname.slice(ITEM_FIELD_PREFIX.length), 10);
    if (Number.isNaN(idx)) continue;

    if (!itemFiles[idx]) {
      itemFiles[idx] = [];
    }
    itemFiles[idx].push(file);
  }

  return { requestFiles, itemFiles };
}

async function uploadAndStoreAttachment({ client, file, requestId, itemId, requesterId }) {
  const { objectKey } = await storeAttachmentFile({
    file,
    requestId,
    itemId,
  });

  await insertAttachment(client, {
    requestId,
    itemId,
    fileName: file.originalname,
    filePath: objectKey,
    uploadedBy: requesterId,
  });
}

async function persistRequestAttachments({
  client,
  requestId,
  requesterId,
  itemIdMap,
  files,
}) {
  if (!client || !requestId || !requesterId) {
    throw new Error("Missing attachment persistence context");
  }

  if (!Array.isArray(files) || files.length === 0) {
    return 0;
  }

  if (!isStorageConfigured()) {
    console.warn(
      "⚠️ Supabase storage is not configured; skipping attachment uploads while still creating the request.",
    );
    return 0;
  }

  const { requestFiles, itemFiles } = groupUploadedFiles(files);
  let storedCount = 0;

  for (const file of requestFiles) {
    await uploadAndStoreAttachment({
      client,
      file,
      requestId,
      itemId: null,
      requesterId,
    });
    storedCount += 1;
  }

  const supportsItemAttachments = await attachmentsHasItemIdColumn(client);

  if (!supportsItemAttachments && Object.keys(itemFiles).length > 0) {
    console.warn(
      "⚠️ Item-level attachments are not supported by the current database schema; storing them as request-level attachments instead.",
    );
  }

  for (const [idx, filesForItem] of Object.entries(itemFiles)) {
    const mappedItemId = supportsItemAttachments
      ? itemIdMap?.[idx]
      : null;

    if (supportsItemAttachments && !mappedItemId) {
      continue;
    }

    for (const file of filesForItem) {
      await uploadAndStoreAttachment({
        client,
        file,
        requestId,
        itemId: mappedItemId,
        requesterId,
      });
      storedCount += 1;
    }
  }

  return storedCount;
}

module.exports = {
  persistRequestAttachments,
  groupUploadedFiles,
};