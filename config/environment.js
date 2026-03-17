const ENV_PROFILES = {
  base: {
    required: ['DATABASE_URL', 'JWT_SECRET'],
    recommended: ['CORS_ALLOWED_ORIGINS'],
  },
  development: {
    required: [],
    recommended: ['FRONTEND_URL', 'APP_CONFIG_VERSION'],
  },
  test: {
    required: ['DATABASE_URL', 'JWT_SECRET'],
    recommended: [],
  },
  production: {
    required: ['FRONTEND_URL', 'CORS_ALLOWED_ORIGINS', 'APP_CONFIG_VERSION'],
    recommended: ['SECRET_ROTATION_INTERVAL_DAYS', 'SECRET_ROTATION_LAST_COMPLETED_AT'],
  },
};

const buildProfile = (nodeEnv) => {
  const env = nodeEnv || 'development';
  const envProfile = ENV_PROFILES[env] || {};

  const required = Array.from(new Set([...(ENV_PROFILES.base.required || []), ...(envProfile.required || [])]));
  const recommended = Array.from(
    new Set([...(ENV_PROFILES.base.recommended || []), ...(envProfile.recommended || [])])
  );

  return { env, required, recommended };
};

const loadEnvironmentConfig = () => {
  const { env, required, recommended } = buildProfile(process.env.NODE_ENV);

  const missingRequired = required.filter((key) => !process.env[key]);
  const missingRecommended = recommended.filter((key) => !process.env[key]);

  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required ${env} environment variables: ${missingRequired.join(', ')}`
    );
  }

  if (missingRecommended.length > 0) {
    console.warn(
      `⚠️ Missing recommended ${env} environment variables: ${missingRecommended.join(', ')}`
    );
  }

  return {
    nodeEnv: env,
    appConfigVersion: process.env.APP_CONFIG_VERSION || 'unversioned',
    secretRotation: {
      intervalDays: Number.parseInt(process.env.SECRET_ROTATION_INTERVAL_DAYS || '90', 10),
      lastCompletedAt: process.env.SECRET_ROTATION_LAST_COMPLETED_AT || null,
    },
  };
};

module.exports = {
  ENV_PROFILES,
  loadEnvironmentConfig,
};