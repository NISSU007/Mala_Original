const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. การเชื่อมต่อฐานข้อมูล
// ==========================================
const dbPath = path.join(__dirname, 'mala.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('เชื่อมต่อฐานข้อมูลล้มเหลว:', err.message);
    } else {
        console.log('เชื่อมต่อฐานข้อมูล SQLite สำเร็จ');
    }
});

// ==========================================
// 2. ตั้งค่า Middlewares & Template Engine
// ==========================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'mala_secret_key_2026',
    resave: false,
    saveUninitialized: true
}));

app.use((req, res, next) => {
    if (!req.session.cart) {
        req.session.cart = [];
    }
    const cart = req.session.cart;
    res.locals.cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    res.locals.cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
    next();
});

// ==========================================
// ฟังก์ชันช่วยเหลือ (Helper Function)
// ==========================================
function normalizeCategory(catName) {
    if (!catName) return 'อื่นๆ';
    const name = catName.trim();
    if (name.includes('ซุป')) return 'ซุป';
    if (name.includes('เนื้อ')) return 'เนื้อสัตว์';
    if (name.includes('ซีฟู้ด') || name.includes('ทะเล')) return 'ซีฟู้ด';
    if (name.includes('ผัก')) return 'ผัก';
    if (name.includes('ลูกชิ้น') || name.includes('แปรรูป')) return 'ลูกชิ้นและของแปรรูป';
    if (name.includes('เส้น')) return 'เส้น';
    if (name.includes('ทานเล่น') || name.includes('ของทาน')) return 'ของทานเล่น';
    if (name.includes('น้ำ') || name.includes('เครื่องดื่ม')) return 'เครื่องดื่ม';
    return 'อื่นๆ';
}

// ==========================================
// 3. การจัดการเส้นทาง (ROUTES)
// ==========================================

// [GET] หน้าแรก
app.get('/', (req, res) => {
    db.all('SELECT * FROM Category', [], (err, categories) => {
        if (err) return res.status(500).send('Database Error: ' + err.message);
        
        db.all('SELECT * FROM Menu WHERE Is_Available = 1', [], (err, menuList) => {
            if (err) return res.status(500).send('Database Error: ' + err.message);
            
            const menus = { 'ซุป': [], 'เนื้อสัตว์': [], 'ซีฟู้ด': [], 'ผัก': [], 'ลูกชิ้นและของแปรรูป': [], 'เส้น': [], 'อื่นๆ': [], 'ของทานเล่น': [], 'เครื่องดื่ม': [] };

            const catMap = {};
            categories.forEach(cat => {
                catMap[cat.Category_ID] = normalizeCategory(cat.Category_Name);
            });

            menuList.forEach(item => {
                const mappedCat = catMap[item.Category_ID] || 'อื่นๆ';
                if (menus[mappedCat]) {
                    menus[mappedCat].push(item);
                } else {
                    menus['อื่นๆ'].push(item);
                }
            });

            res.render('index', { menus });
        });
    });
});

// [GET] หน้ารายละเอียดเมนูอาหาร
app.get('/menu/:id', (req, res) => {
    const menuId = req.params.id;
    const { cartItemId } = req.query; 

    let editItem = null;
    if (cartItemId && req.session.cart) {
        editItem = req.session.cart.find(i => i.cartItemId === cartItemId) || null;
    }

    const sql = `SELECT m.*, c.Category_Name 
                 FROM Menu m 
                 LEFT JOIN Category c ON m.Category_ID = c.Category_ID 
                 WHERE m.Menu_ID = ?`;
                 
    db.get(sql, [menuId], (err, item) => {
        if (err || !item) return res.redirect('/');
        
        const categoryGroup = normalizeCategory(item.Category_Name);
        res.render('menu-detail', { item, categoryGroup, editItem, cartItemId });
    });
});

// [POST] การเพิ่มหรืออัปเดตสินค้าในตะกร้า 
app.post('/cart/add', (req, res) => {
    const { menuId, menuName, price, quantity, spiceLevel, mixedSoupTypes, note, cartItemId } = req.body;
    const itemPrice = parseFloat(price);
    const qty = parseInt(quantity) || 1;
    
    const cleanMenuName = menuName.replace(/\s*\([^)]*\)/g, '').trim();

    if (!req.session.cart) {
        req.session.cart = [];
    }

    let selectedSoups = mixedSoupTypes;
    if (selectedSoups && !Array.isArray(selectedSoups)) {
        selectedSoups = [selectedSoups];
    }

    if (cartItemId) {
        const itemIndex = req.session.cart.findIndex(i => i.cartItemId === cartItemId);
        if (itemIndex !== -1) {
            req.session.cart[itemIndex] = {
                cartItemId: cartItemId,
                menuId: parseInt(menuId),
                menuName: cleanMenuName,
                price: itemPrice,
                quantity: qty,
                subtotal: itemPrice * qty,
                spiceLevel: spiceLevel || '',
                mixedSoupTypes: selectedSoups || [], 
                note: note || ''
            };
            return res.redirect('/'); // แก้ไขแล้วให้กลับไปหน้าแรก
        }
    }

    req.session.cart.push({
        cartItemId: Date.now() + Math.random().toString(36).substring(2, 5), 
        menuId: parseInt(menuId),
        menuName: cleanMenuName,
        price: itemPrice,
        quantity: qty,
        subtotal: itemPrice * qty,
        spiceLevel: spiceLevel || '',
        mixedSoupTypes: selectedSoups || [], 
        note: note || ''
    });

    res.redirect('/'); 
});

// [GET] หน้าตะกร้าสินค้า
app.get('/cart', (req, res) => {
    res.render('cart', { cart: req.session.cart });
});

// [POST] การเพิ่ม/ลดจำนวนสินค้าจากปุ่มในหน้าตะกร้า
app.post('/cart/update', (req, res) => {
    const { cartItemId, action } = req.body;
    const item = req.session.cart.find(i => i.cartItemId === cartItemId);
    
    if (item) {
        if (action === 'increase') {
            item.quantity += 1;
        } else if (action === 'decrease' && item.quantity > 1) {
            item.quantity -= 1;
        }
        item.subtotal = item.quantity * item.price; 
    }
    res.redirect('/cart');
});

// [POST] การลบสินค้าออกจากตะกร้า
app.post('/cart/remove', (req, res) => {
    const { cartItemId } = req.body;
    req.session.cart = req.session.cart.filter(item => item.cartItemId !== cartItemId);
    res.redirect('/cart');
});

// [GET] หน้าเลือกประเภทการสั่งและเลือกโต๊ะ
app.get('/checkout', (req, res) => {
    if (req.session.cart.length === 0) return res.redirect('/');

    db.all('SELECT * FROM "Table" WHERE Table_Status = "พร้อมใช้งาน"', [], (err, tables) => {
        if (err) return res.status(500).send('Database Error');
        res.render('checkout', { tables, cart: req.session.cart });
    });
});

// [POST] ยืนยันการสั่งซื้อ บันทึกลงฐานข้อมูล Database
app.post('/checkout', (req, res) => {
    const { tableId, orderType } = req.body;
    const cart = req.session.cart;

    if (!cart || cart.length === 0) return res.redirect('/');

    const totalPrice = cart.reduce((sum, item) => sum + item.subtotal, 0);
    const refCode = 'ORD-' + Math.floor(100000 + Math.random() * 900000); 

    const insertOrderSql = `INSERT INTO "Order" (Table_ID, Order_Type, Total_Price, Order_Status, Reference_Code) 
                            VALUES (?, ?, ?, 'รอยืนยัน', ?)`;

    db.run(insertOrderSql, [tableId || null, orderType, totalPrice, refCode], function(err) {
        if (err) return res.status(500).send('สร้างออเดอร์ล้มเหลว: ' + err.message);

        const orderId = this.lastID; 
        
        const insertDetailSql = `INSERT INTO Order_Detail (Order_ID, Menu_ID, Quantity, Unit_Price, Subtotal, Spiciness_Level, Special_Note) 
                                 VALUES (?, ?, ?, ?, ?, ?, ?)`;

        const stmt = db.prepare(insertDetailSql);
        cart.forEach(item => {
            let finalNote = item.note || '';
            if (item.mixedSoupTypes && item.mixedSoupTypes.length > 0) {
                const soupStr = `(ผสมน้ำซุป: ${item.mixedSoupTypes.join(', ')})`;
                finalNote = finalNote ? `${finalNote} ${soupStr}` : soupStr;
            }

            stmt.run([orderId, item.menuId, item.quantity, item.price, item.subtotal, item.spiceLevel || null, finalNote || null]);
        });
        
        stmt.finalize((finalizeErr) => {
            if (finalizeErr) console.error("Error finalizing statement", finalizeErr);
            req.session.cart = []; 
            res.redirect(`/order-success/${orderId}`);
        });
    });
});

// [GET] หน้าสรุปออเดอร์หลังสั่งซื้อสำเร็จ
app.get('/order-success/:id', (req, res) => {
    db.get('SELECT * FROM "Order" WHERE Order_ID = ?', [req.params.id], (err, order) => {
        if (err || !order) return res.status(404).send('ไม่พบข้อมูลคำสั่งซื้อ');
        res.render('order-success', { order });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});