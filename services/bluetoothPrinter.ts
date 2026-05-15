
import { Bill } from '../types';

// Dịch vụ chuẩn của máy in nhiệt Bluetooth (thường gặp)
const PRINT_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINT_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

let printDevice: any = null;
let printCharacteristic: any = null;

// Hàm xóa dấu Tiếng Việt để in an toàn trên máy in nhiệt giá rẻ
const removeAccents = (str: string): string => {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D");
};

// Hàm chuyển đổi số thành chữ Tiếng Việt (Không dấu để in thermal)
const numberToWordsNoAccent = (total: number): string => {
  if (total === 0) return "Khong dong";

  const units = ["", "mot", "hai", "ba", "bon", "nam", "sau", "bay", "tam", "chin"];
  const levels = ["", "nghin", "trieu", "ty"];

  const readThreeDigits = (num: number, isLast: boolean): string => {
    let res = "";
    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const u = num % 10;

    if (h > 0) {
      res += units[h] + " tram ";
    } else if (!isLast) {
      res += "khong tram ";
    }

    if (t > 1) {
      res += units[t] + " muoi ";
      if (u === 1) res += "mot";
      else if (u === 5) res += "lam";
      else if (u > 0) res += units[u];
    } else if (t === 1) {
      res += "muoi ";
      if (u === 5) res += "lam";
      else if (u > 0) res += units[u];
    } else if (u > 0) {
      if (!isLast || h > 0) res += "le ";
      res += units[u];
    }
    return res.trim();
  };

  let res = "";
  let levelIdx = 0;
  let remaining = total;

  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const chunkStr = readThreeDigits(chunk, remaining < 1000);
      res = chunkStr + " " + levels[levelIdx] + " " + res;
    }
    remaining = Math.floor(remaining / 1000);
    levelIdx++;
  }

  res = res.trim();
  return res.charAt(0).toUpperCase() + res.slice(1) + " dong";
};

export const connectPrinter = async (): Promise<string> => {
  try {
    if (!(navigator as any).bluetooth) {
      throw new Error("Trình duyệt này không hỗ trợ Web Bluetooth. Hãy dùng Chrome trên Android/Windows.");
    }

    const device = await (navigator as any).bluetooth.requestDevice({
      filters: [{ services: [PRINT_SERVICE_UUID] }],
      optionalServices: [PRINT_SERVICE_UUID]
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(PRINT_SERVICE_UUID);
    printCharacteristic = await service.getCharacteristic(PRINT_CHARACTERISTIC_UUID);
    printDevice = device;

    device.addEventListener('gattserverdisconnected', () => {
      printDevice = null;
      printCharacteristic = null;
      console.log("Printer disconnected");
    });

    return device.name || "Máy in Bluetooth";
  } catch (error) {
    console.error("Bluetooth Error:", error);
    throw error;
  }
};

export const disconnectPrinter = () => {
  if (printDevice && printDevice.gatt.connected) {
    printDevice.gatt.disconnect();
  }
  printDevice = null;
  printCharacteristic = null;
};

// Hàm gửi dữ liệu xuống máy in với cơ chế an toàn (Chunking + Retry)
const sendData = async (data: Uint8Array) => {
  if (!printCharacteristic) throw new Error("Chưa kết nối máy in!");

  // GIẢM KÍCH THƯỚC CHUNK: Bluetooth LE thường có MTU thấp (~23 bytes).
  // 100 bytes quá lớn, gây lỗi GATT operation failed.
  // 40 bytes là mức an toàn cho hầu hết máy in nhiệt Bluetooth.
  const CHUNK_SIZE = 40;

  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);

    let retries = 0;
    let success = false;

    // Cơ chế Retry nếu gặp lỗi GATT (do nghẽn buffer)
    while (!success && retries < 3) {
      try {
        await printCharacteristic.writeValue(chunk);
        success = true;
      } catch (error) {
        console.warn(`Ghi chunk thất bại (lần ${retries + 1}), đang thử lại...`, error);
        retries++;
        // Backoff delay: Chờ lâu hơn mỗi lần retry (100ms, 200ms, 300ms)
        await new Promise(r => setTimeout(r, 100 * retries));
      }
    }

    if (!success) {
      throw new Error("Mất kết nối với máy in hoặc máy in đang bận (GATT Error). Hãy thử tắt bật lại máy in.");
    }

    // TĂNG DELAY: Chờ máy in xử lý buffer trước khi gửi gói tiếp theo.
    // Tăng từ 20ms lên 50ms để ổn định hơn.
    await new Promise(r => setTimeout(r, 50));
  }
};

const CMD = {
  INIT: [0x1B, 0x40],
  CENTER: [0x1B, 0x61, 0x01],
  LEFT: [0x1B, 0x61, 0x00],
  BOLD_ON: [0x1B, 0x45, 0x01],
  BOLD_OFF: [0x1B, 0x45, 0x00],
  FEED: [0x0A],
  CUT: [0x1D, 0x56, 0x41, 0x00]
};

export const printBillBluetooth = async (bill: Bill) => {
  if (!printCharacteristic) throw new Error("Chưa kết nối máy in!");

  const encoder = new TextEncoder();
  const commands: number[] = [];

  const add = (...bytes: number[]) => commands.push(...bytes);
  const text = (str: string) => {
    const cleanStr = removeAccents(str);
    const encoded = encoder.encode(cleanStr);
    encoded.forEach(b => commands.push(b));
  };
  const nl = () => add(0x0A);

  add(...CMD.INIT);

  add(...CMD.CENTER);
  add(...CMD.BOLD_ON);
  text("VNPT NAM BUON MA THUOT"); nl();
  add(...CMD.BOLD_OFF);
  text("Dia chi: 06 Le Duan, Buon Ma Thuot, Dak Lak"); nl();
  text("--------------------------------"); nl();

  add(...CMD.BOLD_ON);
  text("THONG BAO CUOC"); nl();
  text(`Ky cuoc: ${bill.period}`); nl();
  add(...CMD.BOLD_OFF);
  nl();

  add(...CMD.LEFT);
  text(`Ten KH: ${bill.customerName}`); nl();
  if (bill.subscriberNumber) { text(`So TB : ${bill.subscriberNumber}`); nl(); }
  if (bill.paymentCode) { text(`Ma TT : ${bill.paymentCode}`); nl(); }
  if (bill.phone) { text(`DT    : ${bill.phone}`); nl(); }
  text(`Dia chi: ${bill.address}`); nl();

  add(...CMD.CENTER);
  text("--------------------------------"); nl();

  add(...CMD.LEFT);

  text(`TONG CONG     : ${bill.total.toLocaleString('vi-VN')} d`); nl();


  text(`${numberToWordsNoAccent(bill.total)}`); nl();

  text("(Da bao gom VAT)"); nl();

  add(...CMD.CENTER);
  text("--------------------------------"); nl();
  add(...CMD.LEFT);
  text("Nhan vien ho tro:"); nl();
  add(...CMD.LEFT);
  text(`${bill.staff.code}`); nl();
  text("--------------------------------");
  add(...CMD.CENTER);
  const now = new Date();
  const timeStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  text(`Thoi gian: ${timeStr}`); nl();
  text("--------------------------------"); nl();

  nl(); nl(); nl(); nl();

  await sendData(new Uint8Array(commands));
};

// Hàm in QR và thông tin thanh toán chuyển khoản
export const printPaymentQR = async (bill: Bill) => {
  if (!printCharacteristic) throw new Error("Chưa kết nối máy in!");

  const encoder = new TextEncoder();
  const commands: number[] = [];

  const add = (...bytes: number[]) => commands.push(...bytes);
  const text = (str: string) => {
    const cleanStr = removeAccents(str);
    const encoded = encoder.encode(cleanStr);
    encoded.forEach(b => commands.push(b));
  };
  const nl = () => add(0x0A);

  add(...CMD.INIT);
  add(...CMD.CENTER);
  add(...CMD.BOLD_ON);
  text("HUONG DAN THANH TOAN"); nl();
  add(...CMD.BOLD_OFF);
  text("--------------------------------"); nl();

  add(...CMD.LEFT);
  text(`KH: ${bill.customerName}`); nl();
  text(`Ky cuoc: ${bill.period}`); nl();
  text(`So tien: ${bill.total.toLocaleString('vi-VN')} d`); nl();
  text("--------------------------------"); nl();

  add(...CMD.CENTER);
  text("CHUYEN KHOAN NGAN HANG"); nl();
  text("NGAN HANG: BIDV"); nl();
  text("STK: 8825006143"); nl();
  text("CHU TK: NGO TAN THONG"); nl();

  text("Noi dung CK: " + bill.customerName); nl();
  text("Luu y: Kiem tra ten TK truoc khi CK"); nl();

  text("--------------------------------"); nl();
  text("Khuyen mai: Dong 12 thang tang 1 thang"); nl();
  text("--------------------------------"); nl();
  add(...CMD.LEFT);
  text("Nhan vien ho tro:"); nl();
  text(bill.staff.code || "Nhan vien VNPT"); nl();

  nl(); nl(); nl(); nl();
  await sendData(new Uint8Array(commands));
};

// Hàm in phiếu báo hỏng
export const printFaultReport = async (bill: Bill) => {
  if (!printCharacteristic) throw new Error("Chưa kết nối máy in!");

  const encoder = new TextEncoder();
  const commands: number[] = [];

  const add = (...bytes: number[]) => commands.push(...bytes);
  const text = (str: string) => {
    const cleanStr = removeAccents(str);
    const encoded = encoder.encode(cleanStr);
    encoded.forEach(b => commands.push(b));
  };
  const nl = () => add(0x0A);

  add(...CMD.INIT);

  // Header
  add(...CMD.CENTER);
  add(...CMD.BOLD_ON);
  text("VNPT BAC BUON MA THUOT"); nl();
  add(...CMD.BOLD_OFF);
  text("--------------------------------"); nl();

  // Title
  add(...CMD.BOLD_ON);
  text("PHIEU BAO HONG"); nl();
  add(...CMD.BOLD_OFF);
  nl();

  // Content
  add(...CMD.LEFT);
  text(`KH    : ${bill.customerName}`); nl();
  text(`Dia chi: ${bill.address}`); nl();
  if (bill.subscriberNumber) { text(`So TB : ${bill.subscriberNumber}`); nl(); }
  if (bill.phone) { text(`SDT   : ${bill.phone}`); nl(); }

  text("--------------------------------"); nl();

  // Note / Issue
  if (bill.note) {
    text(`Ghi chu: ${bill.note}`); nl();
  }
  text("Ly do: Bao hong dich vu mang/TV"); nl();
  nl();

  // Hotline Instruction (Important)
  add(...CMD.CENTER);
  add(...CMD.BOLD_ON);
  text("TONG DAI BAO HONG:"); nl();

  // Double height/width if possible, or just bold
  text("1800 1166"); nl();
  add(...CMD.BOLD_OFF);
  text("(Nhan phim 1 - Mien phi)"); nl();

  text("--------------------------------"); nl();

  // Footer
  add(...CMD.LEFT);
  text(`NV Ho tro: ${bill.staff.code}`); nl();
  const now = new Date();
  const timeStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  text(`Thoi gian: ${timeStr}`); nl();

  nl(); nl(); nl(); nl();
  await sendData(new Uint8Array(commands));
};
