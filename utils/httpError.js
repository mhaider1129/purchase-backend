/**
 * Create an Error object with an attached HTTP status code.
 * @param {number} statusCode - HTTP status code to attach
 * @param {string} message - Error message
 * @returns {Error}
 */
function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

module.exports = createHttpError;