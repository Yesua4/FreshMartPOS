require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── DATABASE ────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));  // serves index.html

// ─── SETUP DATABASE SCHEMA ───────────────────────────────────────────────────
async function setupDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(20) DEFAULT 'Cashier',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        category VARCHAR(50) NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        emoji VARCHAR(10) DEFAULT '📦',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        receipt_id VARCHAR(50) UNIQUE NOT NULL,
        cashier VARCHAR(100) NOT NULL,
        subtotal NUMERIC(10,2) NOT NULL,
        tax NUMERIC(10,2) NOT NULL,
        total NUMERIC(10,2) NOT NULL,
        payment_method VARCHAR(20) NOT NULL,
        amount_received NUMERIC(10,2) NOT NULL,
        change_amount NUMERIC(10,2) NOT NULL,
        item_count INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER,
        product_name VARCHAR(150) NOT NULL,
        emoji VARCHAR(10),
        quantity INTEGER NOT NULL,
        unit_price NUMERIC(10,2) NOT NULL,
        line_total NUMERIC(10,2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Seed default admin user if none exists
    const userCheck = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCheck.rows[0].count) === 0) {
      const adminHash = await bcrypt.hash('admin123', 10);
      const cashierHash = await bcrypt.hash('cashier123', 10);
      await client.query(`
        INSERT INTO users (username, password_hash, name, role) VALUES
        ('admin', $1, 'Admin User', 'Admin'),
        ('cashier', $2, 'Maria Santos', 'Cashier')
        ON CONFLICT (username) DO NOTHING
      `, [adminHash, cashierHash]);
      console.log('✅ Default users created: admin/admin123 and cashier/cashier123');
    }

    // Seed default products if none exist
    const prodCheck = await client.query('SELECT COUNT(*) FROM products');
    if (parseInt(prodCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO products (name, category, price, stock, emoji) VALUES
        ('Fresh Apples',   'Fruits',      45.00,  120, '🍎'),
        ('Banana',         'Fruits',      35.00,   80, '🍌'),
        ('Mango',          'Fruits',      55.00,   60, '🥭'),
        ('Orange',         'Fruits',      40.00,   75, '🍊'),
        ('Carrots',        'Vegetables',  25.00,  100, '🥕'),
        ('Cabbage',        'Vegetables',  30.00,   50, '🥬'),
        ('Tomato',         'Vegetables',  20.00,   90, '🍅'),
        ('Potato',         'Vegetables',  22.00,  110, '🥔'),
        ('Chicken Breast', 'Meat',       180.00,   40, '🍗'),
        ('Pork Liempo',    'Meat',       220.00,   35, '🥩'),
        ('Bangus Fillet',  'Meat',       150.00,   30, '🐟'),
        ('Fresh Milk',     'Dairy',       95.00,   55, '🥛'),
        ('Cheese',         'Dairy',      120.00,   40, '🧀'),
        ('Egg (Tray)',     'Dairy',      200.00,   45, '🥚'),
        ('Coca-Cola',      'Beverages',   55.00,  100, '🥤'),
        ('Mineral Water',  'Beverages',   20.00,  150, '💧'),
        ('Orange Juice',   'Beverages',   65.00,   60, '🍹'),
        ('Potato Chips',   'Snacks',      35.00,   80, '🥔'),
        ('Biscuits',       'Snacks',      28.00,   90, '🍪'),
        ('Chocolate',      'Snacks',      45.00,   70, '🍫'),
        ('Detergent',      'Household',  125.00,   50, '🧼'),
        ('Shampoo',        'Household',   85.00,   45, '🧴')
      `);
      console.log('✅ Default products seeded');
    }

    // Default settings
    await client.query(`
      INSERT INTO settings (key, value) VALUES
      ('store_name', 'FreshMart Grocery'),
      ('store_address', 'Davao City'),
      ('tax_rate', '12')
      ON CONFLICT (key) DO NOTHING
    `);

    console.log('✅ Database schema ready');
  } finally {
    client.release();
  }
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    res.json({ id: user.id, name: user.name, role: user.role, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PRODUCT ROUTES ───────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY category, name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

app.post('/api/products', async (req, res) => {
  const { name, category, price, stock, emoji } = req.body;
  if (!name || !category || price == null || stock == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO products (name, category, price, stock, emoji) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, category, price, stock, emoji || '📦']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add product' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const { name, category, price, stock, emoji } = req.body;
  try {
    const result = await pool.query(
      'UPDATE products SET name=$1, category=$2, price=$3, stock=$4, emoji=$5 WHERE id=$6 RETURNING *',
      [name, category, price, stock, emoji || '📦', req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

app.patch('/api/products/:id/restock', async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid amount' });
  try {
    const result = await pool.query(
      'UPDATE products SET stock = stock + $1 WHERE id=$2 RETURNING *',
      [amount, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to restock' });
  }
});

// ─── ORDER ROUTES ─────────────────────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  const { filter } = req.query;
  let dateFilter = '';
  if (filter === 'today') dateFilter = "AND created_at >= CURRENT_DATE";
  else if (filter === 'week') dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '7 days'";
  else if (filter === 'month') dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '30 days'";

  try {
    const result = await pool.query(
      `SELECT * FROM orders WHERE 1=1 ${dateFilter} ORDER BY created_at DESC LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { receipt_id, cashier, subtotal, tax, total, payment_method, amount_received, change_amount, items } = req.body;
  if (!receipt_id || !items || items.length === 0) {
    return res.status(400).json({ error: 'Missing required order data' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert order
    const item_count = items.reduce((a, b) => a + b.quantity, 0);
    const orderResult = await client.query(
      `INSERT INTO orders (receipt_id, cashier, subtotal, tax, total, payment_method, amount_received, change_amount, item_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [receipt_id, cashier, subtotal, tax, total, payment_method, amount_received, change_amount, item_count]
    );
    const order = orderResult.rows[0];

    // Insert order items and deduct stock
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, emoji, quantity, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [order.id, item.id, item.name, item.emoji, item.quantity, item.price, item.price * item.quantity]
      );
      // Deduct stock from products table
      await client.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2',
        [item.quantity, item.id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save order' });
  } finally {
    client.release();
  }
});

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [todaySales, totalProducts, lowStock, todayOrders] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE created_at >= CURRENT_DATE`),
      pool.query(`SELECT COUNT(*) FROM products`),
      pool.query(`SELECT COUNT(*) FROM products WHERE stock <= 20`),
      pool.query(`SELECT COUNT(*) FROM orders WHERE created_at >= CURRENT_DATE`)
    ]);

    res.json({
      today_sales: parseFloat(todaySales.rows[0].total),
      total_products: parseInt(totalProducts.rows[0].count),
      low_stock: parseInt(lowStock.rows[0].count),
      today_orders: parseInt(todayOrders.rows[0].count)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ─── SETTINGS ROUTES ─────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings');
    const settings = {};
    result.rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  const { store_name, store_address, tax_rate } = req.body;
  try {
    await pool.query(`
      INSERT INTO settings (key, value) VALUES ('store_name',$1),('store_address',$2),('tax_rate',$3)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [store_name, store_address, tax_rate]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
setupDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 FreshMart POS Server running on http://localhost:${PORT}`);
    console.log(`📦 Database: Neon PostgreSQL`);
    console.log(`\nDefault Login Credentials:`);
    console.log(`  Admin   → username: admin     | password: admin123`);
    console.log(`  Cashier → username: cashier   | password: cashier123\n`);
  });
}).catch(err => {
  console.error('❌ Failed to initialize database:', err);
  process.exit(1);
});
