import pool from '../db.js';

/**
 * Create a new order for `cartTotal` and apply a single coupon to it:
 * validate the coupon, compute the discount, record the redemption
 * (counts against the coupon's usage_limit, and its usage_limit_per_user
 * if `userId` is given — bonus 2), and store the result on the order.
 * @param {number} cartTotal
 * @param {string} code
 * @param {string|null} [userId] - bonus 2: required if the coupon has a usage_limit_per_user
 * @returns {Promise<{orderId: string, discountAmount: number, finalTotal: number}>}
 * @throws {Error} if the coupon is invalid, expired, below min spend, or
 *   at its usage limit (global or per-user)
 */
export async function applyCoupon(cartTotal, code, userId = null) {
  const cartTotalNum = Number(cartTotal);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const couponRes = await client.query('SELECT * FROM coupons WHERE code = $1 FOR UPDATE', [code]);
    if (couponRes.rows.length === 0) {
      throw new Error(`Coupon not found: ${code}`);
    }
    const coupon = couponRes.rows[0];

    if (new Date() > coupon.expires_at) {
      throw new Error(`Coupon expired: ${code}`);
    }
    if (cartTotalNum < Number(coupon.min_spend)) {
      throw new Error(`Cart total below minimum spend of ${coupon.min_spend}`);
    }
    if (coupon.times_used >= coupon.usage_limit) {
      throw new Error(`Coupon usage limit reached: ${code}`);
    }
    if (coupon.usage_limit_per_user !== null && !userId) {
      throw new Error(`User ID is required for coupon: ${code}`);
    }

    if (coupon.usage_limit_per_user !== null) {
      const userRes = await client.query(`
        SELECT COUNT(*) as count 
        FROM order_coupons oc
        JOIN orders o ON o.id = oc.order_id
        WHERE oc.code = $1 AND o.user_id = $2 AND o.status != 'cancelled'
      `, [code, userId]);
      
      const userCount = Number(userRes.rows[0].count);
      if (userCount >= coupon.usage_limit_per_user) {
        throw new Error(`User usage limit reached for coupon: ${code}`);
      }
    }

    let discountAmount = 0;
    const value = Number(coupon.discount_value);
    
    if (coupon.discount_type === 'percent') {
      discountAmount = cartTotalNum * (value / 100);
      if (coupon.max_discount_amount !== null) {
        discountAmount = Math.min(discountAmount, Number(coupon.max_discount_amount));
      }
    } else if (coupon.discount_type === 'flat') {
      discountAmount = value;
    }

    let finalTotal = cartTotalNum - discountAmount;
    if (finalTotal < 0) {
      discountAmount = cartTotalNum;
      finalTotal = 0;
    }

    discountAmount = Math.round(discountAmount * 100) / 100;
    finalTotal = Math.round(finalTotal * 100) / 100;

    await client.query('UPDATE coupons SET times_used = times_used + 1 WHERE code = $1', [code]);

    const orderRes = await client.query(`
      INSERT INTO orders (cart_total, coupon_code, discount_amount, final_total, user_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [cartTotalNum, code, discountAmount, finalTotal, userId]);
    const orderId = orderRes.rows[0].id;

    await client.query(`
      INSERT INTO order_coupons (order_id, code, discount_amount)
      VALUES ($1, $2, $3)
    `, [orderId, code, discountAmount]);

    await client.query('COMMIT');
    
    return {
      orderId,
      discountAmount,
      finalTotal
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
