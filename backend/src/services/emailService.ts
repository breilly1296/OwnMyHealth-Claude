/**
 * Email Service
 *
 * Provides email functionality using SendGrid for:
 * - Email verification
 * - Password reset
 * - Health alerts (future)
 *
 * Setup:
 * 1. Create a SendGrid account at https://sendgrid.com
 * 2. Get your API key from Settings > API Keys
 * 3. Set SENDGRID_API_KEY in your .env file
 * 4. Set FROM_EMAIL to your verified sender email
 *
 * @module services/emailService
 */

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// ============================================
// Configuration
// ============================================

interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  baseUrl: string;
}

function getEmailConfig(): EmailConfig {
  return {
    apiKey: process.env.SENDGRID_API_KEY || '',
    fromEmail: process.env.FROM_EMAIL || 'noreply@ownmyhealth.com',
    fromName: process.env.FROM_NAME || 'OwnMyHealth',
    baseUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  };
}

// ============================================
// Types
// ============================================

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ============================================
// Email Templates
// ============================================

const emailTemplates = {
  /**
   * Email verification template
   */
  verification: (params: { name: string; verificationUrl: string }) => ({
    subject: 'Verify your OwnMyHealth account',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🏥 OwnMyHealth</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1f2937; margin-top: 0;">Verify your email address</h2>
    <p>Hi ${params.name || 'there'},</p>
    <p>Thanks for signing up for OwnMyHealth! Please verify your email address by clicking the button below:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.verificationUrl}" style="background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Verify Email Address</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">This link will expire in 24 hours.</p>
    <p style="color: #6b7280; font-size: 14px;">If you didn't create an account, you can safely ignore this email.</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${params.verificationUrl}" style="color: #667eea; word-break: break-all;">${params.verificationUrl}</a>
    </p>
  </div>
</body>
</html>
    `,
    text: `
Verify your OwnMyHealth account

Hi ${params.name || 'there'},

Thanks for signing up for OwnMyHealth! Please verify your email address by visiting:

${params.verificationUrl}

This link will expire in 24 hours.

If you didn't create an account, you can safely ignore this email.
    `,
  }),

  /**
   * Password reset template
   */
  passwordReset: (params: { name: string; resetUrl: string }) => ({
    subject: 'Reset your OwnMyHealth password',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🏥 OwnMyHealth</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1f2937; margin-top: 0;">Reset your password</h2>
    <p>Hi ${params.name || 'there'},</p>
    <p>We received a request to reset your password. Click the button below to choose a new password:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.resetUrl}" style="background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Reset Password</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">This link will expire in 1 hour.</p>
    <p style="color: #6b7280; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${params.resetUrl}" style="color: #667eea; word-break: break-all;">${params.resetUrl}</a>
    </p>
  </div>
</body>
</html>
    `,
    text: `
Reset your OwnMyHealth password

Hi ${params.name || 'there'},

We received a request to reset your password. Visit the link below to choose a new password:

${params.resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
    `,
  }),

  /**
   * Welcome email after verification
   */
  welcome: (params: { name: string; loginUrl: string }) => ({
    subject: 'Welcome to OwnMyHealth!',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to OwnMyHealth</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🏥 OwnMyHealth</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1f2937; margin-top: 0;">Welcome aboard! 🎉</h2>
    <p>Hi ${params.name || 'there'},</p>
    <p>Your email has been verified and your OwnMyHealth account is ready to use!</p>
    <p>Here's what you can do:</p>
    <ul style="color: #4b5563;">
      <li>📊 Track your biomarkers and lab results</li>
      <li>🧬 Analyze your DNA data for health insights</li>
      <li>🏥 Manage your insurance information</li>
      <li>🎯 Set and track health goals</li>
    </ul>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.loginUrl}" style="background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Get Started</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">If you have any questions, we're here to help!</p>
  </div>
</body>
</html>
    `,
    text: `
Welcome to OwnMyHealth!

Hi ${params.name || 'there'},

Your email has been verified and your OwnMyHealth account is ready to use!

Here's what you can do:
- Track your biomarkers and lab results
- Analyze your DNA data for health insights
- Manage your insurance information
- Set and track health goals

Get started: ${params.loginUrl}

If you have any questions, we're here to help!
    `,
  }),
};

// ============================================
// Core Email Functions
// ============================================

/**
 * Send an email using SendGrid API
 */
async function sendEmail(options: SendEmailOptions): Promise<EmailResult> {
  const emailConfig = getEmailConfig();

  // Check if SendGrid is configured
  if (!emailConfig.apiKey) {
    if (config.isDevelopment) {
      // In development, log the email instead of sending
      logger.info('Email would be sent (SendGrid not configured)', {
        data: {
          to: options.to,
          subject: options.subject,
          preview: options.text?.substring(0, 100) + '...',
        },
      });
      return { success: true, messageId: 'dev-mode-no-send' };
    }
    logger.error('SendGrid API key not configured');
    return { success: false, error: 'Email service not configured' };
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${emailConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: options.to }] }],
        from: {
          email: emailConfig.fromEmail,
          name: emailConfig.fromName,
        },
        subject: options.subject,
        content: [
          ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
          { type: 'text/html', value: options.html },
        ],
      }),
    });

    if (response.ok || response.status === 202) {
      const messageId = response.headers.get('x-message-id') || 'sent';
      logger.info('Email sent successfully', {
        data: { to: options.to, subject: options.subject, messageId },
      });
      return { success: true, messageId };
    }

    const errorText = await response.text();
    logger.error('SendGrid API error', {
      data: { status: response.status, error: errorText },
    });
    return { success: false, error: `SendGrid error: ${response.status}` };
  } catch (error) {
    logger.error('Failed to send email', {
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return { success: false, error: 'Failed to send email' };
  }
}

// ============================================
// Public Email Functions
// ============================================

/**
 * Send email verification link
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
  name?: string
): Promise<EmailResult> {
  const emailConfig = getEmailConfig();
  const verificationUrl = `${emailConfig.baseUrl}/verify-email?token=${token}`;
  const template = emailTemplates.verification({ name: name || '', verificationUrl });

  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/**
 * Send password reset link
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string,
  name?: string
): Promise<EmailResult> {
  const emailConfig = getEmailConfig();
  const resetUrl = `${emailConfig.baseUrl}/reset-password?token=${token}`;
  const template = emailTemplates.passwordReset({ name: name || '', resetUrl });

  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/**
 * Send welcome email after verification
 */
export async function sendWelcomeEmail(
  email: string,
  name?: string
): Promise<EmailResult> {
  const emailConfig = getEmailConfig();
  const loginUrl = `${emailConfig.baseUrl}/login`;
  const template = emailTemplates.welcome({ name: name || '', loginUrl });

  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return !!process.env.SENDGRID_API_KEY;
}

export default {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  isEmailConfigured,
};
