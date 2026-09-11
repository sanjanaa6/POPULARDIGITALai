import test from 'node:test';
import assert from 'node:assert/strict';

import pool from '../src/db.js';
import { createCoupon } from '../src/commands/createCoupon.js';
import { applyCoupon } from '../src/commands/applyCoupon.js';
import { getCoupon } from '../src/commands/getCoupon.js';
import { cancelOrder } from '../src/commands/cancelOrder.js';

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function uniqueCode(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

async function cleanup(code) {
  await pool.query('DELETE FROM order_coupons WHERE code = $1', [code]);
  await pool.query('DELETE FROM orders WHERE coupon_code = $1', [code]);
  await pool.query('DELETE FROM coupons WHERE code = $1', [code]);
}

test('create coupon then look it up and verify timesUsed starts at 0', async () => {
  const code = uniqueCode('CREATE');

  try {
    await createCoupon(code, 'percent', 15, 20, tomorrow, 50);
    const coupon = await getCoupon(code);

    assert.equal(coupon.code, code);
    assert.equal(coupon.discountType, 'percent');
    assert.equal(coupon.discountValue, 15);
    assert.equal(coupon.minSpend, 20);
    assert.equal(coupon.timesUsed, 0);
  } finally {
    await cleanup(code);
  }
});

test('apply a percent coupon computes the correct discount and final total', async () => {
  const code = uniqueCode('PERCENT');

  try {
    await createCoupon(code, 'percent', 15, 20, tomorrow, 50);

    const result = await applyCoupon(100, code);

    assert.equal(result.discountAmount, 15);
    assert.equal(result.finalTotal, 85);

    const coupon = await getCoupon(code);
    assert.equal(coupon.timesUsed, 1);
  } finally {
    await cleanup(code);
  }
});

test('apply a flat coupon computes the correct discount and final total', async () => {
  const code = uniqueCode('FLAT');

  try {
    await createCoupon(code, 'flat', 5, 0, tomorrow, 50);

    const result = await applyCoupon(100, code);

    assert.equal(result.discountAmount, 5);
    assert.equal(result.finalTotal, 95);

    const coupon = await getCoupon(code);
    assert.equal(coupon.timesUsed, 1);
  } finally {
    await cleanup(code);
  }
});

test('reject applying a coupon below its minimum spend', async () => {
  const code = uniqueCode('MINSPEND');

  try {
    await createCoupon(code, 'percent', 10, 50, tomorrow, 50);

    await assert.rejects(
      () => applyCoupon(40, code),
      /Cart total below minimum spend of 50/
    );
  } finally {
    await cleanup(code);
  }
});

test('reject applying an expired coupon', async () => {
  const code = uniqueCode('EXPIRED');

  try {
    await createCoupon(code, 'flat', 5, 0, yesterday, 50);

    await assert.rejects(
      () => applyCoupon(100, code),
      /Coupon expired/
    );
  } finally {
    await cleanup(code);
  }
});

test('reject an unknown coupon code', async () => {
  await assert.rejects(
    () => applyCoupon(100, uniqueCode('UNKNOWN')),
    /Coupon not found/
  );
});

test('cancel an order and release the coupon usage back', async () => {
  const code = uniqueCode('CANCEL');

  try {
    await createCoupon(code, 'percent', 10, 0, tomorrow, 50);

    const result = await applyCoupon(100, code);
    const beforeCancel = await getCoupon(code);

    assert.equal(beforeCancel.timesUsed, 1);

    await cancelOrder(result.orderId);

    const afterCancel = await getCoupon(code);
    assert.equal(afterCancel.timesUsed, 0);
  } finally {
    await cleanup(code);
  }
});

test('reject applying a coupon after its usage limit is reached', async () => {
  const code = uniqueCode('LIMIT');

  try {
    await createCoupon(code, 'flat', 5, 0, tomorrow, 1);

    await applyCoupon(100, code);

    await assert.rejects(
      () => applyCoupon(100, code),
      /Coupon usage limit reached/
    );
  } finally {
    await cleanup(code);
  }
});
