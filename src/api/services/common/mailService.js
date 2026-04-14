// src/api/services/common/mailService.js

const path = require('path');
const nodemailer = require('nodemailer');
const logger = require('../../../utils/logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: String(process.env.SMTP_TLS_STRICT || 'true') === 'true',
    },
  });

  return transporter;
}

const LOGO_PATH = path.join(__dirname, 'assets', 'logo-proxidream.png');
const LOGO_CID = 'proxidream-logo';

const BRAND = {
  company: 'Proxidream',
  legalName: 'ETS PROXIDREAM',
  tagline: 'Des solutions numériques qui simplifient le quotidien',
  rccm: 'RC/YAO/2025/A/1002',
  niu: 'M032517681432U',
  city: 'Yaoundé, Cameroun',
  website: 'https://proxidream.com',
  supportEmail: 'support@proxidream.com',
  primary: '#1E2ACC',
  primaryDark: '#151FA0',
  accent: '#FFD60A',
  text: '#0F172A',
  muted: '#64748B',
  mutedLight: '#94A3B8',
  bg: '#F1F5F9',
  card: '#FFFFFF',
  border: '#E2E8F0',
  softBg: '#F8FAFC',
  year: () => new Date().getFullYear(),
};

async function sendMail({ to, subject, html }) {
  const from = `"${BRAND.company}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`;
  try {
    const info = await getTransporter().sendMail({
      from,
      to,
      subject,
      html,
      attachments: [{
        filename: 'proxidream-logo.png',
        path: LOGO_PATH,
        cid: LOGO_CID,
      }],
    });
    logger.info(`[Mail] sent to ${to} — ${subject} (${info.messageId})`);
    return info;
  } catch (err) {
    logger.error(`[Mail] failed to ${to} — ${err.message}`);
    throw err;
  }
}

function layout({ preheader = '', title, intro, bodyHtml, ctaLabel, ctaUrl, showSecurityNote = true }) {
  const cta = ctaLabel && ctaUrl
    ? `<tr><td align="center" style="padding:8px 0 24px;">
         <a href="${ctaUrl}" style="display:inline-block;background:${BRAND.primary};color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:14px;">${ctaLabel}</a>
       </td></tr>`
    : '';

  const securityNote = showSecurityNote
    ? `<p style="margin:0 0 8px;"><strong style="color:${BRAND.text};">Sécurité —</strong> ${BRAND.company} ne vous demandera jamais votre mot de passe ou vos codes de vérification par téléphone, SMS ou e-mail.</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(30,42,204,0.08);">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.primaryDark} 100%);padding:32px 36px;" bgcolor="${BRAND.primary}">
          <table role="presentation" width="100%"><tr>
            <td valign="middle">
              <img src="cid:${LOGO_CID}" alt="${BRAND.company}" width="56" height="56" style="display:block;border-radius:12px;border:0;outline:none;" />
            </td>
            <td align="right" valign="middle">
              <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">${BRAND.company}</div>
              <div style="color:#C5CAFF;font-size:11px;font-weight:500;margin-top:2px;">${BRAND.tagline}</div>
            </td>
          </tr></table>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px 36px 16px;">
          <h1 style="margin:0 0 12px;color:${BRAND.text};font-size:22px;font-weight:700;line-height:1.3;letter-spacing:-0.3px;">${title}</h1>
          ${intro ? `<p style="margin:0 0 24px;color:${BRAND.muted};font-size:14px;line-height:1.6;">${intro}</p>` : ''}
          <table role="presentation" width="100%"><tr><td style="color:${BRAND.text};font-size:14px;line-height:1.7;">${bodyHtml}</td></tr>${cta}</table>
        </td></tr>

        <!-- Accent bar -->
        <tr><td style="padding:0 36px 28px;">
          <div style="height:3px;background:linear-gradient(90deg,${BRAND.primary} 0%,${BRAND.accent} 100%);border-radius:2px;"></div>
        </td></tr>

        <!-- Security + sign-off -->
        <tr><td style="padding:20px 36px 24px;color:${BRAND.muted};font-size:13px;line-height:1.6;">
          ${securityNote}
          <p style="margin:12px 0 0;color:${BRAND.text};">Cordialement,<br/><strong>L'équipe ${BRAND.company}</strong></p>
        </td></tr>

        <!-- Legal footer -->
        <tr><td style="padding:20px 36px;background:${BRAND.softBg};border-top:1px solid ${BRAND.border};">
          <table role="presentation" width="100%">
            <tr>
              <td valign="top" style="color:${BRAND.muted};font-size:11px;line-height:1.6;">
                <div style="color:${BRAND.text};font-weight:700;font-size:12px;letter-spacing:0.3px;">${BRAND.legalName}</div>
                <div>${BRAND.city}</div>
                <div>RCCM : ${BRAND.rccm}</div>
                <div>NIU : ${BRAND.niu}</div>
              </td>
              <td valign="top" align="right" style="color:${BRAND.muted};font-size:11px;line-height:1.6;">
                <div><a href="${BRAND.website}" style="color:${BRAND.primary};text-decoration:none;font-weight:600;">${BRAND.website.replace('https://','')}</a></div>
                <div><a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.supportEmail}</a></div>
                <div style="margin-top:8px;">E-mail automatique — ne pas répondre</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Copyright -->
        <tr><td align="center" style="padding:14px 36px 22px;background:${BRAND.softBg};color:${BRAND.mutedLight};font-size:11px;border-top:1px solid ${BRAND.border};">
          © ${BRAND.year()} ${BRAND.legalName}. Tous droits réservés.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

exports.sendOtp = async ({ to, code, firstName }) => {
  const ttl = process.env.OTP_TTL_MINUTES || '10';
  const name = firstName ? `${firstName}` : '';
  const html = layout({
    preheader: `Votre code de vérification : ${code}`,
    title: 'Votre code de vérification',
    intro: `Bonjour${name ? ' ' + name : ''}, nous avons reçu une demande de connexion à votre espace ${BRAND.company}. Utilisez le code ci-dessous pour la valider.`,
    bodyHtml: `
      <div style="text-align:center;margin:8px 0 24px;">
        <div style="display:inline-block;background:${BRAND.softBg};border:2px solid ${BRAND.primary};border-radius:12px;padding:22px 36px;font-size:36px;font-weight:700;letter-spacing:14px;color:${BRAND.primary};font-family:'Courier New',Consolas,monospace;">${code}</div>
      </div>
      <p style="margin:0 0 8px;color:${BRAND.muted};font-size:13px;text-align:center;">Ce code est valable <strong style="color:${BRAND.text};">${ttl} minutes</strong>.</p>
      <p style="margin:20px 0 0;color:${BRAND.muted};font-size:13px;">Si vous n'êtes pas à l'origine de cette demande, aucune action n'est requise — votre compte reste sécurisé. Nous vous invitons toutefois à changer votre mot de passe par précaution.</p>
    `,
  });
  return sendMail({ to, subject: `${code} — Code de vérification ${BRAND.company}`, html });
};

exports.sendWelcome = async ({ to, firstName, tempPassword, role }) => {
  const name = firstName ? `${firstName}` : '';
  const roleLabel = { super_admin: 'Super administrateur', pronostiqueur: 'Pronostiqueur', investisseur: 'Investisseur' }[role] || role;
  const html = layout({
    preheader: `Votre accès ${BRAND.company} est prêt`,
    title: `Bienvenue chez ${BRAND.company}`,
    intro: `Bonjour${name ? ' ' + name : ''}, votre accès à la plateforme ${BRAND.company} a été créé. Vous trouverez ci-dessous vos identifiants de première connexion.`,
    bodyHtml: `
      <table role="presentation" width="100%" style="margin:8px 0 22px;background:${BRAND.softBg};border:1px solid ${BRAND.border};border-radius:10px;">
        <tr><td style="padding:14px 18px;color:${BRAND.muted};font-size:13px;width:40%;border-bottom:1px solid ${BRAND.border};">Profil</td>
            <td style="padding:14px 18px;color:${BRAND.text};font-size:13px;font-weight:600;border-bottom:1px solid ${BRAND.border};">${roleLabel}</td></tr>
        <tr><td style="padding:14px 18px;color:${BRAND.muted};font-size:13px;">Identifiant</td>
            <td style="padding:14px 18px;color:${BRAND.text};font-size:13px;font-weight:600;">${to}</td></tr>
      </table>
      <p style="margin:0 0 10px;color:${BRAND.text};font-size:14px;font-weight:600;">Mot de passe temporaire</p>
      <div style="background:#ffffff;border:2px dashed ${BRAND.primary};border-radius:10px;padding:18px 22px;font-family:'Courier New',Consolas,monospace;font-size:17px;font-weight:700;color:${BRAND.primary};letter-spacing:1px;word-break:break-all;text-align:center;">${tempPassword}</div>
      <p style="margin:22px 0 0;color:${BRAND.muted};font-size:13px;">Lors de votre première connexion, un code de vérification vous sera envoyé par e-mail afin de sécuriser votre accès. Vous serez ensuite invité(e) à définir votre propre mot de passe.</p>
    `,
  });
  return sendMail({ to, subject: `Votre accès ${BRAND.company} est prêt`, html });
};
