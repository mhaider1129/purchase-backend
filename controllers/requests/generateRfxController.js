const sourcing = require("../../services/rfxAuthorization");
const PDFDocument = require("pdfkit");
const createHttpError = require("../../utils/httpError");
const {
  assertRequestItemsReadyForSourcing,
} = require("../../services/sourcingReadinessService");

const renderPdf = (writeDocument) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.once("end", () => resolve(Buffer.concat(chunks)));
    doc.once("error", reject);

    try {
      writeDocument(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });

const generateRfx = async (req, res, next) => {
  const { id } = req.params;
  const type = (req.query.type || "rfq").toLowerCase();
  const allowedTypes = ["rfp", "rfi", "rfq"];

  if (!allowedTypes.includes(type)) {
    return next(createHttpError(400, "Invalid document type"));
  }

  try {
    const pdf = await sourcing.transaction(
      req.user,
      { requestId: id },
      async (client, ctx) => {
        const requestRes = await client.query(
          `SELECT r.*, d.name AS department_name, p.name AS project_name,
              COALESCE(NULLIF(TRIM(r.temporary_requester_name), ''), u.name, 'Unknown requester') AS requester_name
       FROM requests r
       LEFT JOIN departments d ON r.department_id = d.id
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN users u ON r.requester_id = u.id
       WHERE r.id = $1`,
          [id],
        );

        if (requestRes.rowCount === 0) {
          throw sourcing.missing();
        }

        const request = requestRes.rows[0];

        const itemsRes = await client.query(
          `SELECT id, item_name,
              quantity,
              request_mode,
              catalog_status,
              generic_item_id,
              preferred_product_id,
              mandatory_product_id,
              restriction_justification,
              NULL::text AS unit,
              COALESCE(NULLIF(TRIM(specs), ''), NULLIF(TRIM(intended_use), ''), NULLIF(TRIM(brand), '')) AS description
       FROM public.requested_items
       WHERE request_id = $1
         AND LOWER(COALESCE(approval_status, 'approved')) <> 'rejected'`,
          [id],
        );

        const items = itemsRes.rows;
        await assertRequestItemsReadyForSourcing(client, id, items, ctx.actor);
        const titleMap = {
          rfp: "Request for Proposal",
          rfi: "Request for Information",
          rfq: "Request for Quotation",
        };
        return renderPdf((doc) => {
          doc.fontSize(18).text(titleMap[type], { align: "center" });
          doc.moveDown();

          doc.fontSize(12).text(`Request ID: ${request.id}`);
          doc.text(`Department: ${request.department_name}`);
          doc.text(`Requester: ${request.requester_name}`);
          doc.text(`Justification: ${request.justification}`);
          if (request.project_name) {
            doc.text(`Project: ${request.project_name}`);
          }
          doc.moveDown();

          doc.fontSize(14).text("Items:", { underline: true });
          items.forEach((item, idx) => {
            doc
              .fontSize(12)
              .text(
                `${idx + 1}. ${item.item_name} - ${item.quantity} ${item.unit || ""}`,
              );
            if (item.description) {
              doc.text(`   Description: ${item.description}`);
            }
          });
        });
      },
    );

    const dispositionType =
      req.query.disposition === "attachment" ? "attachment" : "inline";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${dispositionType}; filename=${type.toUpperCase()}_${id}.pdf`,
    );
    res.setHeader("Content-Length", pdf.length);
    res.end(pdf);
  } catch (err) {
    console.error("Failed to generate RFX:", err);
    next(
      err.statusCode || err.status
        ? err
        : createHttpError(500, "Failed to generate document"),
    );
  }
};

module.exports = { generateRfx };
