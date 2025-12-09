/**
 * Email Service
 *
 * Handles transactional emails for OwnMyHealth:
 * - Email verification
 * - Password reset
 * - (Future) Notifications, reminders
 *
 * Supports SendGrid as the email provider.
 * Falls back to logging in development mode.
 */

import { logger } from '../utils/logger.js';

// Email configuration from environment
const EMAIL_CONFIG = {
  sendgridApiKey: process.env.SENDGRID_API_KEY || '',
  fromEmail: process.env.FROM_EMAIL || 'noreply@ownmyhealth.io',
  fromName: process.env.FROM_NAME || 'OwnMyHealth',
  appUrl: process.env.APP_URL || 'https://ownmyhealth.io',
  enabled: process.env.EMAIL_ENABLED === 'true',
};

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SendGridError {
  response?: {
    body?: {
      errors?: Array<{ message: string }>;
    };
  };
}

/**
 * Send an email using SendGrid
 */
async function sendWithSendGrid(options: EmailOptions): Promise<boolean> {
  const { sendgridApiKey, fromEmail, fromName } = EMAIL_CONFIG;

  if (!sendgridApiKey) {
    logger.warn('SendGrid API key not configured');
    return false;
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: options.to }] }],
        from: { email: fromEmail, name: fromName },
        subject: options.subject,
        content: [
          { type: 'text/html', value: options.html },
          ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json() as SendGridError;
      logger.error('SendGrid API error', {
        status: response.status,
        errors: error?.response?.body?.errors,
      });
      return false;
    }

    logger.info('Email sent successfully', { to: options.to, subject: options.subject });
    return true;
  } catch (error) {
    logger.error('Failed to send email', { error, to: options.to });
    return false;
  }
}

/**
 * Log email to console (development fallback)
 */
function logEmailToConsole(options: EmailOptions): void {
  logger.devBox('📧 EMAIL (NOT SENT - Dev Mode)', [
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    '---',
    options.text || 'See HTML content',
  ]);
}

/**
 * Send an email (uses SendGrid in production, logs in development)
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  // In development without email enabled, just log
  if (!EMAIL_CONFIG.enabled || process.env.NODE_ENV === 'development') {
    logEmailToConsole(options);
    return true; // Return success for dev flow
  }

  return sendWithSendGrid(options);
}

/**
 * Send email verification email
 */
export async function sendVerificationEmail(
  email: string,
  token: string
): Promise<boolean> {
  const verificationUrl = `${EMAIL_CONFIG.appUrl}/verify-email?token=${token}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🏥 OwnMyHealth</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1f2937; margin-top: 0;">Verify Your Email Address</h2>

    <p>Thanks for signing up for OwnMyHealth! Please verify your email address by clicking the button below:</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${verificationUrl}"
         style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 14px 28px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                display: inline-block;">
        Verify Email Address
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      Or copy and paste this link into your browser:<br>
      <a href="${verificationUrl}" style="color: #667eea; word-break: break-all;">${verificationUrl}</a>
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

    <p style="color: #9ca3af; font-size: 12px;">
      This link expires in 24 hours. If you didn't create an account with OwnMyHealth, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
`;

  const text = `
Verify Your Email Address

Thanks for signing up for OwnMyHealth! Please verify your email address by clicking the link below:

${verificationUrl}

This link expires in 24 hours.

If you didn't create an account with OwnMyHealth, you can safely ignore this email.
`;

  return sendEmail({
    to: email,
    subject: 'Verify your OwnMyHealth account',
    html,
    text,
  });
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<boolean> {
  const resetUrl = `${EMAIL_CONFIG.appUrl}/reset-password?token=${token}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🏥 OwnMyHealth</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1f2937; margin-top: 0;">Reset Your Password</h2>

    <p>We received a request to reset your password. Click the button below to create a new password:</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetUrl}"
         style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 14px 28px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                display: inline-block;">
        Reset Password
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      Or copy and paste this link into your browser:<br>
      <a href="${resetUrl}" style="color: #667eea; word-break: break-all;">${resetUrl}</a>
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

    <p style="color: #9ca3af; font-size: 12px;">
      This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
    </p>
  </div>
</body>
</html>
`;

  const text = `
Reset Your Password

We received a request to reset your password. Click the link below to create a new password:

${resetUrl}

This link expires in 1 hour.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
`;

  return sendEmail({
    to: email,
    subject: 'Reset your OwnMyHealth password',
    html,
    text,
  });
}

/**
 * Send welcome email after verification
 */
export async function sendWelcomeEmail(email: string): Promise<boolean> {
  const loginUrl = `${EMAIL_CONFIG.appUrl}/login`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to OwnMyHealth</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🏥 OwnMyHealth</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1f2937; margin-top: 0;">Welcome to OwnMyHealth! 🎉</h2>

    <p>Your email has been verified. You're all set to start managing your health data!</p>

    <h3 style="color: #374151;">Get Started:</h3>
    <ul style="color: #4b5563;">
      <li><strong>Track Biomarkers</strong> - Upload lab reports or manually enter health data</li>
      <li><strong>DNA Insights</strong> - Import your 23andMe or AncestryDNA data</li>
      <li><strong>Insurance Navigation</strong> - Upload your insurance documents to understand coverage</li>
      <li><strong>Health Goals</strong> - Set and track personalized health goals</li>
    </ul>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${loginUrl}"
         style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 14px 28px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                display: inline-block;">
        Log In to Your Account
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

    <p style="color: #9ca3af; font-size: 12px;">
      Questions? Reply to this email or visit our help center.
    </p>
  </div>
</body>
</html>
`;

  const text = `
Welcome to OwnMyHealth!

Your email has been verified. You're all set to start managing your health data!

Get Started:
- Track Biomarkers: Upload lab reports or manually enter health data
- DNA Insights: Import your 23andMe or AncestryDNA data
- Insurance Navigation: Upload your insurance documents to understand coverage
- Health Goals: Set and track personalized health goals

Log in at: ${loginUrl}

Questions? Reply to this email or visit our help center.
`;

  return sendEmail({
    to: email,
    subject: 'Welcome to OwnMyHealth!',
    html,
    text,
  });
}

/**
 * Check if email service is properly configured
 */
export function isEmailConfigured(): boolean {
  return EMAIL_CONFIG.enabled && !!EMAIL_CONFIG.sendgridApiKey;
}

export default {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  isEmailConfigured,
};
