'use strict';

class InventoryError extends Error {
  constructor(code, message, statusCode = 400, details = null) {
    super(message);
    this.name = 'InventoryError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = InventoryError;