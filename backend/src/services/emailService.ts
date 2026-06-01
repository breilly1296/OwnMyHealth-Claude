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

// SendGrid types (lazy loaded to avoid errors if not installed).
// mailSettings.sandboxMode is SendGrid's "validate but don't send" hook —
// used by staging so notification flows fire without spamming real inboxes.
interface SendGridMailData {
  to: string;
  from: { email: string; name: string };
  subject: string;
  text: string;
  html: string;
  mailSettings?: {
    sandboxMode?: { enable: boolean };
  };
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
      // Set 10s request timeout for SendGrid API calls
      (sgMail as unknown as { setTimeout?: (ms: number) => void }).setTimeout?.(10_000);
      logger.info('SendGrid client initialized', { prefix: 'Email' });
    } catch {
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

/**
 * Generate the "account already exists" notice. Sent when someone attempts to
 * register with an email that already has an account. The registration API
 * returns the SAME generic response whether or not the email exists (account
 * enumeration #18), so this email is how the real owner finds out — and how a
 * recipient who didn't try to register learns no new account was created.
 */
function getAccountExistsEmailContent(loginUrl: string): { subject: string; text: string; html: string } {
  const subject = 'You already have an OwnMyHealth account';

  const text = `
Someone just tried to create an OwnMyHealth account with this email address.

Good news — you already have an account, so there's nothing more to do. Just sign in:

${loginUrl}

If you've forgotten your password, use the "Forgot password?" link on the sign-in page to reset it.

If this wasn't you, you can safely ignore this email. No new account was created and nothing about your existing account has changed.

Best regards,
The OwnMyHealth Team
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You already have an account</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin: 0;">OwnMyHealth</h1>
    <p style="color: #6b7280; margin: 5px 0 0 0;">Your Health, Your Data, Your Control</p>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
    <h2 style="margin-top: 0; color: #111827;">You already have an account</h2>
    <p>Someone just tried to create an OwnMyHealth account with this email address. Good news — you already have one, so there's nothing more to do.</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${loginUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600;">
        Sign in
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      Forgot your password? Use the <strong>Forgot password?</strong> link on the sign-in page to reset it.
    </p>

    <p style="color: #6b7280; font-size: 14px;">
      If the button doesn't work, copy and paste this URL into your browser:
    </p>
    <p style="word-break: break-all; font-size: 13px; color: #2563eb;">
      ${loginUrl}
    </p>
  </div>

  <div style="background: #f0f9ff; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
    <p style="margin: 0; color: #075985; font-size: 14px;">
      <strong>Didn't try to register?</strong> You can safely ignore this email. No new account was created and nothing about your existing account has changed.
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
      // Sandbox mode runs through SendGrid's validation pipeline (templates,
      // recipient format, from-address) but skips actual delivery. Staging
      // turns this on so we can exercise the full notification path without
      // sending to real addresses.
      ...(config.email.sandboxMode && {
        mailSettings: { sandboxMode: { enable: true } },
      }),
    };

    await client.send(msg);
    const deliveryLabel = config.email.sandboxMode ? 'Email validated (sandbox)' : 'Email sent';
    logger.info(`${deliveryLabel}: ${subject} to ${to}`, { prefix: 'Email' });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
      logger.error('Email sending timed out', { prefix: 'Email', data: { to, subject } });
      return { success: false, error: 'Email service timed out. Please try again.' };
    }
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

/**
 * Send the "account already exists" notice (account enumeration #18).
 * The login page is the app root; the reset flow is reached from there via the
 * "Forgot password?" link.
 */
export async function sendAccountExistsEmail(
  email: string
): Promise<{ success: boolean; error?: string }> {
  const loginUrl = config.email.frontendUrl;
  const { subject, text, html } = getAccountExistsEmailContent(loginUrl);

  if (config.isDevelopment) {
    logger.devBox('ACCOUNT EXISTS NOTICE', [
      `To: ${email}`,
      `Login URL: ${loginUrl}`,
      'Sent because a duplicate registration was attempted',
    ]);
  }

  return sendEmail(email, subject, text, html);
}

/**
 * Generic send used by the engagement/notification pipeline.
 *
 * Exposed separately from the typed `sendVerificationEmail` / `sendPasswordResetEmail`
 * helpers because engagement emails need to go through a single dispatcher
 * (notificationService) that resolves the body via `emailTemplates.ts`.
 * The dev-mode logging fallback is reused.
 */
export async function sendGenericEmail(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  return sendEmail(to, subject, text, html);
}

/**
 * Confirmation email sent to the NEW address during an email change. Clicking
 * the link proves the user controls the new inbox and completes the swap.
 * Mirrors the verification-email content (same expiry/copy structure).
 */
function getEmailChangeConfirmContent(
  confirmUrl: string,
  oldEmail: string
): { subject: string; text: string; html: string } {
  const subject = 'Confirm Your New OwnMyHealth Email Address';

  const text = `
Confirm Your New Email Address

A request was made to change the email address on the OwnMyHealth account currently registered to ${oldEmail}.

Click the link below to confirm this new address and complete the change:

${confirmUrl}

This link will expire in 1 hour.

If you didn't request this change, you can safely ignore this email — the account's email address will not be changed.

Best regards,
The OwnMyHealth Team
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Your New Email Address</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin: 0;">OwnMyHealth</h1>
    <p style="color: #6b7280; margin: 5px 0 0 0;">Your Health, Your Data, Your Control</p>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
    <h2 style="margin-top: 0; color: #111827;">Confirm Your New Email Address</h2>
    <p>A request was made to change the email address on the OwnMyHealth account currently registered to <strong>${oldEmail}</strong>.</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${confirmUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600;">
        Confirm New Email
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      This link will expire in <strong>1 hour</strong>.
    </p>

    <p style="color: #6b7280; font-size: 14px;">
      If the button doesn't work, copy and paste this URL into your browser:
    </p>
    <p style="word-break: break-all; font-size: 13px; color: #2563eb;">
      ${confirmUrl}
    </p>
  </div>

  <div style="background: #eff6ff; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
    <p style="margin: 0; color: #1e40af; font-size: 14px;">
      <strong>Didn't request this?</strong> You can safely ignore this email — the account's email address will not be changed.
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

/**
 * Security notice sent to the OLD address when an email change is requested.
 * This is the out-of-band alarm: if the change wasn't authorized by the real
 * owner (e.g. a hijacked session), the original mailbox still gets warned and
 * is pointed at the reset-password flow to reclaim the account.
 */
function getEmailChangeNoticeContent(
  newEmail: string,
  resetUrl: string
): { subject: string; text: string; html: string } {
  const subject = 'Security Notice: Email Change Requested';

  const text = `
Email Change Requested

A request was made to change the email address on your OwnMyHealth account to ${newEmail}.

The change is NOT complete yet — it only takes effect once the new address is confirmed via a link sent to it.

If you requested this, no action is needed.

If you did NOT request this, your account may be compromised. Reset your password immediately:

${resetUrl}

Best regards,
The OwnMyHealth Team
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Change Requested</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin: 0;">OwnMyHealth</h1>
    <p style="color: #6b7280; margin: 5px 0 0 0;">Your Health, Your Data, Your Control</p>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
    <h2 style="margin-top: 0; color: #111827;">Email Change Requested</h2>
    <p>A request was made to change the email address on your OwnMyHealth account to <strong>${newEmail}</strong>.</p>
    <p style="color: #6b7280; font-size: 14px;">
      The change is <strong>not complete yet</strong> — it only takes effect once the new address is confirmed via a link sent to it.
    </p>
    <p style="color: #6b7280; font-size: 14px;">If you requested this, no action is needed.</p>
  </div>

  <div style="background: #fef2f2; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
    <p style="margin: 0 0 10px 0; color: #991b1b; font-size: 14px;">
      <strong>Didn't request this?</strong> Your account may be compromised. Reset your password immediately:
    </p>
    <p style="margin: 0; word-break: break-all; font-size: 13px;">
      <a href="${resetUrl}" style="color: #dc2626;">${resetUrl}</a>
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

/**
 * Send the confirmation link to the NEW email address during an email change.
 */
export async function sendEmailChangeConfirmation(
  newEmail: string,
  oldEmail: string,
  changeToken: string
): Promise<{ success: boolean; error?: string }> {
  const confirmUrl = `${config.email.frontendUrl}/confirm-email-change?token=${changeToken}`;
  const { subject, text, html } = getEmailChangeConfirmContent(confirmUrl, oldEmail);

  if (config.isDevelopment) {
    logger.devBox('EMAIL CHANGE CONFIRMATION', [
      `To (new): ${newEmail}`,
      `Confirm URL: ${confirmUrl}`,
      'Token expires in 1 hour',
    ]);
  }

  return sendEmail(newEmail, subject, text, html);
}

/**
 * Send the out-of-band security notice to the OLD email address.
 */
export async function sendEmailChangeNotice(
  oldEmail: string,
  newEmail: string
): Promise<{ success: boolean; error?: string }> {
  const resetUrl = `${config.email.frontendUrl}/reset-password`;
  const { subject, text, html } = getEmailChangeNoticeContent(newEmail, resetUrl);

  if (config.isDevelopment) {
    logger.devBox('EMAIL CHANGE NOTICE', [
      `To (old): ${oldEmail}`,
      `New address: ${newEmail}`,
      'Sent to warn the original address',
    ]);
  }

  return sendEmail(oldEmail, subject, text, html);
}

// ============================================
// Export
// ============================================

export const emailService = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountExistsEmail,
  send: sendGenericEmail,
};

export default emailService;
