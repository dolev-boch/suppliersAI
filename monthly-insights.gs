/**
 * Monthly Supplier Insights – Google Apps Script
 * Drive root: 1if-Tbg64dr6uFn_O6mLw6mW48gMQfbhw
 * Structure:  root → year folder (2025/2026) → spreadsheet (03-26)
 *             Each spreadsheet → tabs named after suppliers
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

var INSIGHTS_DRIVE_ROOT   = '1if-Tbg64dr6uFn_O6mLw6mW48gMQfbhw';
var INSIGHTS_EMAIL_TO     = 'edenpatis@gmail.com';
var INSIGHTS_SUBJECT      = 'תובנות חודשיות: ספקים - השוואה מחודש אחרון ואחורה';
var EXCLUDE_NAME_KEYWORD  = 'בעבודה רציפה';

// Columns (1-based), matching main-invoice-script.gs
var IC_DEL_SUM  = 4;  // D – סכום תעודת משלוח
var IC_INV_SUM  = 6;  // F – סכום חשבונית מס
var IC_NOTES    = 7;  // G – הערות
var IC_DATA_ROW = 5;  // first data row in each sheet

// Anomaly: flag suppliers whose spend changed by more than this vs. their historical avg
var ANOMALY_THRESHOLD_PCT = 20;
// Rising trend: flag if second-half avg is ≥ this % higher than first-half avg
var TREND_RISE_PCT        = 10;
// Minimum average monthly spend to be included in trend analysis (avoids noise)
var TREND_MIN_SPEND       = 500;
// How many consecutive absent months = supplier treated as "returning" not "spike"
var RETURNING_THRESHOLD   = 3;

// Fixed monthly costs (non-supplier)
var FIXED_EMPLOYEES  = 95000;
var FIXED_OTHER      = 8500;
// Recommended net profit margin target for a patisserie/café
var PROFIT_MARGIN    = 0.18; // 18%

// ============================================================================
// ENTRY POINTS
// ============================================================================

function sendMonthlyInsights() {
  try {
    var report = buildReport();
    sendEmail(report);
    Logger.log('✅ Monthly insights email sent.');
  } catch (err) {
    Logger.log('❌ sendMonthlyInsights failed: ' + err.toString());
  }
}

/**
 * Run this from the script editor to preview and send a test email immediately.
 */
function testInsights() {
  Logger.log('🧪 Building report...');
  var report = buildReport();
  Logger.log('\n' + report.plain);
  sendEmail(report);
  Logger.log('✅ Test email sent to ' + INSIGHTS_EMAIL_TO);
}

/**
 * Creates the day-17 trigger. Run ONCE only.
 */
function createMonthlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendMonthlyInsights') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendMonthlyInsights')
    .timeBased()
    .onMonthDay(17)
    .atHour(9)
    .nearMinute(0)
    .inTimezone('Asia/Jerusalem')
    .create();
  Logger.log('✅ Trigger set: day 17 at 09:00 Jerusalem time.');
}

// ============================================================================
// DATA COLLECTION
// ============================================================================

/**
 * Collects all monthly supplier data from Drive.
 *
 * Returns:
 *   { 'MM/YYYY': { supplierName: { inv, del, total, hasZikuiNote } } }
 *
 * TOTAL ACCURACY (fix for issue #1):
 *   For each supplier sheet we first look for the "סה"כ כללי" summary row that
 *   the spreadsheet template provides. Reading that row directly avoids any
 *   double-counting or rounding discrepancies from manual column summation.
 *   If the summary row is not found we fall back to summing rows individually.
 *
 *   Credit invoices are INCLUDED (they are negative and correctly reduce the total).
 */
function collectAllMonthlyData() {
  var allData = {};
  var root = DriveApp.getFolderById(INSIGHTS_DRIVE_ROOT);
  var yearIter = root.getFolders();

  while (yearIter.hasNext()) {
    var yearFolder = yearIter.next();
    var yearStr    = yearFolder.getName().trim();
    if (!/^\d{4}$/.test(yearStr)) continue;
    var year = parseInt(yearStr, 10);

    var fileIter = yearFolder.getFiles();
    while (fileIter.hasNext()) {
      var file = fileIter.next();
      var name = file.getName();

      if (name.indexOf(EXCLUDE_NAME_KEYWORD) !== -1) continue;
      if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;

      var month = parseMonthFromFileName(name);
      if (!month) { Logger.log('⚠️ Cannot parse month: ' + name); continue; }

      var key = month + '/' + year;
      Logger.log('📂 ' + key + ' → ' + name);
      allData[key] = readSpreadsheet(file.getId(), key);
    }
  }
  return allData;
}

function parseMonthFromFileName(name) {
  var m = name.match(/^(\d{1,2})[-_\/]/);
  if (m) return parseInt(m[1], 10);
  var heMap = {'ינואר':1,'פברואר':2,'מרץ':3,'אפריל':4,'מאי':5,'יוני':6,
               'יולי':7,'אוגוסט':8,'ספטמבר':9,'אוקטובר':10,'נובמבר':11,'דצמבר':12};
  for (var he in heMap) { if (name.indexOf(he) !== -1) return heMap[he]; }
  return null;
}

/**
 * Reads one monthly supplier spreadsheet.
 * Returns { supplierName: { inv, del, total, hasZikuiNote } }
 */
function readSpreadsheet(ssId) {
  var result = {};
  try {
    var ss     = SpreadsheetApp.openById(ssId);
    var sheets = ss.getSheets();

    sheets.forEach(function(sheet) {
      var sheetName = sheet.getName().trim();

      // Skip aggregate/summary tabs — but keep "שונות" (issue #5)
      if (sheetName.indexOf('סה"כ') !== -1 || sheetName.indexOf('סהכ') !== -1 ||
          sheetName.indexOf('הוצאות') !== -1) return;

      var lastRow = sheet.getLastRow();
      if (lastRow < IC_DATA_ROW) return;

      var numRows  = lastRow - IC_DATA_ROW + 1;
      var allVals  = sheet.getRange(IC_DATA_ROW, 1, numRows, 8).getValues();

      var invTotal = 0, delTotal = 0;
      var foundSummary = false;
      var hasZikuiNote = false;

      // ── Pass 1: read from the "סה"כ כללי" summary row (most accurate) ──────
      // We scan from the bottom up because summary rows are always last.
      for (var i = allVals.length - 1; i >= 0; i--) {
        var rowText = allVals[i].join('');
        if (rowText.indexOf('כללי') !== -1) {
          // Column D = delivery grand total, Column F = invoice grand total.
          // Both are taken as-is (negative credit invoices are already accounted for
          // in the template formula, so this matches what the sheet displays).
          var dVal = parseNum(allVals[i][IC_DEL_SUM - 1]);
          var fVal = parseNum(allVals[i][IC_INV_SUM - 1]);
          delTotal = dVal;          // may be 0 if no delivery notes
          invTotal = fVal;          // may include negative credits

          // Fallback: if neither column has a value, scan the whole row for max
          if (delTotal === 0 && invTotal === 0) {
            var maxV = 0;
            allVals[i].forEach(function(c) { var n = parseNum(c); if (n > maxV) maxV = n; });
            if (maxV > 0) invTotal = maxV;
          }
          foundSummary = true;
          Logger.log('   ✓ ' + sheetName + ': summary row found (del=' + delTotal + ' inv=' + invTotal + ')');
          break;
        }
      }

      // ── Pass 2 (fallback): sum individual data rows ───────────────────────
      if (!foundSummary) {
        Logger.log('   ⚠️ ' + sheetName + ': no "כללי" row, summing manually');
        allVals.forEach(function(row) {
          var rt = row.join('');
          if (rt.indexOf('סה"כ') !== -1 || rt.indexOf('סהכ') !== -1) return;
          var del = parseNum(row[IC_DEL_SUM - 1]);
          var inv = parseNum(row[IC_INV_SUM - 1]);
          // Include all values (positive = charges, negative = credits)
          delTotal += del;
          invTotal += inv;
        });
      }

      // ── Pass 3: check notes column (G) for זיכוי mentions ────────────────
      allVals.forEach(function(row) {
        var note = String(row[IC_NOTES - 1] || '');
        if (note.indexOf('זיכוי') !== -1 || note.indexOf('זכוי') !== -1) {
          hasZikuiNote = true;
        }
      });

      // Only record if there was any financial activity
      var total = delTotal + invTotal;
      if (Math.abs(total) > 0 || delTotal !== 0 || invTotal !== 0) {
        // Use the net (could be negative if credits > charges)
        if (Math.abs(total) > 0.01) {
          result[sheetName] = { inv: invTotal, del: delTotal, total: total, hasZikuiNote: hasZikuiNote };
        }
      }
    });
  } catch (err) {
    Logger.log('❌ Error reading ' + ssId + ': ' + err.toString());
  }
  return result;
}

function parseNum(val) {
  if (val === '' || val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  var n = parseFloat(String(val).replace(/[₪,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ============================================================================
// REPORT BUILDING
// ============================================================================

function buildReport() {
  var allData = collectAllMonthlyData();
  var months  = sortedMonthKeys(Object.keys(allData));

  if (months.length === 0) {
    return { plain: 'לא נמצאו נתונים.', html: '<p>לא נמצאו נתונים.</p>' };
  }

  var latestKey   = months[months.length - 1];
  var prevKeys    = months.slice(0, -1);
  var latestData  = allData[latestKey];
  var lParts      = latestKey.split('/');
  var latestM     = parseInt(lParts[0], 10);
  var latestY     = parseInt(lParts[1], 10);
  var monthName   = hebrewMonth(latestM);

  Logger.log('Latest: ' + latestKey + ' | Prev: ' + prevKeys.join(', '));

  var sections = [];

  // ── Header ───────────────────────────────────────────────────────────────
  sections.push({
    title: 'דוח תובנות חודשי – ' + monthName + ' ' + latestY,
    lines: ['נוצר: ' + Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm')]
  });

  // ── 1. Total spending ────────────────────────────────────────────────────
  var currentTotal = sumSuppliers(latestData);
  var totalLines   = ['סה"כ הוצאות ספקים ' + monthName + ' ' + latestY + ': ₪' + fmt(currentTotal)];

  if (prevKeys.length > 0) {
    var prevTotals = prevKeys.map(function(k) { return sumSuppliers(allData[k]); });
    var avgPrev    = avg(prevTotals);
    var diffPct    = pct(currentTotal, avgPrev);
    var dir        = currentTotal > avgPrev ? 'גבוה' : 'נמוך';
    totalLines.push('ממוצע חודשי היסטורי (' + prevKeys.length + ' חודשים): ₪' + fmt(avgPrev) +
                    ' — החודש ' + dir + ' ב-' + Math.abs(diffPct).toFixed(1) + '%');

    var prevMonthKey   = prevKeys[prevKeys.length - 1];
    var prevMonthTotal = sumSuppliers(allData[prevMonthKey]);
    var prevParts      = prevMonthKey.split('/');
    var momDiff        = pct(currentTotal, prevMonthTotal);
    totalLines.push('לעומת ' + hebrewMonth(parseInt(prevParts[0])) + ' ' + prevParts[1] +
                    ' (₪' + fmt(prevMonthTotal) + '): ' + (momDiff > 0 ? 'עלייה' : 'ירידה') +
                    ' של ' + Math.abs(momDiff).toFixed(1) + '%');

    var sameLastYear = latestM + '/' + (latestY - 1);
    if (allData[sameLastYear]) {
      var yoyTotal = sumSuppliers(allData[sameLastYear]);
      var yoyDiff  = pct(currentTotal, yoyTotal);
      totalLines.push('לעומת ' + monthName + ' ' + (latestY - 1) + ' (₪' + fmt(yoyTotal) + '): ' +
                      (yoyDiff > 0 ? 'עלייה' : 'ירידה') + ' של ' + Math.abs(yoyDiff).toFixed(1) + '% בין השנים');
    }
  }
  sections.push({ title: '💰 סיכום הוצאות ספקים', lines: totalLines });

  // ── 2. Top 5 suppliers ───────────────────────────────────────────────────
  var sorted    = Object.entries(latestData).sort(function(a, b) { return b[1].total - a[1].total; });
  var top5Lines = sorted.slice(0, 5).map(function(entry, i) {
    var name = entry[0], d = entry[1];
    var share = currentTotal > 0 ? ((d.total / currentTotal) * 100).toFixed(1) : '0';
    var parts = [];
    if (d.inv !== 0) parts.push('חשבוניות: ₪' + fmt(d.inv));
    if (d.del !== 0) parts.push('תעודות: ₪' + fmt(d.del));
    var isShonot = name === 'שונות' ? ' (קטגוריית ספקים שונים)' : '';
    return (i + 1) + '. ' + name + isShonot + ': ₪' + fmt(d.total) +
           ' (' + share + '% מסה"כ)' + (parts.length ? '  [' + parts.join(' | ') + ']' : '');
  });
  sections.push({ title: '🏆 5 ספקים יקרים ביותר החודש', lines: top5Lines });

  // ── 3. Anomalies (fix for issue #2 — returning suppliers excluded) ────────
  var anomalyLines = [];
  if (prevKeys.length >= 2) {
    var anomalies = [];
    Object.entries(latestData).forEach(function(entry) {
      var supplier = entry[0], currData = entry[1];

      // Count how many consecutive months this supplier was ABSENT immediately before now
      var consecutiveAbsent = 0;
      for (var i = prevKeys.length - 1; i >= 0; i--) {
        if (allData[prevKeys[i]][supplier] && allData[prevKeys[i]][supplier].total !== 0) break;
        consecutiveAbsent++;
      }

      // Issue #2: if absent for RETURNING_THRESHOLD+ consecutive months, treat as returning —
      // NOT as an anomalous spike. Anomaly detection only applies to consistently active suppliers.
      if (consecutiveAbsent >= RETURNING_THRESHOLD) return;

      var history = prevKeys
        .map(function(k) { return allData[k][supplier] ? allData[k][supplier].total : 0; })
        .filter(function(v) { return v > 0; });
      if (history.length < 2) return;

      var histAvg = avg(history);
      var change  = pct(currData.total, histAvg);
      if (Math.abs(change) >= ANOMALY_THRESHOLD_PCT) {
        anomalies.push({ supplier: supplier, curr: currData.total, histAvg: histAvg, change: change });
      }
    });

    if (anomalies.length === 0) {
      anomalyLines.push('✅ לא זוהו חריגות משמעותיות (>' + ANOMALY_THRESHOLD_PCT + '%) אצל ספקים פעילים באופן עקבי.');
    } else {
      anomalies.sort(function(a, b) { return Math.abs(b.change) - Math.abs(a.change); });
      anomalies.forEach(function(a) {
        var arrow = a.change > 0 ? '📈' : '📉';
        var word  = a.change > 0 ? 'עלייה' : 'ירידה';
        var note  = a.supplier === 'שונות' ? ' (ספקים מגוונים בקטגוריה זו)' : '';
        anomalyLines.push(arrow + ' ' + a.supplier + note + ': ₪' + fmt(a.curr) +
                          ' (ממוצע היסטורי: ₪' + fmt(a.histAvg) + ') — ' +
                          word + ' של ' + Math.abs(a.change).toFixed(1) + '%');
      });
    }
  } else {
    anomalyLines.push('(נדרשים לפחות 2 חודשים קודמים לניתוח חריגות)');
  }
  sections.push({ title: '⚠️ חריגות בהוצאות ספקים', lines: anomalyLines });

  // ── 4. New, returning, and leaving suppliers (issue #2) ──────────────────
  var movementLines = [];
  if (prevKeys.length > 0) {
    var allPrevEver    = {};
    var allPrevRecent  = {}; // active in last 3 months
    prevKeys.forEach(function(k) {
      Object.keys(allData[k]).forEach(function(s) { allPrevEver[s] = k; });
    });
    prevKeys.slice(-3).forEach(function(k) {
      Object.keys(allData[k]).forEach(function(s) { allPrevRecent[s] = k; });
    });
    var currentNames = Object.keys(latestData);

    // Genuinely new: never seen before in ANY previous month
    var brandNew = currentNames.filter(function(s) { return !allPrevEver[s]; });

    // Returning: was seen before, but absent for 3+ consecutive months
    var returning = currentNames.filter(function(s) {
      if (!allPrevEver[s]) return false; // brand new
      var consAbsent = 0;
      for (var i = prevKeys.length - 1; i >= 0; i--) {
        if (allData[prevKeys[i]][s] && allData[prevKeys[i]][s].total !== 0) break;
        consAbsent++;
      }
      return consAbsent >= RETURNING_THRESHOLD;
    });

    // Leaving: active in last 3 months but absent this month
    var leaving = Object.keys(allPrevRecent).filter(function(s) { return !latestData[s]; });

    if (brandNew.length > 0) {
      movementLines.push('🆕 ספקים חדשים לגמרי (לא הופיעו בשום חודש קודם):');
      brandNew.forEach(function(s) {
        movementLines.push('   • ' + s + ': ₪' + fmt(latestData[s].total));
      });
    }
    if (returning.length > 0) {
      if (movementLines.length) movementLines.push('');
      movementLines.push('🔄 ספקים שחזרו לפעילות (נעדרו 3+ חודשים):');
      returning.forEach(function(s) {
        movementLines.push('   • ' + s + ': ₪' + fmt(latestData[s].total) +
                           ' — מטופל כספק חוזר, לא כחריגה');
      });
    }
    if (leaving.length > 0) {
      if (movementLines.length) movementLines.push('');
      movementLines.push('❓ ספקים שנעדרים החודש (היו פעילים ב-3 חודשים אחרונים):');
      leaving.forEach(function(s) {
        var lk = allPrevRecent[s].split('/');
        var isShonot = s === 'שונות' ? ' (קטגוריית ספקים שונים)' : '';
        movementLines.push('   • ' + s + isShonot +
                           ' (פעיל לאחרונה: ' + hebrewMonth(parseInt(lk[0])) + ' ' + lk[1] + ')');
      });
    }
    if (movementLines.length === 0)
      movementLines.push('✅ אין שינויים בהרכב הספקים הפעילים.');
  } else {
    movementLines.push('(נדרש לפחות חודש אחד קודם)');
  }
  sections.push({ title: '🔄 שינויים בהרכב הספקים', lines: movementLines });

  // ── 5. Spending trend bar chart ──────────────────────────────────────────
  var trendLines  = [];
  var recent6     = months.slice(-6);
  var maxForChart = Math.max.apply(null, recent6.map(function(k) { return sumSuppliers(allData[k]); }));
  recent6.forEach(function(k) {
    var p     = k.split('/');
    var total = sumSuppliers(allData[k]);
    var len   = maxForChart > 0 ? Math.round((total / maxForChart) * 20) : 0;
    var bar   = '█'.repeat(len) + '░'.repeat(20 - len);
    trendLines.push(hebrewMonth(parseInt(p[0])) + ' ' + p[1] + ': ' + bar +
                    '  ₪' + fmt(total) + (k === latestKey ? ' ◄ נוכחי' : ''));
  });
  sections.push({ title: '📈 מגמת הוצאות (6 חודשים אחרונים)', lines: trendLines });

  // ── 6. Consistently rising suppliers — full rewrite for accuracy (issue #3) ──
  //
  // Algorithm:
  //   • Take all months (including the current one) where this supplier had spend > 0.
  //   • Require at least 3 data points and a minimum average spend of TREND_MIN_SPEND.
  //   • Split data into a first half and a second half.
  //   • If avg(second half) ≥ avg(first half) × (1 + TREND_RISE_PCT/100), the trend is rising.
  //   • Additionally require that the LAST known value is higher than the FIRST known value
  //     (prevents flagging a supplier that spiked early then came back down).
  //   • If any month in the data has a זיכוי note in the sheet, add an explicit caveat
  //     because a pending credit inflates the cost for that month.
  //
  var risingLines = [];
  if (prevKeys.length >= 2) {
    var risingSuppliers = [];
    var allMonthsForTrend = months; // include current month

    // Gather per-supplier data across all months (שונות included — issue #5)
    var supplierSet = {};
    allMonthsForTrend.forEach(function(k) {
      Object.keys(allData[k]).forEach(function(s) { supplierSet[s] = true; });
    });

    Object.keys(supplierSet).forEach(function(supplier) {
      var dataPoints = allMonthsForTrend
        .map(function(k) {
          var d = allData[k] && allData[k][supplier];
          return d && d.total > 0
            ? { key: k, total: d.total, hasZikui: d.hasZikuiNote }
            : null;
        })
        .filter(function(x) { return x !== null; });

      if (dataPoints.length < 3) return; // need at least 3 real months

      var totals   = dataPoints.map(function(x) { return x.total; });
      var avgTotal = avg(totals);
      if (avgTotal < TREND_MIN_SPEND) return; // too small to matter

      var half  = Math.floor(dataPoints.length / 2);
      var first = dataPoints.slice(0, half).map(function(x) { return x.total; });
      var last  = dataPoints.slice(-half).map(function(x) { return x.total; });
      if (first.length === 0 || last.length === 0) return;

      var avgFirst = avg(first);
      var avgLast  = avg(last);
      var isRising = avgLast >= avgFirst * (1 + TREND_RISE_PCT / 100) &&
                     totals[totals.length - 1] > totals[0]; // last > first

      if (!isRising) return;

      var zikuiMonths = dataPoints
        .filter(function(x) { return x.hasZikui; })
        .map(function(x) {
          var p = x.key.split('/');
          return hebrewMonth(parseInt(p[0])) + ' ' + p[1];
        });

      risingSuppliers.push({
        supplier:    supplier,
        dataPoints:  dataPoints,
        avgFirst:    avgFirst,
        avgLast:     avgLast,
        zikuiMonths: zikuiMonths,
        rise:        pct(avgLast, avgFirst)
      });
    });

    risingSuppliers.sort(function(a, b) { return b.rise - a.rise; });

    if (risingSuppliers.length === 0) {
      risingLines.push('✅ לא זוהו ספקים עם מגמת עלייה עקבית (לפחות ' + TREND_RISE_PCT + '% בין הממוצע הראשון לאחרון).');
    } else {
      risingLines.push('כיצד מחושבת מגמת עלייה עקבית?');
      risingLines.push('נאספים כל החודשים שבהם לספק הייתה פעילות. הנתונים מחולקים לחצי ראשון וחצי אחרון.');
      risingLines.push('אם ממוצע החצי האחרון גבוה ב-' + TREND_RISE_PCT + '%+ מהחצי הראשון, וגם הסכום האחרון');
      risingLines.push('גבוה מהסכום הראשון — הספק מסומן כמגמת עלייה. מינימום ' + TREND_MIN_SPEND + '₪ ממוצע.');
      risingLines.push('');

      risingSuppliers.forEach(function(r) {
        var isShonot = r.supplier === 'שונות' ? ' (קטגוריית ספקים שונים)' : '';
        risingLines.push('📈 ' + r.supplier + isShonot);
        risingLines.push('   חצי ראשון (ממוצע): ₪' + fmt(r.avgFirst) +
                         '  →  חצי אחרון (ממוצע): ₪' + fmt(r.avgLast) +
                         '  (+' + r.rise.toFixed(0) + '%)');
        // Show all data points month by month
        var breakdown = r.dataPoints.map(function(x) {
          var p = x.key.split('/');
          var z = x.hasZikui ? '*זיכוי' : '';
          return hebrewMonth(parseInt(p[0])) + ': ₪' + fmt(x.total) + z;
        }).join(' | ');
        risingLines.push('   פירוט חודשי: ' + breakdown);
        // זיכוי caveat
        if (r.zikuiMonths.length > 0) {
          risingLines.push('   ⚠️ הסתייגות: בחודש/ים ' + r.zikuiMonths.join(', ') +
                           ' נרשמה הערת זיכוי. ייתכן שסכום אותו חודש מנופח כי הזיכוי טרם קוזז — יש לבדוק ידנית.');
        }
        risingLines.push('   המלצה: מומלץ לבחון מחדש תנאי ההסכם עם ספק זה ולבקש הצעת מחיר מתחרה.');
        risingLines.push('');
      });
    }
  } else {
    risingLines.push('(נדרשים לפחות 3 חודשים לניתוח מגמות)');
  }
  sections.push({ title: '💡 ספקים עם מגמת עלייה עקבית — הזדמנויות לחיסכון', lines: risingLines });

  // ── 7. All-time spending records ─────────────────────────────────────────
  var recordLines = [];
  Object.entries(latestData).forEach(function(entry) {
    var supplier = entry[0], currVal = entry[1].total;
    var allVals  = months.map(function(k) { return allData[k][supplier] ? allData[k][supplier].total : 0; });
    var maxEver  = Math.max.apply(null, allVals);
    if (currVal === maxEver && prevKeys.some(function(k) { return allData[k][supplier]; })) {
      var isShonot = supplier === 'שונות' ? ' (קטגוריית ספקים שונים)' : '';
      recordLines.push('🔴 ' + supplier + isShonot + ': ₪' + fmt(currVal) + ' — שיא הוצאות היסטורי!');
    }
  });
  if (recordLines.length > 0)
    sections.push({ title: '🔴 שיאי הוצאות חדשים החודש', lines: recordLines });

  // ── 8. Profitability analysis (issue #6) ─────────────────────────────────
  var fixedTotal    = FIXED_EMPLOYEES + FIXED_OTHER;
  var totalAllCosts = currentTotal + fixedTotal;
  var breakEven     = totalAllCosts;
  var targetRevenue = totalAllCosts / (1 - PROFIT_MARGIN);
  var supplierPct   = currentTotal > 0 && targetRevenue > 0
                      ? ((currentTotal / targetRevenue) * 100).toFixed(1) : '0';
  var dailyTarget   = Math.ceil(targetRevenue / 26); // ~26 working days/month

  var profLines = [];
  profLines.push('📌 הנחות בסיס:');
  profLines.push('   • הוצאות ספקים החודש: ₪' + fmt(currentTotal));
  profLines.push('   • שכר עובדים: ₪' + fmt(FIXED_EMPLOYEES));
  profLines.push('   • הוצאות אחרות קבועות: ₪' + fmt(FIXED_OTHER));
  profLines.push('   • סה"כ עלויות: ₪' + fmt(totalAllCosts));
  profLines.push('');
  profLines.push('💳 נקודת איזון (Break-even): ₪' + fmt(breakEven) + ' ברוטו לחודש');
  profLines.push('   = ההכנסה המינימלית לכסות את כל ההוצאות ללא רווח.');
  profLines.push('');
  profLines.push('🎯 הכנסה מומלצת (רווח ' + (PROFIT_MARGIN * 100).toFixed(0) + '% נטו): ₪' + fmt(targetRevenue) + ' ברוטו לחודש');
  profLines.push('   = יעד יומי (26 ימי עבודה): ₪' + fmt(dailyTarget) + ' ליום');
  profLines.push('   = הוצאות ספקים מהוות ' + supplierPct + '% מהמחזור המומלץ');
  profLines.push('');
  profLines.push('📊 מדד בריאות: בית קפה/פטיסרי טיפוסי בישראל:');
  profLines.push('   Food cost (ספקים) אמור להיות 25-35% מהמחזור.');
  var foodCostPct = currentTotal > 0 && targetRevenue > 0
                    ? ((currentTotal / targetRevenue) * 100).toFixed(1) : '—';
  var fcStatus = parseFloat(foodCostPct) <= 35
                 ? '✅ תקין (' + foodCostPct + '%)'
                 : '⚠️ גבוה (' + foodCostPct + '%) — בדוק מחירי ספקים';
  profLines.push('   Food cost חודשי זה: ' + fcStatus);
  sections.push({ title: '📊 כמה צריך להרוויח ברוטו כדי להיות רווחי?', lines: profLines });

  // ── 9. Full supplier breakdown ────────────────────────────────────────────
  var breakdownLines = sorted.map(function(entry) {
    var name = entry[0], d = entry[1];
    var parts = [];
    if (d.inv !== 0) parts.push('חשבוניות ₪' + fmt(d.inv));
    if (d.del !== 0) parts.push('תעודות ₪' + fmt(d.del));
    var share    = currentTotal > 0 ? ((d.total / currentTotal) * 100).toFixed(1) : '0';
    var isShonot = name === 'שונות' ? ' (קטגוריית ספקים שונים)' : '';
    return '• ' + name + isShonot + ': ₪' + fmt(d.total) + ' (' + share + '%)' +
           (parts.length ? '  [' + parts.join(' | ') + ']' : '');
  });
  breakdownLines.push('');
  breakdownLines.push('סה"כ ספקים: ₪' + fmt(currentTotal) + ' (' + sorted.length + ' ספקים)');
  sections.push({ title: '📋 פירוט מלא לפי ספק – ' + monthName + ' ' + latestY, lines: breakdownLines });

  return { plain: renderPlain(sections), html: renderHtml(sections, monthName, latestY) };
}

// ============================================================================
// RENDERING
// ============================================================================

function renderPlain(sections) {
  return sections.map(function(s) {
    return s.title + '\n' + '─'.repeat(55) + '\n' + s.lines.join('\n');
  }).join('\n\n');
}

function renderHtml(sections, monthName, year) {
  var COLORS = ['#1a5c2a','#1e6b31','#2e7d3c','#2e7d3c','#2e7d3c',
                '#2e7d3c','#2e7d3c','#1a5c2a','#c0392b','#2e7d3c'];

  var rows = sections.map(function(s, idx) {
    var bg = COLORS[idx] || '#2e7d3c';
    var linesHtml = s.lines.map(function(l) {
      if (l === '') return '<br>';
      var cls = '';
      if (l.indexOf('✅') === 0 || l.indexOf('🔴') === 0 || l.indexOf('📈') === 0 ||
          l.indexOf('📉') === 0 || l.indexOf('🆕') === 0 || l.indexOf('❓') === 0 ||
          l.indexOf('💡') === 0 || l.indexOf('⚠️') !== -1 || l.indexOf('•') === 0) {
        cls = 'padding-right:8px;';
      }
      if (l.indexOf('   ') === 0) cls += 'color:#555;font-size:13px;';
      return '<p style="margin:3px 0;' + cls + '">' + escHtml(l) + '</p>';
    }).join('');

    return '<div style="margin-bottom:18px;">' +
           '<div style="background:' + bg + ';color:white;padding:10px 16px;' +
           'border-radius:6px 6px 0 0;font-weight:bold;font-size:15px;">' +
           escHtml(s.title) + '</div>' +
           '<div style="background:#f9f9f9;border:1px solid #ddd;border-top:none;' +
           'padding:12px 16px;border-radius:0 0 6px 6px;font-size:14px;line-height:1.8;">' +
           linesHtml + '</div></div>';
  }).join('');

  return '<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="font-family:Arial,sans-serif;direction:rtl;text-align:right;' +
    'background:#efefef;margin:0;padding:16px;">' +
    '<div style="max-width:700px;margin:0 auto;background:white;border-radius:10px;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.15);overflow:hidden;">' +
    '<div style="background:#1a5c2a;color:white;padding:24px;text-align:center;">' +
    '<h1 style="margin:0;font-size:22px;">📊 תובנות חודשיות: ספקים</h1>' +
    '<p style="margin:6px 0 0;opacity:.85;font-size:15px;">השוואה מחודש אחרון ואחורה — ' +
    monthName + ' ' + year + '</p></div>' +
    '<div style="padding:20px;">' + rows + '</div>' +
    '<div style="background:#e8e8e8;text-align:center;padding:12px;font-size:12px;color:#777;">' +
    'זוזה פטיסרי • דוח אוטומטי • נוצר ב-' +
    Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy') +
    '</div></div></body></html>';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ============================================================================
// EMAIL
// ============================================================================

function sendEmail(report) {
  MailApp.sendEmail({
    to:       INSIGHTS_EMAIL_TO,
    subject:  INSIGHTS_SUBJECT,
    body:     report.plain,
    htmlBody: report.html,
    name:     'זוזה פטיסרי – ניתוח ספקים'
  });
}

// ============================================================================
// UTILITIES
// ============================================================================

function sortedMonthKeys(keys) {
  return keys.slice().sort(function(a, b) {
    var pa = a.split('/'), pb = b.split('/');
    var ya = parseInt(pa[1]), yb = parseInt(pb[1]);
    var ma = parseInt(pa[0]), mb = parseInt(pb[0]);
    return ya !== yb ? ya - yb : ma - mb;
  });
}

function sumSuppliers(monthData) {
  return Object.values(monthData).reduce(function(s, d) { return s + (d.total || 0); }, 0);
}

function avg(arr) {
  return arr.length ? arr.reduce(function(a, b) { return a + b; }, 0) / arr.length : 0;
}

function pct(current, ref) {
  return ref ? ((current - ref) / ref) * 100 : 0;
}

function fmt(num) {
  return Math.round(num).toLocaleString('he-IL');
}

function hebrewMonth(m) {
  return ['','ינואר','פברואר','מרץ','אפריל','מאי','יוני',
          'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'][m] || '';
}
