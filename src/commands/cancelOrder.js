import pool from '../db.js';

/**
 * Cancel an order. If a coupon was applied, its usage count should be
 * released back.
 * @param {string} orderId
 * @returns {Promise<string>} a result message
 * @throws {Error} if the order doesn't exist or is already cancelled
 */
export async function cancelOrder(orderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (orderRes.rows.length === 0) {
      throw new Error(`Order not found: ${orderId}`);
    }
    const order = orderRes.rows[0];

    if (order.status === 'cancelled') {
      throw new Error(`Order already cancelled: ${orderId}`);
    }

    await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['cancelled', orderId]);

    const ocRes = await client.query('SELECT code FROM order_coupons WHERE order_id = $1 FOR UPDATE', [orderId]);
    const codesToRelease = new Set();
    
    if (order.coupon_code) {
      codesToRelease.add(order.coupon_code);
    }
    for (const row of ocRes.rows) {
      codesToRelease.add(row.code);
    }

    const codesArr = Array.from(codesToRelease).sort();
    for (const code of codesArr) {
      await client.query('UPDATE coupons SET times_used = GREATEST(0, times_used - 1) WHERE code = $1', [code]);
    }

    await client.query('COMMIT');
    return `Order ${orderId} cancelled successfully.`;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
