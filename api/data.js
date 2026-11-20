// api/data.js : อ่านข้อมูลจาก Supabase ด้วย publishable key (อ่านได้อย่างเดียวตาม RLS)
// คืน JSON รูปทรงเดียวกับไฟล์วันแรก (drugs / stock / dispense_log แต่ละก้อนมี meta และ items)
// เพิ่มจากแม่แบบวันที่ 2: catalog = บัญชียาทุกตัวจาก v_drug_catalog (มี is_active, lot_count, usable_qty)
//   สำหรับหน้า admin.html ส่วน drugs เดิมคงไว้ dashboard และ pos.html จึงใช้ได้โดยไม่ต้องแก้
const TABLES = {
  drugs: 'drugs?select=*&order=sku',
  stock: 'stock?select=*&order=stock_id',
  dispense_log: 'dispense_log?select=*&order=dispense_id',
  catalog: 'v_drug_catalog?select=*&order=sku',
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'ยังไม่ได้ตั้ง SUPABASE_URL หรือ SUPABASE_PUBLISHABLE_KEY ใน Vercel' });
  }
  try {
    const headers = { apikey: key };            // ส่ง key ทาง header ชื่อ apikey เท่านั้น
    const get = async (path) => {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers });
      if (!r.ok) throw new Error(`Supabase ตอบ ${r.status} ที่ ${path.split('?')[0]}`);
      return r.json();
    };
    // catalog อ่านแยก ถ้ายังไม่ได้รัน crud.sql ข้อมูลเดิมยังส่งได้ dashboard และ pos.html จึงไม่พังตาม
    const getCatalog = get(TABLES.catalog).then(
      items => ({ items }),
      () => ({ error: 'ยังไม่มี v_drug_catalog ให้รัน crud.sql ใน Supabase' }));
    const [cfg, drugs, stock, dispense, catalog] = await Promise.all([
      get('app_config?select=as_of&id=eq.1'),
      get(TABLES.drugs), get(TABLES.stock), get(TABLES.dispense_log), getCatalog,
    ]);
    // ตารางที่ไม่มีนโยบายอ่านจะคืน [] โดยไม่แจ้ง error จึงต้องตรวจเอง
    if (!cfg.length || !drugs.length || !stock.length) {
      return res.status(502).json({ error: 'ได้ข้อมูลว่าง ตรวจนโยบายสิทธิ์เข้าถึงแถว (RLS) ของตาราง' });
    }
    const meta = { as_of: cfg[0].as_of, source: 'supabase' };
    const out = {
      drugs: { meta, items: drugs },
      stock: { meta, items: stock },
      dispense_log: { meta, items: dispense },
    };
    if (catalog.items) out.catalog = { meta, items: catalog.items };
    else out.catalog_error = catalog.error;
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};
