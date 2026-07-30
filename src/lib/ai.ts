export type AiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  chatCompletionsUrl: string;
};

function requiredEnvironment(name: "AI_API_KEY" | "AI_BASE_URL" | "AI_MODEL") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for AI requests.`);
  }
  return value;
}

export function getOpenAiApiUrl(baseUrl: string, path: string) {
  const clean = baseUrl.replace(/\/$/, "");
  if (clean.endsWith(`/${path}`)) return clean;
  if (clean.endsWith("/v1")) return `${clean}/${path}`;
  return `${clean}/v1/${path}`;
}

export function getOpenAiChatCompletionsUrl(baseUrl: string) {
  return getOpenAiApiUrl(baseUrl, "chat/completions");
}

export function getAiConfig(): AiConfig {
  const apiKey = requiredEnvironment("AI_API_KEY");
  const baseUrl = requiredEnvironment("AI_BASE_URL").replace(/\/$/, "");
  const model = requiredEnvironment("AI_MODEL");

  return {
    apiKey,
    baseUrl,
    model,
    chatCompletionsUrl: getOpenAiChatCompletionsUrl(baseUrl),
  };
}
