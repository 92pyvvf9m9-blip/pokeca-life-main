/**
 * Multi-AI validation connector.
 *
 * It is disabled unless endpoints and API keys are configured.
 * Each endpoint must accept:
 *   { task: "validate_lottery", candidate: {...} }
 * and return:
 *   { valid, corrections, confidence, reason }
 *
 * This keeps the collector independent of provider-specific API changes.
 */
const providers = [
  {
    name: "ChatGPT",
    endpoint: process.env.OPENAI_VALIDATOR_ENDPOINT,
    key: process.env.OPENAI_API_KEY,
  },
  {
    name: "Gemini",
    endpoint: process.env.GEMINI_VALIDATOR_ENDPOINT,
    key: process.env.GEMINI_API_KEY,
  },
  {
    name: "Grok",
    endpoint: process.env.XAI_VALIDATOR_ENDPOINT,
    key: process.env.XAI_API_KEY,
  },
].filter((provider) => provider.endpoint && provider.key);

async function callProvider(provider, candidate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(provider.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify({
        task: "validate_lottery",
        candidate,
      }),
    });
    if (!response.ok) throw new Error(`${provider.name}: HTTP ${response.status}`);
    return { provider: provider.name, ...(await response.json()) };
  } finally {
    clearTimeout(timer);
  }
}

export async function validateWithAI(candidate) {
  if (!providers.length) {
    return {
      enabled: false,
      candidate,
      reviews: [],
    };
  }

  const reviews = await Promise.allSettled(
    providers.map((provider) => callProvider(provider, candidate))
  );
  const successful = reviews
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  const accepted = successful.filter((review) => review.valid !== false);
  const confidence = accepted.length
    ? accepted.reduce((sum, review) => sum + Number(review.confidence || 0), 0) / accepted.length
    : 0;

  return {
    enabled: true,
    candidate,
    reviews: successful,
    accepted: accepted.length >= Math.ceil(successful.length / 2),
    confidence,
  };
}
