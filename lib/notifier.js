const dns = require("dns").promises;
const nodemailer = require("nodemailer");

function configured(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function readGmailEmailConfig() {
  const user = process.env.SMTP_GMAIL_USER;
  const secureRaw = process.env.SMTP_GMAIL_SECURE;
  const proxy = process.env.SMTP_PROXY || process.env.OPENAI_PROXY;

  return {
    provider: "gmail",
    label: "Gmail 个人邮箱",
    host: process.env.SMTP_GMAIL_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_GMAIL_PORT || 465),
    secure: secureRaw === undefined ? true : secureRaw === "true",
    user,
    pass: process.env.SMTP_GMAIL_PASS,
    from: process.env.SMTP_GMAIL_FROM || (user ? `DreameHub <${user}>` : ""),
    proxy,
  };
}

async function sendEmailCode(target, code) {
  const config = readGmailEmailConfig();
  if (!configured(config.host)) {
    throw new Error(`未配置 ${config.label} SMTP_GMAIL_HOST，无法发送真实邮箱验证码`);
  }
  if (!configured(config.user) || !configured(config.pass)) {
    throw new Error(`未配置 ${config.label} SMTP_GMAIL_USER/SMTP_GMAIL_PASS，无法发送真实邮箱验证码`);
  }

  let smtpHost = config.host;
  if (!configured(config.proxy)) {
    try {
      smtpHost = (await dns.lookup(config.host, { family: 4 })).address;
    } catch {
      smtpHost = config.host;
    }
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: config.port,
    secure: config.secure,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      servername: config.host,
    },
    proxy: configured(config.proxy) ? config.proxy : undefined,
    auth: configured(config.user)
      ? {
          user: config.user,
          pass: config.pass,
        }
      : undefined,
  });

  await transporter.sendMail({
    from: config.from,
    to: target,
    subject: "DreameHub 验证码",
    text: `你的 DreameHub 验证码是：${code}。10 分钟内有效。`,
    html: `<p>你的 DreameHub 验证码是：</p><h2>${code}</h2><p>10 分钟内有效。</p>`,
  });

  return config.provider;
}

async function sendSmsCode(target, code) {
  if (!configured(process.env.TWILIO_ACCOUNT_SID) || !configured(process.env.TWILIO_AUTH_TOKEN) || !configured(process.env.TWILIO_FROM)) {
    throw new Error("未配置 Twilio 短信参数，无法发送真实手机验证码");
  }

  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const body = new URLSearchParams({
    To: target,
    From: process.env.TWILIO_FROM,
    Body: `Your DreameHub verification code is ${code}. It expires in 10 minutes.`,
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "短信验证码发送失败");
  }
}

async function sendVerificationCode(channel, target, code) {
  if (process.env.VERIFICATION_DEV_MODE === "true") {
    return { devCode: code, provider: "dev" };
  }

  if (channel === "phone") {
    await sendSmsCode(target, code);
    return { provider: "twilio" };
  }

  const provider = await sendEmailCode(target, code);
  return { provider };
}

module.exports = { sendVerificationCode };
