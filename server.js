const express = require('express');

const mysql = require('mysql2/promise');

const bcrypt = require('bcryptjs');

const session = require('express-session');

const multer = require('multer');

const path = require('path');

const cloudinary = require('cloudinary').v2;

require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 4000;

// Untuk TiDB Cloud Starter gunakan port 4000 dan DB_SSL=true

const dbConfig = {

    host: process.env.DB_HOST || 'localhost',

    port: Number(process.env.DB_PORT || 3306),

    user: process.env.DB_USER || 'root',

    password: process.env.DB_PASSWORD || '',

    database: process.env.DB_NAME || 'furnique_db',

    multipleStatements: true,

    waitForConnections: true,

    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),

    queueLimit: 0,

    ...(process.env.DB_SSL === 'true' ? { ssl: { minVersion: 'TLSv1.2' } } : {})

};

cloudinary.config({

    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,

    api_key: process.env.CLOUDINARY_API_KEY,

    api_secret: process.env.CLOUDINARY_API_SECRET,

    secure: true

});

function uploadToCloudinary(file, folder) {

    return new Promise((resolve, reject) => {

        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {

            return reject(new Error('Penyimpanan file belum dikonfigurasi. Lengkapi CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, dan CLOUDINARY_API_SECRET.'));

        }

        const stream = cloudinary.uploader.upload_stream(

            { folder, resource_type: 'auto', use_filename: false, unique_filename: true },

            (error, result) => {

                if (error) return reject(error);

                resolve(result.secure_url);

            }

        );

        stream.end(file.buffer);

    });

}

let pool;

// Inisialisasi Database & Tabel Otomatis Sesuai Spesifikasi Relasional
async function initDatabase() {

    try {

        // Database dibuat lebih dahulu di dashboard penyedia database

        // Aplikasi membuat tabel di database yang ditentukan oleh DB_NAME

        pool = mysql.createPool(dbConfig);

        await pool.query(`

            CREATE TABLE IF NOT EXISTS users (

                id INT AUTO_INCREMENT PRIMARY KEY,

                nama VARCHAR(100) NOT NULL,

                email VARCHAR(100) NOT NULL UNIQUE,

                password VARCHAR(255) NOT NULL,

                no_hp VARCHAR(20) NOT NULL,

                alamat TEXT NOT NULL,

                role ENUM('pelanggan', 'admin', 'pemilik') DEFAULT 'pelanggan',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

            );

            CREATE TABLE IF NOT EXISTS categories (

                id INT AUTO_INCREMENT PRIMARY KEY,

                nama_kategori VARCHAR(50) NOT NULL UNIQUE

            );

            CREATE TABLE IF NOT EXISTS products (

                id INT AUTO_INCREMENT PRIMARY KEY,

                nama_produk VARCHAR(100) NOT NULL,

                kategori_id INT NOT NULL,

                harga DECIMAL(12,2) NOT NULL,

                stok INT NOT NULL,

                bahan VARCHAR(100) NOT NULL,

                dimensi VARCHAR(100) NOT NULL,

                deskripsi TEXT,

                foto VARCHAR(255),

                status_ketersediaan ENUM('Tersedia', 'Habis', 'Pre-Order') DEFAULT 'Tersedia',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (kategori_id) REFERENCES categories(id) ON DELETE CASCADE

            );

            CREATE TABLE IF NOT EXISTS orders (

                id INT AUTO_INCREMENT PRIMARY KEY,

                user_id INT NOT NULL,

                total_harga DECIMAL(12,2) NOT NULL,

                metode_pengiriman VARCHAR(50) NOT NULL,

                biaya_pengiriman DECIMAL(12,2) DEFAULT 0.00,

                alamat_pengiriman TEXT NOT NULL,

                status_pesanan ENUM('Menunggu Konfirmasi', 'Diproses', 'Dalam Produksi', 'Siap Dikirim', 'Dalam Pengiriman', 'Selesai') DEFAULT 'Menunggu Konfirmasi',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

            );

            CREATE TABLE IF NOT EXISTS order_items (

                id INT AUTO_INCREMENT PRIMARY KEY,

                order_id INT NOT NULL,

                product_id INT NOT NULL,

                jumlah INT NOT NULL,

                harga_satuan DECIMAL(12,2) NOT NULL,

                subtotal DECIMAL(12,2) NOT NULL,

                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,

                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE

            );

            CREATE TABLE IF NOT EXISTS payments (

                id INT AUTO_INCREMENT PRIMARY KEY,

                order_id INT NOT NULL,

                metode_pembayaran VARCHAR(50) NOT NULL,

                jumlah_bayar DECIMAL(12,2) NOT NULL,

                bukti_transfer VARCHAR(255),

                status_pembayaran ENUM('Menunggu Pembayaran', 'Menunggu Verifikasi', 'Berhasil', 'Ditolak') DEFAULT 'Menunggu Pembayaran',

                alasan_penolakan TEXT,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE

            );

            CREATE TABLE IF NOT EXISTS custom_orders (

                id INT AUTO_INCREMENT PRIMARY KEY,

                user_id INT NOT NULL,

                jenis_furnitur VARCHAR(100) NOT NULL,

                panjang DECIMAL(8,2) NOT NULL,

                lebar DECIMAL(8,2) NOT NULL,

                tinggi DECIMAL(8,2) NOT NULL,

                bahan_kayu VARCHAR(100) NOT NULL,

                finishing VARCHAR(100) NOT NULL,

                deskripsi_desain TEXT NOT NULL,

                jumlah INT NOT NULL,

                gambar_referensi VARCHAR(255),

                alamat_pengiriman TEXT NOT NULL,

                estimasi_harga DECIMAL(12,2) DEFAULT NULL,

                estimasi_waktu VARCHAR(100) DEFAULT NULL,

                status_penawaran ENUM('Menunggu Estimasi', 'Menunggu Persetujuan Pelanggan', 'Disetujui', 'Ditolak') DEFAULT 'Menunggu Estimasi',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

            );

            CREATE TABLE IF NOT EXISTS shipments (

                id INT AUTO_INCREMENT PRIMARY KEY,

                order_id INT NOT NULL,

                kurir VARCHAR(50) NOT NULL,

                no_resi VARCHAR(100),

                status_pengiriman VARCHAR(100) DEFAULT 'Menunggu Pengiriman',

                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE

            );

        `);

        // Seed Default Users (Admin, Pemilik, Pelanggan)
        const [users] = await pool.query('SELECT * FROM users');

        if (users.length === 0) {

            const hashedAdmin = await bcrypt.hash('admin123', 10);

            const hashedPemilik = await bcrypt.hash('pemilik123', 10);

            const hashedPelanggan = await bcrypt.hash('pelanggan123', 10);

            await pool.query(`

                INSERT INTO users (nama, email, password, no_hp, alamat, role) VALUES

                ('Administrator Furnique', 'admin\@furnique.com', ?, '081234567890', 'Kantor Pusat Furnique', 'admin'),

                ('Pemilik Usaha Furnique', 'pemilik\@furnique.com', ?, '081234567891', 'Manajemen Furnique', 'pemilik'),

                ('Adelia Hafsani', 'adelia\@mhs.untad.ac.id', ?, '082134567892', 'Jl. Soekarno Hatta Palu', 'pelanggan')

            `, [hashedAdmin, hashedPemilik, hashedPelanggan]);

        }

        // Seed Categories
        const [cats] = await pool.query('SELECT * FROM categories');

        if (cats.length === 0) {

            await pool.query(`

                INSERT INTO categories (nama_kategori) VALUES

                ('Ruang Keluarga'), ('Kamar Tidur'), ('Ruang Makan'), ('Furnitur Kantor'), ('Penyimpanan'), ('Dekorasi');

            `);

        }

        // Samakan nama kategori lama (bahasa Inggris) menjadi bahasa Indonesia

        // ID kategori tetap dipertahankan agar relasi produk dan transaksi tidak terputus

        const categoryTranslations = {

            'Living Room': 'Ruang Keluarga',

            'Bedroom': 'Kamar Tidur',

            'Dining Room': 'Ruang Makan',

            'Office Furniture': 'Furnitur Kantor',

            'Storage': 'Penyimpanan',

            'Decorative Furniture': 'Dekorasi'

        };

        for (const [oldName, newName] of Object.entries(categoryTranslations)) {

            const [oldRows] = await pool.query('SELECT id FROM categories WHERE nama_kategori = ? LIMIT 1', [oldName]);

            if (!oldRows.length) continue;

            const [newRows] = await pool.query('SELECT id FROM categories WHERE nama_kategori = ? LIMIT 1', [newName]);

            if (newRows.length) {

                await pool.query('UPDATE products SET kategori_id = ? WHERE kategori_id = ?', [newRows[0].id, oldRows[0].id]);

                await pool.query('DELETE FROM categories WHERE id = ?', [oldRows[0].id]);

            } else {

                await pool.query('UPDATE categories SET nama_kategori = ? WHERE id = ?', [newName, oldRows[0].id]);

            }

        }

        // Ubah nama produk contoh lama menjadi bahasa Indonesia tanpa mengubah ID produk

        const productNameTranslations = {

            'Aurelia Three Seater Sofa': 'Sofa Tiga Dudukan Aurelia',

            'Milo Accent Lounge Chair': 'Kursi Santai Aksen Milo',

            'Nolan Minimalist TV Cabinet': 'Bufet TV Minimalis Nolan',

            'Elara Nesting Coffee Tables': 'Meja Kopi Susun Elara',

            'Aster Queen Bed Frame': 'Rangka Tempat Tidur Aster',

            'Nima Six Drawer Dresser': 'Lemari Laci Enam Susun Nima',

            'Celia Upholstered Bench': 'Bangku Berlapis Kain Celia',

            'Rumi Wardrobe Two Door': 'Lemari Pakaian Dua Pintu Rumi',

            'Hana Extendable Dining Table': 'Meja Makan Lipat Perpanjangan Hana',

            'Kira Upholstered Dining Chair': 'Kursi Makan Berlapis Kain Kira',

            'Tora Round Dining Table': 'Meja Makan Bundar Tora',

            'Sena Dining Bench': 'Bangku Meja Makan Sena',

            'Alden Standing Desk': 'Meja Kerja Berdiri Alden',

            'Rhea Ergonomic Office Chair': 'Kursi Kerja Ergonomis Rhea',

            'Kei Office Bookshelf': 'Rak Buku Kantor Kei',

            'Arlo Compact Work Desk': 'Meja Kerja Ringkas Arlo',

            'Veda Sliding Door Cabinet': 'Lemari Pintu Geser Veda',

            'Oren Modular Bookshelf': 'Rak Buku Modular Oren',

            'Livia Rattan Storage Cabinet': 'Lemari Penyimpanan Rotan Livia',

            'Bima Multi Purpose Shelf': 'Rak Serbaguna Bima',

            'Ayla Round Side Table': 'Meja Samping Bundar Ayla',

            'Nara Minimalist Console Table': 'Meja Konsol Minimalis Nara',

            'Luma Sculptural Accent Stool': 'Bangku Aksen Luma',

            'Mika Decorative Wall Shelf': 'Rak Dinding Hias Mika',

            'Sora Entryway Bench': 'Bangku Area Masuk Sora'

        };

        for (const [oldName, newName] of Object.entries(productNameTranslations)) {

            const [oldRows] = await pool.query('SELECT id FROM products WHERE nama_produk = ? LIMIT 1', [oldName]);

            if (!oldRows.length) continue;

            const [newRows] = await pool.query('SELECT id FROM products WHERE nama_produk = ? LIMIT 1', [newName]);

            if (!newRows.length) {

                await pool.query('UPDATE products SET nama_produk = ? WHERE id = ?', [newName, oldRows[0].id]);

            }

        }

        // Seed katalog tambahan secara idempotent

        // Produk yang sudah ada tidak dihapus atau ditimpa; produk baru hanya
        // ditambahkan jika nama produknya belum tercatat di database

        const additionalProducts = [

            // Ruang Keluarga
            ['Sofa Tiga Dudukan Aurelia', 'Ruang Keluarga', 8750000, 4, 'Kayu Solid & Linen Premium', '220 x 90 x 82 cm', 'Sofa tiga dudukan dengan bantalan empuk dan siluet modern untuk ruang keluarga.', 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=82'],

            ['Kursi Santai Aksen Milo', 'Ruang Keluarga', 2950000, 9, 'Kayu Ash & Kain Boucle', '76 x 78 x 80 cm', 'Kursi aksen dengan bentuk membulat yang nyaman untuk sudut baca atau ruang santai.', 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?auto=format&fit=crop&w=800&q=82'],

            ['Bufet TV Minimalis Nolan', 'Ruang Keluarga', 3650000, 7, 'MDF Premium dengan Lapisan Kayu Ek', '160 x 40 x 50 cm', 'Kabinet TV minimalis dengan ruang penyimpanan tertutup untuk menjaga ruang tetap rapi.', 'https://images.unsplash.com/photo-1550581190-9c1c48d21d6c?auto=format&fit=crop&w=800&q=82'],

            ['Meja Kopi Susun Elara', 'Ruang Keluarga', 2250000, 11, 'Kayu Jati & Metal', '80/60 x 45/38 cm', 'Meja kopi bertingkat yang fleksibel dan hemat ruang untuk berbagai tata letak.', 'https://images.unsplash.com/photo-1550254478-ead40cc54513?auto=format&fit=crop&w=800&q=82'],

            // Kamar Tidur
            ['Rangka Tempat Tidur Aster', 'Kamar Tidur', 6850000, 5, 'Kayu Jati Solid', '160 x 200 x 105 cm', 'Rangka tempat tidur queen dengan headboard sederhana dan konstruksi kokoh.', 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=800&q=82'],

            ['Lemari Laci Enam Susun Nima', 'Kamar Tidur', 4250000, 6, 'Kayu Mahoni', '120 x 45 x 85 cm', 'Lemari laci enam susun untuk menyimpan pakaian dan perlengkapan kamar.', 'https://images.unsplash.com/photo-1615874694520-474822394e73?auto=format&fit=crop&w=800&q=82'],

            ['Bangku Berlapis Kain Celia', 'Kamar Tidur', 1750000, 10, 'Kayu Solid & Kain Linen', '110 x 38 x 45 cm', 'Bangku ujung tempat tidur dengan dudukan empuk dan kaki kayu yang stabil.', 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=800&q=82'],

            ['Lemari Pakaian Dua Pintu Rumi', 'Kamar Tidur', 5950000, 3, 'Kayu Olahan Premium', '100 x 55 x 200 cm', 'Lemari dua pintu dengan area gantung dan rak untuk kebutuhan penyimpanan harian.', 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=82'],

            // Ruang Makan
            ['Meja Makan Perpanjangan Hana', 'Ruang Makan', 7350000, 4, 'Kayu Jati Solid', '160/200 x 90 x 75 cm', 'Meja makan ekstensi yang dapat diperpanjang saat menerima lebih banyak tamu.', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=82'],

            ['Kursi Makan Berlapis Kain Kira', 'Ruang Makan', 1550000, 14, 'Kayu Ash & Kain', '48 x 55 x 82 cm', 'Kursi makan dengan sandaran ergonomis dan lapisan kain yang nyaman.', 'https://images.unsplash.com/photo-1604578762246-41134e37f9cc?auto=format&fit=crop&w=800&q=82'],

            ['Meja Makan Bundar Tora', 'Ruang Makan', 5450000, 5, 'Kayu Oak Solid', 'Ø 110 x 75 cm', 'Meja makan bundar untuk menciptakan suasana akrab di ruang makan.', 'https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=800&q=82'],

            ['Bangku Meja Makan Sena', 'Ruang Makan', 1850000, 8, 'Kayu Jati', '130 x 38 x 45 cm', 'Bangku makan panjang yang cocok dipadukan dengan meja makan kayu.', 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=800&q=82'],

            // Furnitur Kantor
            ['Meja Kerja Berdiri Alden', 'Furnitur Kantor', 4650000, 5, 'Kayu Ek & Logam', '140 x 70 x 75 cm', 'Meja kerja bergaya modern dengan ruang permukaan luas untuk aktivitas produktif.', 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=800&q=82'],

            ['Kursi Kerja Ergonomis Rhea', 'Furnitur Kantor', 2350000, 12, 'Jaring, Logam & Busa', '62 x 60 x 105 cm', 'Kursi kerja dengan sandaran ergonomis untuk mendukung kenyamanan saat bekerja.', 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=82'],

            ['Rak Buku Kantor Kei', 'Furnitur Kantor', 3150000, 7, 'Kayu Olahan Berlapis Veneer', '80 x 32 x 180 cm', 'Rak buku vertikal dengan beberapa tingkat untuk menyusun buku dan perlengkapan kerja.', 'https://images.unsplash.com/photo-1497366858526-0766cadbe8fa?auto=format&fit=crop&w=800&q=82'],

            ['Meja Kerja Ringkas Arlo', 'Furnitur Kantor', 2150000, 10, 'Kayu Pinus & Metal', '100 x 50 x 75 cm', 'Meja kerja ringkas untuk ruang belajar atau area kerja di rumah.', 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=800&q=82'],

            // Penyimpanan
            ['Lemari Pintu Geser Veda', 'Penyimpanan', 4850000, 4, 'Kayu Jati & Rotan', '120 x 42 x 85 cm', 'Kabinet pintu geser dengan aksen rotan untuk penyimpanan yang praktis.', 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?auto=format&fit=crop&w=800&q=82'],

            ['Rak Buku Modular Oren', 'Penyimpanan', 2750000, 9, 'MDF Premium', '90 x 30 x 160 cm', 'Rak modular dengan kompartemen terbuka untuk buku, dekorasi, dan koleksi.', 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=800&q=82'],

            ['Lemari Penyimpanan Rotan Livia', 'Penyimpanan', 3950000, 6, 'Kayu Mahoni & Rotan', '100 x 40 x 110 cm', 'Kabinet penyimpanan dengan detail anyaman rotan bernuansa natural.', 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=800&q=82'],

            ['Rak Serbaguna Bima', 'Penyimpanan', 1650000, 13, 'Kayu Pinus Solid', '75 x 30 x 150 cm', 'Rak serbaguna untuk membantu mengatur barang di berbagai area rumah.', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=82'],

            // Dekorasi
            ['Meja Samping Bundar Ayla', 'Dekorasi', 975000, 15, 'Kayu Jati Solid', 'Ø 45 x 50 cm', 'Meja samping mungil untuk melengkapi sofa atau sudut ruangan.', 'https://images.unsplash.com/photo-1616486029423-aaa4789e8c9a?auto=format&fit=crop&w=800&q=82'],

            ['Meja Konsol Minimalis Nara', 'Dekorasi', 1850000, 8, 'Kayu Ek & Logam', '110 x 32 x 78 cm', 'Meja konsol ramping untuk area foyer, lorong, atau belakang sofa.', 'https://images.unsplash.com/photo-1600210491369-e753d80a41f3?auto=format&fit=crop&w=800&q=82'],

            ['Bangku Aksen Luma', 'Dekorasi', 890000, 20, 'Kayu Jati Solid', '35 x 35 x 45 cm', 'Bangku aksen dengan bentuk sederhana yang dapat digunakan sebagai tempat duduk tambahan.', 'https://images.unsplash.com/photo-1538688423619-a81d3f23454b?auto=format&fit=crop&w=800&q=82'],

            ['Rak Dinding Hias Mika', 'Dekorasi', 650000, 18, 'Kayu Pinus', '60 x 15 x 20 cm', 'Ambalan dinding untuk memajang tanaman kecil, foto, dan dekorasi favorit.', 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=800&q=82'],

            ['Bangku Area Masuk Sora', 'Dekorasi', 1450000, 9, 'Kayu Ash Solid', '90 x 35 x 45 cm', 'Bangku kecil untuk area pintu masuk dengan desain ringan dan fungsional.', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=82']

        ];

        for (const item of additionalProducts) {

            const [nama_produk, nama_kategori, harga, stok, bahan, dimensi, deskripsi, foto] = item;

            const [categoryRows] = await pool.query(

                'SELECT id FROM categories WHERE nama_kategori = ? LIMIT 1',

                [nama_kategori]

            );

            if (!categoryRows.length) continue;

            const [existingRows] = await pool.query(

                'SELECT id FROM products WHERE nama_produk = ? LIMIT 1',

                [nama_produk]

            );

            if (existingRows.length) continue;

            await pool.query(

                `INSERT INTO products

                 (nama_produk, kategori_id, harga, stok, bahan, dimensi, deskripsi, foto, status_ketersediaan)

                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Tersedia')`,

                [nama_produk, categoryRows[0].id, harga, stok, bahan, dimensi, deskripsi, foto]

            );

        }

        // Perbarui foto untuk 16 produk terbaru (halaman 1 dan 2 katalog)

        // Setiap produk memakai URL Unsplash yang berbeda agar foto tidak berulang

        // Pembaruan hanya mengubah kolom foto; ID, stok, harga, pesanan, dan transaksi tetap

        const fotoProdukHalaman1dan2 = {

            'Bangku Area Masuk Sora': 'https://images.unsplash.com/photo-1643392894452-705bdca3c6ab?auto=format&fit=crop&w=900&q=82',

            'Rak Dinding Hias Mika': 'https://images.unsplash.com/photo-1768430309142-632889e10e86?auto=format&fit=crop&w=900&q=82',

            'Bangku Aksen Luma': 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?auto=format&fit=crop&w=900&q=82',

            'Meja Konsol Minimalis Nara': 'https://images.unsplash.com/photo-1600210491369-e753d80a41f3?auto=format&fit=crop&w=900&q=82',

            'Meja Samping Bundar Ayla': 'https://images.unsplash.com/photo-1533090481720-856c6e3c1fdc?auto=format&fit=crop&w=900&q=82',

            'Rak Serbaguna Bima': 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=900&q=82',

            'Lemari Penyimpanan Rotan Livia': 'https://images.unsplash.com/photo-1567016526105-22da7c13161a?auto=format&fit=crop&w=900&q=82',

            'Rak Buku Modular Oren': 'https://images.unsplash.com/photo-1673892990360-2168cc2c25d6?auto=format&fit=crop&w=900&q=82',

            'Lemari Pintu Geser Veda': 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?auto=format&fit=crop&w=900&q=82',

            'Meja Kerja Ringkas Arlo': 'https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?auto=format&fit=crop&w=900&q=82',

            'Rak Buku Kantor Kei': 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=900&q=82',

            'Kursi Kerja Ergonomis Rhea': 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=900&q=82',

            'Meja Kerja Berdiri Alden': 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=82',

            'Bangku Meja Makan Sena': 'https://images.unsplash.com/photo-1773754767059-d645ebf55539?auto=format&fit=crop&w=900&q=82',

            'Meja Makan Bundar Tora': 'https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=900&q=82',

            'Kursi Makan Berlapis Kain Kira': 'https://images.unsplash.com/photo-1592078615290-033ee584e267?auto=format&fit=crop&w=900&q=82'

        };

        for (const [nama_produk, foto] of Object.entries(fotoProdukHalaman1dan2)) {

            await pool.query(

                'UPDATE products SET foto = ? WHERE nama_produk = ?',

                [foto, nama_produk]

            );

        }

        console.log(`Database ${dbConfig.database} berhasil diinisialisasi!`);

    } catch (err) {

        console.error('Gagal inisialisasi database:', err);

        throw err;

    }

}

// Middleware konfigurasi untuk hosting di balik reverse proxy HTTPS

app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));

app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Jangan publikasikan seluruh folder proyek (server.js, .env, package.json)

app.use(session({

    secret: process.env.SESSION_SECRET || 'CHANGE_THIS_SESSION_SECRET_BEFORE_DEPLOY',

    resave: false,

    saveUninitialized: false,

    cookie: {

        maxAge: 24 * 60 * 60 * 1000,

        httpOnly: true,

        sameSite: 'lax',

        secure: process.env.NODE_ENV === 'production'

    }

}));

// Upload disimpan di Cloudinary agar tidak hilang saat hosting restart/redeploy

const upload = multer({

    storage: multer.memoryStorage(),

    limits: { fileSize: 2 * 1024 * 1024 }, // Maksimal 2 MB*

    fileFilter: (req, file, cb) => {

        const allowedTypes = /jpeg|jpg|png|pdf/;

        const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());

        const mimeAllowed = ['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype);

        if (extName && mimeAllowed) return cb(null, true);

        cb(new Error('Hanya file JPG, PNG, atau PDF yang diizinkan.'));

    }

});

// Middleware Proteksi Role
function authMiddleware(roles = []) {

    return (req, res, next) => {

        if (!req.session.user) {

            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan. Silakan login.' });

        }

        if (roles.length > 0 && !roles.includes(req.session.user.role)) {

            return res.status(403).json({ success: false, message: 'Akses ditolak. Hak akses tidak memadai.' });

        }

        next();

    };

}

// ================= REST API: AUTHENTICATION =================
app.post('/api/register', async (req, res) => {
    try {
        const { nama, email, password, no_hp, alamat } = req.body || {};

        if (!nama || !email || !password || !no_hp || !alamat) {
            return res.status(400).json({ success: false, message: 'Nama, email, password, nomor HP, dan alamat wajib diisi.' });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ success: false, message: 'Password minimal 6 karakter.' });
        }

        const namaBersih = String(nama).trim();
        const emailBersih = String(email).trim().toLowerCase();
        const [existing] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [emailBersih]);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Email sudah terdaftar.' });
        }

        const hashedPassword = await bcrypt.hash(String(password), 10);
        await pool.query(
            'INSERT INTO users (nama, email, password, no_hp, alamat, role) VALUES (?, ?, ?, ?, ?, ?)',
            [namaBersih, emailBersih, hashedPassword, String(no_hp).trim(), String(alamat).trim(), 'pelanggan']
        );

        return res.json({ success: true, message: 'Registrasi berhasil! Silakan login.' });
    } catch (err) {
        console.error('POST /api/register:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Email sudah terdaftar.' });
        }
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat registrasi.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email dan password wajib diisi.' });
        }

        const emailBersih = String(email).trim().toLowerCase();
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [emailBersih]);
        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Email atau password salah.' });
        }

        const user = rows[0];
        const match = await bcrypt.compare(String(password), user.password);
        if (!match) {
            return res.status(401).json({ success: false, message: 'Email atau password salah.' });
        }

        req.session.user = { id: user.id, nama: user.nama, email: user.email, role: user.role };
        req.session.save((err) => {
            if (err) {
                console.error('Gagal menyimpan session login:', err);
                return res.status(500).json({ success: false, message: 'Login berhasil diverifikasi, tetapi sesi gagal disimpan. Silakan coba lagi.' });
            }
            return res.json({ success: true, role: user.role, user: req.session.user });
        });
    } catch (err) {
        console.error('POST /api/login:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server saat login.' });
    }
});

app.post('/api/logout', (req, res) => {
    if (!req.session) return res.json({ success: true, message: 'Berhasil logout.' });
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ success: false, message: 'Sesi gagal diakhiri.' });
        res.clearCookie('connect.sid');
        return res.json({ success: true, message: 'Berhasil logout.' });
    });
});

app.get('/api/me', (req, res) => {

    if (!req.session.user) return res.status(401).json({ success: false });

    res.json({ success: true, user: req.session.user });

});

// Kategori dibaca dari database agar pilihan kategori produk tidak bergantung pada ID yang diasumsikan.
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, nama_kategori FROM categories ORDER BY id ASC');
        return res.json(rows);
    } catch (err) {
        console.error('GET /api/categories:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat kategori produk.' });
    }
});

// ================= REST API: PRODUCTS & CATEGORIES =================
app.get('/api/products', async (req, res) => {

    try {

        const { cari, kategori, minHarga, maxHarga, sort } = req.query;

        let query = `

            SELECT p.*, c.nama_kategori 

            FROM products p 

            JOIN categories c ON p.kategori_id = c.id 

            WHERE 1=1

        `;

        let params = [];

        if (cari) {

            query += ` AND (p.nama_produk LIKE ? OR p.bahan LIKE ?)`;

            params.push(`%${cari}%`, `%${cari}%`);

        }

        if (kategori && kategori !== 'Semua') {

            query += ` AND c.nama_kategori = ?`;

            params.push(kategori);

        }

        if (minHarga) {

            query += ` AND p.harga >= ?`;

            params.push(minHarga);

        }

        if (maxHarga) {

            query += ` AND p.harga <= ?`;

            params.push(maxHarga);

        }

        if (sort === 'termurah') query += ` ORDER BY p.harga ASC`;

        else if (sort === 'termahal') query += ` ORDER BY p.harga DESC`;

        else query += ` ORDER BY p.id DESC`;

        const [rows] = await pool.query(query, params);

        res.json(rows);

    } catch (err) {

        res.status(500).json({ success: false, message: err.message });

    }

});

app.get('/api/products/:id', async (req, res) => {

    try {

        const [rows] = await pool.query(`

            SELECT p.*, c.nama_kategori FROM products p JOIN categories c ON p.kategori_id = c.id WHERE p.id = ?

        `, [req.params.id]);

        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });

        res.json(rows[0]);

    } catch (err) {

        res.status(500).json({ success: false, message: err.message });

    }

});

app.post('/api/products', authMiddleware(['admin']), async (req, res) => {

    try {

        const { nama_produk, kategori_id, harga, stok, bahan, dimensi, deskripsi = '', foto = '', status_ketersediaan } = req.body || {};
        const hargaNum = Number(harga), stokNum = Number(stok), kategoriNum = Number(kategori_id);
        if (!String(nama_produk || '').trim() || !Number.isInteger(kategoriNum) || kategoriNum < 1 ||
            !Number.isFinite(hargaNum) || hargaNum < 0 || !Number.isInteger(stokNum) || stokNum < 0 ||
            !String(bahan || '').trim() || !String(dimensi || '').trim()) {
            return res.status(400).json({ success: false, message: 'Lengkapi nama, kategori, harga, stok, bahan, dan dimensi produk dengan benar.' });
        }
        const status = status_ketersediaan || (stokNum > 0 ? 'Tersedia' : 'Habis');
        if (!['Tersedia', 'Habis', 'Pre-Order'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Status ketersediaan produk tidak valid.' });
        }
        const [categoryRows] = await pool.query('SELECT id FROM categories WHERE id = ? LIMIT 1', [kategoriNum]);
        if (!categoryRows.length) return res.status(400).json({ success: false, message: 'Kategori produk tidak ditemukan.' });
        await pool.query(
            'INSERT INTO products (nama_produk, kategori_id, harga, stok, bahan, dimensi, deskripsi, foto, status_ketersediaan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [String(nama_produk).trim(), kategoriNum, hargaNum, stokNum, String(bahan).trim(), String(dimensi).trim(), String(deskripsi), String(foto), status]
        );
        return res.status(201).json({ success: true, message: 'Produk berhasil ditambahkan.' });

    } catch (err) {

        res.status(500).json({ success: false, message: err.message });

    }

});

app.put('/api/products/:id', authMiddleware(['admin']), async (req, res) => {

    try {

        const { harga, stok, status_ketersediaan } = req.body || {};
        const hargaNum = Number(harga), stokNum = Number(stok);
        if (!Number.isFinite(hargaNum) || hargaNum < 0 || !Number.isInteger(stokNum) || stokNum < 0) {
            return res.status(400).json({ success: false, message: 'Harga dan stok harus berupa angka yang valid.' });
        }
        const status = status_ketersediaan || (stokNum > 0 ? 'Tersedia' : 'Habis');
        if (!['Tersedia', 'Habis', 'Pre-Order'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Status ketersediaan produk tidak valid.' });
        }
        const [result] = await pool.query(
            'UPDATE products SET harga = ?, stok = ?, status_ketersediaan = ? WHERE id = ?',
            [hargaNum, stokNum, status, req.params.id]
        );
        if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
        return res.json({ success: true, message: 'Produk berhasil diperbarui.' });

    } catch (err) {

        res.status(500).json({ success: false, message: err.message });

    }

});

app.delete('/api/products/:id', authMiddleware(['admin']), async (req, res) => {
    try {
        const productId = req.params.id;
        const [products] = await pool.query('SELECT id FROM products WHERE id = ? LIMIT 1', [productId]);
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
        }

        // Jangan hapus produk yang sudah tercatat dalam transaksi agar riwayat pesanan tetap utuh.
        const [usedProducts] = await pool.query(
            'SELECT id FROM order_items WHERE product_id = ? LIMIT 1',
            [productId]
        );
        if (usedProducts.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Produk tidak dapat dihapus karena sudah memiliki riwayat pesanan. Silakan ubah stok menjadi 0.'
            });
        }

        await pool.query('DELETE FROM products WHERE id = ?', [productId]);
        return res.json({ success: true, message: 'Produk berhasil dihapus.' });
    } catch (err) {
        console.error('DELETE /api/products/:id:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat menghapus produk.' });
    }
});



// ================= REST API: ORDERS & CHECKOUT (TRANSACTIONAL) =================
app.post('/api/orders', authMiddleware(['pelanggan']), async (req, res) => {
    let connection;
    let transactionStarted = false;
    try {
        const { items, metode_pengiriman, biaya_pengiriman, alamat_pengiriman, metode_pembayaran } = req.body || {};
        const user_id = req.session.user.id;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Keranjang belanja kosong.' });
        }
        if (!metode_pengiriman || !alamat_pengiriman || !metode_pembayaran) {
            return res.status(400).json({ success: false, message: 'Metode pengiriman, metode pembayaran, dan alamat wajib diisi.' });
        }
        if (!['Transfer Bank', 'E-Wallet', 'QRIS'].includes(metode_pembayaran)) {
            return res.status(400).json({ success: false, message: 'Metode pembayaran tidak didukung.' });
        }
        const biayaKirim = Number(biaya_pengiriman || 0);
        if (!Number.isFinite(biayaKirim) || biayaKirim < 0) {
            return res.status(400).json({ success: false, message: 'Biaya pengiriman tidak valid.' });
        }
        for (const item of items) {
            if (!item || !Number.isInteger(Number(item.product_id)) || !Number.isInteger(Number(item.jumlah)) || Number(item.jumlah) < 1) {
                return res.status(400).json({ success: false, message: 'Data produk atau jumlah dalam keranjang tidak valid.' });
            }
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        let subtotal_produk = 0;
        const itemTervalidasi = [];

        for (const item of items) {
            const productId = Number(item.product_id);
            const jumlah = Number(item.jumlah);
            const [prodRows] = await connection.query(
                'SELECT id, nama_produk, harga, stok FROM products WHERE id = ? FOR UPDATE',
                [productId]
            );
            if (prodRows.length === 0) {
                throw new Error(`Produk ID ${productId} tidak ditemukan.`);
            }

            const prod = prodRows[0];
            if (Number(prod.stok) < jumlah) {
                throw new Error(`Stok produk ${prod.nama_produk} tidak mencukupi.`);
            }

            const harga_satuan = Number(prod.harga);
            const subtotal = harga_satuan * jumlah;
            subtotal_produk += subtotal;
            itemTervalidasi.push({ product_id: productId, jumlah, harga_satuan, subtotal });

            await connection.query('UPDATE products SET stok = stok - ? WHERE id = ?', [jumlah, productId]);
        }

        const total_harga = subtotal_produk + biayaKirim;
        const [orderResult] = await connection.query(
            'INSERT INTO orders (user_id, total_harga, metode_pengiriman, biaya_pengiriman, alamat_pengiriman, status_pesanan) VALUES (?, ?, ?, ?, ?, ?)',
            [user_id, total_harga, metode_pengiriman, biayaKirim, String(alamat_pengiriman).trim(), 'Menunggu Konfirmasi']
        );
        const order_id = orderResult.insertId;

        for (const item of itemTervalidasi) {
            await connection.query(
                'INSERT INTO order_items (order_id, product_id, jumlah, harga_satuan, subtotal) VALUES (?, ?, ?, ?, ?)',
                [order_id, item.product_id, item.jumlah, item.harga_satuan, item.subtotal]
            );
        }

        await connection.query(
            'INSERT INTO payments (order_id, metode_pembayaran, jumlah_bayar, status_pembayaran) VALUES (?, ?, ?, ?)',
            [order_id, metode_pembayaran, total_harga, 'Menunggu Pembayaran']
        );

        await connection.commit();
        transactionStarted = false;
        return res.json({ success: true, order_id, total_harga, message: 'Pesanan berhasil dibuat.' });
    } catch (err) {
        if (connection && transactionStarted) {
            try { await connection.rollback(); } catch (rollbackErr) {
                console.error('Rollback POST /api/orders gagal:', rollbackErr);
            }
        }
        console.error('POST /api/orders:', err);
        return res.status(400).json({ success: false, message: err.message || 'Pesanan gagal dibuat.' });
    } finally {
        if (connection) connection.release();
    }
});



app.get('/api/orders', authMiddleware(), async (req, res) => {
    try {
        const params = [];
        let ownerWhere = '';
        if (req.session.user.role === 'pelanggan') {
            ownerWhere = 'WHERE o.user_id = ?';
            params.push(req.session.user.id);
        }
        const [rows] = await pool.query(`
            SELECT
                o.id, o.user_id, o.total_harga, o.metode_pengiriman,
                o.biaya_pengiriman, o.alamat_pengiriman, o.status_pesanan, o.created_at,
                u.nama AS nama_pelanggan, u.email, u.no_hp,
                (SELECT GROUP_CONCAT(DISTINCT CONCAT(COALESCE(pr.nama_produk, 'Produk dihapus'), ' (', oi.jumlah, 'x)') SEPARATOR ', ')
                   FROM order_items oi LEFT JOIN products pr ON pr.id = oi.product_id
                  WHERE oi.order_id = o.id) AS daftar_produk,
                pay.id AS payment_id,
                COALESCE(pay.status_pembayaran, 'Menunggu Pembayaran') AS status_pembayaran,
                pay.bukti_transfer, pay.metode_pembayaran, pay.alasan_penolakan, pay.jumlah_bayar
            FROM orders o
            JOIN users u ON u.id = o.user_id
            LEFT JOIN payments pay ON pay.id = (
                SELECT MAX(p2.id) FROM payments p2 WHERE p2.order_id = o.id
            )
            ${ownerWhere}
            ORDER BY o.created_at DESC, o.id DESC
        `, params);
        return res.json(rows);
    } catch (err) {
        console.error('GET /api/orders:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat daftar pesanan.' });
    }
});

// Detail pesanan: pelanggan hanya dapat melihat pesanan miliknya

app.get('/api/orders/:id/detail', authMiddleware(), async (req, res) => {

    try {

        const params = [req.params.id];

        let ownerFilter = '';

        if (req.session.user.role === 'pelanggan') {

            ownerFilter = ' AND o.user_id = ?';

            params.push(req.session.user.id);

        }

        const [ordersFound] = await pool.query(

            `SELECT o.*, COALESCE(pay.status_pembayaran, 'Menunggu Pembayaran') AS status_pembayaran,

                    pay.metode_pembayaran, pay.jumlah_bayar, pay.bukti_transfer

             FROM orders o LEFT JOIN payments pay ON pay.order_id = o.id

             WHERE o.id = ?${ownerFilter} ORDER BY pay.id DESC LIMIT 1`, params

        );

        if (!ordersFound.length) return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });

        const [items] = await pool.query(

            `SELECT oi.id, oi.product_id, COALESCE(p.nama_produk, 'Produk dihapus') AS nama_produk,

                    oi.harga_satuan, oi.jumlah, oi.subtotal

             FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id

             WHERE oi.order_id = ? ORDER BY oi.id`, [req.params.id]

        );

        res.json({ order: ordersFound[0], items });

    } catch (err) {

        console.error('GET /api/orders/:id/detail:', err);

        res.status(500).json({ success: false, message: err.message });

    }

});

app.put('/api/orders/:id/status', authMiddleware(['admin']), async (req, res) => {
    try {
        const status_pesanan = String(req.body?.status_pesanan || '');
        const allowed = ['Menunggu Konfirmasi', 'Diproses', 'Dalam Produksi', 'Siap Dikirim', 'Dalam Pengiriman', 'Selesai'];
        if (!allowed.includes(status_pesanan)) {
            return res.status(400).json({ success: false, message: 'Status pesanan tidak valid.' });
        }
        const [existing] = await pool.query('SELECT id FROM orders WHERE id = ? LIMIT 1', [req.params.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
        await pool.query('UPDATE orders SET status_pesanan = ? WHERE id = ?', [status_pesanan, req.params.id]);
        return res.json({ success: true, message: 'Status pesanan diperbarui.' });
    } catch (err) {
        console.error('PUT /api/orders/:id/status:', err);
        return res.status(500).json({ success: false, message: 'Gagal memperbarui status pesanan.' });
    }
});

// ================= REST API: PAYMENTS =================
// Daftar pembayaran untuk admin, lengkap dengan informasi pelanggan dan pesanan

app.get('/api/payments', authMiddleware(['admin', 'pemilik']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT pay.id, pay.order_id, pay.metode_pembayaran, pay.jumlah_bayar,
                   pay.bukti_transfer, pay.status_pembayaran, pay.alasan_penolakan, pay.created_at,
                   o.total_harga, o.status_pesanan, u.nama AS nama_pelanggan, u.email, u.no_hp,
                   (SELECT GROUP_CONCAT(DISTINCT CONCAT(COALESCE(pr.nama_produk, 'Produk dihapus'), ' (', oi.jumlah, 'x)') SEPARATOR ', ')
                      FROM order_items oi LEFT JOIN products pr ON pr.id = oi.product_id
                     WHERE oi.order_id = o.id) AS daftar_produk
            FROM payments pay
            JOIN orders o ON o.id = pay.order_id
            JOIN users u ON u.id = o.user_id
            ORDER BY pay.created_at DESC, pay.id DESC
        `);
        return res.json(rows);
    } catch (err) {
        console.error('GET /api/payments:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat daftar pembayaran.' });
    }
});

// Pelanggan mengunggah bukti pembayaran untuk pesanan miliknya sendiri

app.post('/api/payments', authMiddleware(['pelanggan']), upload.single('bukti_transfer'), async (req, res) => {

    try {

        const { order_id, metode_pembayaran } = req.body || {};

        if (!order_id || !['Transfer Bank', 'E-Wallet', 'QRIS'].includes(metode_pembayaran)) {

            return res.status(400).json({ success: false, message: 'ID pesanan dan metode pembayaran wajib diisi.' });

        }

        if (!req.file) {

            return res.status(400).json({ success: false, message: 'Bukti pembayaran wajib diunggah.' });

        }

        const [orders] = await pool.query(

            'SELECT id FROM orders WHERE id = ? AND user_id = ?',

            [order_id, req.session.user.id]

        );

        if (orders.length === 0) {

            return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan atau bukan milik akun Anda.' });

        }

        const [paymentRows] = await pool.query(
            'SELECT id, status_pembayaran FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1',
            [order_id]
        );
        if (!paymentRows.length) {
            return res.status(404).json({ success: false, message: 'Data pembayaran untuk pesanan ini tidak ditemukan.' });
        }
        if (paymentRows[0].status_pembayaran === 'Berhasil') {
            return res.status(409).json({ success: false, message: 'Pembayaran pesanan ini sudah berhasil diverifikasi.' });
        }

        const buktiUrl = await uploadToCloudinary(req.file, 'furnique/payment-proofs');
        const [result] = await pool.query(
            `UPDATE payments
             SET metode_pembayaran = ?, bukti_transfer = ?, status_pembayaran = 'Menunggu Verifikasi', alasan_penolakan = NULL
             WHERE id = ?`,
            [metode_pembayaran, buktiUrl, paymentRows[0].id]
        );

        if (result.affectedRows === 0) {

            return res.status(404).json({ success: false, message: 'Data pembayaran untuk pesanan ini tidak ditemukan.' });

        }

        res.json({ success: true, message: 'Bukti pembayaran berhasil diunggah. Menunggu verifikasi admin.' });

    } catch (err) {

        res.status(500).json({ success: false, message: err.message });

    }

});

// Admin mengonfirmasi atau menolak pembayaran

app.put('/api/payments/:id/verify', authMiddleware(['admin']), async (req, res) => {
    let connection;
    let transactionStarted = false;
    try {
        const { status_pembayaran, alasan_penolakan } = req.body || {};
        const allowedStatuses = ['Berhasil', 'Ditolak'];

        if (!allowedStatuses.includes(status_pembayaran)) {
            return res.status(400).json({ success: false, message: 'Status pembayaran harus Berhasil atau Ditolak.' });
        }
        if (status_pembayaran === 'Ditolak' && !String(alasan_penolakan || '').trim()) {
            return res.status(400).json({ success: false, message: 'Alasan penolakan wajib diisi.' });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [rows] = await connection.query(
            'SELECT order_id FROM payments WHERE id = ? FOR UPDATE',
            [req.params.id]
        );
        if (rows.length === 0) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(404).json({ success: false, message: 'Pembayaran tidak ditemukan.' });
        }

        const orderId = rows[0].order_id;
        await connection.query(
            'UPDATE payments SET status_pembayaran = ?, alasan_penolakan = ? WHERE id = ?',
            [status_pembayaran, status_pembayaran === 'Ditolak' ? String(alasan_penolakan).trim() : null, req.params.id]
        );

        if (status_pembayaran === 'Berhasil') {
            await connection.query(
                "UPDATE orders SET status_pesanan = 'Diproses' WHERE id = ?",
                [orderId]
            );
        }

        await connection.commit();
        transactionStarted = false;
        return res.json({
            success: true,
            message: status_pembayaran === 'Berhasil'
                ? 'Pembayaran berhasil dikonfirmasi dan pesanan masuk tahap Diproses.'
                : 'Pembayaran ditolak. Pelanggan perlu mengunggah bukti pembayaran yang benar.'
        });
    } catch (err) {
        if (connection && transactionStarted) {
            try { await connection.rollback(); } catch (rollbackErr) {
                console.error('Rollback PUT /api/payments/:id/verify gagal:', rollbackErr);
            }
        }
        console.error('PUT /api/payments/:id/verify:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat memverifikasi pembayaran.' });
    } finally {
        if (connection) connection.release();
    }
});



// ================= REST API: CUSTOM ORDERS =================
app.post('/api/custom-orders', authMiddleware(['pelanggan']), upload.single('gambar_referensi'), async (req, res) => {

    try {

        const { jenis_furnitur, panjang, lebar, tinggi, bahan_kayu, finishing, deskripsi_desain, jumlah, alamat_pengiriman } = req.body;

        const gambar_referensi = req.file

            ? await uploadToCloudinary(req.file, 'furnique/custom-order-references')

            : null;

        const user_id = req.session.user.id;

        await pool.query(

            `INSERT INTO custom_orders (user_id, jenis_furnitur, panjang, lebar, tinggi, bahan_kayu, finishing, deskripsi_desain, jumlah, gambar_referensi, alamat_pengiriman, status_penawaran) 

             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Menunggu Estimasi')`,

            [user_id, jenis_furnitur, panjang, lebar, tinggi, bahan_kayu, finishing, deskripsi_desain, jumlah, gambar_referensi, alamat_pengiriman]

        );

        res.json({ success: true, message: 'Permintaan custom order berhasil dikirim ke tim admin.' });

    } catch (err) {

        res.status(500).json({ success: false, message: err.message });

    }

});

app.get('/api/custom-orders', authMiddleware(), async (req, res) => {

    try {

        let query = `SELECT co.*, u.nama as nama_pelanggan, u.no_hp FROM custom_orders co JOIN users u ON co.user_id = u.id`;

        let params = [];

        if (req.session.user.role === 'pelanggan') {

            query += ` WHERE co.user_id = ?`;

            params.push(req.session.user.id);

        }

        query += ` ORDER BY co.id DESC`;

        const [rows] = await pool.query(query, params);

        res.json(rows);

    } catch (err) {

        res.status(500).json({ success: false, message: err.message });

    }

});

app.put('/api/custom-orders/:id', authMiddleware(['admin']), async (req, res) => {

    try {

        const { estimasi_harga, estimasi_waktu } = req.body;

        if (estimasi_harga === undefined || !estimasi_waktu || Number(estimasi_harga) < 0) {

            return res.status(400).json({ success: false, message: 'Harga dan estimasi waktu wajib diisi dengan benar.' });

        }

        const [result] = await pool.query(

            `UPDATE custom_orders

             SET estimasi_harga = ?, estimasi_waktu = ?, status_penawaran = 'Menunggu Persetujuan Pelanggan'

             WHERE id = ?`,

            [Number(estimasi_harga), String(estimasi_waktu), req.params.id]

        );

        if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Permintaan kustom tidak ditemukan.' });

        res.json({ success: true, message: 'Penawaran dikirim kepada pelanggan untuk disetujui.' });

    } catch (err) {

        console.error('PUT /api/custom-orders/:id:', err);

        res.status(500).json({ success: false, message: err.message });

    }

});

// Keputusan penawaran hanya dapat dilakukan pelanggan pemilik permintaan

app.put('/api/custom-orders/:id/decision', authMiddleware(['pelanggan']), async (req, res) => {

    try {

        const decision = String(req.body.decision || '');

        if (!['Disetujui', 'Ditolak'].includes(decision)) {

            return res.status(400).json({ success: false, message: 'Keputusan tidak valid.' });

        }

        const [result] = await pool.query(

            `UPDATE custom_orders SET status_penawaran = ?

             WHERE id = ? AND user_id = ? AND status_penawaran = 'Menunggu Persetujuan Pelanggan'

               AND estimasi_harga IS NOT NULL AND estimasi_waktu IS NOT NULL`,

            [decision, req.params.id, req.session.user.id]

        );

        if (!result.affectedRows) {

            return res.status(409).json({ success: false, message: 'Penawaran tidak ditemukan, bukan milik Anda, atau sudah diputuskan.' });

        }

        res.json({ success: true, message: decision === 'Disetujui' ? 'Penawaran diterima pelanggan.' : 'Penawaran ditolak pelanggan.' });

    } catch (err) {

        console.error('PUT /api/custom-orders/:id/decision:', err);

        res.status(500).json({ success: false, message: err.message });

    }

});

// ================= REST API: REPORTS & DASHBOARD =================
app.get('/api/reports/summary', authMiddleware(['admin', 'pemilik']), async (req, res) => {

    try {

        const [[{ total_produk }]] = await pool.query('SELECT COUNT(*) as total_produk FROM products');

        const [[{ total_pelanggan }]] = await pool.query("SELECT COUNT(*) as total_pelanggan FROM users WHERE role='pelanggan'");

        const [[{ total_pesanan }]] = await pool.query('SELECT COUNT(*) as total_pesanan FROM orders');

        const [[{ pesanan_pending }]] = await pool.query("SELECT COUNT(*) as pesanan_pending FROM orders WHERE status_pesanan='Menunggu Konfirmasi'");

        const [[{ total_pendapatan }]] = await pool.query("SELECT COALESCE(SUM(total_harga), 0) as total_pendapatan FROM orders o JOIN payments p ON o.id=p.order_id WHERE p.status_pembayaran='Berhasil'");

        const [[{ pembayaran_pending }]] = await pool.query("SELECT COUNT(*) as pembayaran_pending FROM payments WHERE status_pembayaran='Menunggu Verifikasi'");

        res.json({

            total_produk,

            total_pelanggan,

            total_pesanan,

            pesanan_pending,

            total_pendapatan,

            pembayaran_pending

        });

    } catch (err) {

        res.status(500).json({ success: false, message: err.message });

    }

});

app.get('/api/reports/sales', authMiddleware(['admin', 'pemilik']), async (req, res) => {

    try {

        const [rows] = await pool.query(`

            SELECT DATE(o.created_at) as tanggal, COUNT(o.id) as jumlah_transaksi, SUM(o.total_harga) as pendapatan

            FROM orders o

            JOIN payments p ON o.id = p.order_id

            WHERE p.status_pembayaran = 'Berhasil'

            GROUP BY DATE(o.created_at)

            ORDER BY tanggal DESC LIMIT 30

        `);

        res.json(rows);

    } catch (err) {

        res.status(500).json({ success: false, message: err.message });

    }

});

app.get('/api/users', authMiddleware(['admin']), async (req, res) => {

    try {

        const [rows] = await pool.query("SELECT id, nama, email, no_hp, alamat, role, created_at FROM users WHERE role='pelanggan' ORDER BY created_at DESC, id DESC");

        res.json(rows);

    } catch (err) {

        res.status(500).json({ success: false, message: err.message });

    }

});

app.get('/', (req, res) => {

    res.sendFile(path.join(__dirname, 'index.html'));

});

initDatabase()

    .then(() => {

        app.listen(PORT, '0.0.0.0', () => {

            console.log(`Server FURNIQUE aktif pada port ${PORT}`);

        });

    })

    .catch((err) => {

        console.error('Server tidak dijalankan karena database gagal diinisialisasi:', err.message);

        process.exit(1);

    });
