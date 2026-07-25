export function loadConfig(env = process.env) {
  return {
    host: env.MAGICTOWN_HOST ?? "127.0.0.1",
    port: Number(env.MAGICTOWN_PORT ?? 4183),
    databaseUrl: env.MAGICTOWN_DATABASE_URL ?? "postgres://127.0.0.1:5432/magictown",
    publicBaseUrl: env.MAGICTOWN_PUBLIC_BASE_URL ?? `http://${env.MAGICTOWN_HOST ?? "127.0.0.1"}:${env.MAGICTOWN_PORT ?? 4183}`,
    assetProvider: env.MAGICTOWN_ASSET_PROVIDER ?? (env.DASHSCOPE_API_KEY ? "qwen-image" : "codex-manual"),
    dashscopeApiKey: env.DASHSCOPE_API_KEY ?? null,
    dashscopeBaseUrl: env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/api/v1",
    dashscopeImageModel: env.DASHSCOPE_IMAGE_MODEL ?? "qwen-image-2.0",
    dashscopeImageSize: env.DASHSCOPE_IMAGE_SIZE ?? "1024*1024",
    assetOutputRoot: env.MAGICTOWN_ASSET_OUTPUT_ROOT ?? null,
    capabilityTtlMinutes: Number(env.MAGICTOWN_CAPABILITY_TTL_MINUTES ?? 30),
    credentialTtlDays: Number(env.MAGICTOWN_CREDENTIAL_TTL_DAYS ?? 90),
    workerPollMs: Number(env.MAGICTOWN_WORKER_POLL_MS ?? 1000),
    autoMigrate: env.MAGICTOWN_AUTO_MIGRATE !== "0"
  };
}
