---
title: Authentication Overview
description: Learn how to protect your documentation with email-based authentication
order: 1
---

# Authentication Overview

f0 supports optional authentication to protect private documentation. When enabled, users must verify their email address to access content.

## Authentication Modes

f0 operates in one of two modes, configured via the `AUTH_MODE` environment variable:

### Public Mode (Default)

```env
AUTH_MODE=public
```

All documentation is accessible without login. Use this for:
- Open source project documentation
- Public API references
- Marketing/product documentation

### Private Mode

```env
AUTH_MODE=private
```

All routes require authentication except:
- `/login` — The login page
- `/api/auth/*` — Authentication endpoints
- `/_nuxt/*` — Framework assets

:::warning
In private mode, ensure you have configured the allowlist and email settings before deployment.
:::

## How Authentication Works

f0 uses a passwordless, email-based OTP (One-Time Password) flow:

1. **User enters email** — On the login page
2. **System checks allowlist** — Email must be pre-approved
3. **OTP is generated** — 8-digit code, valid for 5 minutes
4. **Email is sent** — Via AWS SES
5. **User enters code** — Max 3 attempts
6. **JWT is issued** — Valid for 72 hours

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│  User   │────▶│ f0│────▶│ AWS SES │
│ Browser │◀────│  Server │◀────│  Email  │
└─────────┘     └─────────┘     └─────────┘
     │                │
     │    JWT Token   │
     │◀───────────────│
```

## Security Features

### Email Allowlist

Only pre-approved emails can authenticate. Configure in `/private/allowlist.json`:

```json
{
  "emails": [
    "alice@company.com",
    "bob@company.com"
  ],
  "domains": [
    "@company.com"
  ]
}
```

### Rate Limiting

To prevent abuse:
- Max 3 OTP requests per 5 minutes per email
- Max 3 verification attempts per OTP
- Failed attempts are logged

### Secure Storage

- OTPs are stored in memory with TTL (time-to-live)
- JWTs are signed with a secret key
- No passwords are ever stored

## Next Steps

- [Configure Email (AWS SES)](/guides/authentication/email-setup)
- [Set Up Allowlist](/guides/authentication/allowlist)
- [JWT Configuration](/guides/authentication/jwt-config)
