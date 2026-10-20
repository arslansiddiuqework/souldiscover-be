/**
 * Vercel serverless entry — re-exports the Express app.
 * All HTTP routes are handled by the Express router in dist/index.js.
 */
module.exports = require("../dist/index.js");
