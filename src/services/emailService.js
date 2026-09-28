// Calls SendGrid's REST API directly instead of using @sendgrid/mail (the
// SDK wraps Node's http module internally, which doesn't run on Workers).
// Same requests, same templates — just sent with fetch() instead of an SDK.

async function sendEmail(env, { to, subject, html }) {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: env.SENDGRID_FROM_EMAIL, name: env.SENDGRID_FROM_NAME || "Sharef" },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid request failed (${res.status}): ${body}`);
  }
}

export async function sendVerificationEmail(env, toEmail, fullName, otp) {
  await sendEmail(env, {
    to: toEmail,
    subject: "Verify your Sharef account",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2>Hi ${fullName},</h2>
        <p>Your Sharef verification code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${otp}</p>
        <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(env, toEmail, fullName, otp) {
  await sendEmail(env, {
    to: toEmail,
    subject: "Reset your Sharef password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2>Hi ${fullName},</h2>
        <p>You requested to reset your Sharef password. Your reset code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${otp}</p>
        <p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email — your password will not be changed.</p>
      </div>
    `,
  });
}

// Ported alongside the two above (same file, same pattern) even though the
// auth slice doesn't call these yet — used by the resource-moderation and
// announcement phases later.
export async function sendResourceStatusEmail(env, toEmail, fullName, resourceTitle, status, reason) {
  const isApproved = status === "approved";
  await sendEmail(env, {
    to: toEmail,
    subject: isApproved ? "Your upload was approved" : "Your upload was not approved",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2>Hi ${fullName},</h2>
        <p>Your resource <strong>"${resourceTitle}"</strong> has been
          ${isApproved ? "<strong style='color:#2dd4bf;'>approved</strong> and is now live on Sharef." : "<strong style='color:#f87171;'>rejected</strong>."}
        </p>
        ${!isApproved && reason ? `<p>Reason: <strong>${reason}</strong></p>` : ""}
        ${!isApproved ? "<p>You're welcome to review the file and re-upload it if the issue can be fixed.</p>" : ""}
      </div>
    `,
  });
}

export async function sendAnnouncementEmail(env, toEmail, fullName, title, message) {
  await sendEmail(env, {
    to: toEmail,
    subject: `Sharef Announcement: ${title}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2>Hi ${fullName},</h2>
        <p style="font-weight:700; font-size:1.1rem;">${title}</p>
        <p style="white-space: pre-wrap;">${message}</p>
      </div>
    `,
  });
}
