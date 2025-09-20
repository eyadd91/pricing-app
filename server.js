// server.js
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const xlsx = require('xlsx');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// تأكد من وجود مجلد uploads
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ميدلوير
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  name: 'pricing.sid',
  secret: process.env.SESSION_SECRET || 'change_this_secret_locally',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24*60*60*1000 } // يوم واحد
}));

// إعداد multer للرفع
const upload = multer({ dest: UPLOAD_DIR });

// --- utilities ---
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const txt = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(txt);
    }
  } catch (e) {
    console.error('Error reading users.json', e);
  }
  return [];
}

function round(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// ميدلوير يحمي الراوتات
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  // إذا هو طلب API نرجع 401، وإلا نعيد توجيه لصفحة تسجيل الدخول
  if (req.xhr || req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized - login required' });
  return res.redirect('/login.html');
}

// -----------------
// Auth: login/logout
// -----------------

// POST /api/login  { username, password }
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });

    const users = loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // if user has passwordHash -> use bcrypt, else compare plain password
    if (user.passwordHash) {
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    } else if (user.password) {
      if (password !== user.password) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    } else {
      return res.status(500).json({ success: false, message: 'User record invalid (no password)' });
    }

    // ناجح -> احفظ الجلسة
    req.session.user = { username: user.username };
    return res.json({ success: true, message: 'Logged in', user: user.username });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    res.clearCookie('pricing.sid');
    return res.json({ success: true });
  });
});

// -----------------
// Protected APIs
// -----------------

// حساب تسعيرة يدوي (يتطلب تسجيل دخول)
app.post('/api/calc-price', requireLogin, (req, res) => {
  try {
    const {
      cost = 0,
      wastePercent = 0,
      fixedExpenses = 0,
      profitPercent = 20,
      profitMode = 'on_cost'
    } = req.body;

    // حساب الهدر بشكل صحيح: تحويل تكلفة الشراء (قبل الهدر) إلى تكلفة الوحدة الصالحة
    const costAfterWaste = parseFloat(cost) / (1 - parseFloat(wastePercent) / 100);
    const totalCost = costAfterWaste + parseFloat(fixedExpenses);

    let sellingPrice = 0;
    if (profitMode === 'on_price') {
      const p = parseFloat(profitPercent) / 100;
      sellingPrice = totalCost / (1 - p);
    } else {
      sellingPrice = totalCost * (1 + parseFloat(profitPercent) / 100);
    }

    return res.json({
      costAfterWaste: round(costAfterWaste),
      totalCost: round(totalCost),
      sellingPrice: round(sellingPrice)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'خطأ في حساب السعر' });
  }
});

// رفع ومعالجة ملف Excel (يتطلب تسجيل دخول)
app.post('/api/upload-excel', requireLogin, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    const wb = xlsx.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows || rows.length === 0) return res.status(400).json({ error: 'Empty sheet' });

    const headers = rows[0];
    const dataRows = rows.slice(1).filter(r => r.some(cell => cell !== ''));

    const results = dataRows.map(r => {
      const rowObj = {};
      headers.forEach((h, i) => rowObj[h] = r[i]);

      const cost = parseFloat(rowObj.Cost || rowObj.cost || 0);
      const wastePercent = parseFloat(rowObj.WastePercent || rowObj.wastePercent || 0);
      const fixedExpenses = parseFloat(rowObj.FixedExpenses || rowObj.fixedExpenses || 0);
      const profitPercent = parseFloat(rowObj.ProfitPercent || rowObj.profitPercent || 20);

      const costAfterWaste = (wastePercent >= 100) ? 0 : cost / (1 - wastePercent / 100);
      const totalCost = costAfterWaste + fixedExpenses;
      const sellingPrice = totalCost * (1 + profitPercent / 100);

      return {
        item: rowObj.Item || rowObj.item || '',
        cost: round(cost),
        wastePercent: round(wastePercent),
        fixedExpenses: round(fixedExpenses),
        profitPercent: round(profitPercent),
        costAfterWaste: round(costAfterWaste),
        totalCost: round(totalCost),
        sellingPrice: round(sellingPrice)
      };
    });

    // حذف الملف المرفوع بعد المعالجة (تنظيف)
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }

    return res.json({ rows: results });
  } catch (err) {
    console.error('upload-excel error', err);
    return res.status(500).json({ error: 'خطأ في قراءة ملف الاكسل' });
  }
});

// تصدير النتائج كملف Excel (يتطلب تسجيل دخول)
// يتوقع body.rows = [ { ... }, ... ]
app.post('/api/export-excel', requireLogin, (req, res) => {
  try {
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'No rows to export' });

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Results');

    const outPath = path.join(UPLOAD_DIR, `export_${Date.now()}.xlsx`);
    xlsx.writeFile(wb, outPath);

    res.download(outPath, 'results.xlsx', err => {
      if (err) console.error('Download error', err);
      // حاول تحذف الملف بعد التنزيل
      try { fs.unlinkSync(outPath); } catch (e) { /* ignore */ }
    });
  } catch (err) {
    console.error('export-excel error', err);
    return res.status(500).json({ error: 'Export failed' });
  }
});

// خيار: حماية الوصول للـ index.html — إذا رغبت أن تحمي الواجهة بالكامل عبر الجلسة
// إذا أردت تحويل السلوك: إلغاء تعليق السطور التالية لفرض إعادة التوجيه غير المسجلين:
// app.get('/', requireLogin, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
