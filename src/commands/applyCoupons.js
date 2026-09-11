import pool from '../db.js';

/**
 * BONUS 3 (stackable coupons). Create a new order for `cartTotal` and
 * apply one or two coupons to it in a single request: at most one
 * `percent` and one `flat` coupon, applied in a well-defined order you
 * choose and document. Validation and redemption must be all-or-nothing —
 * if either coupon is invalid, neither is consumed and no order is
 * created.
 * @param {number} cartTotal
 * @param {string[]} codes - 1 or 2 coupon codes
 * @param {string|null} [userId]
 * @returns {Promise<{orderId: string, discountAmount: number, finalTotal: number, appliedCodes: string[]}>}
 * @throws {Error} if codes.length > 2, both codes are the same
 *   discount_type, or any coupon fails validation
 */
export async function applyCoupons(cartTotal, codes, userId = null) {
  const cartTotalNum = Number(cartTotal);
  if (!Array.isArray(codes) || codes.length === 0 || codes.length > 2) {
    throw new Error('Must provide 1 or 2 coupon codes');
  }
  if (codes.length === 2 && codes[0] === codes[1]) {
    throw new Error('Cannot apply the same coupon code twice');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sortedCodes = [...codes].sort();
    const couponsRes = await client.query('SELECT * FROM coupons WHERE code = ANY($1) ORDER BY code FOR UPDATE', [sortedCodes]);
    
    if (couponsRes.rows.length !== codes.length) {
      throw new Error(`One or more coupons not found`);
    }

    const coupons = couponsRes.rows;

    if (coupons.length === 2) {
      if (coupons[0].discount_type === coupons[1].discount_type) {
        throw new Error('Cannot stack two coupons of the same type');
      }
    }

    const now = new Date();
    for (const coupon of coupons) {
      if (now > coupon.expires_at) {
        throw new Error(`Coupon expired: ${coupon.code}`);
      }
      if (cartTotalNum < Number(coupon.min_spend)) {
        throw new Error(`Cart total below minimum spend of ${coupon.min_spend} for coupon: ${coupon.code}`);
      }
      if (coupon.times_used >= coupon.usage_limit) {
        throw new Error(`Coupon usage limit reached: ${coupon.code}`);
      }

      if (userId && coupon.usage_limit_per_user !== null) {
        const userRes = await client.query(`
          SELECT COUNT(*) as count 
          FROM order_coupons oc
          JOIN orders o ON o.id = oc.order_id
          WHERE oc.code = $1 AND o.user_id = $2 AND o.status != 'cancelled'
        `, [coupon.code, userId]);
        
        const userCount = Number(userRes.rows[0].count);
        if (userCount >= coupon.usage_limit_per_user) {
          throw new Error(`User usage limit reached for coupon: ${coupon.code}`);
        }
      }
    }

    // Order of application: percent discount is applied first, then flat discount.
    const percentCoupon = coupons.find(c => c.discount_type === 'percent');
    const flatCoupon = coupons.find(c => c.discount_type === 'flat');

    let currentTotal = cartTotalNum;
    let totalDiscountAmount = 0;
    const appliedDiscounts = [];

    const couponsToApply = [];
    if (percentCoupon) couponsToApply.push(percentCoupon);
    if (flatCoupon) couponsToApply.push(flatCoupon);

    for (const coupon of couponsToApply) {
      let discountAmount = 0;
      const value = Number(coupon.discount_value);
      
      if (coupon.discount_type === 'percent') {
        discountAmount = currentTotal * (value / 100);
        if (coupon.max_discount_amount !== null) {
          discountAmount = Math.min(discountAmount, Number(coupon.max_discount_amount));
        }
      } else if (coupon.discount_type === 'flat') {
        discountAmount = value;
      }

      discountAmount = Math.round(discountAmount * 100) / 100;
      
      let newTotal = currentTotal - discountAmount;
      if (newTotal < 0) {
        discountAmount = currentTotal;
        newTotal = 0;
      }

      currentTotal = newTotal;
      totalDiscountAmount += discountAmount;

      appliedDiscounts.push({
        code: coupon.code,
        amount: discountAmount
      });
    }

    let finalTotal = currentTotal;
    totalDiscountAmount = Math.round(totalDiscountAmount * 100) / 100;
    finalTotal = Math.round(finalTotal * 100) / 100;

    for (const coupon of coupons) {
      await client.query('UPDATE coupons SET times_used = times_used + 1 WHERE code = $1', [coupon.code]);
    }

    const firstCode = codes.length === 1 ? codes[0] : null;
    
    const orderRes = await client.query(`
      INSERT INTO orders (cart_total, coupon_code, discount_amount, final_total, user_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [cartTotalNum, firstCode, totalDiscountAmount, finalTotal, userId]);
    const orderId = orderRes.rows[0].id;

    for (const applied of appliedDiscounts) {
      await client.query(`
        INSERT INTO order_coupons (order_id, code, discount_amount)
        VALUES ($1, $2, $3)
      `, [orderId, applied.code, applied.amount]);
    }

    await client.query('COMMIT');
    
    return {
      orderId,
      discountAmount: totalDiscountAmount,
      finalTotal,
      appliedCodes: appliedDiscounts.map(d => d.code)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
