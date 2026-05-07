
export interface Staff {
  code: string;
  name: string;
  phone: string;
}

export interface Bill {
  id: string;
  customerName: string;
  subscriberNumber: string;
  paymentCode: string;
  phone: string;
  address: string;
  location?: string;   // Link Google Maps
  qrLink?: string;     // Link QR Payment
  period: string; // e.g., "11/2025"
  oldDebt: number;
  incurredFee: number;
  total: number;
  staff: Staff;
  note: string;        // Ghi chú
  lastPrinted: string; // Thời gian in lần cuối
  status?: string;     // Trạng thái khách hàng (Vắng nhà, Khiếu nại...)
}

export type PaperSize = '58mm' | '80mm';

// --- NEW: Sync Interface ---
export interface SyncTask {
  id: string;          // ID duy nhất của task (uuid)
  type: 'ADD' | 'UPDATE';
  payload: any;        // Dữ liệu cần gửi (Bill hoặc Partial<Bill>)
  timestamp: number;   // Thời gian tạo task
  retryCount: number;  // Số lần thử lại
}
