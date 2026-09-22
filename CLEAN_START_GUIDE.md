# Clean Start Guide - Fresh Database Setup

## ✅ Mock Data Removed

I've cleaned up all mock/demo data so you can start fresh with your real operations.

---

## 📋 What Was Removed

### **Frontend (`src/data.ts`)**
✓ **Removed**: All occupied rooms with fake guest data  
✓ **Removed**: All rooms in "cleaning" or "overdue" states  
✓ **Kept**: 32 room definitions (all set to "available" and empty)  
✓ **Kept**: User accounts (9 accounts: kitchen, 4 cashiers, 2 admins, owner)  
✓ **Kept**: Billable services (room rates, menu items, extras)  

### **Frontend (`src/App.tsx`)**
✓ **Removed**: 4 mock scheduled bookings (DEFAULT_BOOKINGS array)  
✓ **Changed**: Now fetches bookings from API only (no fallback data)

### **Backend (`server/db/seed.ts`)**
✓ **Removed**: 5 default handoff tasks  
✓ **Removed**: 3 mock audit log entries  
✓ **Kept**: User accounts seeding  
✓ **Kept**: Room structure seeding  
✓ **Kept**: Billable services seeding  

---

## 🏨 Current Room Setup (After Clean)

All 32 rooms are now **available** and **empty**:

### **Floor 1**
- **Rooms 1-5**: VIP Suite (available, ready for guests)
- **Rooms 6-11**: Classic Room (available, ready for guests)

### **Floor 2**
- **Room 12**: Staff House (maintenance mode, not bookable)
- **Rooms 13-26**: Premium Room (available, ready for guests)

### **Floor 3**
- **Rooms 27-32**: Classic Room (available, ready for guests)

**Total Available**: 31 rooms  
**Total in Maintenance**: 1 room (Staff House)

---

## 🚀 How to Start Fresh

### **Step 1: Reset Database**
```bash
# Drop all existing data and re-seed with clean slate
npm run db:setup
```

This will:
1. Run all migrations (creates tables if needed)
2. Seed clean data:
   - 9 user accounts (login credentials)
   - 32 rooms (all available)
   - Billable services (rates, menu items)
   - **NO mock bookings**
   - **NO mock tasks**
   - **NO mock audit logs**

### **Step 2: Start Application**
```bash
npm run dev:all
```

### **Step 3: Login**
Use any of these accounts:

| Username | Password | Role | Description |
|----------|----------|------|-------------|
| `owner` | `owner123` | Owner | Full access to everything |
| `admin1` | `admin123` | Admin | Can manage settings, finalize reports |
| `admin2` | `admin456` | Admin | Can manage settings, finalize reports |
| `ann` | `ann123` | Cashier | Frontdesk operations |
| `pau` | `pau123` | Cashier | Frontdesk operations |
| `rca` | `rca123` | Cashier | Frontdesk operations |
| `dan` | `dan123` | Cashier | Frontdesk operations |
| `kitchen1` | `kitchen123` | Kitchen | POS/F&B only |
| `admin` | `admin` | Admin | Legacy compatibility |

### **Step 4: Start Using the System**

Now you can begin normal operations:

1. **Create Your First Booking**
   - Go to **Bookings** tab
   - Click "Add Booking"
   - Select room, dates, guest info

2. **Check-In Your First Guest**
   - Go to **Frontdesk** tab
   - Click on an available room
   - Fill in guest details
   - Select rate (3h, 12h, 24h, promo)
   - Click "Check In"

3. **Create Your First Receipt**
   - Click on an occupied room
   - Add any charges (food, extras)
   - Click "Generate Receipt"
   - **Automatically populates weekly shift entries!**

4. **Track Your First Week**
   - Go to **Weekly** tab
   - Navigate to current week
   - See auto-populated shift data
   - Enter expenses manually
   - Export to Excel when done

---

## 📊 What Data Will Accumulate Naturally

As you use the system, these will build up organically:

### **Bookings**
- Created when you schedule reservations
- Visible in Bookings Calendar
- Can be checked in, cancelled, or modified

### **Receipts**
- Created on guest checkout
- Auto-populates weekly shift entries
- Tracked by cashier and shift type

### **Shift Entries** (Weekly Reporting)
- **Auto-populated** when receipts are created
- No manual entry needed!
- Shows revenue breakdown by category

### **Expenses** (Weekly Reporting)
- Manually entered by admin/owner
- 2-column layout matching your template
- Subtotals calculated automatically

### **Audit Logs**
- Automatically logged when:
  - Services are created/updated/deleted
  - Settings are changed
  - Important actions occur

### **Handoff Tasks**
- Created by cashiers during shift handoff
- Completed tasks marked by next shift
- Deleted when no longer needed

---

## 🔄 How to Reset Again (If Needed)

If you want to start over completely:

```bash
# Option 1: Use the "Reset Board" button in the UI
# (Frontdesk tab, top right corner)

# Option 2: Command line reset
npm run db:setup
```

**Note**: The "Reset Board" button only resets rooms and POS revenue. It does NOT reset users, services, or database structure.

---

## 🎯 Key Differences from Before

### **Before (With Mock Data)**
- 6 rooms showed as occupied with fake guests
- 3 rooms showed as "cleaning"
- 1 room showed as "overdue"
- 4 fake bookings scheduled
- 5 fake handoff tasks
- 3 fake audit log entries

### **Now (Clean Slate)**
- All 31 rooms show as "available" (except Staff House)
- No occupied rooms
- No scheduled bookings
- No handoff tasks
- No audit logs
- **Everything starts fresh!**

---

## 🛠 What's Still Included (Essential Data)

### **User Accounts** (9 accounts)
- Needed for login functionality
- Covers all role types
- Use as-is or modify passwords in Settings

### **Billable Services** (30+ items)
- Room rates for all 3 tiers (Standard, Deluxe, Suite)
- All rate types (3h, 12h, 24h, promo)
- F&B menu items (food, drinks)
- Room extras (towels, beds, linens, etc.)
- Essential for checkout/billing operations

### **Room Structure** (32 rooms)
- Physical room layout
- Room tiers and types
- Floor assignments
- All set to "available" state

---

## 📝 Recommended First Steps

1. **Verify Login**: Test all user accounts
2. **Review Rates**: Check if prices match your actual rates (Settings tab)
3. **Adjust Services**: Add/remove menu items as needed (Settings tab)
4. **Test Check-In**: Create a test booking and check in
5. **Test Receipt**: Generate a receipt and verify Excel format
6. **Test Weekly Report**: Navigate to Weekly tab, see if auto-population works

---

## ⚠️ Important Notes

### **User Accounts**
- Don't delete user accounts unless you're sure
- They're needed for authentication
- Change passwords in Settings → User Management (future feature)

### **Billable Services**
- Room rates are essential for checkout calculations
- Don't delete unless you have replacements
- Menu items can be modified freely

### **Room Numbers**
- Room numbers are permanent (can't change after initial setup)
- Physical layout should match your actual property
- Modify in `src/data.ts` before first seed if needed

---

## 🆘 Troubleshooting

### Issue: "No rooms showing"
**Solution**: Run `npm run db:setup` to re-seed

### Issue: "Can't login"
**Solution**: User accounts might be missing. Run `npm run db:setup`

### Issue: "Prices are wrong"
**Solution**: Go to Settings tab → Modify billable services

### Issue: "Want to add more rooms"
**Solution**: 
1. Edit `src/data.ts` → add rooms to INITIAL_ROOMS array
2. Run `npm run db:setup`
3. Restart app

---

## ✅ Summary Checklist

After running `npm run db:setup`, verify:

- [ ] Can login with any user account
- [ ] All 31 rooms show as "available"
- [ ] Room 12 (Staff House) shows as "maintenance"
- [ ] Bookings tab is empty
- [ ] Reports tab shows zero revenue
- [ ] Weekly tab shows empty shift entries
- [ ] Settings tab shows all billable services
- [ ] Audit logs tab is empty
- [ ] Tasks list is empty

**If all checked**: You're ready to start using the system! 🎉

---

## 📞 Next Steps

1. Start with a test guest check-in
2. Create a test receipt
3. Verify weekly auto-population works
4. Export first weekly Excel report
5. Begin normal operations with real guests

**Happy Property Managing!** 🏨
