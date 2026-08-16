export function loadConfig(env = process.env) {
  const hunyuanImageApiKey = env.HUNYUAN_IMAGE_API_KEY ?? env.TENCENT_TOKENHUB_API_KEY ?? null;
  const voxelOnly = env.MAGICTOWN_VOXEL_ONLY === "1";
  return {
    host: env.MAGICTOWN_HOST ?? "127.0.0.1",
    port: Number(env.MAGICTOWN_PORT ?? 4183),
    databaseUrl: env.MAGICTOWN_DATABASE_URL ?? "postgres://127.0.0.1:5432/magictown",
    publicBaseUrl: env.MAGICTOWN_PUBLIC_BASE_URL ?? `http://${env.MAGICTOWN_HOST ?? "127.0.0.1"}:${env.MAGICTOWN_PORT ?? 4183}`,
    voxelOnly,
    assetProvider: voxelOnly ? "voxel" : env.MAGICTOWN_ASSET_PROVIDER ?? (hunyuanImageApiKey ? "hunyuan-image" : env.DASHSCOPE_API_KEY ? "qwen-image" : "codex-manual"),
    hunyuanImageApiKey,
    hunyuanImageModel: env.HUNYUAN_IMAGE_MODEL ?? "hy-image-v3.0",
    hunyuanImageResolution: env.HUNYUAN_IMAGE_RESOLUTION ?? "1024:1024",
    hunyuanSubmitUrl: env.HUNYUAN_IMAGE_SUBMIT_URL ?? "https://tokenhub.tencentmaas.com/v1/api/image/submit",
    hunyuanQueryUrl: env.HUNYUAN_IMAGE_QUERY_URL ?? "https://tokenhub.tencentmaas.com/v1/api/image/query",
    hunyuanPollMs: Number(env.HUNYUAN_IMAGE_POLL_MS ?? 5000),
    hunyuanTimeoutMs: Number(env.HUNYUAN_IMAGE_TIMEOUT_MS ?? 600000),
    hunyuanMinimumPairIou: Number(env.HUNYUAN_MINIMUM_PAIR_IOU ?? 0.97),
    hunyuanMinimumLightPixels: Number(env.HUNYUAN_MINIMUM_LIGHT_PIXELS ?? 40),
    hunyuanMaximumAnchorError: Number(env.HUNYUAN_MAXIMUM_ANCHOR_ERROR ?? 0.045),
    hunyuanMaximumEnvelopeOverflow: Number(env.HUNYUAN_MAXIMUM_ENVELOPE_OVERFLOW ?? 0.12),
    hunyuanSkipAnchorNormalization: env.HUNYUAN_SKIP_ANCHOR_NORMALIZATION === "1",
    hunyuanStyleReferencePath: env.HUNYUAN_STYLE_REFERENCE_PATH ?? null,
    hunyuanPythonPath: env.HUNYUAN_PYTHON_PATH ?? null,
    dashscopeApiKey: env.DASHSCOPE_API_KEY ?? null,
    dashscopeBaseUrl: env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/api/v1",
    dashscopeImageModel: env.DASHSCOPE_IMAGE_MODEL ?? "qwen-image-2.0",
    dashscopeImageSize: env.DASHSCOPE_IMAGE_SIZE ?? "1024*1024",
    dashscopeStyleReferenceEnabled: env.DASHSCOPE_STYLE_REFERENCE_ENABLED === "1",
    assetOutputRoot: env.MAGICTOWN_ASSET_OUTPUT_ROOT ?? null,
    capabilityTtlMinutes: Number(env.MAGICTOWN_CAPABILITY_TTL_MINUTES ?? 30),
    credentialTtlDays: Number(env.MAGICTOWN_CREDENTIAL_TTL_DAYS ?? 90),
    workerPollMs: Number(env.MAGICTOWN_WORKER_POLL_MS ?? 1000),
    turnIntervalMs: Number(env.MAGICTOWN_TURN_INTERVAL_MS ?? 86_400_000),
    turnDeadlineMs: Number(env.MAGICTOWN_TURN_DEADLINE_MS ?? 86_400_000),
    turnSchedulerPollMs: Number(env.MAGICTOWN_TURN_SCHEDULER_POLL_MS ?? 1000),
    autoMigrate: env.MAGICTOWN_AUTO_MIGRATE !== "0"
  };
}
