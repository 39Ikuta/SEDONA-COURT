# Weekly Reporting System - Test Guide

This document outlines how to test the complete weekly reporting system end-to-end.

## Prerequisites

1. **Database Setup**: PostgreSQL running locally or remotely
2. **Environment**: `.env.local` file with `DATABASE_URL` configured
3. **Dependencies**: Run `npm install`

## Setup Steps

### 1. Create `.env.local`

```bash
cp .env.example .env.local
```

Edit `.env.local` with your database URL:

```
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/sedona_court"
API_PORT=4000
```

### 2. Run Migrations

```bash
npm run migrate
```

This creates all weekly reporting tables:
- `weekly_shift_entries` - 14 shift records per week (7 days × 2 shifts)
- `weekly_expenses` - 2-column expense tracking
- `gcash_entries` - GCash transaction audit trail
- `cash_denomination_report` - Cash counting records

### 3. Verify Migration Status

```bash
npm run migrate:status
```

Expected output: All 4 migrations should show as "executed"

---

## Test Scenarios

### Scenario 1: API Endpoint Validation

#### 1a. Test GET Weekly Data

**Endpoint**: `GET /api/weekly-reports/2024-01-01`

**Request**:
```bash
curl -X GET http://localhost:4000/api/weekly-reports/2024-01-01
```

**Expected Response** (200 OK):
```json
{
  "period": {
    "weekStart": "2024-01-01",
    "weekEnd": "2024-01-07",
    "weekLabel": "Jan 01 - Jan 07, 2024"
  },
  "shifts": [ /* 14 shift records */ ],
  "expenses": {
    "col1": { /* 17 field totals */ },
    "col2": { /* 2 field totals */ },
    "total": 0
  },
  "gcash": {
    "entries": [],
    "total": 0
  },
  "cashDenomination": null,
  "summary": {
    "totalRevenue": 0,
    "totalGCash": 0,
    "totalExpenses": 0,
    "netProfit": 0
  }
}
```

#### 1b. Test Invalid Date Validation

**Request** (non-Monday date):
```bash
curl -X GET http://localhost:4000/api/weekly-reports/2024-01-02
```

**Expected Response** (400 Bad Request):
```json
{
  "error": "Invalid date",
  "details": "weekStart: Date must be a Monday (start of week)"
}
```

#### 1c. Test Future Date Validation

**Request** (date in future):
```bash
curl -X GET http://localhost:4000/api/weekly-reports/2099-01-01
```

**Expected Response** (400 Bad Request):
```json
{
  "error": "Invalid date",
  "details": "weekStart: Date cannot be in the future"
}
```

### Scenario 2: Cash Denomination Validation

#### 2a. Test Valid Cash Count

**Endpoint**: `POST /api/weekly-reports/2024-01-01/cash-denom`

**Request**:
```json
{
  "bills_1000_count": 5,
  "bills_500_count": 10,
  "bills_200_count": 0,
  "bills_100_count": 5,
  "bills_50_count": 2,
  "coins_total": 150.50,
  "received_by": "Alice",
  "counted_by": "Bob"
}
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "message": "Cash denomination saved",
  "data": {
    "total1000": 5000,
    "total500": 5000,
    "total200": 0,
    "total100": 500,
    "total50": 100,
    "coinsTotal": 150.50,
    "grandTotal": 10750.50
  }
}
```

#### 2b. Test Invalid Cash Count

**Request** (negative bills):
```json
{
  "bills_1000_count": -5,
  "bills_500_count": 10,
  "bills_200_count": 0,
  "bills_100_count": 5,
  "bills_50_count": 2,
  "coins_total": 150.50
}
```

**Expected Response** (400 Bad Request):
```json
{
  "error": "Validation failed",
  "details": "bills_1000_count: Cannot be negative"
}
```

#### 2c. Test Unreasonably High Count

**Request** (bills_1000_count > 10000):
```json
{
  "bills_1000_count": 50000,
  "bills_500_count": 10,
  "bills_200_count": 0,
  "bills_100_count": 5,
  "bills_50_count": 2,
  "coins_total": 150.50
}
```

**Expected Response** (400 Bad Request):
```json
{
  "error": "Validation failed",
  "details": "bills_1000_count: Unreasonably high value"
}
```

### Scenario 3: Expense Entry Validation

#### 3a. Test Valid Expense Update

**Endpoint**: `POST /api/weekly-reports/2024-01-01/expenses`

**Request**:
```json
{
  "kitchen_expenses": 500,
  "wilkins_pure": 1000,
  "ate_lanie_beddings": 200,
  "miscellaneous": 150
}
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "message": "Expenses updated",
  "data": {
    "col1Total": 1850,
    "col2Total": 0,
    "total": 1850
  }
}
```

#### 3b. Test Invalid Expense Value

**Request** (negative value):
```json
{
  "kitchen_expenses": -500,
  "wilkins_pure": 1000
}
```

**Expected Response** (400 Bad Request):
```json
{
  "error": "Validation failed",
  "details": "kitchen_expenses: Cannot be negative"
}
```

### Scenario 4: Frontend Component Testing

#### 4a. Load Weekly Report Manager

1. Start the application: `npm run dev:all`
2. Navigate to the Reports section
3. Click on "Weekly Report Manager"

**Expected Behavior**:
- Week navigation shows current week
- Summary cards display: Total Revenue, GCash Sales, Total Expenses, Net Profit
- 4 tabs available: Shifts, Expenses, GCash, Cash Count
- Data loads without errors

#### 4b. Test Week Navigation

1. Click "Previous Week" button
2. Click "Next Week" button
3. Verify dates update correctly

**Expected Behavior**:
- Week dates change correctly
- Data reloads for new week
- Week label updates

#### 4c. Test Cash Denomination Entry

1. Navigate to "Cash Count" tab
2. Enter denomination counts:
   - ₱1000 Bills: 5
   - ₱500 Bills: 10
   - ₱200 Bills: 0
   - ₱100 Bills: 5
   - ₱50 Bills: 2
   - Coins (PHP): 150.50
   - Received By: Test User
3. Click "Save Cash Count"

**Expected Behavior**:
- Success message appears
- Data persists on page reload
- Summary cards update with new totals

#### 4d. Test Excel Export

1. On Weekly Report Manager, click "Export to Excel"
2. File downloads as `Weekly_Report_2024-01-01.xlsx`
3. Open in Excel/Sheets

**Expected Structure**:
- Sheet 1: Shift Entries (14 rows × 8 columns)
- Section 2: Expenses (2 columns)
- Section 3: GCash Summary
- Section 4: Cash Denomination Breakdown
- Currency formatting: PHP with comma separators
- Borders and styling applied

### Scenario 5: Auto-Population on Receipt Creation

#### 5a. Create a Receipt (via API or UI)

**Request**:
```json
{
  "receiptNo": "R001",
  "dateTime": "2024-01-01 14:30:00",
  "guestName": "John Doe",
  "items": [
    { "description": "Room Bill", "amount": 500 }
  ],
  "total": 500,
  "paymentMethod": "CASH",
  "cashierId": "CSH001"
}
```

#### 5b. Verify Auto-Population

**Get Weekly Data**:
```bash
curl http://localhost:4000/api/weekly-reports/2024-01-01
```

**Expected Behavior**:
- Receipt amount appears in shift entry for that date
- Summary totals update automatically
- No manual entry needed

---

## Data Structure Verification

### Shift Entry Object

```json
{
  "date": "2024-01-01",
  "dayOfWeek": "MON",
  "shiftType": "DAY",
  "cashier": "Alice",
  "totalCheckins": 5,
  "checkoutCount": 3,
  "transferCount": 1,
  "roomBill": 2500,
  "kitchenBill": 800,
  "drinksBill": 400,
  "miscellPurchases": 100,
  "extras": 50,
  "discount": 0,
  "paymentReceived": 3850
}
```

### Expense Object (Col1)

```json
{
  "kitchenExpenses": 500,
  "wilkinsPure": 1000,
  "ateLanieBeddings": 200,
  "kricoGasLaundry": 150,
  "tissueFlexiCling": 100,
  "miscellaneous": 50,
  "kovi": 0,
  "cmSurcRh": 0,
  "lempo": 0,
  "marbont": 0,
  "aquapura": 0,
  "andengStore": 0,
  "georgeCable": 0,
  "rhMeat": 0,
  "cokeZero": 0,
  "shortPau": 0,
  "venyenZonrox": 0,
  "subtotal": 2000
}
```

### Cash Denomination Object

```json
{
  "bills1000Count": 5,
  "bills500Count": 10,
  "bills200Count": 0,
  "bills100Count": 5,
  "bills50Count": 2,
  "coinsTotal": 150.50,
  "total1000": 5000,
  "total500": 5000,
  "total200": 0,
  "total100": 500,
  "total50": 100,
  "grandTotal": 10750.50,
  "receivedBy": "Alice",
  "countedBy": "Bob"
}
```

---

## Troubleshooting

### Tables Not Found After Migration

```bash
# Check migration status
npm run migrate:status

# If status shows pending, run again
npm run migrate

# If still failing, check database connection
psql $DATABASE_URL -c "\dt"
```

### API Endpoint Returns 500 Error

1. Check server logs for error details
2. Verify database connection in `.env.local`
3. Confirm all migrations have run

### Excel Export File is Blank

1. Verify weekly data exists (check summary cards)
2. Check browser console for JavaScript errors
3. Ensure XLSX library is installed: `npm install xlsx`

### Validation Errors Not Showing

1. Check that validation utility is imported in routes
2. Verify error response format in API handler
3. Check frontend error state display

---

## Performance Benchmarks

- **Weekly data GET**: Should complete in <500ms
- **Cash denomination POST**: Should complete in <200ms
- **Excel generation**: Should complete in <1000ms
- **Database queries**: All use indexes for <100ms response

---

## Success Criteria

✓ All 4 database tables created  
✓ Validation rejects invalid data with descriptive errors  
✓ API endpoints return correct data structure  
✓ Frontend displays data without errors  
✓ Excel export generates valid file with correct format  
✓ Week navigation and data refresh works smoothly  
✓ Cash denomination entry persists and calculates correctly  
✓ Auto-population on receipt creation works  

---

## Next Steps

After testing:

1. **Documentation**: Update API docs with weekly reporting endpoints
2. **Error Logging**: Add detailed logging for audit trail
3. **Reporting**: Generate sample reports for validation
4. **Training**: Create user guide for operators
