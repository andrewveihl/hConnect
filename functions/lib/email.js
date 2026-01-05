"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const firebase_functions_1 = require("firebase-functions");
const nodemailer_1 = __importDefault(require("nodemailer"));
const firebase_1 = require("./firebase");
const firestore_1 = require("firebase-admin/firestore");
let cachedTransporter = null;
/**
 * Get the "from" address for emails.
 */
function getFromAddress() {
    return process.env.RESEND_FROM || process.env.EMAIL_FROM || 'hConnect <onboarding@resend.dev>';
}
/**
 * Get the Resend API key from environment.
 */
function getResendApiKey() {
    return process.env.RESEND_API_KEY || '';
}
/**
 * Check if Resend API is configured.
 */
function hasResendConfig() {
    const key = getResendApiKey();
    return Boolean(key && key.length > 0);
}
/**
 * Check if SMTP is configured.
 */
function hasSmtpConfig() {
    return Boolean(process.env.EMAIL_SMTP_HOST &&
        process.env.EMAIL_SMTP_USER &&
        process.env.EMAIL_SMTP_PASS);
}
/**
 * Send email using Resend API (simpler, recommended).
 * Get a free API key at https://resend.com
 */
async function sendViaResend(options) {
    const apiKey = getResendApiKey();
    if (!apiKey) {
        return { sent: false, reason: 'resend_not_configured' };
    }
    const from = getFromAddress();
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html
            })
        });
        if (!response.ok) {
            const error = await response.text();
            firebase_functions_1.logger.error('[email] Resend API error', { status: response.status, error });
            return { sent: false, reason: `resend_error_${response.status}` };
        }
        const data = await response.json();
        firebase_functions_1.logger.info('[email] Sent via Resend', { to: options.to, id: data.id });
        return { sent: true, messageId: data.id };
    }
    catch (err) {
        firebase_functions_1.logger.error('[email] Resend request failed', { err });
        return { sent: false, reason: err instanceof Error ? err.message : 'resend_failed' };
    }
}
/**
 * Send email using SMTP (nodemailer).
 */
async function sendViaSmtp(options) {
    if (!cachedTransporter) {
        const host = process.env.EMAIL_SMTP_HOST || '';
        const user = process.env.EMAIL_SMTP_USER || '';
        const pass = process.env.EMAIL_SMTP_PASS || '';
        const portRaw = process.env.EMAIL_SMTP_PORT || '';
        const secureRaw = process.env.EMAIL_SMTP_SECURE || 'true';
        const secure = String(secureRaw).toLowerCase() !== 'false';
        const port = portRaw ? Number(portRaw) : secure ? 465 : 587;
        if (!host || !user || !pass) {
            return { sent: false, reason: 'smtp_not_configured' };
        }
        try {
            cachedTransporter = nodemailer_1.default.createTransport({
                host,
                port,
                secure,
                auth: { user, pass }
            });
        }
        catch (err) {
            firebase_functions_1.logger.error('[email] Failed to create SMTP transporter', err);
            return { sent: false, reason: 'smtp_setup_failed' };
        }
    }
    const from = getFromAddress();
    try {
        const info = await cachedTransporter.sendMail({
            from,
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html ?? undefined
        });
        firebase_functions_1.logger.info('[email] Sent via SMTP', { to: options.to, messageId: info.messageId });
        return { sent: true, messageId: info.messageId };
    }
    catch (err) {
        firebase_functions_1.logger.error('[email] SMTP send failed', { to: options.to, err });
        return { sent: false, reason: err instanceof Error ? err.message : 'smtp_send_failed' };
    }
}
/**
 * Send an email notification.
 * Tries Resend API first (if configured), then falls back to SMTP.
 *
 * Configuration (set in functions/.env file):
 *
 * Option 1 - Resend (recommended, easiest):
 *   RESEND_API_KEY=re_xxxxx  (get free key at https://resend.com)
 *   RESEND_FROM=hConnect <alerts@yourdomain.com>  (optional, uses test address by default)
 *
 * Option 2 - SMTP (Gmail, etc.):
 *   EMAIL_FROM=alerts@yourdomain.com
 *   EMAIL_SMTP_HOST=smtp.gmail.com
 *   EMAIL_SMTP_USER=your-email@gmail.com
 *   EMAIL_SMTP_PASS=your-app-password
 */
async function sendEmail(options) {
    const startTime = Date.now();
    // Log config status
    firebase_functions_1.logger.info('[email] Attempting to send', {
        to: options.to,
        subject: options.subject,
        hasResend: hasResendConfig(),
        hasSmtp: hasSmtpConfig()
    });
    let result;
    // Try Resend first (simpler API)
    if (hasResendConfig()) {
        result = await sendViaResend(options);
    }
    else if (hasSmtpConfig()) {
        // Fall back to SMTP
        result = await sendViaSmtp(options);
    }
    else {
        // No email provider configured
        firebase_functions_1.logger.warn('[email] No email provider configured. Set RESEND_API_KEY or SMTP config in functions/.env');
        result = { sent: false, reason: 'no_email_provider_configured' };
    }
    // Log to Firestore for admin visibility
    try {
        await firebase_1.db.collection('adminLogs').doc('email').collection('notifications').add({
            to: options.to,
            subject: options.subject,
            sent: result.sent,
            reason: result.reason ?? null,
            messageId: result.messageId ?? null,
            provider: hasResendConfig() ? 'resend' : hasSmtpConfig() ? 'smtp' : 'none',
            context: options.context ?? null,
            durationMs: Date.now() - startTime,
            createdAt: firestore_1.FieldValue.serverTimestamp()
        });
    }
    catch (logErr) {
        firebase_functions_1.logger.warn('[email] Failed to log email attempt to Firestore', { logErr });
    }
    return result;
}
//# sourceMappingURL=email.js.map