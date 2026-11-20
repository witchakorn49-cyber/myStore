// api/admin.js : หน้าจัดการ (เพิ่ม/แก้ไข/เปลี่ยนสถานะ) เรียกฟังก์ชันใน crud.sql ด้วย secret key
// ไฟล์เดียวรับทุกงาน แยกด้วย action เพื่อไม่ให้จำนวน function บน Vercel เพิ่ม
// ต้องตั้งใน Vercel: SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_CODE (รหัสผู้ดูแลชั่วคราว)
// ข้อจำกัด workshop: รหัสผู้ดูแลเป็นรหัสร่วม ไม่ใช่การเข้าสู่ระบบรายบุคคล ระบบจริงต้องใช้ Supabase Auth
const crypto = require('crypto');

// action -> [ชื่อฟังก์ชัน, รายชื่อช่องที่ต้องส่ง, ตัวแปลงชนิดข้อมูล]
const ACTIONS = {
  drug_create:      ['drug_create',      ['drug', 'by'],                       b => ({ p: b.drug, p_by: b.by })],
  drug_update:      ['drug_update',      ['sku', 'changes', 'reason', 'by'],   b => ({ p_sku: b.sku, p: b.changes, p_reason: b.reason, p_by: b.by })],
  drug_set_active:  ['drug_set_active',  ['sku', 'active', 'reason', 'by'],    b => ({ p_sku: b.sku, p_active: b.active === true, p_reason: b.reason, p_by: b.by })],
  stock_receive:    ['stock_receive',    ['sku', 'lot', 'received_date', 'expiry', 'qty', 'unit_cost', 'by'],
                      b => ({ p_sku: b.sku, p_lot: b.lot, p_received_date: b.received_date, p_expiry: b.expiry,
                              p_qty: Number(b.qty), p_unit_cost: Number(b.unit_cost), p_by: b.by })],
  stock_fix_expiry: ['stock_fix_expiry', ['stock_id', 'expiry', 'reason', 'by'], b => ({ p_stock_id: b.stock_id, p_expiry: b.expiry, p_reason: b.reason, p_by: b.by })],
  stock_set_status: ['stock_set_status', ['stock_id', 'status', 'reason', 'by'], b => ({ p_stock_id: b.stock_id, p_status: b.status, p_reason: b.reason, p_by: b.by })],
  dispense_return:  ['dispense_return',  ['dispense_id', 'qty', 'reason', 'by'], b => ({ p_dispense_id: b.dispense_id, p_qty: Number(b.qty), p_reason: b.reason, p_by: b.by })],
  dispense_void:    ['dispense_void',    ['dispense_id', 'reason', 'by'],      b => ({ p_dispense_id: b.dispense_id, p_reason: b.reason, p_by: b.by })],
};

function sameCode(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'ใช้ได้เฉพาะ POST' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const admin = process.env.ADMIN_CODE;
  if (!url || !key || !admin) {
    return res.status(500).json({ ok: false, message: 'ยังไม่ได้ตั้ง SUPABASE_URL, SUPABASE_SECRET_KEY หรือ ADMIN_CODE ใน Vercel' });
  }
  // รหัสผู้ดูแลส่งทาง header ไม่ใส่ใน URL
  if (!sameCode(req.headers['x-admin-code'] || '', admin)) {
    return res.status(401).json({ ok: false, message: 'รหัสผู้ดูแลไม่ถูกต้อง' });
  }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const spec = ACTIONS[b.action];
  if (!spec) return res.status(400).json({ ok: false, message: 'ไม่รู้จักงาน ' + String(b.action || '') });
  const [fn, required, toParams] = spec;
  const missing = required.filter(k => b[k] === undefined || b[k] === null || b[k] === '');
  if (missing.length) return res.status(400).json({ ok: false, message: 'ข้อมูลไม่ครบ: ' + missing.join(', ') });
  // วันที่ต้องเป็น YYYY-MM-DD เท่านั้น กันฐานข้อมูลตีความ 03/04/2027 ตาม DateStyle ผิดวันโดยไม่แจ้ง
  for (const k of ['received_date', 'expiry']) {
    if (b[k] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(b[k]))) {
      return res.status(400).json({ ok: false, message: `${k} ต้องเป็นรูปแบบ YYYY-MM-DD (ค.ศ.)` });
    }
  }

  try {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(toParams(b)),
    });
    const data = await r.json().catch(() => null);
    if (r.ok) return res.status(200).json(data);
    // P0001 = ข้อความที่ฟังก์ชัน raise เอง (กฎธุรกิจ) ส่งต่อให้ผู้ใช้ได้
    if (data && data.code === 'P0001') return res.status(400).json({ ok: false, message: data.message });
    // 23xxx = ชน constraint ที่ฟังก์ชันไม่ได้ดักไว้ ไม่ส่งรายละเอียดภายในออกไป
    if (data && /^23/.test(data.code || '')) return res.status(400).json({ ok: false, message: 'ข้อมูลขัดกฎของฐานข้อมูล ตรวจค่าที่กรอก' });
    // 22xxx = ค่าผิดชนิดหรือเกินช่วง เช่น 2027-02-30 หรือจำนวนที่ไม่ใช่ตัวเลข
    if (data && /^22/.test(data.code || '')) return res.status(400).json({ ok: false, message: 'ค่าที่กรอกผิดรูปแบบหรือเกินช่วง (วันที่ไม่มีจริง หรือจำนวนไม่ใช่ตัวเลข)' });
    return res.status(502).json({ ok: false, message: 'ฐานข้อมูลตอบผิดปกติ ตรวจ key และชื่อฟังก์ชัน (รัน crud.sql แล้วหรือยัง)' });
  } catch (e) {
    return res.status(502).json({ ok: false, message: 'เชื่อมฐานข้อมูลไม่ได้' });
  }
};
