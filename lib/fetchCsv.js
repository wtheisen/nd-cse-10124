const DEFAULT_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 20000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCsv(url, options = {}) {
  const attempts = options.attempts || DEFAULT_ATTEMPTS;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'nd-cse-site-bot/1.0' },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      let text = await response.text();
      if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
      }
      return text;
    } catch (err) {
      lastError = err.name === 'AbortError'
        ? new Error(`request timed out after ${timeoutMs}ms`)
        : err;

      if (attempt < attempts) {
        const waitMs = 500 * (2 ** (attempt - 1));
        console.warn(`[11ty] CSV fetch attempt ${attempt}/${attempts} failed (${lastError.message}); retrying in ${waitMs}ms`);
        await delay(waitMs);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`CSV fetch failed after ${attempts} attempts: ${lastError.message}`);
}

module.exports = fetchCsv;
