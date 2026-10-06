import { calculateResourceCost } from "../utils/pricing.js";
import { buildDownloadStreamUrl } from "../utils/downloadToken.js";
import { generateId } from "../utils/id.js";
import { sanitizeError } from "../utils/sanitizeError.js";
import { initializeTransaction, verifyTransaction } from "../services/paystackService.js";

// Funding limits (whole naira). MIN matches the frontend's MIN_FUND.
const MIN_FUND_NAIRA = 100;
const MAX_FUND_NAIRA = 500000;

// Paystack transaction statuses that mean "this attempt is definitively over".
// Anything else (ongoing / pending / processing / queued) means "ask again later".
const PAYSTACK_FINAL_FAILURE = new Set(["failed", "abandoned", "reversed"]);

function nowIso() {
  return new Date().toISOString();
}

function changed(result) {
  return result?.meta?.changes ?? result?.meta?.rows_written ?? 0;
}

function errText(err) {
  return String(err?.message ?? err ?? "");
}

// @route GET /api/wallet/balance
export async function getBalance(c) {
  try {
    const user = c.get("user");
    const row = await c.env.DB.prepare("SELECT wallet_balance FROM users WHERE id = ?").bind(user.id).first();
    return c.json({ success: true, balance: row?.wallet_balance ?? 0 });
  } catch (err) {
    console.error("getBalance failed:", errText(err));
    return c.json({ success: false, message: "Could not fetch balance", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/wallet/fund/initialize
export async function initializeFunding(c) {
  let reference = null;
  try {
    const body = await c.req.json().catch(() => null);
    const amount = body?.amount;

    // Strict: a real JSON number, whole naira, inside sane bounds. Rejects
    // strings, NaN/Infinity, fractions (Paystack works in whole kobo and we
    // credit exactly what was paid) and absurd values.
    if (typeof amount !== "number" || !Number.isInteger(amount)) {
      return c.json({ success: false, message: "Enter a valid whole-naira amount" }, 400);
    }
    if (amount < MIN_FUND_NAIRA) {
      return c.json({ success: false, message: `Minimum funding amount is ₦${MIN_FUND_NAIRA}` }, 400);
    }
    if (amount > MAX_FUND_NAIRA) {
      return c.json({ success: false, message: `Maximum funding amount is ₦${MAX_FUND_NAIRA.toLocaleString("en-NG")}` }, 400);
    }

    const user = c.get("user");
    const requester = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(user.id).first();
    if (!requester) {
      return c.json({ success: false, message: "User not found" }, 404);
    }

    // Random reference: unguessable, and doesn't embed the user's id.
    reference = `SHAREF-${crypto.randomUUID()}`;
    const timestamp = nowIso();

    // Logged as pending BEFORE calling Paystack so the webhook always has a
    // row to match, even if the user closes the tab mid-payment.
    await c.env.DB.prepare(
      `INSERT INTO transactions (id, user_id, type, amount, status, reference, description, created_at, updated_at)
       VALUES (?, ?, 'deposit', ?, 'pending', ?, 'Wallet funding via Paystack', ?, ?)`
    )
      .bind(generateId(), user.id, amount, reference, timestamp, timestamp)
      .run();

    let data;
    try {
      data = await initializeTransaction(c.env, {
        email: requester.email,
        amountNaira: amount,
        reference,
        callbackUrl: `${c.env.FRONTEND_URL}/payment-callback.html`,
      });
    } catch (paystackErr) {
      // Don't leave a dangling "pending" row that can never be paid.
      await c.env.DB.prepare(
        "UPDATE transactions SET status = 'failed', updated_at = ? WHERE reference = ? AND status = 'pending'"
      )
        .bind(nowIso(), reference)
        .run()
        .catch(() => {});
      throw paystackErr;
    }

    return c.json({ success: true, authorizationUrl: data.authorization_url, reference: data.reference });
  } catch (err) {
    console.error("initializeFunding failed:", errText(err));
    return c.json({ success: false, message: "Could not initialize payment", error: sanitizeError(c.env, err) }, 500);
  }
}

// ---------------------------------------------------------------------------
// Settlement: the ONE place a deposit becomes money in a wallet.
//
// Both statements run in a single D1 batch() = a single SQL transaction, so
// the wallet credit and the pending->successful flip either BOTH happen or
// NEITHER does (a crash/timeout between them can no longer lose a deposit).
//
// Race safety: the credit's amount and target user are read by subquery from
// the transaction row *only while that row is not yet 'successful'*. Whichever
// caller (verify endpoint or webhook) runs its batch second sees 'successful',
// its subqueries return NULL, and its credit touches zero rows. No amount
// parameter is trusted from the caller at all.
// ---------------------------------------------------------------------------
async function settleDeposit(c, reference) {
  const ts = nowIso();
  const [creditResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users
          SET wallet_balance = wallet_balance + (
                SELECT amount FROM transactions
                 WHERE reference = ? AND type = 'deposit' AND status != 'successful' AND user_id IS NOT NULL),
              updated_at = ?
        WHERE id = (
                SELECT user_id FROM transactions
                 WHERE reference = ? AND type = 'deposit' AND status != 'successful' AND user_id IS NOT NULL)`
    ).bind(reference, ts, reference),
    c.env.DB.prepare(
      `UPDATE transactions SET status = 'successful', updated_at = ?
        WHERE reference = ? AND type = 'deposit' AND status != 'successful' AND user_id IS NOT NULL`
    ).bind(ts, reference),
  ]);
  return { credited: changed(creditResult) > 0 };
}

// Checks what Paystack says was actually paid against what we recorded when
// the payment was initialised. Returns null if fine, or a reason string.
function paymentMismatch(tx, paystackData, reference) {
  if (paystackData.reference && paystackData.reference !== reference) return "reference mismatch";
  if (paystackData.currency !== "NGN") return `unexpected currency ${paystackData.currency}`;
  if (paystackData.amount !== Math.round(tx.amount * 100)) {
    return `amount mismatch (paid ${paystackData.amount} kobo, expected ${Math.round(tx.amount * 100)})`;
  }
  return null;
}

async function flagMismatch(c, reference, reason) {
  console.error(`Paystack payment mismatch for ${reference}: ${reason}`);
  // Left 'pending' on purpose (never credited) with a note an admin can see
  // in the transactions list.
  await c.env.DB.prepare(
    "UPDATE transactions SET description = ?, updated_at = ? WHERE reference = ? AND status != 'successful'"
  )
    .bind(`Flagged: ${reason}`.slice(0, 200), nowIso(), reference)
    .run()
    .catch(() => {});
}

// @route GET /api/wallet/fund/verify/:reference
// Called by the frontend right after Paystack's checkout redirects back — a
// convenience for instant UI feedback. The webhook is the safety net that
// credits the wallet if the user never returns to this page.
export async function verifyFunding(c) {
  try {
    const reference = c.req.param("reference");
    const user = c.get("user");

    // Scoped to the caller: you can only verify your own payments.
    const tx = await c.env.DB.prepare(
      "SELECT status, amount FROM transactions WHERE reference = ? AND user_id = ? AND type = 'deposit'"
    )
      .bind(reference, user.id)
      .first();

    if (!tx) return c.json({ success: false, message: "Transaction not found" }, 404);
    if (tx.status === "successful") return c.json({ success: true, message: "Payment already confirmed" });

    const paystackData = await verifyTransaction(c.env, reference);

    if (paystackData.status === "success") {
      const mismatch = paymentMismatch(tx, paystackData, reference);
      if (mismatch) {
        await flagMismatch(c, reference, mismatch);
        return c.json(
          { success: false, message: "We couldn't match this payment to your request. Please contact support with your reference." },
          400
        );
      }
      await settleDeposit(c, reference);
      return c.json({ success: true, message: "Wallet funded successfully" });
    }

    if (PAYSTACK_FINAL_FAILURE.has(paystackData.status)) {
      await c.env.DB.prepare("UPDATE transactions SET status = 'failed', updated_at = ? WHERE reference = ? AND status = 'pending'")
        .bind(nowIso(), reference)
        .run();
      return c.json({ success: false, message: "Payment was not successful" }, 400);
    }

    // Still in flight: don't mark anything failed — the webhook (or a later
    // verify) will credit it when Paystack finalises.
    return c.json(
      { success: false, pending: true, message: "Your payment is still being processed. Your wallet will be credited automatically once it is confirmed." },
      202
    );
  } catch (err) {
    console.error("verifyFunding failed:", errText(err));
    return c.json({ success: false, message: "Could not verify payment", error: sanitizeError(c.env, err) }, 500);
  }
}

// Constant-time HMAC-SHA512 check (crypto.subtle.verify compares in constant
// time, unlike `===` on hex strings). Malformed/missing signature -> false.
async function verifyPaystackSignature(rawBody, secret, signatureHeader) {
  if (!secret || typeof signatureHeader !== "string" || !/^[0-9a-fA-F]{128}$/.test(signatureHeader)) return false;
  const sigBytes = new Uint8Array(signatureHeader.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(rawBody));
}

// @route POST /api/wallet/webhook  (called by Paystack's servers)
export async function paystackWebhook(c) {
  try {
    const rawBody = await c.req.text();
    const isValid = await verifyPaystackSignature(rawBody, c.env.PAYSTACK_SECRET_KEY, c.req.header("x-paystack-signature"));
    if (!isValid) return c.text("Invalid signature", 401);

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return c.text("Bad payload", 400);
    }

    if (event.event === "charge.success" && event.data?.status === "success") {
      const reference = event.data.reference;
      const tx = await c.env.DB.prepare(
        "SELECT status, amount FROM transactions WHERE reference = ? AND type = 'deposit'"
      )
        .bind(reference)
        .first();

      if (!tx) {
        // Not one of ours (or a purchase ref). 200 so Paystack stops retrying.
        console.error(`Webhook for unknown reference ${reference}`);
      } else if (tx.status !== "successful") {
        const mismatch = paymentMismatch(tx, event.data, reference);
        if (mismatch) await flagMismatch(c, reference, mismatch);
        else await settleDeposit(c, reference);
      }
    }

    return c.text("Webhook received", 200);
  } catch (err) {
    // Real failure (e.g. DB down): 500 makes Paystack retry the webhook.
    console.error("Webhook error:", errText(err));
    return c.text("Webhook processing failed", 500);
  }
}

async function recordDownloadOnly(c, resourceId, userId) {
  const ts = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE resources SET downloads = downloads + 1, updated_at = ? WHERE id = ?").bind(ts, resourceId),
    c.env.DB.prepare("INSERT INTO download_logs (id, user_id, resource_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(generateId(), userId, resourceId, ts, ts),
  ]);
}

async function ownedResponse(c, resourceId, userId) {
  await recordDownloadOnly(c, resourceId, userId);
  return c.json({
    success: true,
    alreadyOwned: true,
    fileUrl: await buildDownloadStreamUrl(c, resourceId, userId),
    message: "Download starting",
  });
}

// @route POST /api/wallet/charge  (used by the download flow across all pages)
export async function chargeForDownload(c) {
  try {
    const body = await c.req.json().catch(() => null);
    const resourceId = body?.resourceId;
    if (typeof resourceId !== "string" || !resourceId) {
      return c.json({ success: false, message: "resourceId is required" }, 400);
    }
    const user = c.get("user");

    const resource = await c.env.DB.prepare("SELECT id, status, pages, course, title FROM resources WHERE id = ?")
      .bind(resourceId)
      .first();
    if (!resource || resource.status !== "approved") {
      return c.json({ success: false, message: "Resource not available" }, 404);
    }

    // Already purchased? Free re-download.
    const existingPurchase = await c.env.DB.prepare(
      "SELECT id FROM transactions WHERE user_id = ? AND resource_id = ? AND type = 'purchase' AND status = 'successful'"
    )
      .bind(user.id, resourceId)
      .first();
    if (existingPurchase) return await ownedResponse(c, resourceId, user.id);

    const cost = calculateResourceCost(resource.pages);
    const ts = nowIso();

    // ONE atomic batch (single SQL transaction): deduct, record the purchase,
    // bump the counter, log the download, read back the balance.
    //  - Insufficient funds: the deduction would drive wallet_balance below
    //    zero, which violates the schema's CHECK (wallet_balance >= 0). That
    //    aborts and rolls back the ENTIRE batch — nothing is recorded.
    //  - Concurrent duplicate purchase (double-click / two tabs): violates
    //    the unique index on successful purchases, rolling back this batch's
    //    deduction too — so nobody is ever charged twice.
    //  - Any other failure: everything rolls back; the user keeps their money
    //    and gets no download, instead of the old "paid but nothing happened".
    let results;
    try {
      results = await c.env.DB.batch([
        c.env.DB.prepare("UPDATE users SET wallet_balance = wallet_balance - ?, updated_at = ? WHERE id = ?").bind(cost, ts, user.id),
        c.env.DB.prepare(
          `INSERT INTO transactions (id, user_id, type, amount, status, resource_id, description, created_at, updated_at)
           VALUES (?, ?, 'purchase', ?, 'successful', ?, ?, ?, ?)`
        ).bind(generateId(), user.id, cost, resourceId, `${resource.course} — ${resource.title}`, ts, ts),
        c.env.DB.prepare("UPDATE resources SET downloads = downloads + 1, updated_at = ? WHERE id = ?").bind(ts, resourceId),
        c.env.DB.prepare("INSERT INTO download_logs (id, user_id, resource_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
          .bind(generateId(), user.id, resourceId, ts, ts),
        c.env.DB.prepare("SELECT wallet_balance FROM users WHERE id = ?").bind(user.id),
      ]);
    } catch (batchErr) {
      const msg = errText(batchErr);
      if (/CHECK constraint failed/i.test(msg)) {
        const row = await c.env.DB.prepare("SELECT wallet_balance FROM users WHERE id = ?").bind(user.id).first();
        return c.json(
          { success: false, insufficientBalance: true, message: "Insufficient wallet balance", required: cost, currentBalance: row?.wallet_balance ?? 0 },
          402
        );
      }
      if (/UNIQUE constraint failed/i.test(msg) && /transactions/i.test(msg)) {
        // Lost a race against our own twin request: it already bought this.
        return await ownedResponse(c, resourceId, user.id);
      }
      throw batchErr;
    }

    let newBalance = results?.[4]?.results?.[0]?.wallet_balance;
    if (newBalance === undefined) {
      const row = await c.env.DB.prepare("SELECT wallet_balance FROM users WHERE id = ?").bind(user.id).first();
      newBalance = row?.wallet_balance;
    }

    return c.json({
      success: true,
      alreadyOwned: false,
      fileUrl: await buildDownloadStreamUrl(c, resourceId, user.id),
      newBalance,
      message: "Payment successful, download starting",
    });
  } catch (err) {
    console.error("chargeForDownload failed:", errText(err));
    return c.json({ success: false, message: "Could not process download", error: sanitizeError(c.env, err) }, 500);
  }
}
