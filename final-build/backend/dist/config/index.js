"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cookieNames = exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
// Load the repository-level .env first (local development), then a backend-local
// .env if present. Container deployments inject environment variables directly.
dotenv_1.default.config({ path: process.env.ENV_FILE || node_path_1.default.resolve(process.cwd(), '..', '.env') });
dotenv_1.default.config();
const booleanString = zod_1.z
    .union([zod_1.z.boolean(), zod_1.z.string()])
    .transform((value) => (typeof value === 'boolean' ? value : value.toLowerCase() === 'true'));
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: zod_1.z.coerce
        .number()
        .int()
        .positive()
        .default(Number(process.env.PORT) || 4000),
    FRONTEND_ORIGIN: zod_1.z.string().url().default('http://localhost:5173'),
    ADDITIONAL_ORIGINS: zod_1.z.string().optional(),
    API_PUBLIC_URL: zod_1.z.string().url().optional(),
    SERVE_FRONTEND: booleanString.default(false),
    FRONTEND_DIST: zod_1.z.string().optional(),
    DATABASE_URL: zod_1.z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_ADMIN_URL: zod_1.z.string().optional(),
    DB_SSL_MODE: zod_1.z.enum(['disable', 'require', 'verify-full']).default('disable'),
    DB_SSL_CA: zod_1.z.string().optional(),
    DB_SSL_SERVERNAME: zod_1.z.string().default('db'),
    DB_POOL_MAX: zod_1.z.coerce.number().int().min(1).max(50).default(15),
    JWT_ACCESS_SECRET: zod_1.z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    COOKIE_SECRET: zod_1.z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
    MFA_ENCRYPTION_KEY: zod_1.z.string().regex(/^[a-fA-F0-9]{64}$/, 'MFA_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
    CHALLENGE_SECRET: zod_1.z.string().min(32, 'CHALLENGE_SECRET must be at least 32 characters'),
    WEBHOOK_SECRET: zod_1.z.string().min(32, 'WEBHOOK_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: zod_1.z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: zod_1.z.coerce.number().int().min(1).max(30).default(7),
    COOKIE_SECURE: booleanString.default(false),
    TRUST_PROXY: zod_1.z.coerce.number().int().min(0).max(5).default(1),
    EXPOSE_RESET_TOKEN: booleanString.default(false),
    LOG_LEVEL: zod_1.z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SEED_SUPER_ADMIN_EMAIL: zod_1.z.string().email().default('superadmin@ssims.edu'),
    SEED_SUPER_ADMIN_PASSWORD: zod_1.z.string().min(12).optional(),
    SEED_ADMIN_EMAIL: zod_1.z.string().email().default('admin@ssims.edu'),
    SEED_ADMIN_PASSWORD: zod_1.z.string().min(12).optional(),
    SEED_LECTURER_EMAIL: zod_1.z.string().email().default('lecturer@ssims.edu'),
    SEED_LECTURER_PASSWORD: zod_1.z.string().min(12).optional(),
    SEED_STUDENT_EMAIL: zod_1.z.string().email().default('student@ssims.edu'),
    SEED_STUDENT_PASSWORD: zod_1.z.string().min(12).optional(),
    SEED_LAB_EMAIL: zod_1.z.string().email().default('security.lab@ssims.edu'),
    SEED_LAB_PASSWORD: zod_1.z.string().min(12).optional(),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
    // Fail closed: never start with weak or missing cryptographic configuration.
    console.error(`SSIMS environment validation failed:\n${details}`);
    process.exit(1);
}
const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';
if (isProduction && !raw.COOKIE_SECURE) {
    console.error('COOKIE_SECURE must be true in production.');
    process.exit(1);
}
if (isProduction && raw.EXPOSE_RESET_TOKEN) {
    console.error('EXPOSE_RESET_TOKEN must be false in production.');
    process.exit(1);
}
if (isProduction && raw.DB_SSL_MODE === 'disable') {
    console.error('DB_SSL_MODE cannot be disable in production.');
    process.exit(1);
}
exports.config = {
    nodeEnv: raw.NODE_ENV,
    isProduction,
    port: raw.API_PORT,
    frontendOrigin: raw.FRONTEND_ORIGIN,
    allowedOrigins: [
        raw.FRONTEND_ORIGIN,
        ...(raw.ADDITIONAL_ORIGINS || '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
    ],
    apiPublicUrl: raw.API_PUBLIC_URL || raw.FRONTEND_ORIGIN,
    internalApiUrl: process.env.INTERNAL_API_URL || `http://127.0.0.1:${raw.API_PORT}`,
    serveFrontend: raw.SERVE_FRONTEND,
    frontendDist: raw.FRONTEND_DIST || node_path_1.default.resolve(process.cwd(), 'public'),
    databaseUrl: raw.DATABASE_URL,
    databaseAdminUrl: raw.DATABASE_ADMIN_URL,
    dbSslMode: raw.DB_SSL_MODE,
    dbSslCa: raw.DB_SSL_CA,
    dbSslServerName: raw.DB_SSL_SERVERNAME,
    dbPoolMax: raw.DB_POOL_MAX,
    jwtAccessSecret: raw.JWT_ACCESS_SECRET,
    cookieSecret: raw.COOKIE_SECRET,
    mfaEncryptionKey: Buffer.from(raw.MFA_ENCRYPTION_KEY, 'hex'),
    challengeSecret: raw.CHALLENGE_SECRET,
    webhookSecret: raw.WEBHOOK_SECRET,
    accessTokenTtlSeconds: raw.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: raw.REFRESH_TOKEN_TTL_DAYS,
    cookieSecure: raw.COOKIE_SECURE,
    trustProxy: raw.TRUST_PROXY,
    exposeResetToken: raw.EXPOSE_RESET_TOKEN,
    logLevel: raw.LOG_LEVEL,
    seed: {
        superAdminEmail: raw.SEED_SUPER_ADMIN_EMAIL,
        superAdminPassword: raw.SEED_SUPER_ADMIN_PASSWORD,
        adminEmail: raw.SEED_ADMIN_EMAIL,
        adminPassword: raw.SEED_ADMIN_PASSWORD,
        lecturerEmail: raw.SEED_LECTURER_EMAIL,
        lecturerPassword: raw.SEED_LECTURER_PASSWORD,
        studentEmail: raw.SEED_STUDENT_EMAIL,
        studentPassword: raw.SEED_STUDENT_PASSWORD,
        labEmail: raw.SEED_LAB_EMAIL,
        labPassword: raw.SEED_LAB_PASSWORD,
    },
};
exports.cookieNames = {
    refresh: 'ssims_rt',
    csrf: 'ssims_csrf',
};
//# sourceMappingURL=index.js.map