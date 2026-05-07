
import React from 'react';
import { Bill, PaperSize } from '../types';

interface ReceiptProps {
  bill: Bill;
  paperSize: PaperSize;
}

// Hàm chuyển đổi số thành chữ Tiếng Việt cơ bản
const numberToWords = (total: number): string => {
  if (total === 0) return "Không đồng";
  
  const units = ["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
  const levels = ["", "nghìn", "triệu", "tỷ"];

  const readThreeDigits = (num: number, isLast: boolean): string => {
    let res = "";
    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const u = num % 10;

    if (h > 0) {
      res += units[h] + " trăm ";
    } else if (!isLast) {
      res += "không trăm ";
    }

    if (t > 1) {
      res += units[t] + " mươi ";
      if (u === 1) res += "mốt";
      else if (u === 5) res += "lăm";
      else if (u > 0) res += units[u];
    } else if (t === 1) {
      res += "mười ";
      if (u === 5) res += "lăm";
      else if (u > 0) res += units[u];
    } else if (u > 0) {
      if (!isLast || h > 0) res += "lẻ ";
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
  return res.charAt(0).toUpperCase() + res.slice(1) + " đồng";
};

const Receipt: React.FC<ReceiptProps> = ({ bill, paperSize }) => {
  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('vi-VN') + ' đ';
  };

  const now = new Date();
  const timeString = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  const widthClass = paperSize === '58mm' ? 'w-[58mm]' : 'w-[80mm]';

  return (
    <div className={`${widthClass} font-mono text-xs leading-tight bg-white p-2 text-black mx-auto`}>
      {/* Header */}
      <div className="text-center font-bold mb-2">
        <h1 className="text-sm">VNPT BẮC BUÔN MA THUỘT</h1>
        <p className="font-normal text-[10px] leading-tight mt-1">Địa chỉ: 219 Ngô Quyền, Buôn Ma Thuột, Đắk Lắk</p>
        <div className="border-b-2 border-dashed border-black my-1"></div>
        <h2 className="text-sm uppercase mt-2">THÔNG BÁO CƯỚC</h2>
        <p className="mt-1">KỲ CƯỚC: {bill.period}</p>
      </div>

      {/* Customer Info */}
      <div className="flex flex-col gap-1 mb-2">
        <div className="flex">
          <span className="w-16 shrink-0">Tên KH:</span>
          <span className="font-bold break-words flex-1">{bill.customerName}</span>
        </div>
        {bill.subscriberNumber && (
          <div className="flex">
            <span className="w-16 shrink-0">Số TB:</span>
            <span className="font-bold break-words flex-1">{bill.subscriberNumber}</span>
          </div>
        )}
        {bill.paymentCode && (
          <div className="flex">
            <span className="w-16 shrink-0">Mã TT:</span>
            <span className="font-bold break-words flex-1">{bill.paymentCode}</span>
          </div>
        )}
        {bill.phone && (
          <div className="flex">
            <span className="w-16 shrink-0">Điện thoại:</span>
            <span className="break-words flex-1">{bill.phone}</span>
          </div>
        )}
        <div className="flex flex-col">
          <span className="w-16 shrink-0">Địa chỉ:</span>
          <span className="break-words">{bill.address}</span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-b-2 border-dashed border-black my-2"></div>

      {/* Financials */}
      <div className="flex flex-col gap-1 mb-2">
        <div className="flex justify-between text-sm font-bold mt-1">
          <span>TỔNG TIỀN:</span>
          <span>{formatCurrency(bill.total)}</span>
        </div>
        <div className="text-[10px] italic leading-tight mt-1">
          <span className="font-bold"></span>
          {numberToWords(bill.total)}
        </div>
        <div className="text-right italic text-[10px] mt-1">
          (Đã bao gồm VAT)
        </div>
      </div>

      {/* Divider */}
      <div className="border-b-2 border-dashed border-black my-2"></div>

      {/* Footer / Staff Info */}
      <div className="mb-4">
        <p className="font-bold">NV thu cước:</p>
        <p>{bill.staff.code}</p>
      </div>

      <div className="text-center mb-2">
        <p>Thời gian in: {timeString}</p>
        <div className="border-b-2 border-dashed border-black my-2"></div>
      </div>
      
      {/* Space for cutting paper */}
      <div className="h-4"></div>
    </div>
  );
};

export default Receipt;
