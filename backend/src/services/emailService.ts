/**
 * Email Service
 *
 * Handles sending transactional emails using SendGrid.
 * Falls back to logging emails in development when SendGrid is not configured.
 *
 * Supported email types:
 * - Email verification (after registration)
 * - Password reset
 * - Resend verification
 *
 * @module services/emailService
 */

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// SendGrid types (lazy loaded to avoid errors if not installed)
interface SendGridMailData {
  to: string;
  from: { email: string; name: string };
  subject: string;
  text: string;
  html: string;
}

// Lazy-loaded SendGrid client
let sgMail: { setApiKey: (key: string) => void; send: (msg: SendGridMailData) => Promise<unknown> } | null = null;

/**
 * Initialize SendGrid client
 */
async function getSendGridClient() {
  if (!sgMail && config.email.enabled) {
    try {
      const sendgrid = await import('@sendgrid/mail');
      sgMail = sendgrid.default;
      sgMail.setApiKey(config.email.sendgridApiKey);
      logger.info('SendGrid client initialized', { prefix: 'Email' });
    } catch (error) {
      logger.warn('SendGrid package not installed. Emails will be logged only.', { prefix: 'Email' });
      return null;
    }
  }
  return sgMail;
}

// ============================================
// Email Templates
// ============================================

/**
 * Generate email verification email content
 */
function getVerificationEmailContent(verificationUrl: string): { subject: string; text: string; html: string } {
  const subject = 'Verify Your OwnMyHealth Account';

  const text = `
Welcome to OwnMyHealth!

Please verify your email address by clicking the link below:

${verificationUrl}

This link will expire in 24 hours.

If you didn't create an account with OwnMyHealth, you can safely ignore this email.

Best regards,
The OwnMyHealth Team
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin: 0;">OwnMyHealth</h1>
    <p style="color: #6b7280; margin: 5px 0 0 0;">Your Health, Your Data, Your Control</p>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
    <h2 style="margin-top: 0; color: #111827;">Welcome to OwnMyHealth!</h2>
    <p>Thank you for signing up. Please verify your email address to get started.</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${verificationUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600;">
        Verify Email Address
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      This link will expire in <strong>24 hours</strong>.
    </p>

    <p style="color: #6b7280; font-size: 14px;">
      If the button doesn't work, copy and paste this URL into your browser:
    </p>
    <p style="word-break: break-all; font-size: 13px; color: #2563eb;">
      ${verificationUrl}
    </p>
  </div>

  <div style="text-align: center; color: #9ca3af; font-size: 12px;">
    <p>If you didn't create an account with OwnMyHealth, you can safely ignore this email.</p>
    <p>&copy; ${new Date().getFullYear()} OwnMyHealth. All rights reserved.</p>
  </div>
</body>
</html>
  `.trim();

  return { subject, text, html };
}

/**
 * Generate password reset email content
 */
function getPasswordResetEmailContent(resetUrl: string): { subject: string; text: string; html: string } {
  const subject = 'Reset Your OwnMyHealth Password';

  const text = `
Password Reset Request

You requested to reset your password for your OwnMyHealth account.

Click the link below to reset your password:

${resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

Best regards,
The OwnMyHealth Team
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin: 0;">OwnMyHealth</h1>
    <p style="color: #6b7280; margin: 5px 0 0 0;">Your Health, Your Data, Your Control</p>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
    <h2 style="margin-top: 0; color: #111827;">Password Reset Request</h2>
    <p>You requested to reset your password for your OwnMyHealth account.</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600;">
        Reset Password
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      This link will expire in <strong>1 hour</strong>.
    </p>

    <p style="color: #6b7280; font-size: 14px;">
      If the button doesn't work, copy and paste this URL into your browser:
    </p>
    <p style="word-break: break-all; font-size: 13px; color: #dc2626;">
      ${resetUrl}
    </p>
  </div>

  <div style="background: #fef2f2; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
    <p style="margin: 0; color: #991b1b; font-size: 14px;">
      <strong>Didn't request this?</strong> If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
    </p>
  </div>

  <div style="text-align: center; color: #9ca3af; font-size: 12px;">
    <p>&copy; ${new Date().getFullYear()} OwnMyHealth. All rights reserved.</p>
  </div>
</body>
</html>
  `.trim();

  return { subject, text, html };
}

// ============================================
// Email Sending Functions
// ============================================

/**
 * Send an email using SendGrid
 * Falls back to logging if SendGrid is not configured
 */
async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  // If email is not enabled, log and return success (development mode)
  if (!config.email.enabled) {
    logger.devBox(`EMAIL (NOT SENT - No SendGrid key)`, [
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content: ${text.substring(0, 200)}...`,
    ]);
    return { success: true };
  }

  try {
    const client = await getSendGridClient();
    if (!client) {
      logger.warn(`Email not sent (SendGrid unavailable): ${subject} to ${to}`, { prefix: 'Email' });
      return { success: true }; // Don't fail the operation
    }

    const msg: SendGridMailData = {
      to,
      from: {
        email: config.email.fromEmail,
        name: config.email.fromName,
      },
      subject,
      text,
      html,
    };

    await client.send(msg);
    logger.info(`Email sent: ${subject} to ${to}`, { prefix: 'Email' });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to send email: ${errorMessage}`, { prefix: 'Email', data: { to, subject } });
    return { success: false, error: errorMessage };
  }
}

/**
 * Send email verification email
 */
export async function sendVerificationEmail(
  email: string,
  verificationToken: string
): Promise<{ success: boolean; error?: string }> {
  const verificationUrl = `${config.email.frontendUrl}/verify-email?token=${verificationToken}`;
  const { subject, text, html } = getVerificationEmailContent(verificationUrl);

  // Always log in development for debugging
  if (config.isDevelopment) {
    logger.devBox('EMAIL VERIFICATION', [
      `To: ${email}`,
      `Verification URL: ${verificationUrl}`,
      'Token expires in 24 hours',
    ]);
  }

  return sendEmail(email, subject, text, html);
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  resetToken: string
): Promise<{ success: boolean; error?: string }> {
  const resetUrl = `${config.email.frontendUrl}/reset-password?token=${resetToken}`;
  const { subject, text, html } = getPasswordResetEmailContent(resetUrl);

  // Always log in development for debugging
  if (config.isDevelopment) {
    logger.devBox('PASSWORD RESET EMAIL', [
      `To: ${email}`,
      `Reset URL: ${resetUrl}`,
      'Token expires in 1 hour',
    ]);
  }

  return sendEmail(email, subject, text, html);
}

// ============================================
// Export
// ============================================

export const emailService = {
  sendVerificationEmail,
  sendPasswordResetEmail,
};

export default emailService;
