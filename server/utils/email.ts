/**
 * =============================================================================
 * F0 - EMAIL UTILITY (AWS SES)
 * =============================================================================
 * 
 * This module handles email sending via AWS SES for OTP delivery.
 * 
 * CONFIGURATION:
 * - AWS_REGION: AWS region for SES
 * - AWS_ACCESS_KEY_ID: AWS access key
 * - AWS_SECRET_ACCESS_KEY: AWS secret key
 * - EMAIL_FROM: Sender email address (must be verified in SES)
 * 
 * REQUIREMENTS:
 * - AWS SES account configured
 * - Sender email verified (or domain verified for production)
 * - If in SES sandbox, recipient emails must also be verified
 * 
 * EMAIL TEMPLATE:
 * - Clean, professional design
 * - Works without images (text-only fallback)
 * - Mobile-friendly
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

// =============================================================================
// SES CLIENT SETUP
// =============================================================================

/**
 * Lazy-initialized SES client
 * Avoids errors if AWS credentials aren't configured (public mode)
 */
let sesClient: SESClient | null = null

/**
 * Get or create the SES client
 * Uses runtime config for credentials
 */
function getSesClient(): SESClient {
  if (sesClient) {
    return sesClient
  }
  
  // Get config from runtime (injected by Nuxt)
  const config = useRuntimeConfig()
  
  if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
    throw new Error('AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.')
  }
  
  sesClient = new SESClient({
    region: config.awsRegion || 'us-east-1',
    credentials: {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
    },
  })
  
  return sesClient
}

// =============================================================================
// EMAIL TEMPLATES
// =============================================================================

/**
 * Generate HTML email for OTP
 */
function generateOtpEmailHtml(otp: string, siteName: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Access Code</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .container {
      background: #f9f9f9;
      border-radius: 8px;
      padding: 40px;
      text-align: center;
    }
    .logo {
      font-size: 24px;
      font-weight: 600;
      color: #333;
      margin-bottom: 20px;
    }
    .code-box {
      background: #fff;
      border: 2px solid #e5e5e5;
      border-radius: 8px;
      padding: 20px;
      margin: 30px 0;
    }
    .code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 32px;
      font-weight: 600;
      letter-spacing: 4px;
      color: #2563eb;
    }
    .message {
      color: #666;
      font-size: 14px;
    }
    .expiry {
      color: #999;
      font-size: 12px;
      margin-top: 20px;
    }
    .footer {
      margin-top: 40px;
      color: #999;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">${siteName}</div>
    
    <p class="message">
      Enter this code to access the documentation:
    </p>
    
    <div class="code-box">
      <div class="code">${otp}</div>
    </div>
    
    <p class="expiry">
      This code expires in 5 minutes.<br>
      If you didn't request this code, you can safely ignore this email.
    </p>
    
    <div class="footer">
      This is an automated message from ${siteName}.
    </div>
  </div>
</body>
</html>
`.trim()
}

/**
 * Generate plain text email for OTP (fallback)
 */
function generateOtpEmailText(otp: string, siteName: string): string {
  return `
${siteName} - Access Code

Your verification code is: ${otp}

This code expires in 5 minutes.

If you didn't request this code, you can safely ignore this email.

---
This is an automated message from ${siteName}.
`.trim()
}

// =============================================================================
// EMAIL SENDING
// =============================================================================

/**
 * Send OTP email to a user
 * 
 * @param to - Recipient email address
 * @param otp - OTP code to send
 * @returns Promise that resolves on success
 * @throws Error on failure
 */
export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const config = useRuntimeConfig()
  const siteName = config.public.siteName || 'f0'
  const fromEmail = config.emailFrom
  
  if (!fromEmail) {
    throw new Error('EMAIL_FROM not configured')
  }
  
  const client = getSesClient()
  
  const command = new SendEmailCommand({
    Source: fromEmail,
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Data: `Your ${siteName} Access Code`,
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: generateOtpEmailHtml(otp, siteName),
          Charset: 'UTF-8',
        },
        Text: {
          Data: generateOtpEmailText(otp, siteName),
          Charset: 'UTF-8',
        },
      },
    },
  })
  
  try {
    const response = await client.send(command)
    console.log(`[Email] OTP sent to ${to}, MessageId: ${response.MessageId}`)
  } catch (error) {
    console.error(`[Email] Failed to send OTP to ${to}:`, error)
    throw error
  }
}

/**
 * Verify email configuration is working
 * Useful for health checks and setup validation
 */
export async function verifyEmailConfiguration(): Promise<{
  configured: boolean
  error?: string
}> {
  try {
    const config = useRuntimeConfig()
    
    if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
      return { configured: false, error: 'AWS credentials not set' }
    }
    
    if (!config.emailFrom) {
      return { configured: false, error: 'EMAIL_FROM not set' }
    }
    
    // Try to create client (validates credentials format)
    getSesClient()
    
    return { configured: true }
  } catch (error) {
    return { 
      configured: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}
