// api/dispense.js : รับคำขอขายยา แล้วเรียกฟังก์ชัน sell_drug ใน Supabase ด้วย secret key
// secret key อยู่ใน Vercel เท่านั้น ห้ามอยู่ใน repo ห้ามอยู่ในหน้าเว็บ
// (ตรงกับแม่แบบภาคผนวก ก.7 วันที่ 2 ต่างเพียงแก้เครื่องหมาย || ที่ docx แสดงเป็น ││)
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'ใช้ได้เฉพาะ POST' });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return res.status(500).json({ ok: false, message: 'ยังไม่ได้ตั้ง SUPABASE_URL หรือ SUPABASE_SECRET_KEY ใน Vercel' });
  }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const sku = String(b.sku ?? '').trim();
  const qty = Number(b.qty);
  const patient = String(b.patient_code ?? '').trim();
  const pharmacist = String(b.pharmacist_code ?? '').trim();
  if (!sku || !Number.isInteger(qty) || qty <= 0 || !patient || !pharmacist) {
    return res.status(400).json({ ok: false, message: 'ข้อมูลไม่ครบ: ต้องมียา จำนวนเต็มมากกว่า 0 รหัสผู้ป่วย และรหัสเภสัชกร' });
  }
  try {
    const r = await fetch(`${url}/rest/v1/rpc/sell_drug`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_sku: sku, p_qty: qty, p_patient_code: patient, p_pharmacist_code: pharmacist }),
    });
    const data = await r.json().catch(() => null);
    if (r.ok) return res.status(200).json(data);
    // P0001 = ข้อความที่ฟังก์ชัน raise เอง (เหตุผลทางธุรกิจ) ส่งต่อให้ผู้ใช้ได้
    if (data && data.code === 'P0001') return res.status(400).json({ ok: false, message: data.message });
    return res.status(502).json({ ok: false, message: 'ฐานข้อมูลตอบผิดปกติ ตรวจ key และชื่อฟังก์ชัน' });
  } catch (e) {
    return res.status(502).json({ ok: false, message: 'เชื่อมฐานข้อมูลไม่ได้' });
  }
};
