//utils/responseFormatter.js
/**
 * ✅ Send a standardized success response
 * 
 * @param {Response} res - Express response object
 * @param {string} [message='Success'] - Success message
 * @param {Object} [data={}] - Optional payload
 * @param {number} [status=200] - HTTP status code
 * @returns {Response}
 */
const successResponse = (res, message = 'Success', data = {}, status = 200) => {
  return res.status(status).json({
    success: true,
    message,
    data
  });
};

/**
 * ❌ Send a standardized error response
 * 
 * @param {Response} res - Express response object
 * @param {number} [status=500] - HTTP status code
 * @param {string} [errorMessage='Something went wrong'] - Error message
 * @param {Object|null} [errors=null] - Optional detailed error payload
 * @returns {Response}
 */
const errorResponse = (res, status = 500, errorMessage = 'Something went wrong', errors = null) => {
  const response = {
    success: false,
    message: errorMessage
  };

  if (errors) {
    response.errors = errors;
  }

  return res.status(status).json(response);
};

module.exports = {
  successResponse,
  errorResponse
};
