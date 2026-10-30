"use strict";
const express = require("express"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const pool = require("../config/db"),
  upload = require("../middleware/upload");
const {
  createSurgicalConsignmentService,
} = require("../services/surgicalConsignmentService");
const m = require("../services/surgicalConsignmentModel");
const router = express.Router(),
  service = createSurgicalConsignmentService(pool);
const privateDir = () => {
  const directory = path.resolve(
    process.env.SURGICAL_CONSIGNMENT_PRIVATE_DIR ||
      path.join(__dirname, "../private-uploads/surgical-consignments"),
  );
  const publicRoot = path.resolve(__dirname, "../uploads");
  const relative = path.relative(publicRoot, directory);
  if (
    !relative ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw m.error(
      503,
      "Clinical documents must be stored outside the public uploads directory",
    );
  return directory;
};
const wrap = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch(next);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  req.auditPayload = { module: "surgical_consignment", operation: req.method };
  next();
});
router.param("id", (req, res, next, v) => {
  try {
    m.id(v);
    next();
  } catch (e) {
    next(e);
  }
});
router.get(
  "/schema",
  wrap(async (req, res) => {
    await service.checkSchema();
    return res.json({
      current_user_id: req.user.id,
      can_create: m.canCreate(req.user),
      can_scm: m.scm(req.user),
      file_purposes: m.PURPOSES,
      forms: ["DPP.SC.001.F18", "DPP.SC.001.F19", "DPP.SC.001.F20"],
    });
  }),
);
router.get(
  "/settings",
  wrap(async (req, res) => res.json(await service.routingSettings(req.user))),
);
router.put(
  "/settings",
  wrap(async (req, res) =>
    res.json(await service.saveRoutingSettings(req.user, req.body)),
  ),
);
router.get(
  "/routing",
  wrap(async (req, res) =>
    res.json(
      await service.previewRouting(
        req.user,
        req.query.department_id,
        req.query.section_id,
      ),
    ),
  ),
);
router.get(
  "/options",
  wrap(async (req, res) => res.json(await service.options(req.user))),
);
router.get(
  "/",
  wrap(async (req, res) =>
    res.json(await service.list(req.user, req.query.search)),
  ),
);
router.post(
  "/",
  wrap(async (req, res) =>
    res.status(201).json(await service.create(req.user, req.body)),
  ),
);
router.get(
  "/:id",
  wrap(async (req, res) =>
    res.json(await service.read(req.user, req.params.id)),
  ),
);
router.get(
  "/:id/purchase-orders",
  wrap(async (req, res) =>
    res.json(await service.poOptions(req.user, req.params.id)),
  ),
);
for (const action of [
  "approve",
  "receipt",
  "confirm_receipt",
  "save_usage",
  "return",
  "waiver",
  "attest",
  "release_billing",
  "bind_po",
  "close",
  "cancel",
])
  router.post(
    `/:id/${action}`,
    wrap(async (req, res) =>
      res.json(await service.mutate(req.user, req.params.id, req.body, action)),
    ),
  );
router.post(
  "/:id/files",
  (req, res, next) =>
    service
      .get(req.user, req.params.id)
      .then((c) => {
        if (!c.clinical_access)
          throw m.error(403, "Clinical document access requires assignment");
        next();
      })
      .catch(next),
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file?.buffer?.length)
      throw m.error(400, "Choose a non-empty supporting document");
    if (!m.PURPOSES.includes(req.body.purpose))
      throw m.error(400, "Choose a document purpose");
    const storageName =
      crypto.randomUUID() + path.extname(req.file.originalname).toLowerCase();
    await fs.mkdir(privateDir(), { recursive: true, mode: 0o700 });
    const target = path.join(privateDir(), storageName);
    await fs.writeFile(target, req.file.buffer, { mode: 0o600, flag: "wx" });
    try {
      res.status(201).json(
        await service.attach(req.user, req.params.id, {
          file_name: req.file.originalname,
          storage_name: storageName,
          purpose: req.body.purpose,
        }),
      );
    } catch (e) {
      await fs.unlink(target).catch(() => {});
      throw e;
    }
  }),
);
router.get(
  "/:id/files/:fileId/download",
  wrap(async (req, res) => {
    const f = await service.download(
      req.user,
      req.params.id,
      req.params.fileId,
    );
    if (!/^[a-f0-9-]{36}(\.[a-z0-9]+)?$/i.test(f.storage_name))
      throw m.error(500, "Invalid private file record");
    await fs.access(path.join(privateDir(), f.storage_name));
    res.download(path.join(privateDir(), f.storage_name), f.file_name);
  }),
);
module.exports = router;
