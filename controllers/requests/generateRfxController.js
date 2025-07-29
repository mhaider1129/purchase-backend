const pool = require('../../config/db');
const PDFDocument = require('pdfkit');
const createHttpError = require('../../utils/httpError');

const generateRfx = async (req, res, next) => {
  const { id } = req.params;
  const type = (req.query.type || 'rfq').toLowerCase();
  const allowedTypes = ['rfp', 'rfi', 'rfq'];

  if (!allowedTypes.includes(type)) {
    return next(createHttpError(400, 'Invalid document type'));
  }

  const allowedRoles = ['ProcurementSupervisor', 'ProcurementSpecialist', 'SCM'];
  if (!allowedRoles.includes(req.user.role)) {
    return next(createHttpError(403, 'Unauthorized to generate document'));
  }

  try {
    const requestRes = await pool.query(
      `SELECT r.*, d.name AS department_name, u.name AS requester_name
       FROM requests r
       JOIN departments d ON r.department_id = d.id
       JOIN users u ON r.requester_id = u.id
       WHERE r.id = $1`,
      [id]
    );

    if (requestRes.rowCount === 0) {
      return next(createHttpError(404, 'Request not found'));
    }

    const request = requestRes.rows[0];
    const itemsRes = await pool.query(
      `SELECT item_name, quantity, unit, description
       FROM requested_items
       WHERE request_id = $1`,
      [id]
    );

    const items = itemsRes.rows;
    const doc = new PDFDocument();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${type.toUpperCase()}_${id}.pdf`
    );

    doc.pipe(res);

    const titleMap = { rfp: 'Request for Proposal', rfi: 'Request for Information', rfq: 'Request for Quotation' };
    doc.fontSize(18).text(titleMap[type], { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Request ID: ${request.id}`);
    doc.text(`Department: ${request.department_name}`);
    doc.text(`Requester: ${request.requester_name}`);
    doc.text(`Justification: ${request.justification}`);
    doc.moveDown();

    doc.fontSize(14).text('Items:', { underline: true });
    items.forEach((item, idx) => {
      doc.fontSize(12).text(`${idx + 1}. ${item.item_name} - ${item.quantity} ${item.unit || ''}`);
      if (item.description) {
        doc.text(`   Description: ${item.description}`);
      }
    });

    doc.end();
  } catch (err) {
    console.error('Failed to generate RFX:', err);
    next(createHttpError(500, 'Failed to generate document'));
  }
};

module.exports = { generateRfx };