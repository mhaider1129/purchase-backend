class ItemMasterRepository {
  constructor(client) { this.client = client; }
  async findGeneric(id) {
    const result = await this.client.query(`SELECT gi.*, c.name AS category_name
      FROM generic_items gi LEFT JOIN item_categories c ON c.id = gi.category_id
      WHERE gi.id = $1 FOR SHARE`, [id]);
    return result.rows[0] || null;
  }
  async findUom(id) {
    const result = await this.client.query('SELECT * FROM item_uom WHERE id = $1 AND is_active = true FOR SHARE', [id]);
    return result.rows[0] || null;
  }
  async findProduct(id) {
    const result = await this.client.query(`SELECT ap.*, m.name AS manufacturer_name, u.name AS product_uom_name
      FROM approved_products ap
      LEFT JOIN item_manufacturers m ON m.id = ap.manufacturer_id
      LEFT JOIN item_uom u ON u.id = ap.uom_id
      WHERE ap.id = $1 FOR SHARE`, [id]);
    return result.rows[0] || null;
  }
}
module.exports = ItemMasterRepository;