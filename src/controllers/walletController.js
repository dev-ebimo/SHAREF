import { calculateResourceCost } from "../utils/pricing.js";
import { buildDownloadStreamUrl } from "../utils/downloadToken.js";
import { generateId } from "../utils/id.js";
import { initializeTransaction, verifyTransaction } from "../services/paystackService.js";

function nowIso() {
  return new Date().toISOString();
}

// D1's docs describe this field as `meta.changes` in some places and
// `meta.rows_written` in others (likely just two names for the same
// underlying SQLite changes() value, across different doc versions) —
// checking both is cheap and removes any doubt about which one a given
// D1 version actually returns, for logic this financially sensitive.
function rowsChanged(result) {
  return result?.meta?.changes ?? result?.meta?.rows_written ?? 0;
}

// @route GET /api/wallet/balance
export async function getBalance(c) {
  try {
    const user = c.get("user");
    const row = await c.env.DB.prepare("SELECT wallet_balance FROM users WHERE id = ?").bind(user.id).first();
    return c.json({ success: true, balance: row.wallet_balance });
  } catch (err) {
    return c.json({ success: false, message: "Could not fetch balance", error: err.message }, 500);
  }
}

// @route POST /api/wallet/fund/initialize
export async function initializeFunding(c) {
  try {
    const { amount } = await c.req.json();
    if (!amount || amount <= 0) {
      return c.json({ success: false, message: "Enter a valid amount" }, 400);
    }

    const user = c.get("user");
    const reference = `SHAREF-${user.id}-${Date.now()}`;
    const timestamp = nowIso();

    // Log the attempt as pending BEFORE calling Paystack, so the webhook has
    // something to match against even if the user closes the tab mid-payment.
    await c.env.DB.prepare(
      `INSERT INTO transactions (id, user_id, type, amount, status, reference, description, created_at, updated_at)
       VALUES (?, ?, 'deposit', ?, 'pending', ?, 'Wallet funding via Paystack', ?, ?)`
    )
      .bind(generateId(), user.id, amount, reference, timestamp, timestamp)
      .run();

    const requester = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(user.id).first();
    const data = await initializeTransaction(c.env, {
      email: requester.email,
      amountNaira: amount,
      reference,
      callbackUrl: `${c.env.FRONTEND_URL}/payment-callback.html`,
    });

    return c.json({ success: true, authorizationUrl: data.authorization_url, reference: data.reference });
  } catch (err) {
    return c.json({ success: false, message: "Could not initialize payment", error: err.message }, 500);
  }
}

// Shared by verifyFunding and the webhook below — atomically flips
// pending -> successful and credits the wallet, but only for whichever of
// the two callers gets here first. The other sees rowsChanged === 0 and
// treats it as a no-op, since the money was already applied. This closes
// the double-credit window that would exist if the status check and the
// credit were two separate, non-atomic steps.
async function claimAndCreditTransaction(c, reference, expectedAmountNaira = null) {
  const claimResult = await c.env.DB.prepare(
    "UPDATE transactions SET status = 'successful', updated_at = ? WHERE reference = ? AND status != 'successful'"
  )
    .bind(nowIso(), reference)
    .run();

  if (rowsChanged(claimResult) === 0) {
    return { credited: false }; // already claimed by the other caller, or doesn't exist
  }

  const tx = await c.env.DB.prepare("SELECT user_id, amount FROM transactions WHERE reference = ?").bind(reference).first();
  const amount = expectedAmountNaira ?? tx.amount;

  await c.env.DB.prepare("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?")
    .bind(amount, tx.user_id)
    .run();

  return { credited: true, userId: tx.user_id, amount };
}

// @route GET /api/wallet/fund/verify/:reference
// Called by the frontend right after Paystack's checkout redirects back —
// this is a convenience for instant UI feedback. The webhook below is the
// real source of truth and will also credit the wallet if this is skipped.
export async function verifyFunding(c) {
  try {
    const reference = c.req.param("reference");
    const transaction = await c.env.DB.prepare("SELECT status FROM transactions WHERE reference = ?").bind(reference).first();

    if (!transaction) {
      return c.json({ success: false, message: "Transaction not found" }, 404);
    }
    if (transaction.status === "successful") {
      return c.json({ success: true, message: "Payment already confirmed" });
    }

    const paystackData = await verifyTransaction(c.env, reference);

    if (paystackData.status === "success") {
      await claimAndCreditTransaction(c, reference);
      return c.json({ success: true, message: "Wallet funded successfully" });
    }

    await c.env.DB.prepare("UPDATE transactions SET status = 'failed', updated_at = ? WHERE reference = ? AND status != 'successful'")
      .bind(nowIso(), reference)
      .run();
    return c.json({ success: false, message: "Payment was not successful" }, 400);
  } catch (err) {
    return c.json({ success: false, message: "Could not verify payment", error: err.message }, 500);
  }
}

async function verifyPaystackSignature(rawBody, secret, signatureHeader) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return computedHex === signatureHeader;
}

// @route POST /api/wallet/webhook  (called by Paystack's servers, not the frontend)
// Simpler here than the original Express version: Hono reads the body
// directly in this one handler with c.req.text(), so there's no risk of a
// global JSON-parsing middleware having already consumed it — the
// route-ordering trick the original needed (`express.raw()` mounted
// before `express.json()`) has no equivalent needed on Workers.
export async function paystackWebhook(c) {
  try {
    const rawBody = await c.req.text();
    const signature = c.req.header("x-paystack-signature");

    const isValid = await verifyPaystackSignature(rawBody, c.env.PAYSTACK_SECRET_KEY, signature);
    if (!isValid) {
      return c.text("Invalid signature", 401);
    }

    const event = JSON.parse(rawBody);

    if (event.event === "charge.success") {
      const { reference, amount } = event.data;
      await claimAndCreditTransaction(c, reference, amount / 100); // kobo -> naira
    }

    return c.text("Webhook received", 200);
  } catch (err) {
    console.error("Webhook error:", err.message);
    return c.text("Webhook processing failed", 500);
  }
}

// @route POST /api/wallet/charge  (used by the download flow across all pages)
export async function chargeForDownload(c) {
  try {
    const { resourceId } = await c.req.json();
    const user = c.get("user");

    const resource = await c.env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(resourceId).first();
    if (!resource || resource.status !== "approved") {
      return c.json({ success: false, message: "Resource not available" }, 404);
    }

    // Already purchased? Skip the charge entirely — free re-download.
    const existingPurchase = await c.env.DB.prepare(
      "SELECT id FROM transactions WHERE user_id = ? AND resource_id = ? AND type = 'purchase' AND status = 'successful'"
    )
      .bind(user.id, resourceId)
      .first();

    if (existingPurchase) {
      await recordDownload(c, resourceId, user.id);
      return c.json({
        success: true,
        alreadyOwned: true,
        fileUrl: await buildDownloadStreamUrl(c, resourceId, user.id),
        message: "Download starting",
      });
    }

    const cost = calculateResourceCost(resource.pages);

    // Atomic, conditional deduction — the check (balance >= cost) and the
    // write happen in the SAME statement, so two simultaneous downloads for
    // a user with just enough balance for ONE of them can't both succeed.
    // The original read the balance, checked it in JS, then wrote it back
    // as two separate steps — a real race window this closes.
    const deductResult = await c.env.DB.prepare("UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ? AND wallet_balance >= ?")
      .bind(cost, user.id, cost)
      .run();

    if (rowsChanged(deductResult) === 0) {
      const row = await c.env.DB.prepare("SELECT wallet_balance FROM users WHERE id = ?").bind(user.id).first();
      return c.json(
        { success: false, insufficientBalance: true, message: "Insufficient wallet balance", required: cost, currentBalance: row.wallet_balance },
        402
      );
    }

    await c.env.DB.prepare(
      `INSERT INTO transactions (id, user_id, type, amount, status, resource_id, description, created_at, updated_at)
       VALUES (?, ?, 'purchase', ?, 'successful', ?, ?, ?, ?)`
    )
      .bind(generateId(), user.id, cost, resourceId, `${resource.course} — ${resource.title}`, nowIso(), nowIso())
      .run();

    await recordDownload(c, resourceId, user.id);

    const balanceRow = await c.env.DB.prepare("SELECT wallet_balance FROM users WHERE id = ?").bind(user.id).first();

    return c.json({
      success: true,
      alreadyOwned: false,
      fileUrl: await buildDownloadStreamUrl(c, resourceId, user.id),
      newBalance: balanceRow.wallet_balance,
      message: "Payment successful, download starting",
    });
  } catch (err) {
    return c.json({ success: false, message: "Could not process download", error: err.message }, 500);
  }
}

async function recordDownload(c, resourceId, userId) {
  const timestamp = nowIso();
  await c.env.DB.prepare("UPDATE resources SET downloads = downloads + 1, updated_at = ? WHERE id = ?")
    .bind(timestamp, resourceId)
    .run();
  await c.env.DB.prepare("INSERT INTO download_logs (id, user_id, resource_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(generateId(), userId, resourceId, timestamp, timestamp)
    .run();
}
