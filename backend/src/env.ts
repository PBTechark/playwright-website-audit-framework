import path from 'path';
import dotenv from 'dotenv';

// The backend runs from backend/, so load the engine's .env explicitly before
// config/auditConfig.ts is imported (it reads process.env at import time).
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
