import pool from '../db.js';

/**
 * @param {string} code
 * @returns {Promise<{code: string, timesUsed: number, usageLimit: number, expiresAt: string}>}
 * @throws {Error} if the coupon doesn't exist
 */
export async function getCoupon(code) {
  const result = await pool.query('SELECT * FROM coupons WHERE code = $1', [code]);
  if (result.rows.length === 0) {
    throw new Error(`Coupon not found: ${code}`);
  }
  const row = result.rows[0];
  return {
    code: row.code,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    minSpend: Number(row.min_spend),
    expiresAt: row.expires_at.toISOString(),
    usageLimit: row.usage_limit,
    maxDiscountAmount: row.max_discount_amount !== null ? Number(row.max_discount_amount) : null,
    usageLimitPerUser: row.usage_limit_per_user,
    timesUsed: row.times_used
  };
}
