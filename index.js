// index.js (Backend Final & Lengkap)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs'); // Modul File System untuk menghapus file

const app = express();
const port = process.env.PORT || 3001;

// --- Konfigurasi Multer untuk Upload File ---
const storage = multer.diskStorage({
    destination: path.join(__dirname, 'uploads'),
    filename: (req, file, cb) => {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- Middleware ---
const corsOptions = { origin: 'http://127.0.0.1:5500', optionsSuccessStatus: 200 };
app.use(cors(corsOptions));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Konfigurasi Database Pool ---
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// --- Helper Function ---
const saveAttachments = async (files, related_table, related_id) => {
    if (!files || files.length === 0) return;
    const isTextId = typeof related_id === 'string';
    const query = `
        INSERT INTO attachments (file_path, related_table, related_id_text, related_id_int) 
        VALUES ($1, $2, $3, $4)`;
    for (const file of files) {
        const values = [file.filename, related_table, isTextId ? related_id : null, isTextId ? null : related_id];
        await pool.query(query, values);
    }
};

// --- ROUTES ---
app.get('/', (req, res) => res.send('API Pendataan Berjalan!'));

// =================================================================
// API ENDPOINT: ATTACHMENTS
// =================================================================
app.delete('/api/attachments/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const fileResult = await client.query('SELECT file_path FROM attachments WHERE id_attachment = $1', [req.params.id]);
        if (fileResult.rows.length === 0) {
            throw new Error('Attachment tidak ditemukan.');
        }
        const filePath = fileResult.rows[0].file_path;

        await client.query('DELETE FROM attachments WHERE id_attachment = $1', [req.params.id]);
        
        const fullPath = path.join(__dirname, 'uploads', filePath);
        fs.unlink(fullPath, (err) => {
            if (err) console.error("Gagal menghapus file dari server:", err);
            else console.log("File berhasil dihapus dari server:", fullPath);
        });
        
        await client.query('COMMIT');
        res.status(200).json({ message: 'Attachment berhasil dihapus' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// =================================================================
// API ENDPOINT: DASHBOARD
// =================================================================
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const totalPoQuery = pool.query('SELECT COUNT(*) AS total_po, SUM(nominal) AS total_value FROM purchase_order');
        const paidInvoiceQuery = pool.query("SELECT COUNT(*) FROM invoice WHERE status_invoice = 'Paid'");
        const pendingInvoiceQuery = pool.query("SELECT COUNT(*) FROM invoice WHERE status_invoice IN ('Bill', 'Unbill')");
        const recentPoQuery = pool.query(`
            SELECT po.no_po, po.perihal_project, v.nama_pt_cv AS nama_vendor, po.nominal
            FROM purchase_order po JOIN vendor v ON po.id_vendor = v.id_vendor
            ORDER BY po.tanggal_po DESC LIMIT 5`);

        const [poResult, paidInvoiceResult, pendingInvoiceResult, recentPoResult] = await Promise.all([
            totalPoQuery, paidInvoiceQuery, pendingInvoiceQuery, recentPoQuery
        ]);
        const stats = {
            total_po: poResult.rows[0].total_po || 0,
            total_value: poResult.rows[0].total_value || 0,
            paid_invoices: paidInvoiceResult.rows[0].count || 0,
            pending_invoices: pendingInvoiceResult.rows[0].count || 0,
            recent_pos: recentPoResult.rows
        };
        res.json(stats);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =================================================================
// API ENDPOINTS: KATEGORI
// =================================================================
app.get('/api/kategori', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM kategori ORDER BY id_kategori ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/kategori/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM kategori WHERE id_kategori = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/kategori', async (req, res) => {
    try {
        const { nama_kategori } = req.body;
        const result = await pool.query('INSERT INTO kategori (nama_kategori) VALUES ($1) RETURNING *', [nama_kategori]);
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/kategori/:id', async (req, res) => {
    try {
        const { nama_kategori } = req.body;
        const result = await pool.query('UPDATE kategori SET nama_kategori = $1 WHERE id_kategori = $2 RETURNING *', [nama_kategori, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =================================================================
// API ENDPOINTS: CLIENT
// =================================================================
app.get('/api/client', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM client ORDER BY id_client ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/client/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM client WHERE id_client = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/client', async (req, res) => {
    try {
        const { nama_brand, nama_pt, alamat } = req.body;
        const result = await pool.query('INSERT INTO client (nama_brand, nama_pt, alamat) VALUES ($1, $2, $3) RETURNING *', [nama_brand, nama_pt, alamat]);
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/client/:id', async (req, res) => {
    try {
        const { nama_brand, nama_pt, alamat } = req.body;
        const result = await pool.query('UPDATE client SET nama_brand = $1, nama_pt = $2, alamat = $3 WHERE id_client = $4 RETURNING *', [nama_brand, nama_pt, alamat, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =================================================================
// API ENDPOINTS: VENDOR
// =================================================================
app.get('/api/vendor', async (req, res) => {
    try {
        const query = `
            SELECT v.*, k.nama_kategori 
            FROM vendor v LEFT JOIN kategori k ON v.id_kategori = k.id_kategori
            ORDER BY v.id_vendor ASC`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vendor/:id', async (req, res) => {
    try {
        const vendorResult = await pool.query('SELECT * FROM vendor WHERE id_vendor = $1', [req.params.id]);
        if (vendorResult.rows.length === 0) return res.status(404).json({ message: 'Vendor tidak ditemukan' });
        
        const attachmentsResult = await pool.query(
            "SELECT id_attachment, file_path FROM attachments WHERE related_table = 'vendor' AND related_id_int = $1 ORDER BY uploaded_at DESC",
            [req.params.id]
        );
        
        const vendorData = vendorResult.rows[0];
        vendorData.attachments = attachmentsResult.rows;
        
        res.json(vendorData);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vendor', upload.array('attachments', 10), async (req, res) => {
    const { nama_pt_cv, nama_vendor, id_kategori, alamat, no_pic, nama_pic, status_verifikasi } = req.body;
    const query = `
        INSERT INTO vendor (nama_pt_cv, nama_vendor, id_kategori, alamat, no_pic, nama_pic, status_verifikasi)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_vendor`;
    try {
        const result = await pool.query(query, [nama_pt_cv, nama_vendor, id_kategori, alamat, no_pic, nama_pic, status_verifikasi]);
        const newVendorId = result.rows[0].id_vendor;
        await saveAttachments(req.files, 'vendor', newVendorId);
        res.status(201).json({ id_vendor: newVendorId, message: 'Vendor berhasil dibuat' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/vendor/:id', upload.array('attachments', 10), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const oldDataResult = await pool.query('SELECT * FROM vendor WHERE id_vendor = $1', [id]);
        const oldData = oldDataResult.rows[0];

        const updatedData = {
            nama_pt_cv: req.body.nama_pt_cv || oldData.nama_pt_cv,
            status_verifikasi: req.body.status_verifikasi || oldData.status_verifikasi,
            nama_vendor: req.body.nama_vendor || oldData.nama_vendor,
            id_kategori: req.body.id_kategori || oldData.id_kategori,
            alamat: req.body.alamat || oldData.alamat,
            no_pic: req.body.no_pic || oldData.no_pic,
            nama_pic: req.body.nama_pic || oldData.nama_pic,
        };

        const query = 'UPDATE vendor SET nama_pt_cv = $1, status_verifikasi = $2, nama_vendor=$3, id_kategori=$4, alamat=$5, no_pic=$6, nama_pic=$7 WHERE id_vendor = $8';
        const values = [...Object.values(updatedData), id];
        await pool.query(query, values);
        
        await saveAttachments(req.files, 'vendor', id);
        
        res.status(200).json({ message: 'Vendor berhasil diperbarui' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =================================================================
// API ENDPOINTS: PO
// =================================================================
app.get('/api/po', async (req, res) => {
    try {
        const query = `
            SELECT po.*, v.nama_pt_cv AS nama_vendor, c.nama_brand AS nama_client
            FROM purchase_order po
            LEFT JOIN vendor v ON po.id_vendor = v.id_vendor
            LEFT JOIN client c ON po.id_client = c.id_client
            ORDER BY po.tanggal_po DESC`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/po/:id', async (req, res) => {
    try {
        const decodedId = decodeURIComponent(req.params.id);
        const poResult = await pool.query('SELECT * FROM purchase_order WHERE no_po = $1', [decodedId]);
        if (poResult.rows.length === 0) return res.status(404).json({ message: 'PO tidak ditemukan' });

        const attachmentsResult = await pool.query(
            "SELECT id_attachment, file_path FROM attachments WHERE related_table = 'po' AND related_id_text = $1 ORDER BY uploaded_at DESC",
            [decodedId]
        );
        
        const poData = poResult.rows[0];
        poData.attachments = attachmentsResult.rows;
        
        res.json(poData);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/po', upload.array('attachments', 10), async (req, res) => {
    const { no_po, id_vendor, id_client, no_memo, nominal, perihal_project, tanggal_po, status_po } = req.body;
    const query = `
        INSERT INTO purchase_order (no_po, id_vendor, id_client, no_memo, nominal, perihal_project, tanggal_po, status_po)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING no_po`;
    try {
        const result = await pool.query(query, [no_po, id_vendor, id_client, no_memo, nominal, perihal_project, tanggal_po, status_po]);
        const newPoId = result.rows[0].no_po;
        await saveAttachments(req.files, 'po', newPoId);
        res.status(201).json({ no_po: newPoId, message: 'PO berhasil dibuat' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/po/:id', upload.array('attachments', 10), async (req, res) => {
    try {
        const id = decodeURIComponent(req.params.id);
        const oldDataResult = await pool.query('SELECT * FROM purchase_order WHERE no_po = $1', [id]);
        const oldData = oldDataResult.rows[0];

        const updatedData = {
            perihal_project: req.body.perihal_project || oldData.perihal_project,
            nominal: req.body.nominal || oldData.nominal,
            status_po: req.body.status_po || oldData.status_po,
            id_vendor: req.body.id_vendor || oldData.id_vendor,
            id_client: req.body.id_client || oldData.id_client,
            no_memo: req.body.no_memo || oldData.no_memo,
            tanggal_po: req.body.tanggal_po || oldData.tanggal_po,
        };

        const query = 'UPDATE purchase_order SET perihal_project = $1, nominal = $2, status_po = $3, id_vendor=$4, id_client=$5, no_memo=$6, tanggal_po=$7 WHERE no_po = $8';
        const values = [...Object.values(updatedData), id];
        await pool.query(query, values);

        await saveAttachments(req.files, 'po', id);
        res.status(200).json({ message: 'PO berhasil diperbarui' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =================================================================
// API ENDPOINTS: MEMO
// =================================================================
app.get('/api/memo', async (req, res) => {
    try {
        const query = `
            SELECT m.*, c.nama_brand, c.nama_pt 
            FROM memo_procurement m
            LEFT JOIN client c ON m.id_client = c.id_client
            ORDER BY m.no_memo ASC`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/memo/:id', async (req, res) => {
     try {
        const decodedId = decodeURIComponent(req.params.id);
        const memoResult = await pool.query('SELECT * FROM memo_procurement WHERE no_memo = $1', [decodedId]);
        if (memoResult.rows.length === 0) return res.status(404).json({ message: 'Memo tidak ditemukan' });

        const attachmentsResult = await pool.query(
            "SELECT id_attachment, file_path FROM attachments WHERE related_table = 'memo' AND related_id_text = $1 ORDER BY uploaded_at DESC",
            [decodedId]
        );
        
        const memoData = memoResult.rows[0];
        memoData.attachments = attachmentsResult.rows;
        
        res.json(memoData);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/memo', upload.array('attachments', 10), async (req, res) => {
    const { no_memo, id_client, perihal } = req.body;
    const query = `
        INSERT INTO memo_procurement (no_memo, id_client, perihal) 
        VALUES ($1, $2, $3) RETURNING no_memo`;
    try {
        const result = await pool.query(query, [no_memo, id_client, perihal]);
        const newMemoId = result.rows[0].no_memo;
        await saveAttachments(req.files, 'memo', newMemoId);
        res.status(201).json({ no_memo: newMemoId, message: 'Memo berhasil dibuat' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/memo/:id', upload.array('attachments', 10), async (req, res) => {
    try {
        const id = decodeURIComponent(req.params.id);
        const oldDataResult = await pool.query('SELECT * FROM memo_procurement WHERE no_memo = $1', [id]);
        const oldData = oldDataResult.rows[0];

        const updatedData = {
            perihal: req.body.perihal || oldData.perihal,
            id_client: req.body.id_client || oldData.id_client,
        };

        const query = 'UPDATE memo_procurement SET perihal = $1, id_client=$2 WHERE no_memo = $3';
        const values = [...Object.values(updatedData), id];
        await pool.query(query, values);
        
        await saveAttachments(req.files, 'memo', id);
        res.status(200).json({ message: 'Memo berhasil diperbarui' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =================================================================
// API ENDPOINTS: INVOICE
// =================================================================
const calculateInvoiceDetails = (invoice, nominal_po) => {
    const dpp = parseFloat(nominal_po) * (parseFloat(invoice.invoice_portion_percent) / 100);
    const ppn = invoice.ppn_status === 'PKP' ? dpp * 0.11 : 0;
    const pph = dpp * 0.02;
    const grand_total = dpp + ppn - pph;
    return { ...invoice, nominal_po, dpp, ppn, pph, grand_total };
};

app.get('/api/invoice', async (req, res) => {
    try {
        const query = `
            SELECT i.*, po.nominal AS nominal_po
            FROM invoice i JOIN purchase_order po ON i.no_po = po.no_po
            ORDER BY i.id_invoice ASC`;
        const result = await pool.query(query);
        const invoicesWithCalculation = result.rows.map(inv => calculateInvoiceDetails(inv, inv.nominal_po));
        res.json(invoicesWithCalculation);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/invoice/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM invoice WHERE id_invoice = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/invoice', async (req, res) => {
    try {
        const { no_po, no_invoice, status_invoice, termin, invoice_portion_percent, ppn_status } = req.body;
        const query = `
            INSERT INTO invoice (no_po, no_invoice, status_invoice, termin, invoice_portion_percent, ppn_status)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
        const result = await pool.query(query, [no_po, no_invoice, status_invoice, termin, invoice_portion_percent, ppn_status]);
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/invoice/:id', async (req, res) => {
    try {
        const { no_po, no_invoice, status_invoice, termin, invoice_portion_percent, ppn_status } = req.body;
        const query = `
            UPDATE invoice SET no_po = $1, no_invoice = $2, status_invoice = $3, termin = $4, invoice_portion_percent = $5, ppn_status = $6
            WHERE id_invoice = $7 RETURNING *`;
        const result = await pool.query(query, [no_po, no_invoice, status_invoice, termin, invoice_portion_percent, ppn_status, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// --- Jalankan Server ---
app.listen(port, () => {
  console.log(`🚀 Server berjalan di http://localhost:${port}`);
});