// index.js (Final dengan Perbaikan Upload Middleware)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const ExcelJS = require('exceljs');

const app = express();
const port = process.env.PORT || 3001;

// --- Konfigurasi Multer untuk Upload File ---
const storage = multer.diskStorage({
    destination: path.join(__dirname, 'uploads'),
    filename: (req, file, cb) => {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

// ### PERBAIKAN 1: Middleware upload kini menangani semua jenis file ###
const upload = multer({ storage: storage }).fields([
    // File spesifik untuk Vendor
    { name: 'npwp_file', maxCount: 1 },
    { name: 'ktp_direktur_file', maxCount: 1 },
    { name: 'surat_pernyataan_file', maxCount: 1 },
    { name: 'akte_file', maxCount: 1 },
    { name: 'nib_file', maxCount: 1 },
    // File umum untuk PO dan Memo, 'attachments' harus cocok dengan nama <input> di frontend
    { name: 'attachments', maxCount: 10 }
]);


// --- Middleware ---
const corsOptions = {
    origin: 'http://127.0.0.1:5500',
    exposedHeaders: ['Content-Disposition'],
    optionsSuccessStatus: 200
};
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

// ### PERBAIKAN 2: Helper Function diperbarui untuk menangani req.files sebagai objek ###
const saveAttachments = async (files, related_table, related_id) => {
    if (!files) return;

    const isTextId = typeof related_id === 'string';
    const query = `
        INSERT INTO attachments (file_path, document_type, related_table, related_id_text, related_id_int) 
        VALUES ($1, $2, $3, $4, $5)`;

    for (const fieldName in files) { // Loop melalui nama field (e.g., 'attachments', 'npwp_file')
        const fileArray = files[fieldName];
        for (const file of fileArray) {
            const document_type = fieldName.toUpperCase();
            const values = [file.filename, document_type, related_table, isTextId ? related_id : null, isTextId ? null : related_id];
            await pool.query(query, values);
        }
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
        const searchTerm = req.query.search || '';
        const result = await pool.query('SELECT * FROM kategori WHERE nama_kategori ILIKE $1 ORDER BY id_kategori ASC', [`%${searchTerm}%`]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/kategori/export', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM kategori ORDER BY id_kategori ASC');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Kategori');
        worksheet.columns = [
            { header: 'ID Kategori', key: 'id_kategori', width: 15 },
            { header: 'Nama Kategori', key: 'nama_kategori', width: 30 },
        ];
        worksheet.addRows(result.rows);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="kategori.xlsx"');
        await workbook.xlsx.write(res);
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
        const searchTerm = req.query.search || '';
        const query = 'SELECT * FROM client WHERE nama_brand ILIKE $1 OR nama_pt ILIKE $1 ORDER BY id_client ASC';
        const result = await pool.query(query, [`%${searchTerm}%`]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/client/export', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM client ORDER BY id_client ASC');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Clients');
        worksheet.columns = [
            { header: 'ID Client', key: 'id_client', width: 10 },
            { header: 'Nama Brand', key: 'nama_brand', width: 30 },
            { header: 'Nama PT', key: 'nama_pt', width: 30 },
            { header: 'Alamat', key: 'alamat', width: 50 },
        ];
        worksheet.addRows(result.rows);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="clients.xlsx"');
        await workbook.xlsx.write(res);
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
const REQUIRED_DOCS = ['NPWP_FILE', 'KTP_DIREKTUR_FILE', 'SURAT_PERNYATAAN_FILE', 'AKTE_FILE', 'NIB_FILE'];

app.get('/api/vendor', async (req, res) => {
    try {
        const searchTerm = req.query.search || '';
        const searchQuery = `
            SELECT 
                v.*, 
                STRING_AGG(k.nama_kategori, ', ') AS kategori_list
            FROM vendor v
            LEFT JOIN vendor_kategori_junction j ON v.id_vendor = j.id_vendor
            LEFT JOIN kategori k ON j.id_kategori = k.id_kategori
            WHERE v.nama_pt_cv ILIKE $1 OR v.nama_vendor ILIKE $1
            GROUP BY v.id_vendor
            ORDER BY v.id_vendor ASC`;
        const result = await pool.query(searchQuery, [`%${searchTerm}%`]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vendor/export', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT v.id_vendor, v.nama_pt_cv, v.nama_vendor, v.status_verifikasi, STRING_AGG(k.nama_kategori, ', ') AS kategori_list
            FROM vendor v 
            LEFT JOIN vendor_kategori_junction j ON v.id_vendor = j.id_vendor
            LEFT JOIN kategori k ON j.id_kategori = k.id_kategori 
            GROUP BY v.id_vendor
            ORDER BY v.id_vendor ASC`);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Vendors');
        worksheet.columns = [
            { header: 'ID', key: 'id_vendor', width: 10 },
            { header: 'Nama PT/CV', key: 'nama_pt_cv', width: 30 },
            { header: 'Nama Vendor (PIC)', key: 'nama_vendor', width: 25 },
            { header: 'Kategori', key: 'kategori_list', width: 40 },
            { header: 'Status Verifikasi', key: 'status_verifikasi', width: 20 },
        ];
        worksheet.addRows(result.rows);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="vendors.xlsx"');
        await workbook.xlsx.write(res);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vendor/:id', async (req, res) => {
    try {
        const vendorResult = await pool.query('SELECT * FROM vendor WHERE id_vendor = $1', [req.params.id]);
        if (vendorResult.rows.length === 0) return res.status(404).json({ message: 'Vendor tidak ditemukan' });

        const kategoriResult = await pool.query(`
            SELECT k.id_kategori FROM kategori k
            JOIN vendor_kategori_junction j ON k.id_kategori = j.id_kategori
            WHERE j.id_vendor = $1`, [req.params.id]);

        const attachmentsResult = await pool.query(
            "SELECT id_attachment, file_path, document_type FROM attachments WHERE related_table = 'vendor' AND related_id_int = $1 ORDER BY uploaded_at DESC",
            [req.params.id]
        );

        const vendorData = vendorResult.rows[0];
        vendorData.attachments = attachmentsResult.rows;
        vendorData.kategori_ids = kategoriResult.rows.map(r => r.id_kategori);

        res.json(vendorData);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vendor', upload, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { nama_pt_cv, nama_vendor, alamat, nama_pic, nomor_pic, kategori_ids } = req.body;

        const vendorQuery = `
            INSERT INTO vendor (nama_pt_cv, nama_vendor, alamat, nama_pic, nomor_pic, status_verifikasi)
            VALUES ($1, $2, $3, $4, $5, 'Belum terverifikasi') RETURNING id_vendor`;
        const vendorResult = await client.query(vendorQuery, [nama_pt_cv, nama_vendor, alamat, nama_pic, nomor_pic]);
        const newVendorId = vendorResult.rows[0].id_vendor;

        await saveAttachments(req.files, 'vendor', newVendorId);

        const checkDocsQuery = `SELECT document_type FROM attachments WHERE related_table = 'vendor' AND related_id_int = $1`;
        const attachments = await client.query(checkDocsQuery, [newVendorId]);
        const uploadedDocTypes = attachments.rows.map(r => r.document_type);

        let docCount = 0;
        REQUIRED_DOCS.forEach(doc => {
            if (uploadedDocTypes.includes(doc)) {
                docCount++;
            }
        });

        if (docCount === REQUIRED_DOCS.length) {
            await client.query(`UPDATE vendor SET status_verifikasi = 'Terverifikasi' WHERE id_vendor = $1`, [newVendorId]);
        }

        if (kategori_ids) {
            const ids = Array.isArray(kategori_ids) ? kategori_ids : [kategori_ids];
            for (const catId of ids) {
                await client.query('INSERT INTO vendor_kategori_junction (id_vendor, id_kategori) VALUES ($1, $2)', [newVendorId, catId]);
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ id_vendor: newVendorId, message: 'Vendor berhasil dibuat' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.put('/api/vendor/:id', upload, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID Vendor tidak valid.' });
        }
        
        const { nama_pt_cv, nama_vendor, alamat, nama_pic, nomor_pic, kategori_ids } = req.body;

        await saveAttachments(req.files, 'vendor', id);

        const checkDocsQuery = `SELECT document_type FROM attachments WHERE related_table = 'vendor' AND related_id_int = $1`;
        const attachments = await client.query(checkDocsQuery, [id]);
        const uploadedDocTypes = attachments.rows.map(r => r.document_type);

        let docCount = 0;
        REQUIRED_DOCS.forEach(doc => {
            if (uploadedDocTypes.includes(doc)) {
                docCount++;
            }
        });

        const status_verifikasi = (docCount === REQUIRED_DOCS.length) ? 'Terverifikasi' : 'Belum terverifikasi';

        const query = `UPDATE vendor SET 
            nama_pt_cv = $1, nama_vendor = $2, alamat = $3, nama_pic = $4, nomor_pic = $5, status_verifikasi = $6
            WHERE id_vendor = $7`;
        await client.query(query, [nama_pt_cv, nama_vendor, alamat, nama_pic, nomor_pic, status_verifikasi, id]);

        await client.query('DELETE FROM vendor_kategori_junction WHERE id_vendor = $1', [id]);
        if (kategori_ids) {
            const ids = Array.isArray(kategori_ids) ? kategori_ids : [kategori_ids];
            for (const catId of ids) {
                await client.query('INSERT INTO vendor_kategori_junction (id_vendor, id_kategori) VALUES ($1, $2)', [id, catId]);
            }
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Vendor berhasil diperbarui' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// =================================================================
// API ENDPOINTS: PO
// =================================================================
app.get('/api/po', async (req, res) => {
    try {
        const searchTerm = req.query.search || '';
        const query = `
            SELECT po.*, v.nama_pt_cv AS nama_vendor, c.nama_brand AS nama_client
            FROM purchase_order po
            LEFT JOIN vendor v ON po.id_vendor = v.id_vendor
            LEFT JOIN client c ON po.id_client = c.id_client
            WHERE po.no_po ILIKE $1 OR po.perihal_project ILIKE $1 OR v.nama_pt_cv ILIKE $1
            ORDER BY po.tanggal_po DESC`;
        const result = await pool.query(query, [`%${searchTerm}%`]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/po/export', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT po.no_po, po.perihal_project, v.nama_pt_cv AS nama_vendor, po.nominal, po.status_po, po.tanggal_po
            FROM purchase_order po LEFT JOIN vendor v ON po.id_vendor = v.id_vendor
            ORDER BY po.tanggal_po DESC`);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Purchase Orders');
        worksheet.columns = [
            { header: 'No. PO', key: 'no_po', width: 25 },
            { header: 'Perihal Project', key: 'perihal_project', width: 40 },
            { header: 'Nama Vendor', key: 'nama_vendor', width: 30 },
            { header: 'Nominal', key: 'nominal', width: 20, style: { numFmt: '"Rp"#,##0.00' } },
            { header: 'Status', key: 'status_po', width: 15 },
            { header: 'Tanggal PO', key: 'tanggal_po', width: 15, style: { numFmt: 'dd/mm/yyyy' } },
        ];
        worksheet.addRows(result.rows);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="purchase_orders.xlsx"');
        await workbook.xlsx.write(res);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/po/:id', async (req, res) => {
    try {
        const decodedId = decodeURIComponent(req.params.id);
        const poResult = await pool.query('SELECT * FROM purchase_order WHERE no_po = $1', [decodedId]);
        if (poResult.rows.length === 0) return res.status(404).json({ message: 'PO tidak ditemukan' });

        const attachmentsResult = await pool.query(
            "SELECT id_attachment, file_path, document_type FROM attachments WHERE related_table = 'po' AND related_id_text = $1 ORDER BY uploaded_at DESC",
            [decodedId]
        );

        const poData = poResult.rows[0];
        poData.attachments = attachmentsResult.rows;

        res.json(poData);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/po', upload, async (req, res) => {
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

app.put('/api/po/:id', upload, async (req, res) => {
    try {
        const id = decodeURIComponent(req.params.id);
        const { perihal_project, nominal, status_po } = req.body;
        
        await pool.query('UPDATE purchase_order SET perihal_project = $1, nominal = $2, status_po = $3 WHERE no_po = $4',
            [perihal_project, nominal, status_po, id]);

        await saveAttachments(req.files, 'po', id);
        res.status(200).json({ message: 'PO berhasil diperbarui' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// =================================================================
// API ENDPOINTS: MEMO
// =================================================================
app.get('/api/memo', async (req, res) => {
    try {
        const searchTerm = req.query.search || '';
        const query = `
            SELECT m.*, c.nama_brand, c.nama_pt 
            FROM memo_procurement m
            LEFT JOIN client c ON m.id_client = c.id_client
            WHERE m.no_memo ILIKE $1 OR m.perihal ILIKE $1 OR c.nama_brand ILIKE $1
            ORDER BY m.no_memo ASC`;
        const result = await pool.query(query, [`%${searchTerm}%`]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/memo/export', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.no_memo, m.perihal, c.nama_brand
            FROM memo_procurement m LEFT JOIN client c ON m.id_client = c.id_client
            ORDER BY m.no_memo ASC`);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Memos');
        worksheet.columns = [
            { header: 'No. Memo', key: 'no_memo', width: 25 },
            { header: 'Perihal', key: 'perihal', width: 50 },
            { header: 'Client', key: 'nama_brand', width: 30 },
        ];
        worksheet.addRows(result.rows);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="memos.xlsx"');
        await workbook.xlsx.write(res);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/memo/:id', async (req, res) => {
    try {
        const decodedId = decodeURIComponent(req.params.id);
        const memoResult = await pool.query('SELECT * FROM memo_procurement WHERE no_memo = $1', [decodedId]);
        if (memoResult.rows.length === 0) return res.status(404).json({ message: 'Memo tidak ditemukan' });

        const attachmentsResult = await pool.query(
            "SELECT id_attachment, file_path, document_type FROM attachments WHERE related_table = 'memo' AND related_id_text = $1 ORDER BY uploaded_at DESC",
            [decodedId]
        );

        const memoData = memoResult.rows[0];
        memoData.attachments = attachmentsResult.rows;

        res.json(memoData);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/memo', upload, async (req, res) => {
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

app.put('/api/memo/:id', upload, async (req, res) => {
    try {
        const id = decodeURIComponent(req.params.id);
        const { perihal } = req.body;
        
        await pool.query('UPDATE memo_procurement SET perihal = $1 WHERE no_memo = $2', [ perihal, id ]);
        
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
        const searchTerm = req.query.search || '';
        const query = `
            SELECT i.*, po.nominal AS nominal_po
            FROM invoice i JOIN purchase_order po ON i.no_po = po.no_po
            WHERE i.no_invoice ILIKE $1 OR i.no_po ILIKE $1
            ORDER BY i.id_invoice ASC`;
        const result = await pool.query(query, [`%${searchTerm}%`]);
        const invoicesWithCalculation = result.rows.map(inv => calculateInvoiceDetails(inv, inv.nominal_po));
        res.json(invoicesWithCalculation);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/invoice/export', async (req, res) => {
    try {
        const query = `
            SELECT i.*, po.nominal AS nominal_po
            FROM invoice i JOIN purchase_order po ON i.no_po = po.no_po
            ORDER BY i.id_invoice ASC`;
        const result = await pool.query(query);
        const invoicesWithCalculation = result.rows.map(inv => calculateInvoiceDetails(inv, inv.nominal_po));

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Invoices');
        worksheet.columns = [
            { header: 'No. Invoice', key: 'no_invoice', width: 25 },
            { header: 'No. PO', key: 'no_po', width: 25 },
            { header: 'Status Invoice', key: 'status_invoice', width: 15 },
            { header: 'Termin', key: 'termin', width: 10 },
            { header: 'Grand Total', key: 'grand_total', width: 20, style: { numFmt: '"Rp"#,##0.00' } },
        ];
        worksheet.addRows(invoicesWithCalculation);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="invoices.xlsx"');
        await workbook.xlsx.write(res);
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