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
  supportEmail: 'contact@proxidream.com',
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

/**
 * Envoie une alerte tech (P0 / fatal). Pas de layout brandé, pas de logo
 * attaché — c'est un email d'opérations, pas un email utilisateur. Le HTML
 * est fourni par `core/logger/alerts/emailTemplate.js`.
 */
exports.sendAlert = async ({ to, subject, html }) => {
  const from = `"${BRAND.company} — Alertes" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`;
  const info = await getTransporter().sendMail({ from, to, subject, html });
  logger.info(`[MailAlert] sent to ${to} — ${subject} (${info.messageId})`);
  return info;
};

/* ────────────────────────────────────────────────────────────────────
 * Emails transactionnels par app (branding dynamique)
 * Utilisés pour les confirmations de souscription et les cadeaux admin.
 * Le branding (logo, couleur, nom) provient du document App de Mongo —
 * pas du BRAND "Proxidream" qui est réservé aux emails admin internes.
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Génère le HTML d'un email transactionnel brandé par app, bilingue.
 *
 * @param {Object} opts
 * @param {Object}  opts.app           - Document App Mongo (branding, displayName, playStoreUrl, supportEmail)
 * @param {String}  opts.language      - 'fr' | 'en'
 * @param {String}  opts.preheader     - Texte caché qui apparaît en aperçu de boîte mail
 * @param {String}  opts.title         - Titre principal (h1)
 * @param {String}  opts.bodyHtml      - Corps HTML (lignes <p>, listes...)
 * @param {String}  opts.ctaLabel      - Libellé du bouton CTA
 * @param {String}  opts.ctaUrl        - URL du bouton CTA
 * @param {String}  [opts.giftMention] - Bloc HTML optionnel pour mention de cadeau (peut être vide)
 */
function appBrandedLayout({ app, language, preheader = '', title, bodyHtml, ctaLabel, ctaUrl, giftMention = '' }) {
  const appName = (() => {
    const dn = app?.displayName;
    if (typeof dn === 'object' && dn) return dn.fr || dn.en || app.appId;
    return dn || app?.appId || 'App';
  })();
  const primaryColor = app?.branding?.primaryColor || '#1E2ACC';
  const logoUrl = app?.branding?.logo || app?.branding?.icon || null;
  const supportEmail = app?.supportEmail || process.env.SMTP_FROM || process.env.SMTP_USER;
  const playStoreUrl = app?.playStoreUrl || '';
  const year = new Date().getFullYear();

  const subjectUnsub = language === 'fr' ? 'Désinscription des emails' : 'Unsubscribe from emails';
  const labels = language === 'fr'
    ? {
        unsub: 'Si tu ne souhaites plus recevoir ces emails, contacte-nous',
        autoMail: 'Email automatique — merci de ne pas répondre',
        copyright: 'Tous droits réservés',
        installApp: playStoreUrl ? 'Télécharger l\'app sur Google Play' : '',
      }
    : {
        unsub: 'If you no longer want to receive these emails, contact us',
        autoMail: 'Automated email — please do not reply',
        copyright: 'All rights reserved',
        installApp: playStoreUrl ? 'Download the app on Google Play' : '',
      };

  const cta = ctaLabel && ctaUrl
    ? `<tr><td align="center" style="padding:8px 0 24px;">
         <a href="${ctaUrl}" style="display:inline-block;background:${primaryColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">${ctaLabel}</a>
       </td></tr>`
    : '';

  const playStoreFooter = playStoreUrl
    ? `<tr><td align="center" style="padding:0 36px 24px;">
         <a href="${playStoreUrl}" style="display:inline-block;font-size:12px;color:${primaryColor};text-decoration:none;font-weight:600;">▶ ${labels.installApp}</a>
       </td></tr>`
    : '';

  // On utilise toujours un fallback texte (première lettre de l'app) plutôt
  // que le logo en image. Raison : les images dans les emails sont souvent
  // bloquées par défaut (Gmail, Outlook), ce qui donne un placeholder moche.
  // La lettre dans un carré coloré est sobre, fiable et 100% rendu HTML/CSS.
  // Note logoUrl conservé en variable mais non utilisé pour l'instant.
  void logoUrl;
  const logoHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="56" height="56" align="center" valign="middle" bgcolor="#FFFFFF" style="width:56px;height:56px;background:#FFFFFF;border-radius:12px;color:${primaryColor};font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:26px;line-height:56px;text-align:center;">${appName.charAt(0).toUpperCase()}</td></tr></table>`;

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">

        <!-- Header avec branding de l'app -->
        <tr><td style="background:${primaryColor};padding:32px 36px;" bgcolor="${primaryColor}">
          <table role="presentation" width="100%"><tr>
            <td valign="middle">${logoHtml}</td>
            <td align="right" valign="middle">
              <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">${appName}</div>
            </td>
          </tr></table>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px 36px 16px;">
          <h1 style="margin:0 0 16px;color:#0F172A;font-size:22px;font-weight:700;line-height:1.3;letter-spacing:-0.3px;">${title}</h1>
          <table role="presentation" width="100%"><tr><td style="color:#0F172A;font-size:14px;line-height:1.7;">${bodyHtml}</td></tr>
          ${giftMention ? `<tr><td style="padding-top:8px;">${giftMention}</td></tr>` : ''}
          ${cta}
          </table>
        </td></tr>

        <!-- Bouton Play Store secondaire -->
        ${playStoreFooter}

        <!-- Footer légal -->
        <tr><td style="padding:18px 36px;background:#F8FAFC;border-top:1px solid #E2E8F0;color:#64748B;font-size:11px;line-height:1.7;">
          <p style="margin:0 0 6px;">${labels.autoMail}.</p>
          <p style="margin:0;">${labels.unsub} : <a href="mailto:${supportEmail}?subject=${encodeURIComponent(subjectUnsub)}" style="color:${primaryColor};text-decoration:none;">${supportEmail}</a></p>
        </td></tr>

        <!-- Copyright -->
        <tr><td align="center" style="padding:14px 36px 22px;background:#F8FAFC;color:#94A3B8;font-size:11px;border-top:1px solid #E2E8F0;">
          © ${year} ${appName}. ${labels.copyright}.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Envoie un email "branded app" (sans le logo Proxidream attaché en pièce
 * jointe — on utilise le logo de l'app via URL).
 */
async function sendAppMail({ app, to, subject, html }) {
  const appName = (() => {
    const dn = app?.displayName;
    if (typeof dn === 'object' && dn) return dn.fr || dn.en || app.appId;
    return dn || app?.appId || 'App';
  })();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
  // Display name personnalisé pour que l'email apparaisse comme venant de l'app
  // (ex: "BigWin Pronos <noreply@xxx.com>")
  const from = `"${appName}" <${fromEmail}>`;
  try {
    const info = await getTransporter().sendMail({ from, to, subject, html });
    logger.info(`[AppMail] [${app?.appId || '?'}] sent to ${to} — ${subject} (${info.messageId})`);
    return info;
  } catch (err) {
    logger.error(`[AppMail] [${app?.appId || '?'}] failed to ${to} — ${err.message}`);
    throw err;
  }
}

/**
 * Email de confirmation de création de souscription (achat ou cadeau admin).
 *
 * Le contenu varie selon `isGift` :
 *   - Achat normal : "Ton forfait est activé"
 *   - Cadeau admin : "Tu as reçu un forfait offert 🎁"
 *
 * @param {Object} opts
 * @param {Object} opts.user         - Doc User (au moins email, pseudo, firstName, countryCode)
 * @param {Object} opts.subscription - Doc Subscription (au moins endDate)
 * @param {Object} opts.package      - Doc Package (name peut être {fr,en} ou string)
 * @param {Object} opts.app          - Doc App (branding, displayName, playStoreUrl, supportEmail)
 * @param {Boolean} [opts.isGift=false]
 * @param {String}  [opts.giftMessage] - Message custom du loyalty gift (si applicable)
 * @param {String}  [opts.bonusGiftLabel] - Mention d'un cadeau additionnel (placeholder pour la future feature cadeaux)
 * @returns {Object|null} info nodemailer, ou null si pas d'email
 */
exports.sendSubscriptionMail = async ({
  user,
  subscription,
  package: pkg,
  app,
  isGift = false,
  giftMessage = null,
  bonusGiftLabel = null,
}) => {
  // Skip silencieux si pas d'email — la notif push aura déjà été envoyée
  if (!user?.email) {
    logger.info(`[AppMail] skip — user ${user?._id} sans email (notif push déjà partie)`);
    return null;
  }
  if (!app) {
    logger.warn(`[AppMail] skip — pas de doc App fourni`);
    return null;
  }

  const { langFromCountryCode } = require('../../../utils/locale');
  const language = langFromCountryCode(user.countryCode);

  // Nom d'affichage : pseudo > prénom > "client"
  const displayName = user.pseudo || user.firstName || (language === 'fr' ? 'cher client' : 'dear client');

  // Nom du package (peut être i18n)
  let packageName = pkg?.name;
  if (packageName && typeof packageName === 'object') {
    packageName = packageName[language] || packageName.fr || packageName.en || 'Premium';
  }
  packageName = packageName || 'Premium';

  // Date d'expiration formatée
  const endDate = subscription?.endDate ? new Date(subscription.endDate) : null;
  const endDateFormatted = endDate
    ? endDate.toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : null;

  // App display name pour les libellés
  const appName = (() => {
    const dn = app?.displayName;
    if (typeof dn === 'object' && dn) return dn[language] || dn.fr || dn.en || app.appId;
    return dn || app?.appId || 'App';
  })();

  // Construction des libellés bilingues
  // Note : le mot "cadeau" / "gift" est volontairement RÉSERVÉ pour la future
  // feature de cadeaux additionnels (vidéo/ebook/audio offerts en bonus à l'achat
  // d'un package). Ici on parle juste du forfait lui-même → on dit "offert" /
  // "offered to you" pour les attributions admin, pas "cadeau".
  const t = language === 'fr'
    ? {
        subjectAchat: `✅ Ton forfait ${packageName} est activé !`,
        subjectGift: `🎉 Forfait offert : ${packageName}`,
        title: isGift ? `Forfait offert pour toi 🎉` : `Forfait activé ✅`,
        greeting: `Salut ${displayName},`,
        introAchat: `Ton paiement a bien été reçu. Ton forfait <strong>${packageName}</strong> sur <strong>${appName}</strong> est maintenant <strong>actif</strong>.`,
        introGift: `Bonne nouvelle ! On t'offre un forfait <strong>${packageName}</strong> sur <strong>${appName}</strong>. Il est <strong>actif dès maintenant</strong>, profite-en bien !`,
        validUntil: endDateFormatted ? `📅 Valable jusqu'au <strong>${endDateFormatted}</strong>` : '',
        cta: 'Ouvrir l\'app',
        outro: 'Bons pronos et bons gains !',
      }
    : {
        subjectAchat: `✅ Your ${packageName} pack is activated!`,
        subjectGift: `🎉 Pack offered: ${packageName}`,
        title: isGift ? `A pack offered to you 🎉` : `Pack activated ✅`,
        greeting: `Hi ${displayName},`,
        introAchat: `Your payment was received. Your <strong>${packageName}</strong> pack on <strong>${appName}</strong> is now <strong>active</strong>.`,
        introGift: `Good news! We're offering you a <strong>${packageName}</strong> pack on <strong>${appName}</strong>. It's <strong>active right now</strong>, enjoy!`,
        validUntil: endDateFormatted ? `📅 Valid until <strong>${endDateFormatted}</strong>` : '',
        cta: 'Open the app',
        outro: 'Good predictions and good wins!',
      };

  // Custom message du loyalty gift (déjà bilingue côté backend, prend la version FR ou EN)
  const customLine = giftMessage
    ? `<p style="margin:0 0 12px;font-style:italic;color:#475569;background:#FFFBEB;border-left:3px solid #F59E0B;padding:10px 14px;border-radius:4px;">${giftMessage}</p>`
    : '';

  // Body principal
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;">${t.greeting}</p>
    ${customLine}
    <p style="margin:0 0 16px;">${isGift ? t.introGift : t.introAchat}</p>
    ${t.validUntil ? `<p style="margin:0 0 24px;color:#475569;">${t.validUntil}</p>` : ''}
    <p style="margin:0 0 8px;color:#64748B;">${t.outro}</p>
  `;

  // Mention bonus cadeau (placeholder pour la feature à venir)
  const giftMentionHtml = bonusGiftLabel
    ? `<div style="margin:8px 0;padding:14px 16px;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;color:#78350F;">
         <strong style="font-size:13px;">🎁 ${language === 'fr' ? 'Cadeau bonus inclus' : 'Bonus gift included'}</strong>
         <div style="font-size:13px;margin-top:4px;">${bonusGiftLabel}</div>
       </div>`
    : '';

  const subject = isGift ? t.subjectGift : t.subjectAchat;
  const html = appBrandedLayout({
    app,
    language,
    preheader: subject,
    title: t.title,
    bodyHtml,
    ctaLabel: t.cta,
    ctaUrl: app?.playStoreUrl || '',
    giftMention: giftMentionHtml,
  });

  return sendAppMail({ app, to: user.email, subject, html });
};
