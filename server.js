const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { User, Product, Order, Transaction } = require('./models');

const app = express();
app.use(express.json());
app.use(cors());

// Secret key for JWT
const JWT_SECRET = 'ag_pubg_store_secret_2026';

// 1. Mongoose Connection (Configured with MongoDB Atlas Cloud)
const MONGO_URI = 'mongodb+srv://yourtv170_db_user:IdmO1bi9cbz68w94@smmpanel1.thupe2n.mongodb.net/pubg_store?appName=smmpanel1';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Cloud Database Connected Successfully!'))
    .catch(err => console.error('Database Connection Error:', err));

// 2. Authentication Middleware
const auth = (role = 'user') => (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ message: 'Access Denied. Please login first.' });

    try {
        const verified = jwt.verify(token.split(" ")[1], JWT_SECRET);
        req.user = verified;
        
        if (role === 'admin' && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Restricted Area: Admin access required.' });
        }
        next();
    } catch (err) {
        res.status(400).json({ message: 'Session expired or invalid token. Please login again.' });
    }
};

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Username and Password are required' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        
        await user.save();
        res.status(201).json({ message: 'Account Created Successfully! You can now login.' });
    } catch (e) {
        res.status(400).json({ message: 'Username already taken, please choose another.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: 'Incorrect username or password' });
        }
        
        const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: user.role, balance: user.balance, username: user.username });
    } catch (e) {
        res.status(500).json({ message: 'Server error during login' });
    }
});

// --- USER ROUTES ---
app.get('/api/user/profile', auth(), async (req, res) => {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
});

app.get('/api/products', auth(), async (req, res) => {
    const products = await Product.find({ stock: { $gt: 0 } });
    res.json(products);
});

app.post('/api/user/add-balance', auth(), async (req, res) => {
    const { amount, method, transactionId } = req.body;
    
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Please enter a valid amount' });
    if (!transactionId) return res.status(400).json({ message: 'Transaction ID is required' });

    const transaction = new Transaction({
        userId: req.user.id,
        username: req.user.username,
        amount: parseFloat(amount),
        method,
        transactionId
    });
    
    await transaction.save();
    res.json({ message: 'Deposit request sent to admin successfully.' });
});

app.post('/api/user/buy', auth(), async (req, res) => {
    try {
        const { productId, playerID } = req.body;
        if (!playerID) return res.status(400).json({ message: 'PUBG Player ID is required' });

        const user = await User.findById(req.user.id);
        const product = await Product.findById(productId);

        if (!product) return res.status(404).json({ message: 'Selected product is no longer available' });
        if (user.balance < product.price) return res.status(400).json({ message: `Insufficient Balance. You need ${product.price} to buy this.` });

        user.balance -= product.price;
        await user.save();

        const order = new Order({
            userId: user._id,
            username: user.username,
            productId: product._id,
            productTitle: product.title,
            playerID,
            price: product.price
        });
        await order.save();

        res.json({ message: 'Order Placed Successfully!', balance: user.balance });
    } catch (e) {
        res.status(500).json({ message: 'Failed to process order' });
    }
});

app.get('/api/user/orders', auth(), async (req, res) => {
    const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(orders);
});

app.get('/api/user/payments', auth(), async (req, res) => {
    const payments = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(payments);
});

// --- ADMIN ROUTES ---
app.post('/api/admin/product', auth('admin'), async (req, res) => {
    const product = new Product(req.body);
    await product.save();
    res.json({ message: 'New Product added to the store' });
});

app.get('/api/admin/orders', auth('admin'), async (req, res) => {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
});

app.post('/api/admin/order/status', auth('admin'), async (req, res) => {
    const { orderId, status } = req.body;
    await Order.findByIdAndUpdate(orderId, { status });
    res.json({ message: `Order marked as ${status}` });
});

app.get('/api/admin/deposits', auth('admin'), async (req, res) => {
    const deposits = await Transaction.find().sort({ createdAt: -1 });
    res.json(deposits);
});

app.post('/api/admin/deposit/action', auth('admin'), async (req, res) => {
    const { depositId, action } = req.body;
    const deposit = await Transaction.findById(depositId);
    
    if (!deposit) return res.status(404).json({ message: 'Deposit record not found' });
    if (deposit.status !== 'Pending') return res.status(400).json({ message: 'This deposit has already been processed' });

    deposit.status = action;
    await deposit.save();

    if (action === 'Approved') {
        await User.findByIdAndUpdate(deposit.userId, { $inc: { balance: deposit.amount } });
    }

    res.json({ message: `Deposit successfully ${action}` });
});

// Start Server
app.listen(5000, () => console.log('AG PUBG STORE API Server running on http://localhost:5000'));