const SMTP_TRANSPORT = {
  host: process.env.TEXTBELT_SMTP_HOST || 'smtp.invalid.local',
  port: Number(process.env.TEXTBELT_SMTP_PORT || 587),
  auth: {
    user: process.env.TEXTBELT_SMTP_USER || '',
    pass: process.env.TEXTBELT_SMTP_PASS || '',
  },
  secure: String(process.env.TEXTBELT_SMTP_SECURE || 'false') === 'true',
  connectionTimeout: 6000,
  greetingTimeout: 6000,
  socketTimeout: 10000,
};

module.exports = {
  transport: SMTP_TRANSPORT,
  mailOptions: {
    from: process.env.TEXTBELT_FROM || 'BEACON <beacon@localhost.invalid>',
  },
  debugEnabled: String(process.env.TEXTBELT_DEBUG || 'false') === 'true',
};
