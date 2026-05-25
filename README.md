# 🏨 Hotel Ordering System - Nepal

A complete local WiFi hotel ordering system for small hotels in Nepal. Works entirely on localhost over local WiFi with no internet required for core features. Powered by Anthropic Claude AI for smart order parsing.

## ✨ Features

- **📱 Customer Self-Service**: Scan QR code on table, browse menu, place orders
- **📞 Receptionist Dashboard**: Real-time order management with status updates
- **⚙️ Admin Panel**: Manage tables, menu, generate QR codes, view orders
- **🤖 AI Integration**: Claude AI parses natural language orders (Nepali/English)
- **🔐 PIN-Based Auth**: Simple PIN codes for staff access (no usernames)
- **⚡ Real-Time Updates**: Socket.IO for instant bill updates and order notifications
- **💾 Local Database**: SQLite (no external DB required)
- **🎨 Beautiful UI**: Mobile-responsive, works in any browser
- **🧮 Auto-Billing**: 13% VAT calculation, itemized receipts

## 🛠️ Tech Stack

- **Backend**: Node.js + Express.js
- **Real-time**: Socket.IO
- **Database**: SQLite (better-sqlite3)
- **AI**: Anthropic Claude (@anthropic-ai/sdk)
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks)
- **QR Codes**: qrcode npm package
- **Auth**: JWT tokens with PIN validation

## 📋 System Roles

1. **Customer** - Scans QR code, orders food, views bill
2. **Receptionist** - Manages orders, marks items as preparing/served
3. **Admin** - Manages tables, menu, generates QR codes

## 🚀 Quick Start

### Prerequisites

- **Node.js** v16+ ([Download](https://nodejs.org))
- **Anthropic API Key** ([Get here](https://console.anthropic.com))

### Installation

1. **Clone or download** this project
   ```bash
   cd hotel-system
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup environment variables**
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` with your settings**
   ```env
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxx  # Your API key
   JWT_SECRET=your_random_secret_here # Change this!
   PORT=3000
   ADMIN_PIN=0000
   RECEPTIONIST_PIN=1234
   ```

5. **Start the server**
   ```bash
   npm start
   ```

   You'll see output like:
   ```
   ╔════════════════════════════════════════════════════════════╗
   ║         🏨 HOTEL ORDERING SYSTEM - NEPAL 🇳🇵               ║
   ╠════════════════════════════════════════════════════════════╣
   ║  ✅ Server is running!                                    ║
   ║  📍 LOCAL IP:  http://192.168.1.100:3000                  ║
   ║  🔓 CUSTOMER:    http://192.168.1.100:3000/table/index.html?table=1
   ║  👔 RECEPTIONIST: http://192.168.1.100:3000/receptionist/index.html
   ║  ⚙️  ADMIN:      http://192.168.1.100:3000/admin/index.html
   ║  PIN Codes: Admin: 0000 | Receptionist: 1234
   ```

6. **On hotel WiFi, access from any device:**
   - Customers: Open the QR code link from table (automatic)
   - Receptionist: `http://192.168.1.100:3000/receptionist/index.html`
   - Admin: `http://192.168.1.100:3000/admin/index.html`

## 📖 Daily Startup

**Each morning**, the receptionist should:

1. Make sure the server is running: `npm start`
2. Access receptionist dashboard from desk monitor
3. Enter PIN: `1234`
4. Monitor all tables for incoming orders
5. Use the connection indicator (green dot) to confirm connection

## 🎯 Usage Guide

### For Customers 👤

1. **Scan QR code** on your table
2. **Browse menu** by categories (Breakfast, Main Course, Snacks, etc.)
3. **Select items** using +/- buttons
4. **Review order** before placing
5. **Two ordering methods:**
   - **Traditional**: Click "Place Order" button
   - **AI Magic**: Type in natural language: *"2 momos and a lassi"* → AI parses it!
6. **View bill** anytime: Click "View My Bill"
7. **Track status**: See when order is being prepared / served

### For Receptionist 👔

1. **Login** with PIN: `1234`
2. **See all tables** with pending order count
3. **Click a table** to see detailed orders
4. **For each item:**
   - Click "👨‍🍳 Preparing" when you start cooking
   - Click "✅ Served" when it's ready
5. **Daily revenue** counter shows today's sales
6. **Sound alerts** 🔔 when new orders arrive
7. **Connection status** shows green (connected) or red (disconnected)

### For Admin ⚙️

1. **Login** with PIN: `0000`
2. **Manage Tables** (📋 tab):
   - Add new tables
   - Edit table names
   - Toggle tables active/inactive
   - Delete tables (blocks if pending orders)

3. **Manage Menu** (🍽️ tab):
   - Add new menu items with emoji, price, category
   - Edit descriptions and prices
   - Filter by category
   - Mark items unavailable without deleting

4. **View Orders** (📦 tab):
   - See real-time order summary
   - Count pending/preparing/served orders

5. **Generate QR Codes** (📱 tab):
   - Generate QR codes for all tables
   - Download individual QR codes
   - Print all QR codes for desk/walls

## 🗄️ Database Schema

### `hotel_tables`
- `id` - Unique table ID
- `name` - Table name (e.g., "Table 1")
- `is_active` - 1 (active) or 0 (inactive)
- `created_at` - Timestamp

### `menu_items`
- `id` - Unique item ID
- `name` - Item name (e.g., "Dal Bhat")
- `price` - NPR price
- `category` - Breakfast/Main Course/Snacks/Beverages/Desserts
- `description` - Item description
- `image_emoji` - Visual emoji (🍚, 🥟, etc.)
- `available` - 1 (available) or 0 (out of stock)

### `orders`
- `id` - Unique order ID
- `table_id` - Which table
- `status` - pending/preparing/served/paid
- `created_at` - Order time
- `paid_at` - When payment processed

### `order_items`
- `id` - Unique order item ID
- `order_id` - Which order
- `menu_item_id` - Which menu item
- `quantity` - How many
- `unit_price` - Locked price at order time
- `notes` - Special requests

## 🔐 Authentication

**PIN-Based Login** (No usernames):

- **Admin PIN**: `0000` (change in `.env`)
- **Receptionist PIN**: `1234` (change in `.env`)
- **JWT Tokens**: 24-hour expiry
- **Socket.IO Verification**: Token verified for real-time rooms

## 🤖 AI Features

### Natural Language Ordering

Customer can type: *"2 momos and lassi"*

The AI will:
- Parse Nepali + English mixed text
- Fuzzy-match menu items
- Extract quantities
- Create order automatically
- Show recognized items and any unrecognized words

### Examples:
```
"I want dal bhat with 2 chai" 
  → Dal Bhat (1), Nepali Chiya (2)

"3 samosa aur aloo tikki"
  → Samosa (3), Aloo Tikki (1)

"Momo 2 lassi mango juice"
  → Momo (2), Lassi (1), Mango Juice (1)
```

## 📊 Default Data

**5 Tables:**
- Table 1, Table 2, Table 3, Table 4, Table 5

**15 Menu Items:**

| Category | Items |
|----------|-------|
| Breakfast | Nepali Chiya (☕), Sel Roti (🍪), Yomari (🥟) |
| Main Course | Dal Bhat (🍚), Momo (🥟), Chow Mein (🍜), Thukpa (🍲) |
| Snacks | Samosa (🥟), Pakora (🍖), Aloo Tikki (🥔) |
| Beverages | Lassi (🥛), Masala Tea (☕), Mango Juice (🥭) |
| Desserts | Gulab Jamun (🍮), Khir (🍚) |

Prices in NPR (₹): 40 - 280

## 🌐 Local WiFi Network Setup

### Option 1: Hotel WiFi Network

1. **Hotel must have WiFi router**
2. **All devices connect to same network**
3. **Note the Local IP** shown at startup
4. **Share that IP with guests**

### Option 2: Mobile Hotspot (Testing)

```bash
# On your computer with mobile hotspot:
- Windows: Settings → Mobile Hotspot → Create
- Mac: System Preferences → Sharing → Internet Sharing
- All devices connect to this hotspot
- Use 192.168.x.x address shown at startup
```

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/login` - Login with PIN
- `POST /api/auth/verify` - Verify token

### Tables
- `GET /api/tables` - Get all tables
- `POST /api/tables` - Create table (admin)
- `PUT /api/tables/:id` - Update table (admin)
- `DELETE /api/tables/:id` - Delete table (admin)

### Menu
- `GET /api/menu` - Get all menu items
- `POST /api/menu` - Add menu item (admin)
- `PUT /api/menu/:id` - Update menu item (admin)
- `DELETE /api/menu/:id` - Delete menu item (admin)

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders/table/:tableId` - Get table orders
- `GET /api/orders/table/:tableId/bill-summary` - Get bill
- `GET /api/orders` - Get all orders (auth)
- `PATCH /api/orders/:id/status` - Update order status (auth)
- `POST /api/orders/natural-language` - AI order parsing

### QR Codes
- `GET /api/qr/generate` - Generate all QR codes (admin)
- `GET /api/qr/table/:id` - Generate single QR (admin)

## 📱 QR Code Printing

1. Go to **Admin Panel** → **QR Codes** tab
2. Click **"🖨️ Print All QR Codes"**
3. Browser print dialog opens
4. Adjust to **4 QR codes per page**
5. Print on sticker paper or laminate
6. Place on each table

## 🐛 Troubleshooting

### "Cannot find module 'better-sqlite3'"
```bash
npm install
npm rebuild better-sqlite3
```

### Server won't start
- Check if port 3000 is already in use: `npm start` on different port
- Kill existing process: `lsof -ti:3000 | xargs kill -9`

### No local IP shown
- Make sure WiFi is enabled
- Server needs to detect network interface
- Manually use computer's IP (e.g., `192.168.1.100`)

### AI parsing not working
- Check `ANTHROPIC_API_KEY` in `.env`
- Verify API key is valid on console.anthropic.com
- Check internet connection (AI requires internet)

### Customers can't see menu
- Confirm all devices on same WiFi network
- Use exact IP shown at startup
- Not localhost - use actual LAN IP

### SQLite database locked
- Restart server: `Ctrl+C` then `npm start`
- Check no other instances running

## 📈 Performance Tips

1. **Close browser tabs** you're not using
2. **Keep receptionist dashboard on desk monitor** (primary display)
3. **Restart server daily** for fresh sessions
4. **Limit to ~20 concurrent customers** on single server
5. **Use 5GHz WiFi** for better range and speed

## 🛡️ Security Notes

- **Change default PINs** in `.env` before production
- **Change JWT_SECRET** to a random string
- **This system is for local private networks only**
- **Not suitable for internet-facing deployments**
- **No password encryption** (PIN comparison only)

## 📝 Customization

### Change Color Scheme
Edit HTML files, update CSS variables:
```css
:root {
  --primary: #E8821A;    /* Saffron color */
  --dark: #2C1810;       /* Dark brown */
  --cream: #FFF8F0;      /* Light cream */
}
```

### Add More Tables
Admin Panel → Tables → Enter name → Add

### Modify Menu
Admin Panel → Menu → Enter details → Add Item

### Change Prices
Admin Panel → Menu → Edit prices on cards

## 🚀 Deployment

**For actual hotel use:**

1. Run on a dedicated machine (doesn't need to be powerful)
2. Use a Linux server or Raspberry Pi for 24/7 uptime
3. Install Node.js on server
4. Use `pm2` to keep service running:
   ```bash
   npm install -g pm2
   pm2 start server.js
   pm2 startup
   pm2 save
   ```

5. Backup database daily: `cp hotel.db backups/hotel-$(date +%Y%m%d).db`

## 📞 Support

For issues or questions:
- Check the troubleshooting section above
- Review API endpoints for integration
- Ensure `.env` is properly configured
- Verify all dependencies installed with `npm install`

## 📄 License

MIT License - Free to use and modify

---

**Made with ❤️ for Nepal's hospitality industry**

Happy ordering! 🍽️✨
# Hotel_system
