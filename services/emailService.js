const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendVerificationEmail(toEmail, fullName, otp) {
  const mailOptions = {
    from: `"Sharef" <${process.env.EMAIL_USER}>`,
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
  };

  await transporter.sendMail(mailOptions);
}
async function sendPasswordResetEmail(toEmail, fullName, otp) {
  const mailOptions = {
    from: `"Sharef" <${process.env.EMAIL_USER}>`,
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
  };

  await transporter.sendMail(mailOptions);
}
async function sendResourceStatusEmail(toEmail, fullName, resourceTitle, status, reason) {
  const isApproved = status === "approved";
  const mailOptions = {
    from: `"Sharef" <${process.env.EMAIL_USER}>`,
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
  };
  await transporter.sendMail(mailOptions);
}
async function sendAnnouncementEmail(toEmail, fullName, title, message) {
  const mailOptions = {
    from: `"Sharef" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `Sharef Announcement: ${title}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2>Hi ${fullName},</h2>
        <p style="font-weight:700; font-size:1.1rem;">${title}</p>
        <p style="white-space: pre-wrap;">${message}</p>
      </div>
    `,
  };
  await transporter.sendMail(mailOptions);
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendResourceStatusEmail, sendAnnouncementEmail };