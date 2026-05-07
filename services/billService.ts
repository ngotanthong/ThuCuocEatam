import { Bill } from '../types';

const STORAGE_KEY = 'vnpt_bills_data';

// Hàm lấy dữ liệu từ LocalStorage
export const getBills = async (): Promise<Bill[]> => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error("Lỗi đọc dữ liệu local:", error);
    return [];
  }
};

// Hàm lưu toàn bộ danh sách bill (Ghi đè)
// Hàm này sẽ được gọi tự động mỗi khi dữ liệu thay đổi trên giao diện
export const saveBills = (bills: Bill[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bills));
    // console.log(`Đã đồng bộ ${bills.length} bản ghi vào bộ nhớ.`);
  } catch (error) {
    console.error("Lỗi lưu dữ liệu (Bộ nhớ đầy?):", error);
    alert("Cảnh báo: Bộ nhớ trình duyệt đã đầy. Dữ liệu mới có thể không được lưu. Vui lòng xóa bớt dữ liệu cũ.");
  }
};