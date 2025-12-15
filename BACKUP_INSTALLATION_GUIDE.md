# Monthly Backup & Reset System - Installation Guide

## Overview

This system automatically backs up your Invoice Scanner Google Sheets at the beginning of each month and resets all data while preserving the structure.

**Backup Schedule:** 1st of every month at 3:00 AM Israel time (automatically adjusts for daylight saving time)

**Backup Location:** Google Drive folder
- URL: https://drive.google.com/drive/folders/1if-Tbg64dr6uFn_O6mLw6mW48gMQfbhw

**File Naming Convention:**
- Format: `MM-YY` (e.g., `12-25`, `01-26`)
- The backup filename represents the **previous month**
- Example: On 01-01-2026, the backup will be named `12-25` (December 2025 data)

**Folder Organization:**
- Backups are organized by year: `2025/`, `2026/`, `2027/`, etc.
- The system automatically creates year folders if they don't exist
- Example: `12-25` backup goes into `2025/` folder
- Example: `01-26` backup goes into `2026/` folder

---

## Installation Steps

### Step 1: Open Google Apps Script

1. Open your Google Sheets file:
   - URL: https://docs.google.com/spreadsheets/d/1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM
2. Click **Extensions** → **Apps Script**
3. This will open the Apps Script editor

### Step 2: Add the Backup Script

1. In the Apps Script editor, you'll see a file called `Code.gs` or `קוד.gs`
2. Click the **+** button next to "Files" to create a new script file
3. Name it: `backup-and-reset.gs`
4. Copy the entire contents of the `backup-and-reset.gs` file from your local folder
5. Paste it into the new script file
6. Click **Save** (💾 icon)

### Step 3: Verify Configuration

Make sure these values are correct in the script:

```javascript
const BACKUP_FOLDER_ID = '1if-Tbg64dr6uFn_O6mLw6mW48gMQfbhw'; // ✅ Already set
const SPREADSHEET_ID = '1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM'; // ✅ Already set
```

These should already be correct, but verify them.

### Step 4: Test the Reset Function (IMPORTANT!)

Before enabling automatic backups, test the reset function on a single sheet:

1. In the Apps Script editor, find the function dropdown (near the top)
2. Select: `testResetSingleSheet`
3. **Edit the test sheet name** in the code (line ~244):
   ```javascript
   const testSheetName = 'אלמנדוס בע"מ'; // Change this to a test sheet
   ```
4. Click **Run** (▶️ icon)
5. **First time:** You'll be asked to authorize the script:
   - Click "Review Permissions"
   - Select your Google account
   - Click "Advanced" → "Go to Invoice Scanner (unsafe)"
   - Click "Allow"
6. Check the **Logs** (Ctrl + Enter or View → Logs)
7. **Verify in your sheet:**
   - Row 1-4 (headers) should be **intact**
   - Column A (מספר סידורי) should be **intact**
   - Rows 5+ (data) should be **cleared**
   - Formatting should be **preserved**

### Step 5: Test Backup Creation (Optional)

1. In the function dropdown, select: `testBackupOnly`
2. Click **Run** (▶️ icon)
3. Check the **Logs** - you should see:
   - "✅ Test backup completed successfully!"
   - URL to the backup file
4. Open the URL to verify the backup was created correctly
5. *Optional:* The test backup will remain in your Drive (you can delete it manually)

### Step 6: Install the Monthly Trigger

This is the most important step - it enables automatic monthly backups:

1. In the function dropdown, select: `setupMonthlyBackupTrigger`
2. Click **Run** (▶️ icon)
3. Check the **Logs** - you should see:
   - "✅ Monthly backup trigger installed successfully!"
4. **Verify the trigger:**
   - Click the **Triggers** icon (⏰ clock icon on the left sidebar)
   - You should see a trigger:
     - Function: `monthlyBackupAndReset`
     - Event: Time-driven
     - Time: Month timer, Day 1, 3am-4am
     - Timezone: Asia/Jerusalem

---

## How It Works

### Backup Process (1st of every month at 3 AM)

1. **Creates backup:**
   - Copies entire spreadsheet
   - Names it with format `MM-YY` (previous month)
   - Example: On 01-01-2026 → backup named `12-25`

2. **Saves to correct folder:**
   - Determines the year of the backup (2025, 2026, etc.)
   - Creates year folder if it doesn't exist
   - Saves backup to that folder
   - Example: `12-25` → saved to `2025/` folder

3. **Resets all sheets:**
   - **Only after successful backup**
   - Clears all data from row 5 onwards
   - Preserves:
     - Headers (rows 1-4)
     - Column A (מספר סידורי - static row numbers)
     - Formatting and structure
   - Applies to **all sheets** (existing and future ones)

4. **Sends notification email:**
   - Success notification with backup URL
   - Summary of reset results
   - Error notification if backup fails

---

## File Naming Examples

| Backup Date | Previous Month | Backup Filename | Folder |
|-------------|----------------|-----------------|--------|
| 01-01-2026  | December 2025  | `12-25`         | `2025/` |
| 02-01-2026  | January 2026   | `01-26`         | `2026/` |
| 03-01-2026  | February 2026  | `02-26`         | `2026/` |
| 01-01-2027  | December 2026  | `12-26`         | `2026/` |
| 02-01-2027  | January 2027   | `01-27`         | `2027/` |

---

## Testing & Verification

### Manual Test Functions

1. **`testResetSingleSheet()`**
   - Tests reset on a single sheet (e.g., אלמנדוס בע"מ)
   - Verifies data clearing works correctly
   - Safe to run multiple times

2. **`testBackupOnly()`**
   - Tests backup creation without reset
   - Creates a test backup file
   - Safe to run - doesn't modify your data

3. **`listAllTriggers()`**
   - Shows all installed triggers
   - Useful for debugging

### What to Verify After Installation

✅ Trigger is installed (check Triggers panel)
✅ Test reset works correctly (run `testResetSingleSheet`)
✅ Backup creation works (run `testBackupOnly`)
✅ Year folders exist in Google Drive (2025, 2026)

---

## Troubleshooting

### Problem: Script authorization fails

**Solution:**
1. Go to Apps Script editor
2. Click on the project name (top left)
3. Enable "Show 'appsscript.json' manifest file"
4. Re-run the authorization

### Problem: Backup not created

**Solution:**
1. Check the **Execution log** (View → Executions)
2. Look for error messages
3. Verify `BACKUP_FOLDER_ID` is correct
4. Ensure you have edit access to the Google Drive folder

### Problem: Reset clears too much data

**Solution:**
1. The reset only clears rows starting from row 5
2. If your data starts at a different row, change `DATA_START_ROW` in the script
3. Test with `testResetSingleSheet()` before running full backup

### Problem: Trigger not running

**Solution:**
1. Check Triggers panel (⏰ icon) - is the trigger there?
2. Check Executions log - any error messages?
3. Re-run `setupMonthlyBackupTrigger()`

### Problem: Wrong year folder

**Solution:**
1. The script uses the **previous month's year** for folder selection
2. Example: On 01-01-2026, backup `12-25` goes to `2025/` (correct!)
3. If this is wrong, check the `monthlyBackupAndReset()` logic

---

## Maintenance

### Adding New Sheets

**No action required!** The backup system automatically:
- Backs up all sheets (including new ones)
- Resets all sheets (including new ones)

### Disabling Automatic Backups

If you need to temporarily disable backups:

1. Go to Apps Script editor
2. Click **Triggers** (⏰ icon)
3. Find `monthlyBackupAndReset` trigger
4. Click ⋮ (three dots) → **Delete trigger**

Or run: `removeMonthlyBackupTrigger()`

### Re-enabling Automatic Backups

Run: `setupMonthlyBackupTrigger()`

---

## Important Notes

⚠️ **The reset happens ONLY after successful backup**
- If backup fails, data is NOT reset
- This prevents data loss

⚠️ **Israel Time Zone**
- The trigger uses `Asia/Jerusalem` timezone
- Automatically adjusts for daylight saving time
- No manual adjustment needed

⚠️ **Column A is preserved**
- מספר סידורי (sequential numbers) in column A are never cleared
- Only data columns (B onwards) are reset

⚠️ **Future-proof**
- Automatically creates year folders (2027, 2028, etc.) as needed
- Works with any number of sheets
- Applies to sheets added in the future

---

## Support

If you encounter issues:

1. Check **Execution log** (View → Executions)
2. Check **Logs** (Ctrl + Enter) after running test functions
3. Verify trigger is installed (Triggers panel)
4. Test individual functions before running full backup

---

## Summary Checklist

- [ ] Script added to Apps Script editor
- [ ] Configuration values verified (BACKUP_FOLDER_ID, SPREADSHEET_ID)
- [ ] `testResetSingleSheet()` tested successfully
- [ ] Verified: headers intact, column A intact, data cleared
- [ ] `testBackupOnly()` tested successfully (optional)
- [ ] `setupMonthlyBackupTrigger()` executed
- [ ] Trigger visible in Triggers panel
- [ ] Year folders exist in Google Drive (2025, 2026)
- [ ] Ready for automatic monthly backups! ✅
