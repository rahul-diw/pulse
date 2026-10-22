export const config = {
  port: +(process.env.PORT || 4000), mongoUri: process.env.MONGO_URI || '', jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  aiUrl: process.env.AI_URL || 'http://localhost:8000', corsOrigin: process.env.CORS_ORIGIN || '*',
  bcryptCost: process.env.NODE_ENV === 'test' ? 4 : 10, seedDemo: process.env.SEED_DEMO !== 'false',
};
