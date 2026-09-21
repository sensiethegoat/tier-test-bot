// Imported first so .env is loaded before any other module reads process.env
// (hosting panels often run `node src/index.js` directly instead of `npm start`).
try {
  process.loadEnvFile?.();
} catch {
  // No .env file: rely on the host's environment variables.
}
