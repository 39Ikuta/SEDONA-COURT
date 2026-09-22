# Weekly Reporting System - Quick Start

## 🚀 Start Here (5 minutes)

### 1. Prerequisites
- PostgreSQL installed and running locally
- Node.js 18+ installed
- npm or bun package manager

### 2. Environment Setup
```bash
# Create .env.local from template
cp .env.example .env.local

# Edit .env.local and set your database connection:
# DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/sedona_court"
```

### 3. Install & Migrate
```bash
# Install dependencies (includes date-fns for date handling)
npm install

# Run database migrations (creates 4 weekly reporting tables)
npm run migrate

# Check migration status
npm run migrate:status
```

### 4. Start Application
```bash
# Start frontend (port 3000) + backend (port 4000) together
npm run dev:all
```

### 5. Access Weekly Reports
1. Open browser: `http://localhost:3000`
2. Login with any user (e.g., `admin` / `password`)
3. Click **"Weekly"** button in top navigation
4. Navigate weeks and manage data

---

## 📊 Core Features in 30 Seconds

### **Shifts Tab**
- Auto-populated from receipts (no manual entry needed!)
- Shows 14 daily shift rows (7 days × DAY/NIGHT shifts)
- Revenue breakdown: Room Bill, Kitchen Bill, Drinks, Misc, Extras, Discount
- Real-time totals

### **Expenses Tab**
- 2-column layout matching your Excel template
- Column 1: 17 operational expense fields (kitchen, supplies, utilities)
- Column 2: 2 admin fields (personnel, admin costs)
- Automatic subtotals + grand total

### **GCash Tab**
- Complete audit trail of GCash transactions
- Reference numbers and receipt links
- Weekly total automatically calculated

### **Cash Count Tab**
- Enter physical denomination counts: ₱1000, ₱500, ₱200, ₱100, ₱50, coins
- Automatic totals calculated: Count × Denomination = Total
- Grand total shows complete cash reconciliation
- Records who counted (audit trail)

### **Summary Cards**
- **Total Revenue**: All room + F&B sales for the week
- **GCash Sales**: Subset of revenue paid via GCash
- **Total Expenses**: Sum of all expense fields
- **Net Profit**: Revenue minus Expenses (instant calculation)

---

## 📥 Excel Export

**One click generates professional Excel file matching your template:**

```
Weekly_Report_2024-01-01.xlsx
├─ Shift Entries (14 rows)
├─ Expense Section (2 columns)
├─ GCash Audit Trail
└─ Cash Denomination Breakdown
```

All currency formatted as ₱ with thousands separators + 2 decimals

---

## 🔄 How Data Flows

### Without Weekly Reporting (Before):
```
Receipt Created
    ↓
Manual entry into spreadsheet
    ↓
Slow, error-prone
```

### With Weekly Reporting (Now):
```
Receipt Created → API: POST /api/receipts
    ↓
weeklyReportAggregator parses line items
    ↓
Auto-populate shift entry in database
    ↓
GET /api/weekly-reports/2024-01-01 returns complete week
    ↓
Frontend displays real-time data
    ↓
User enters expenses + cash count (manual only)
    ↓
Click "Export to Excel" (instant download)
```

---

## 🧪 Verify It Works

### Test 1: Week Navigation
1. Click "< Previous Week" button → dates should change
2. Click "> Next Week" button → dates should change
3. Data should reload for each week

### Test 2: Create Receipt
1. Go to **POS** tab
2. Create a new receipt
3. Go back to **Weekly** tab
4. Check **Shifts** tab → your receipt amount should appear in that day's total!

### Test 3: Cash Count Entry
1. Click **Cash Count** tab
2. Enter some denomination counts (e.g., 5 bills of ₱1000 = ₱5000)
3. Click **Save Cash Count**
4. Success message appears
5. Reload page → data persists ✓

### Test 4: Excel Export
1. Click **Export to Excel** button at bottom
2. File `Weekly_Report_YYYY-MM-DD.xlsx` downloads
3. Open in Excel/Sheets → verify format matches your template

---

## 🔧 API Endpoints (For Reference)

### Read Data (No Auth Required)
```bash
GET /api/weekly-reports/2024-01-01
GET /api/weekly-reports/2024-01-01/shifts
GET /api/weekly-reports/2024-01-01/expenses
GET /api/weekly-reports/2024-01-01/gcash
```

### Write Data (Auth Required)
```bash
POST /api/weekly-reports/2024-01-01/expenses
POST /api/weekly-reports/2024-01-01/cash-denom
POST /api/weekly-reports/2024-01-01/finalize (admin only)
```

---

## ⚠️ Common Questions

### Q: Where does shift data come from?
**A**: Automatically from receipts! When you create a receipt, it auto-populates the shift entry for that date. No manual entry needed.

### Q: Can I edit shift entries?
**A**: No, shifts are read-only (auto-generated from receipts). If you need to modify a receipt, edit the receipt and the shift entry updates automatically.

### Q: What if I enter expenses for the wrong week?
**A**: Week start date is locked to Monday. If you try a non-Monday date, it returns error "Date must be a Monday (start of week)".

### Q: Can I export past weeks?
**A**: Yes! Use the week navigation to go back, then click "Export to Excel". It generates the file for any week with data.

### Q: Who can finalize a week?
**A**: Admin and Owner roles only. This locks the week for audit purposes.

### Q: Is cash count required?
**A**: No, it's optional. But recommended for reconciliation. System calculates it if provided.

---

## 📚 Full Documentation

For comprehensive testing scenarios, troubleshooting, and architecture details:

**See**: `WEEKLY_REPORTING_TEST_GUIDE.md`  
**See**: `WEEKLY_REPORTING_SYSTEM_SUMMARY.md`

---

## 🆘 Troubleshooting

### Issue: "DATABASE_URL not set"
**Solution**: Create `.env.local` file (see step 2 above)

### Issue: Migrations fail with "connection refused"
**Solution**: Ensure PostgreSQL is running and DATABASE_URL is correct

### Issue: Weekly tab not showing
**Solution**: Login required. Make sure you're logged in first.

### Issue: Shift entries not appearing
**Solution**: Create a receipt first (go to POS tab). Shifts auto-populate when receipts exist for that week.

### Issue: Cash Count Save fails
**Solution**: Check error message in alert. Common: negative numbers or values >10000 (bills) or >100000 (coins).

---

## 📞 Next Steps

1. ✅ Get application running (`npm run dev:all`)
2. ✅ Test each tab with sample data
3. ✅ Create receipts to test auto-population
4. ✅ Export to Excel to verify format
5. ✅ Customize field names if needed (edit database schema)
6. ✅ Train team on weekly reporting workflow

---

## 📋 Checklist for First Week

- [ ] Database migrations completed
- [ ] Weekly tab accessible in navigation
- [ ] Create test receipt and verify auto-population
- [ ] Enter sample expense data
- [ ] Enter sample cash counts
- [ ] Export to Excel and verify format
- [ ] Share Excel file with management
- [ ] Collect feedback for any adjustments

---

**Happy Reporting! 📊**

Questions? See full documentation in this directory.
