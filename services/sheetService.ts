
import { Bill, SyncTask } from '../types';

export interface SheetConfig {
  url: string;
  enabled: boolean;
}

const CONFIG_KEY = 'vnpt_sheet_config';
const SYNC_QUEUE_KEY = 'vnpt_sync_queue';
const DEFAULT_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxy-xkOluPvQ-F0lP1BPgsF4EPqCW5juY9I1aKorDZv9oO60HRbXEM04bMVlhVmLP8Bjg/exec';

export const getSheetConfig = (): SheetConfig => {
  try {
    const data = localStorage.getItem(CONFIG_KEY);
    if (data) {
      const config = JSON.parse(data);
      // Nếu chưa có URL (lần đầu hoặc cũ nhưng để trống), dùng default URL
      if (!config.url) {
        return { ...config, url: DEFAULT_SHEET_URL };
      }
      return config;
    }
    // Mặc định cho người dùng hoàn toàn mới
    return { url: DEFAULT_SHEET_URL, enabled: true };
  } catch {
    return { url: DEFAULT_SHEET_URL, enabled: true };
  }
};

export const saveSheetConfig = (config: SheetConfig) => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
};

// --- SYNC QUEUE MANAGEMENT ---

export const getSyncQueue = (): SyncTask[] => {
  try {
    const data = localStorage.getItem(SYNC_QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

const saveSyncQueue = (queue: SyncTask[]) => {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
};

export const addToSyncQueue = (type: 'ADD' | 'UPDATE', payload: any) => {
  const queue = getSyncQueue();
  // Nếu là UPDATE, kiểm tra xem đã có task update cho ID này chưa, nếu có thì merge
  if (type === 'UPDATE') {
    const existingIndex = queue.findIndex(t => t.type === 'UPDATE' && t.payload.id === payload.id);
    if (existingIndex !== -1) {
      // Merge data mới vào task cũ
      queue[existingIndex].payload = { ...queue[existingIndex].payload, ...payload };
      queue[existingIndex].timestamp = Date.now(); // Update timestamp để ưu tiên xử lý sau
      saveSyncQueue(queue);
      return;
    }
  }

  const task: SyncTask = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
    type,
    payload,
    timestamp: Date.now(),
    retryCount: 0
  };
  queue.push(task);
  saveSyncQueue(queue);
};

// Hàm xử lý đồng bộ hàng đợi
export const processSyncQueue = async (url: string): Promise<number> => {
  if (!navigator.onLine) return 0;

  const queue = getSyncQueue();
  if (queue.length === 0) return 0;

  const cleanUrl = normalizeUrl(url);
  let successCount = 0;
  const remainingQueue: SyncTask[] = [];

  // Xử lý tuần tự để đảm bảo tính nhất quán
  for (const task of queue) {
    try {
      const apiPayload = {
        action: task.type,
        data: task.payload
      };

      const response = await fetch(cleanUrl, {
        method: 'POST',
        body: JSON.stringify(apiPayload),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      });

      if (response.ok) {
        const resJson = await response.json();
        if (resJson.status === 'success') {
          successCount++;
          continue; // Thành công, không thêm vào remainingQueue (xóa khỏi hàng đợi)
        }
      }

      // Nếu server trả lỗi logic hoặc không ok, giữ lại
      task.retryCount++;
      remainingQueue.push(task);

    } catch (error) {
      console.error("Sync task failed:", error);
      task.retryCount++;
      remainingQueue.push(task); // Giữ lại nếu lỗi mạng
    }
  }

  saveSyncQueue(remainingQueue);
  return successCount;
};


// --- API CALLS ---

// Hàm chuẩn hóa URL để tránh lỗi người dùng copy nhầm
const normalizeUrl = (url: string): string => {
  let clean = url.trim();
  // Nếu copy link edit, chuyển thành exec
  if (clean.includes('/edit')) {
    clean = clean.split('/edit')[0] + '/exec';
  }
  // Nếu copy link dev, chuyển thành exec
  if (clean.endsWith('/dev')) {
    clean = clean.replace('/dev', '/exec');
  }
  return clean;
}

export const fetchBillsFromAPI = async (url: string): Promise<Bill[]> => {
  const cleanUrl = normalizeUrl(url);
  const finalUrl = `${cleanUrl}?t=${Date.now()}`;

  try {
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'text/plain',
      }
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") === -1) {
      throw new Error("Server returned HTML instead of JSON. Check URL or Script Permissions.");
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("API Fetch Error:", error);
    throw error;
  }
};

// Các hàm này giờ chỉ là wrapper gọi fetch trực tiếp. 
// Logic "thất bại -> queue" sẽ nằm ở App.tsx để điều khiển UI tốt hơn
export const updateBillAPI = async (url: string, billData: Partial<Bill> & { id: string }) => {
  const cleanUrl = normalizeUrl(url);
  const payload = { action: 'UPDATE', data: billData };
  const response = await fetch(cleanUrl, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  });
  if (!response.ok) throw new Error("Network error during update");
  return await response.json();
};

export const addBillAPI = async (url: string, bill: Bill) => {
  const cleanUrl = normalizeUrl(url);
  const payload = { action: 'ADD', data: bill };
  const response = await fetch(cleanUrl, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  });
  if (!response.ok) throw new Error("Network error during add");
  return await response.json();
};
