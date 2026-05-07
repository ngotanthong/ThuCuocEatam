
// --- CẤU HÌNH CỘT TRONG GOOGLE SHEET ---
const COL_MAP = {
  ID: 0, CUSTOMER_NAME: 1, SUBSCRIBER: 2, PAYMENT_CODE: 3, PHONE: 4, ADDRESS: 5,
  PERIOD: 6, OLD_DEBT: 7, INCURRED_FEE: 8, TOTAL: 9, STAFF_CODE: 10, QR_LINK: 11,
  NOTE: 12, LAST_PRINTED: 13, STATUS: 14, LOCATION: 15
};

// Hàm xử lý GET
function doGet(e) {
  try {
    return ContentService.createTextOutput(JSON.stringify(getBillsFromSheet()))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Hàm xử lý POST
function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
     return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Server busy' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
       throw new Error("No post data received");
    }

    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    var data = params.data;
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var result = { status: 'success' };

    if (action === 'UPDATE') {
      result = updateBill(sheet, data);
    } else if (action === 'ADD') {
      result = addBill(sheet, data);
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// --- HÀM HỖ TRỢ XỬ LÝ TIỀN TỆ VN ---
// Giúp đọc "150.000" hoặc "150,000" đều thành số 150000
function parseVND(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === 'number') return value;
  
  // Chuyển về chuỗi và loại bỏ mọi ký tự không phải số (trừ dấu trừ âm)
  var str = String(value);
  var clean = str.replace(/[^0-9-]/g, '');
  return parseInt(clean, 10) || 0;
}

function getBillsFromSheet() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    // Lấy dữ liệu dạng Display Value (chuỗi) để đảm bảo không bị lỗi định dạng ngày tháng/số
    var data = sheet.getRange(2, 1, lastRow - 1, 16).getValues();

    var bills = data.filter(function(row) {
      // Chỉ lấy dòng có Tên KH
      return row[COL_MAP.CUSTOMER_NAME] && String(row[COL_MAP.CUSTOMER_NAME]).trim() !== ""; 
    }).map(function(row) {
      return {
        id: String(row[COL_MAP.ID] || ""), // Ép kiểu string cho ID
        customerName: String(row[COL_MAP.CUSTOMER_NAME]),
        subscriberNumber: String(row[COL_MAP.SUBSCRIBER] || ""),
        paymentCode: String(row[COL_MAP.PAYMENT_CODE] || ""),
        phone: String(row[COL_MAP.PHONE] || ""),
        address: String(row[COL_MAP.ADDRESS] || ""),
        period: String(row[COL_MAP.PERIOD] || ""),
        // Sử dụng parseVND để đọc đúng số tiền
        oldDebt: parseVND(row[COL_MAP.OLD_DEBT]),
        incurredFee: parseVND(row[COL_MAP.INCURRED_FEE]),
        total: parseVND(row[COL_MAP.TOTAL]),
        staff: { code: String(row[COL_MAP.STAFF_CODE] || ""), name: "", phone: "" },
        qrLink: String(row[COL_MAP.QR_LINK] || ""),
        note: String(row[COL_MAP.NOTE] || ""),
        lastPrinted: String(row[COL_MAP.LAST_PRINTED] || ""),
        status: String(row[COL_MAP.STATUS] || ""),
        location: String(row[COL_MAP.LOCATION] || "")
      };
    });
    return bills;
  } catch (e) {
    return [];
  }
}

function updateBill(sheet, billData) {
  var idToFind = String(billData.id).trim(); // Chuẩn hóa ID cần tìm
  var lastRow = sheet.getLastRow();
  
  if (lastRow < 2) return { status: 'error', message: 'Sheet is empty' };
  
  // Lấy toàn bộ cột ID
  var idColumn = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  
  // Tìm vị trí ID (So sánh dạng chuỗi để chính xác tuyệt đối)
  var rowIndex = -1;
  for (var i = 0; i < idColumn.length; i++) {
    if (String(idColumn[i]).trim() === idToFind) {
      rowIndex = i;
      break;
    }
  }
  
  if (rowIndex !== -1) {
    var realRow = rowIndex + 2; 
    
    // Chỉ cập nhật các trường được gửi lên (Partial update)
    if (billData.customerName !== undefined) sheet.getRange(realRow, COL_MAP.CUSTOMER_NAME + 1).setValue(billData.customerName);
    if (billData.total !== undefined) sheet.getRange(realRow, COL_MAP.TOTAL + 1).setValue(billData.total);
    if (billData.note !== undefined) sheet.getRange(realRow, COL_MAP.NOTE + 1).setValue(billData.note);
    if (billData.lastPrinted !== undefined) {
       // Force format text cho cột ngày giờ để tránh Google Sheet tự sửa định dạng
       sheet.getRange(realRow, COL_MAP.LAST_PRINTED + 1).setNumberFormat("@").setValue(billData.lastPrinted);
    }
    if (billData.status !== undefined) sheet.getRange(realRow, COL_MAP.STATUS + 1).setValue(billData.status);
    if (billData.location !== undefined) sheet.getRange(realRow, COL_MAP.LOCATION + 1).setValue(billData.location);
    if (billData.address !== undefined) sheet.getRange(realRow, COL_MAP.ADDRESS + 1).setValue(billData.address);
    if (billData.phone !== undefined) sheet.getRange(realRow, COL_MAP.PHONE + 1).setNumberFormat("@").setValue(billData.phone);
    
    return { status: 'success', message: 'Updated row ' + realRow };
  } else {
    return { status: 'error', message: 'ID not found in Sheet: ' + idToFind };
  }
}

function addBill(sheet, bill) {
  var newRow = [];
  for (var i = 0; i < 16; i++) newRow.push("");

  // Nếu bill gửi lên chưa có ID thì tạo mới, nếu có (từ file Excel cũ) thì giữ nguyên
  var finalId = bill.id || Utilities.getUuid();

  newRow[COL_MAP.ID] = finalId;
  newRow[COL_MAP.CUSTOMER_NAME] = bill.customerName;
  newRow[COL_MAP.SUBSCRIBER] = bill.subscriberNumber;
  newRow[COL_MAP.PAYMENT_CODE] = bill.paymentCode;
  newRow[COL_MAP.PHONE] = "'" + bill.phone; // Thêm dấu ' để ép kiểu text cho SĐT
  newRow[COL_MAP.ADDRESS] = bill.address;
  newRow[COL_MAP.PERIOD] = bill.period;
  newRow[COL_MAP.OLD_DEBT] = bill.oldDebt;
  newRow[COL_MAP.INCURRED_FEE] = bill.incurredFee;
  newRow[COL_MAP.TOTAL] = bill.total;
  newRow[COL_MAP.STAFF_CODE] = bill.staff ? bill.staff.code : "";
  newRow[COL_MAP.QR_LINK] = bill.qrLink;
  newRow[COL_MAP.NOTE] = bill.note;
  newRow[COL_MAP.LAST_PRINTED] = bill.lastPrinted;
  newRow[COL_MAP.STATUS] = bill.status;
  newRow[COL_MAP.LOCATION] = bill.location;

  sheet.appendRow(newRow);
  
  // Format lại dòng vừa thêm để tránh lỗi hiển thị
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 1, 1, 16).setVerticalAlignment("middle");
  
  return { status: 'success', message: 'Added new row', id: finalId };
}
