/**
 * Firebase Functions Secrets
 * Firebase Functions v7 - using defineSecret from params module
 */
import { defineSecret } from 'firebase-functions/params';

// Define secrets for v7
export const geminiApiKey = defineSecret('GEMINI_API_KEY');
export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
export const intelcomApiKey = defineSecret('INTELCOM_API_KEY');
export const intelcomClientCode = defineSecret('INTELCOM_CLIENT_CODE');
