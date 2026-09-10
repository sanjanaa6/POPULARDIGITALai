import pool from '../db.js';

/**
 * Create a new coupon.
 * @param {string} code
 * @param {'percent'|'flat'} discountType
 * @param {number} discountValue
 * @param {number} minSpend
 * @param {string} expiresAt - ISO date string
 * @param {number} usageLimit
 * @param {number|null} [maxDiscountAmount] - bonus 1: cap on computed discount for percent coupons
 * @param {number|null} [usageLimitPerUser] - bonus 2: per-user redemption cap
 * @returns {Promise<string>} a result message
 * @throws {Error} on invalid input or duplicate code
 */
export async function createCoupon(
  code,
  discountType,
  discountValue,
  minSpend,
  expiresAt,
  usageLimit,
  maxDiscountAmount = null,
  usageLimitPerUser = null
) {
  try {
    await pool.query(
      `INSERT INTO coupons (
        code, discount_type, discount_value, min_spend, expires_at, usage_limit, max_discount_amount, usage_limit_per_user
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        code,
        discountType,
        discountValue,
        minSpend,
        expiresAt,
        usageLimit,
        maxDiscountAmount,
        usageLimitPerUser
      ]
    );
    return `Coupon ${code} created successfully.`;
  } catch (err) {
    if (err.code === '23505') {
      throw new Error(`Duplicate coupon code: ${code}`);
    }
    throw new Error(`Failed to create coupon: ${err.message}`);
  }
}
